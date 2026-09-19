/**
 * 只读浏览器采集安全策略（需求 §十八）。
 *
 * 本文件是上游 `dsh-job-hunting/dist/src/browser/browser-policy.js` 的忠实移植：
 *  - 错误信息 **逐字保留英文原文**，以便与上游行为一致、可被测试断言；
 *  - 主机名匹配是 **精确相等**（`hostname === domain`），不做后缀/通配匹配，
 *    因此 `evil-www.zhipin.com` 不会被误判为 `www.zhipin.com`；
 *  - 本插件只读，绝不允许凭据提取、表单提交、点击等写入式动作。
 *
 * 与上游的差异（仅此两点，均为「更严格」方向）：
 *  1. 增加 `additionalAllowedDomains` 合并（上游只有 `allowedDomains`）；
 *  2. 把 `assertAllowedDomain` 由模块私有改为导出，供规划器与测试复用。
 */

import type { BrowserSkillPolicyConfig } from '../shared/types.js';

/** 一次只读采集请求。字段命名对齐上游，便于日志兼容。 */
export interface BrowserCollectionRequest {
    urls: readonly string[];
    config: BrowserSkillPolicyConfig;
    userApproved?: boolean;
    approved?: boolean;
    approvalGranted?: boolean;
    executable?: string;
    source?: string;
    collectedAt?: string;
    actions?: readonly string[];
    credentialExtraction?: boolean;
    credentialExtractionExpression?: string;
    extractExpression?: string;
    submit?: boolean;
    formAction?: boolean;
}

/** 默认策略：只读、需人工批准、域名精确白名单、单轮最多 50 条、最小间隔 1s。 */
export const DEFAULT_BROWSER_POLICY: BrowserSkillPolicyConfig = {
    enabled: true,
    executable: 'bsk',
    mode: 'read-only',
    allowedDomains: ['www.51job.com', 'www.zhipin.com', 'www.liepin.com', 'www.zhaopin.com', 'www.iguopin.com'],
    additionalAllowedDomains: [],
    requireUserApproval: true,
    maxItemsPerRun: 50,
    minIntervalMs: 1000,
};

/** 三个批准字段任意一个为 true 即视为已获人工批准。 */
const isApprovalGranted = (request: BrowserCollectionRequest | undefined): boolean =>
    request?.userApproved === true || request?.approved === true || request?.approvalGranted === true;

const normalizeHostname = (hostname: string): string => hostname.trim().toLowerCase();

/** 必须是裸主机名：不含协议、路径、端口、通配符与空白。 */
const isHostname = (value: string): boolean =>
    value !== '' &&
    !value.includes('://') &&
    !value.includes('/') &&
    !value.includes(':') &&
    !value.includes('*') &&
    !/\s/.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** 校验并归一化单条白名单主机名，返回小写主机名。 */
export const assertAllowedDomain = (domain: string, index: number): string => {
    const normalized = normalizeHostname(typeof domain === 'string' ? domain : '');
    if (!isHostname(normalized)) {
        throw new TypeError(`allowedDomains[${index}] must be a non-empty hostname`);
    }
    return normalized;
};

/** URL 校验：协议必须 http(s)，且主机名必须精确等于白名单中的某一项。 */
export const assertUrlAllowed = (value: string, allowedDomains: readonly string[]): void => {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new TypeError(`URL is invalid or outside the allowed domains: ${value}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TypeError(`URL protocol is not allowed: ${value}`);
    }
    const hostname = normalizeHostname(url.hostname);
    if (!allowedDomains.some((domain) => hostname === domain)) {
        throw new TypeError(`URL is outside the allowed domains: ${value}`);
    }
};

/** 拒绝任何凭据提取 / 表单 / 提交 / 点击类动作（需求 §十八 硬红线）。 */
export const assertNoUnsafeRequestAction = (request: BrowserCollectionRequest): void => {
    const credentialExpression = request.credentialExtractionExpression?.trim();
    const extractExpression = request.extractExpression?.trim();
    if (
        request.credentialExtraction === true ||
        (credentialExpression !== undefined && credentialExpression !== '') ||
        (extractExpression !== undefined && extractExpression !== '') ||
        request.submit === true ||
        request.formAction === true
    ) {
        throw new TypeError('credential extraction, form actions, and submit actions are not allowed');
    }
    const unsafeAction = request.actions?.find((action) =>
        /credential|evaluate|form|submit|write|fill|click|payment|auth|captcha|otp|login/i.test(action),
    );
    if (unsafeAction !== undefined) {
        throw new TypeError(`browser action is not allowed: ${unsafeAction}`);
    }
};

/** 合并 allowedDomains 与 additionalAllowedDomains，保序去重并逐条校验。 */
const resolveAllowedDomains = (config: BrowserSkillPolicyConfig): string[] => {
    const rawDomains = [
        ...(Array.isArray(config.allowedDomains) ? config.allowedDomains : []),
        ...(Array.isArray(config.additionalAllowedDomains) ? config.additionalAllowedDomains : []),
    ];
    const resolved: string[] = [];
    rawDomains.forEach((domain, index) => {
        const normalized = assertAllowedDomain(domain, index);
        if (!resolved.includes(normalized)) resolved.push(normalized);
    });
    return resolved;
};

/**
 * 策略总校验，顺序与上游一致：
 * mode → maxItemsPerRun → minIntervalMs → allowedDomains → 人工批准
 * → urls 非空 → 逐条 URL → 无危险动作。
 */
export const validateBrowserPolicy = (request: BrowserCollectionRequest, config: BrowserSkillPolicyConfig): void => {
    if (!isRecord(config)) {
        throw new TypeError('browserSkill.allowedDomains must contain at least one hostname');
    }
    if (config.mode !== 'read-only') {
        throw new TypeError('browserSkill.mode must be "read-only"');
    }
    if (
        typeof config.maxItemsPerRun !== 'number' ||
        !Number.isInteger(config.maxItemsPerRun) ||
        config.maxItemsPerRun <= 0
    ) {
        throw new TypeError('browserSkill.maxItemsPerRun must be a positive integer');
    }
    if (
        typeof config.minIntervalMs !== 'number' ||
        !Number.isInteger(config.minIntervalMs) ||
        config.minIntervalMs <= 0
    ) {
        throw new TypeError('browserSkill.minIntervalMs must be a positive integer');
    }
    if (!Array.isArray(config.allowedDomains) || config.allowedDomains.length === 0) {
        throw new TypeError('browserSkill.allowedDomains must contain at least one hostname');
    }
    const allowedDomains = resolveAllowedDomains(config);
    if (config.requireUserApproval !== true || !isApprovalGranted(request)) {
        throw new Error('explicit user approval is required for BrowserSkill collection');
    }
    if (!Array.isArray(request?.urls) || request.urls.length === 0) {
        throw new TypeError('BrowserSkill collection requires at least one URL');
    }
    for (const url of request.urls) {
        assertUrlAllowed(url, allowedDomains);
    }
    assertNoUnsafeRequestAction(request);
};
