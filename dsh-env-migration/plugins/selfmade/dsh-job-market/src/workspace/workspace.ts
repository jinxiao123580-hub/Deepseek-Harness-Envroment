/**
 * 工作区解析与原子 JSON 读写。
 *
 * 设计对齐上游 `dsh-job-hunting/dist/src/workspace/workspace-output.js`：
 *  - `WorkspaceContext` 形状一致，便于与 job-hunting 插件共享同一工作区
 *  - 原子写：`.{basename}.{pid}.{timestamp}.tmp` → `rename`
 *  - 输出树目录结构与上游一致（input/resumes、profile、data、reports、assets、config）
 */

import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type WorkspaceStatus = 'ok' | 'missing-dir';

export interface WorkspaceContext {
    id: string;
    path: string;
    sessionIds: readonly string[];
    status: WorkspaceStatus;
}

export interface WorkspaceRecordLike {
    id: string;
    path: string;
    sessionIds: readonly string[];
    status?: WorkspaceStatus | (() => Promise<WorkspaceStatus>) | (() => WorkspaceStatus);
}

export interface WorkspaceRegistryLike {
    get(id: string): WorkspaceRecordLike | undefined;
    list(): WorkspaceRecordLike[];
    resolveByPath(path: string): Promise<WorkspaceRecordLike | undefined>;
}

/** 宿主 DSH 上下文的最小面（与上游 DshContext 对齐）。 */
export interface DshContext {
    agent?: {
        sessionId?: string;
        session?: {
            meta?: {
                cwd?: string;
            };
        };
    };
    workspaceRegistry?: WorkspaceRegistryLike;
}

export class WorkspaceNotFoundError extends Error {
    readonly code = 'WS_NOT_FOUND';
    readonly sessionId: string | undefined;
    readonly cwd: string | undefined;
    constructor(details: { sessionId: string | undefined; cwd: string | undefined }) {
        super(
            `无法解析当前会话的 Workspace（sessionId=${details.sessionId ?? '未提供'}，cwd=${details.cwd ?? '未提供'}）。` +
                '请先让 DSH 打开一个工作区目录，再重试。',
        );
        this.name = 'WorkspaceNotFoundError';
        this.sessionId = details.sessionId;
        this.cwd = details.cwd;
    }
}

const resolveStatus = async (record: WorkspaceRecordLike): Promise<WorkspaceStatus> => {
    if (typeof record.status === 'function') {
        return await record.status();
    }
    if (record.status !== undefined) {
        return record.status;
    }
    try {
        await access(record.path);
        return 'ok';
    } catch {
        return 'missing-dir';
    }
};

const toContext = async (record: WorkspaceRecordLike): Promise<WorkspaceContext> => ({
    id: record.id,
    path: record.path,
    sessionIds: record.sessionIds,
    status: await resolveStatus(record),
});

/** 解析当前会话的活动工作区：优先按 sessionId，其次按 cwd，最后退回唯一工作区。 */
export const resolveActiveWorkspace = async (ctx: DshContext): Promise<WorkspaceContext> => {
    const registry = ctx.workspaceRegistry;
    const sessionId = ctx.agent?.sessionId;
    const cwd = ctx.agent?.session?.meta?.cwd;
    if (registry === undefined) {
        throw new WorkspaceNotFoundError({ sessionId, cwd });
    }

    if (sessionId !== undefined && sessionId !== '') {
        const record = registry.list().find((item) => item.sessionIds.includes(sessionId));
        if (record !== undefined) return await toContext(record);
    }

    if (cwd !== undefined && cwd !== '') {
        const byPath = await registry.resolveByPath(cwd);
        if (byPath !== undefined) return await toContext(byPath);
        const byPrefix = registry.list().find((item) => resolve(item.path) === resolve(cwd));
        if (byPrefix !== undefined) return await toContext(byPrefix);
    }

    const all = registry.list();
    if (all.length === 1 && all[0] !== undefined) return await toContext(all[0]);

    throw new WorkspaceNotFoundError({ sessionId, cwd });
};

/** 相对工作区的绝对路径。 */
export const resolveOutputRoot = (workspace: WorkspaceContext, relativePath: string): string =>
    join(workspace.path, relativePath);

/** 输出树目录（与上游保持一致，便于两个插件共用一个工作区）。 */
export const WORKSPACE_DIRECTORIES = [
    'input/resumes',
    'profile',
    'data',
    'reports',
    'assets',
    'config',
    'taxonomy',
] as const;

export const ensureOutputTree = async (root: string): Promise<void> => {
    for (const directory of WORKSPACE_DIRECTORIES) {
        await mkdir(join(root, directory), { recursive: true });
    }
};

/** 文件是否存在。 */
export const pathExists = async (path: string): Promise<boolean> => {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
};

/** 原子写：先写临时文件再 rename，避免半截文件。 */
export const writeFileAtomic = async (path: string, content: string): Promise<void> => {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.${path.split(/[\\/]/).pop() ?? 'file'}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, path);
};

/** 读取 JSON；文件缺失返回 `undefined`，内容损坏抛出可读错误。 */
export const readJsonFile = async <T>(path: string): Promise<T | undefined> => {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new Error(
            `JSON 文件内容损坏：${path}（${error instanceof Error ? error.message : String(error)}）`,
        );
    }
};

export const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
    await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
};

export const readWorkspaceJson = async <T>(root: string, relativePath: string): Promise<T | undefined> =>
    readJsonFile<T>(join(root, relativePath));

export const writeWorkspaceJson = async <T>(root: string, relativePath: string, value: T): Promise<void> =>
    writeJsonFile(join(root, relativePath), value);
