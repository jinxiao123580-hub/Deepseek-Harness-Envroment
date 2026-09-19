/**
 * DSH 插件入口（cordis）。
 *
 * 结构对齐上游 `dsh-job-hunting/dist/src/index.js`，因此两个插件可以：
 *  - 装进同一个 profile，甚至同一个 Workspace
 *  - 共享 `data/jobs.json` 与 `profile/` 目录约定
 *  - 被同一套 `dsh plugin --profile <name> add <pkg>` 流程管理
 *
 * 与上游的差别只有一点：本插件把「市场分析 + 学习规划」做成一等公民，
 * 采集仍是只读的 BrowserSkill 通道（且非唯一入口，可用本地导入兜底）。
 */

import type { JobMarketConfig } from './shared/types.js';
import { defaultConfig, parseConfig } from './shared/config.js';
import { resolveActiveWorkspace } from './workspace/workspace.js';
import type { DshContext, WorkspaceRegistryLike } from './workspace/workspace.js';
import { createJobMarketTools } from './tools/index.js';
import { jobMarketSkill } from './skill/job-market.skill.js';

export const name = 'dsh-job-market';

/** 需要宿主提供的能力：工具注册、技能注册、工作区注册表。 */
export const inject = ['tools', 'skills', 'workspaceRegistry'];

/** 配置校验入口：把配置错误变成可读的 issue，而不是启动期崩溃。 */
export const Config = {
    '~standard': {
        version: 1 as const,
        vendor: 'dsh-job-market',
        validate(value: unknown) {
            try {
                return { value: parseConfig(value) };
            } catch (error) {
                return {
                    issues: [{ message: error instanceof Error ? error.message : String(error) }],
                };
            }
        },
    },
};

interface ToolRegistryLike {
    register(tool: unknown): () => void;
}
interface SkillRegistryLike {
    register(skill: unknown): () => void;
}

export interface PluginContext {
    tools: ToolRegistryLike;
    skills: SkillRegistryLike;
    workspaceRegistry: WorkspaceRegistryLike;
}

interface ExecLike {
    agent?: {
        id?: unknown;
        session?: { header?: { cwd?: string } };
    };
}

/** 把 cordis 上下文 + 工具执行上下文拼成工作区解析所需的最小面。 */
const toWorkspaceContext = (ctx: PluginContext, exec: ExecLike): DshContext => {
    const cwd = exec.agent?.session?.header?.cwd;
    const id = exec.agent?.id;
    return {
        workspaceRegistry: ctx.workspaceRegistry,
        ...(id === undefined && cwd === undefined
            ? {}
            : {
                  agent: {
                      ...(id === undefined ? {} : { sessionId: String(id) }),
                      ...(cwd === undefined ? {} : { session: { meta: { cwd } } }),
                  },
              }),
    };
};

/**
 * 插件激活。
 *
 * 注册失败时按注册顺序逆序回滚，避免留下「一半工具可用」的坏状态
 * —— 这一点与上游一致，因为半注册状态下模型会挑到不存在的工具。
 */
export const apply = (ctx: PluginContext, configInput: unknown = defaultConfig): (() => void) => {
    const config: JobMarketConfig = parseConfig(configInput);
    const resolveWorkspace = async (exec: unknown) =>
        await resolveActiveWorkspace(toWorkspaceContext(ctx, (exec ?? {}) as ExecLike));

    const disposers: (() => void)[] = [];
    try {
        for (const tool of createJobMarketTools(resolveWorkspace, config)) {
            disposers.push(ctx.tools.register(tool));
        }
        disposers.push(ctx.skills.register(jobMarketSkill));
    } catch (error) {
        for (const dispose of disposers.reverse()) dispose();
        throw error;
    }

    return () => {
        for (const dispose of disposers.reverse()) dispose();
    };
};

export { jobMarketSkill };
export type { JobMarketConfig };
