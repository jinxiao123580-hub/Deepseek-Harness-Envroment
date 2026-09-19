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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
    BrowserSkillPolicyConfig,
    CollectionTarget,
    CollectionOutcome,
    HumanAssistanceReason,
} from '../shared/types.js';
import { parseListingPayload } from './platforms.js';
import type { RawJobRecord } from './platforms.js';
import { validateBrowserPolicy } from './browser-policy.js';
import type { BrowserCollectionRequest } from './browser-policy.js';

/* ============================================================================
 * 执行器
 * ==========================================================================*/

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

const execFileAsync = promisify(execFile);

/** 默认执行器：参数数组直传，不开 shell。 */
const defaultCommandExecutor: BskCommandExecutor = async (executable, args) => {
    try {
        const result = await execFileAsync(executable, [...args], {
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
        });
        return {
            exitCode: 0,
            stdout: String(result.stdout),
            stderr: String(result.stderr),
        };
    } catch (error) {
        const commandError = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
        const message = typeof commandError.message === 'string' ? commandError.message : String(error);
        return {
            exitCode: typeof commandError.code === 'number' ? commandError.code : 1,
            stdout: commandError.stdout === undefined ? '' : String(commandError.stdout),
            stderr: commandError.stderr === undefined ? message : String(commandError.stderr),
        };
    }
};

/**
 * 允许下发给浏览器技能的子命令白名单。
 * 任何不在此列的调用都会被拒绝，确保适配器在结构上无法发起写入式操作。
 */
const SAFE_BSK_SUBCOMMANDS: readonly string[] = ['session', 'navigate', 'snapshot', 'status', '--version'];

/** 只读运行器：只允许白名单子命令，参数始终以数组传递。 */
export class SafeBskRunner implements BskRunner {
    private readonly executable: string;
    private readonly execute: BskCommandExecutor;

    constructor(executable = 'bsk', execute: BskCommandExecutor = defaultCommandExecutor) {
        this.executable = executable;
        this.execute = execute;
    }

    async run(args: readonly string[]): Promise<BskCommandResult> {
        const subcommand = args[0];
        if (subcommand === undefined || !SAFE_BSK_SUBCOMMANDS.includes(subcommand)) {
            throw new TypeError(`browser skill subcommand is not allowed: ${String(subcommand)}`);
        }
        return this.execute(this.executable, args);
    }
}

export const createSafeBskRunner = (executable = 'bsk', execute: BskCommandExecutor = defaultCommandExecutor): BskRunner =>
    new SafeBskRunner(executable, execute);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 探测浏览器技能是否可用。
 * 先试 `--version`，失败再退到 `status`；可执行文件缺失（ENOENT）不抛异常，
 * 而是返回 `available: false`，让上层明确知道「这条路不可用」。
 */
export const checkBrowserSkill = async (executable: string, runner?: BskRunner): Promise<BrowserSkillStatus> => {
    const activeRunner = runner ?? createSafeBskRunner(executable);
    let lastMessage: string | undefined;

    for (const probe of [['--version'], ['status']] as const) {
        try {
            const result = await activeRunner.run([...probe]);
            if (result.exitCode !== 0) {
                lastMessage = result.stderr?.trim() || result.stdout.trim() || `${probe.join(' ')} command failed`;
                continue;
            }
            const stdout = result.stdout.trim();
            let version: string | undefined;
            if (stdout !== '') {
                try {
                    const payload: unknown = JSON.parse(stdout);
                    if (isRecord(payload) && typeof payload.version === 'string') version = payload.version;
                } catch {
                    // 非 JSON 输出：把单行输出当作版本号。
                    version = stdout;
                }
            }
            return version === undefined ? { available: true, executable } : { available: true, executable, version };
        } catch (error) {
            lastMessage = error instanceof Error ? error.message : String(error);
        }
    }

    return lastMessage === undefined
        ? { available: false, executable }
        : { available: false, executable, message: lastMessage };
};

/* ============================================================================
 * 错误类型
 * ==========================================================================*/

/** 需要人工介入：验证码 / 登录 / 一次性验证码 / 支付 / 提交确认。 */
export class BrowserHumanAssistanceRequiredError extends Error {
    readonly reason: HumanAssistanceReason;
    readonly code = 'HUMAN_ASSISTANCE_REQUIRED';

    constructor(reason: HumanAssistanceReason, detail?: string) {
        super(`Human assistance required for BrowserSkill collection: ${detail ?? reason}`);
        this.name = 'BrowserHumanAssistanceRequiredError';
        this.reason = reason;
    }
}

