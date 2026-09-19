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
export declare const DEFAULT_BROWSER_POLICY: BrowserSkillPolicyConfig;
/** 校验并归一化单条白名单主机名，返回小写主机名。 */
export declare const assertAllowedDomain: (domain: string, index: number) => string;
/** URL 校验：协议必须 http(s)，且主机名必须精确等于白名单中的某一项。 */
export declare const assertUrlAllowed: (value: string, allowedDomains: readonly string[]) => void;
/** 拒绝任何凭据提取 / 表单 / 提交 / 点击类动作（需求 §十八 硬红线）。 */
export declare const assertNoUnsafeRequestAction: (request: BrowserCollectionRequest) => void;
/**
 * 策略总校验，顺序与上游一致：
 * mode → maxItemsPerRun → minIntervalMs → allowedDomains → 人工批准
 * → urls 非空 → 逐条 URL → 无危险动作。
 */
export declare const validateBrowserPolicy: (request: BrowserCollectionRequest, config: BrowserSkillPolicyConfig) => void;
