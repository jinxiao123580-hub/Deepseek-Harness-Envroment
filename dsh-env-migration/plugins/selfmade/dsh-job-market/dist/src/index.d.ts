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
import type { WorkspaceRegistryLike } from './workspace/workspace.js';
import { jobMarketSkill } from './skill/job-market.skill.js';
export declare const name = "dsh-job-market";
/** 需要宿主提供的能力：工具注册、技能注册、工作区注册表。 */
export declare const inject: string[];
/** 配置校验入口：把配置错误变成可读的 issue，而不是启动期崩溃。 */
export declare const Config: {
    '~standard': {
        version: 1;
        vendor: string;
        validate(value: unknown): {
            value: JobMarketConfig;
            issues?: undefined;
        } | {
            value?: undefined;
            issues: {
                message: string;
            }[];
        };
    };
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
/**
 * 插件激活。
 *
 * 注册失败时按注册顺序逆序回滚，避免留下「一半工具可用」的坏状态
 * —— 这一点与上游一致，因为半注册状态下模型会挑到不存在的工具。
 */
export declare const apply: (ctx: PluginContext, configInput?: unknown) => (() => void);
export { jobMarketSkill };
export type { JobMarketConfig };