/** 浏览器技能不可用：如实上报，不切换到其他未审计的采集路径。 */
export class BrowserSkillUnavailableError extends Error {
    readonly code = 'BROWSERSKILL_UNAVAILABLE';

    constructor(status: BrowserSkillStatus) {
        super(status.message ?? `BrowserSkill is unavailable: ${status.executable}`);
        this.name = 'BrowserSkillUnavailableError';
    }
}

/* ============================================================================
 * 会话 / 快照解析
 * ==========================================================================*/

const SESSION_ID_PATTERN = /^[A-Za-z0-9]{4}$/;
const CONTEXTUAL_SESSION_ID_PATTERN = /\b(?:session(?:\s+id|Id|_id)?|id)\s*[:=]\s*([A-Za-z0-9]{4})\b/i;

/** 解析 `session start` 的输出，取出 4 位会话 ID。 */
const readSessionId = (stdout: string): string => {
    const trimmed = stdout.trim();
    if (trimmed === '') {
        throw new Error('BrowserSkill did not return a session id');
    }
    let isJson = false;
    try {
        const parsed: unknown = JSON.parse(trimmed);
        isJson = true;
        if (isRecord(parsed)) {
            const sessionId = parsed.sessionId ?? parsed.session_id;
            if (typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId.trim())) {
                return sessionId.trim();
            }
        }
    } catch {
        // 也可能直接打印纯文本或 `session id: ab12` 这类带标签输出。
    }
    if (isJson) {
        throw new Error('BrowserSkill did not return a usable session id');
    }
    if (SESSION_ID_PATTERN.test(trimmed)) return trimmed;
    const contextual = CONTEXTUAL_SESSION_ID_PATTERN.exec(trimmed)?.[1];
    if (contextual !== undefined) return contextual;
    throw new Error('BrowserSkill did not return a usable session id');
};

/** 辅助需求文本 → 规范原因。识别不到返回 undefined（不误报）。 */
const readAssistanceReason = (value: unknown): HumanAssistanceReason | undefined => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    const normalized = text.toLowerCase();
    if (normalized.includes('captcha')) return 'captcha';
    if (normalized.includes('otp') || normalized.includes('one-time')) return 'otp';
    if (normalized.includes('payment')) return 'payment';
    if (normalized.includes('submit-confirmation') || normalized.includes('submission confirmation')) {
        return 'submit-confirmation';
    }
    if (
        normalized.includes('login') ||
        normalized.includes('sign in') ||
        normalized.includes('signin') ||
        normalized.includes('auth')
    ) {
        return 'login';
    }
    return undefined;
};

/** 校验命令结果，非 0 退出即抛错。 */
const assertCommandOk = (result: BskCommandResult, command: readonly string[]): BskCommandResult => {
    if (result.exitCode !== 0) {
        const detail = result.stderr?.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
        throw new Error(`BrowserSkill command failed (${command.join(' ')}): ${detail}`);
    }
    return result;
};

const sleep = async (ms: number): Promise<void> => {
    if (ms <= 0) return;
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};

/* ============================================================================
 * 采集主流程
 * ==========================================================================*/

/**
 * 执行一次只读采集，返回归一化的原始岗位记录。
 *
 * 顺序：策略校验 → 技能可用性 → session start → 逐条 URL 导航/快照 → finally 停止会话。
 * 任一环节检测到需要人工介入即抛 `BrowserHumanAssistanceRequiredError`。
 */
