/**
 * DSH 工具注册层。
 *
 * 每个工具对应需求里的一个用户动作，用户只要在 DSH 里说一句自然语言，
 * 宿主 agent 就会挑对应工具执行：
 *
 *   「分析一下现在机器人软件岗位需要什么」→ job_market_analyze
 *   「根据目前岗位市场给我生成未来8周学习计划」→ job_market_plan_learning
 *   「更新一下求职市场」→ job_market_update
 *
 * 安全约束（需求 §十八）在这里落地为参数级强制：
 *  - 采集类工具必须 `confirmed: true`（const 约束，模型无法默认填 true）
 *  - 采集走 `collectWithBrowserSkill`，内部强制只读模式 + 域名白名单 + 人工批准
 *  - 个人能力写入必须 `confirmed: true`，AI 不得擅自认定已掌握
 */
import type { JobMarketConfig } from '../shared/types.js';
import { BrowserHumanAssistanceRequiredError, BrowserSkillUnavailableError } from '../collect/browser-collector.js';
import type { WorkspaceContext } from '../workspace/workspace.js';
type ResolveWorkspace = (exec: unknown) => Promise<WorkspaceContext>;
/**
 * 工具工厂。
 *
 * `resolveWorkspace` 由插件入口提供（与上游 job-hunting 完全一致的方式），
 * 每次执行都重新解析，保证多工作区/多会话下不会串数据。
 */
export declare const createJobMarketTools: (resolveWorkspace: ResolveWorkspace, config: JobMarketConfig) => unknown[];
/** 供工具层复用的错误类型导出，便于宿主 agent 区分「需要人工介入」。 */
export { BrowserHumanAssistanceRequiredError, BrowserSkillUnavailableError };
