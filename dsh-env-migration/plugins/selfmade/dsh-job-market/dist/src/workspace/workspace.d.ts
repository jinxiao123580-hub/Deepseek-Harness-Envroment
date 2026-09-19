/**
 * 工作区解析与原子 JSON 读写。
 *
 * 设计对齐上游 `dsh-job-hunting/dist/src/workspace/workspace-output.js`：
 *  - `WorkspaceContext` 形状一致，便于与 job-hunting 插件共享同一工作区
 *  - 原子写：`.{basename}.{pid}.{timestamp}.tmp` → `rename`
 *  - 输出树目录结构与上游一致（input/resumes、profile、data、reports、assets、config）
 */
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
export declare class WorkspaceNotFoundError extends Error {
    readonly code = "WS_NOT_FOUND";
    readonly sessionId: string | undefined;
    readonly cwd: string | undefined;
    constructor(details: {
        sessionId: string | undefined;
        cwd: string | undefined;
    });
}
/** 解析当前会话的活动工作区：优先按 sessionId，其次按 cwd，最后退回唯一工作区。 */
export declare const resolveActiveWorkspace: (ctx: DshContext) => Promise<WorkspaceContext>;
/** 相对工作区的绝对路径。 */
export declare const resolveOutputRoot: (workspace: WorkspaceContext, relativePath: string) => string;
/** 输出树目录（与上游保持一致，便于两个插件共用一个工作区）。 */
export declare const WORKSPACE_DIRECTORIES: readonly ['input/resumes', 'profile', 'data', 'reports', 'assets', 'config', 'taxonomy'];
export declare const ensureOutputTree: (root: string) => Promise<void>;
/** 文件是否存在。 */
export declare const pathExists: (path: string) => Promise<boolean>;
/** 原子写：先写临时文件再 rename，避免半截文件。 */
export declare const writeFileAtomic: (path: string, content: string) => Promise<void>;
/** 读取 JSON；文件缺失返回 `undefined`，内容损坏抛出可读错误。 */
export declare const readJsonFile: <T>(path: string) => Promise<T | undefined>;
export declare const writeJsonFile: (path: string, value: unknown) => Promise<void>;
export declare const readWorkspaceJson: <T>(root: string, relativePath: string) => Promise<T | undefined>;
export declare const writeWorkspaceJson: <T>(root: string, relativePath: string, value: T) => Promise<void>;
