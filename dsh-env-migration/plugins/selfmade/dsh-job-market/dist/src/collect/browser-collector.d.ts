/**
 * 只读浏览器采集适配器（需求 §十八）。
 *
 * 结构对齐上游 `dsh-job-hunting/dist/src/browser/{browser-skill-runner,browser-skill-adapter}.js`：
 *  - `SafeBskRunner` 只做「可执行文件 + 参数数组」的调用，**绝不拼 shell 字符串**，
 *    因此不存在命令注入面；
 *  - 命令序列固定为 `session start --no-focus` → `navigate`（带最小间隔节流）→ `snapshot`
 *    → **finally 中必定** `session stop <id>`；只有在拿不到 session id 的异常路径上
 *    才用 `session stop --all` 兜底清理；
 *  - 一旦检测到验证码 / 登录失效 / 支付 / 提交确认等，立刻抛出
 *    `BrowserHumanAssistanceRequiredError`，由上层停止该平台并转人工，
 *    **不尝试任何绕过**（不破验证码、不绕登录、不自动投递、不发消息、不规避限速）；
 *  - 浏览器技能不可用时如实报告不可用，**绝不静默切换到别的采集路径**。
 *
 * 环境说明：默认执行器通过 `execFile` 管道捕获子进程输出，在受限沙箱中
 * 管道 stdio 可能被拒绝（EPERM）。这属于宿主策略边界，**不做降级绕过**：
 * 此时如实返回失败，由调用方决定是否改用注入式 runner（测试）或人工处理。
 */
import type { BrowserSkillPolicyConfig, CollectionTarget, CollectionOutcome, HumanAssistanceReason } from '../shared/types.js';
import type { RawJobRecord } from './platforms.js';
export interface BskCommandResult {
    exitCode: number;
    stdout: string;
    stderr?: string;
}
/** 命令执行抽象：测试可注入假 runner，真实运行走 `SafeBskRunner`。 */
export interface BskRunner {
    run(args: readonly string[]): Promise<BskCommandResult>;
}
export interface BrowserSkillStatus {
    available: boolean;
    executable: string;
    version?: string;
    message?: string;
}
export type BskCommandExecutor = (executable: string, args: readonly string[]) => Promise<BskCommandResult>;
/** 只读运行器：只允许白名单子命令，参数始终以数组传递。 */
export declare class SafeBskRunner implements BskRunner {
    private readonly executable;
    private readonly execute;
    constructor(executable?: string, execute?: BskCommandExecutor);
    run(args: readonly string[]): Promise<BskCommandResult>;
}
export declare const createSafeBskRunner: (executable?: string, execute?: BskCommandExecutor) => BskRunner;
/**
 * 探测浏览器技能是否可用。
 * 先试 `--version`，失败再退到 `status`；可执行文件缺失（ENOENT）不抛异常，
 * 而是返回 `available: false`，让上层明确知道「这条路不可用」。
 */
export declare const checkBrowserSkill: (executable: string, runner?: BskRunner) => Promise<BrowserSkillStatus>;
/** 需要人工介入：验证码 / 登录 / 一次性验证码 / 支付 / 提交确认。 */
export declare class BrowserHumanAssistanceRequiredError extends Error {
    readonly reason: HumanAssistanceReason;
    readonly code = "HUMAN_ASSISTANCE_REQUIRED";
    constructor(reason: HumanAssistanceReason, detail?: string);
}
/** 浏览器技能不可用：如实上报，不切换到其他未审计的采集路径。 */
export declare class BrowserSkillUnavailableError extends Error {
    readonly code = "BROWSERSKILL_UNAVAILABLE";
    constructor(status: BrowserSkillStatus);
}
/**
 * 执行一次只读采集，返回归一化的原始岗位记录。
 *
 * 顺序：策略校验 → 技能可用性 → session start → 逐条 URL 导航/快照 → finally 停止会话。
 * 任一环节检测到需要人工介入即抛 `BrowserHumanAssistanceRequiredError`。
 */
export declare const collectWithBrowserSkill: (request: {
    urls: readonly string[];
    config: BrowserSkillPolicyConfig;
    userApproved?: boolean;
    source?: string;
    collectedAt?: string;
    executable?: string;
    platformId?: string;
}, runner: BskRunner) => Promise<RawJobRecord[]>;
/**
 * 该采集结果是否要求中止当前平台的全部后续采集（需求 §十八）。
 * `needs-human` 表示需要人工介入，必须停平台而不是继续翻页。
 */
export declare const isAbortOutcome: (outcome: CollectionOutcome) => boolean;
/** 便于调用方构造 `needs-human` 结果的辅助（保持 abort 语义一致）。 */
export declare const needsHumanOutcome: (platform: CollectionOutcome['platform'], target: CollectionTarget, humanReason: HumanAssistanceReason, reason?: string) => CollectionOutcome;