export const collectWithBrowserSkill = async (
    request: {
        urls: readonly string[];
        config: BrowserSkillPolicyConfig;
        userApproved?: boolean;
        source?: string;
        collectedAt?: string;
        executable?: string;
        platformId?: string;
    },
    runner: BskRunner,
): Promise<RawJobRecord[]> => {
    if (request.config.enabled !== true) {
        throw new Error('BrowserSkill collection is disabled');
    }

    const policyRequest: BrowserCollectionRequest = {
        urls: request.urls,
        config: request.config,
    };
    if (request.userApproved !== undefined) policyRequest.userApproved = request.userApproved;
    if (request.executable !== undefined) policyRequest.executable = request.executable;
    if (request.source !== undefined) policyRequest.source = request.source;
    if (request.collectedAt !== undefined) policyRequest.collectedAt = request.collectedAt;

    // 1) 安全策略：只读模式、白名单、人工批准、无写入式动作。
    validateBrowserPolicy(policyRequest, request.config);

    // 2) 技能可用性：不可用就如实失败，不换路径。
    const executable = request.executable ?? request.config.executable;
    const status = await checkBrowserSkill(executable, runner);
    if (!status.available) {
        throw new BrowserSkillUnavailableError(status);
    }

    const started = assertCommandOk(await runner.run(['session', 'start', '--no-focus']), [
        'session',
        'start',
        '--no-focus',
    ]);

    let sessionId: string | undefined;
    let collectionError: unknown;
    let cleanupError: Error | undefined;
    let records: RawJobRecord[] = [];

    try {
        sessionId = readSessionId(started.stdout);
        const snapshots: unknown[] = [];
        let lastNavigationAt: number | undefined;

        for (const url of request.urls) {
            // 限速：同一会话内两次导航之间至少间隔 minIntervalMs，绝不加速规避限流。
            if (lastNavigationAt !== undefined) {
                const remaining = request.config.minIntervalMs - (Date.now() - lastNavigationAt);
                await sleep(remaining);
            }
            const navigateCommand = ['navigate', url, '--session', sessionId];
            assertCommandOk(await runner.run(navigateCommand), navigateCommand);
            lastNavigationAt = Date.now();

            const snapshotCommand = ['snapshot', '--session', sessionId];
            const snapshot = assertCommandOk(await runner.run(snapshotCommand), snapshotCommand);
            snapshots.push(readSnapshotPayload(snapshot.stdout));
        }

        const collected: RawJobRecord[] = [];
        for (const payload of snapshots) {
            const assistance = readAssistanceReason(readAssistanceField(payload));
            if (assistance !== undefined) {
                throw new BrowserHumanAssistanceRequiredError(assistance);
            }
            collected.push(...parseListingPayload(request.platformId ?? request.source ?? 'browser-skill', payload));
        }
        records = collected.slice(0, request.config.maxItemsPerRun);
    } catch (error) {
        collectionError = error;
        if (sessionId === undefined) {
            // 会话已启动但拿不到可寻址的 id：仅在这条异常路径上用兜底清理。
            try {
                await runner.run(['session', 'stop', '--all']);
            } catch {
                // 保留原始解析错误，兜底清理失败不覆盖它。
            }
        }
    } finally {
        if (sessionId !== undefined) {
            const stopCommand = ['session', 'stop', sessionId];
            try {
                assertCommandOk(await runner.run(stopCommand), stopCommand);
            } catch (error) {
                // 采集已失败时，原始错误优先；否则把清理失败本身报出来。
                if (collectionError === undefined) {
                    const detail = error instanceof Error ? error.message : String(error);
                    cleanupError = new Error(`BrowserSkill session cleanup failed: ${detail}`, { cause: error });
                }
            }
        }
    }

    if (collectionError !== undefined) throw collectionError;
    if (cleanupError !== undefined) throw cleanupError;
    return records;
};

/** 快照必须是 JSON 对象。 */
const readSnapshotPayload = (stdout: string): Record<string, unknown> => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    } catch {
        throw new Error('BrowserSkill returned an invalid visible job payload');
    }
    if (!isRecord(parsed)) {
        throw new Error('BrowserSkill visible job payload must be an object');
    }
    return parsed;
};

/** 读取辅助需求标记字段。 */
const readAssistanceField = (payload: unknown): unknown => {
    if (!isRecord(payload)) return undefined;
    return payload.assistanceRequired ?? payload.humanAssistance ?? payload.requiresHuman;
};

/**
 * 该采集结果是否要求中止当前平台的全部后续采集（需求 §十八）。
 * `needs-human` 表示需要人工介入，必须停平台而不是继续翻页。
 */
export const isAbortOutcome = (outcome: CollectionOutcome): boolean => outcome.status === 'needs-human';

/** 便于调用方构造 `needs-human` 结果的辅助（保持 abort 语义一致）。 */
export const needsHumanOutcome = (
    platform: CollectionOutcome['platform'],
    target: CollectionTarget,
    humanReason: HumanAssistanceReason,
    reason?: string,
): CollectionOutcome => {
    const outcome: CollectionOutcome = {
        platform,
        target,
        status: 'needs-human',
        job_count: 0,
        abort_platform: true,
        human_reason: humanReason,
    };
    if (reason !== undefined) outcome.reason = reason;
    return outcome;
};
