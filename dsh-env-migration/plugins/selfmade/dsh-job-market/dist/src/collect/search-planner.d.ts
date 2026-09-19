/**
 * 搜索词扩展 + 采集计划生成（需求 §四 / §十九）。
 *
 * 两个职责严格分离：
 *  1. `expandKeywords` / `keywordFamilies` —— 纯规则、确定性、零模型调用。
 *     用户只给 4 个岗位名，这里补齐 ROS / ROS2 / 运动控制 等等价写法，
 *     否则会漏掉大量真实岗位（需求 §四 明确要求）。
 *  2. `planCollection` —— 把「平台 × 关键词 × 城市 × 页码」展开成只读采集目标，
 *     并对 **每一条 URL** 调用 browser-policy 的 `assertUrlAllowed` 做白名单校验；
 *     校验不通过的 URL 进入 `rejected`，绝不进入 `targets`。
 *
 * `keywordFamilies` 承担需求 §四 的最后一句：不同方向的关键词
 * （机器人软件 / 控制 / ROS2 / 嵌入式 …）**不得混进同一个统计口径**，
 * 因此给出「方向 family」分组，供下游 MarketAnalyzer 分方向统计。
 */
import type { JobSearchConfig, CollectionPlan, PlatformDefinition } from '../shared/types.js';
/** 基础修饰词组（方向词），是「方向 family」的判定依据。 */
export declare const BASE_MODIFIERS: readonly string[];
/**
 * 职位后缀。顺序即生成顺序（`{base}工程师` 排在 `{base}开发工程师` 之前，
 * 与需求 §四 的示例输出顺序一致）。
 */
export declare const ROLE_SUFFIXES: readonly string[];
/**
 * 需求 §四：把用户目标岗位扩展为具体搜索关键词。
 *
 * 规则：`基础修饰词 × 职位后缀`，再叠加用户原岗位与 `extra_keywords`。
 * 输出保序去重，且 **用户自己写的岗位永远排在最前**。
 */
export declare const expandKeywords: (config: JobSearchConfig) => string[];
/**
 * 按方向 family 分组。
 * 返回 `family → 关键词[]`，值保持输入顺序并已去重，
 * 便于下游「同一 family 才可合并统计」。
 */
export declare const keywordFamilies: (keywords: readonly string[]) => Map<string, string[]>;
/**
 * 生成只读采集计划。
 *
 * 展开维度：平台（默认 `enabledPlatforms()`）× 扩展关键词 × 城市 × 页码。
 * 每条 URL 都必须通过 `assertUrlAllowed`；失败者进入 `rejected` 并保留
 * 抛出的原始英文错误信息作为 `reason`，便于日志与测试断言。
 */
export declare const planCollection: (input: {
    config: JobSearchConfig;
    platforms?: readonly PlatformDefinition[];
    now?: string;
    /** 目标数量上限，默认 200。 */
    maxTargets?: number;
}) => CollectionPlan;
