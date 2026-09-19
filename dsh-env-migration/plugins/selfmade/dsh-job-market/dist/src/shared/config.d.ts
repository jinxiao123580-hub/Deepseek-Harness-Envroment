/**
 * 插件配置：默认值 + 校验。
 *
 * 设计对齐上游 `dsh-job-hunting/dist/src/config/{default-config,schema}.js`：
 *  - 导出 `Config` 供 cordis 的 `~standard` 校验使用（见 `src/index.ts`）
 *  - `browserSkill.mode` 强制 `'read-only'`（需求 §十八，不可配置为 write）
 *
 * Gap 权重来自 `src/gap/gap-analyzer.ts`，避免两处定义漂移。
 */
import type { BrowserSkillPolicyConfig, JobMarketConfig, JobSearchConfig, LlmCostConfig, MarketConfig } from './types.js';
/** 五个招聘站点的精确主机名白名单（需求 §三 / §十八）。 */
export declare const DEFAULT_BROWSER_ALLOWED_DOMAINS: readonly string[];
export declare const DEFAULT_OUTPUT_DIR = "job-market-site";
/** 默认求职方向（需求 §四 的示例）。 */
export declare const DEFAULT_TARGET_ROLES: readonly string[];
export declare const DEFAULT_LOCATIONS: readonly string[];
export declare const defaultJobSearch: JobSearchConfig;
export declare const DEFAULT_BROWSER_POLICY_CONFIG: BrowserSkillPolicyConfig;
export declare const defaultLlmCost: LlmCostConfig;
export declare const defaultMarket: MarketConfig;
export declare const defaultConfig: JobMarketConfig;
/**
 * 校验并合并配置。
 * 传入部分配置即与默认值深合并；非法值抛出中文 `TypeError`。
 */
export declare const parseConfig: (input?: unknown) => JobMarketConfig;
/** 解析后的完整域名白名单（allowedDomains + additionalAllowedDomains，去重）。 */
export declare const resolvedAllowedDomains: (config: JobMarketConfig) => string[];
