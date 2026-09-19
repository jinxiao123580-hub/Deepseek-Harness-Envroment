/**
 * market-analyzer —— 市场需求统计（需求 §七 技能需求 / §八 方向拆分 / §十六 数据真实性）
 *
 * 铁律：
 *  1. 本文件里的每一个数字（岗位数、占比、薪资分位、加权需求、共现 lift）
 *     都**由真实岗位记录现场计算**，绝不估计、不外推、不补全。
 *  2. 每项统计都携带 `job_ids`，保证「点 68% 就能看到是哪些岗位」可回溯。
 *  3. 全部函数均为纯函数：不读写磁盘、不发网络请求；时间一律通过 `now` 注入。
 */
import type { CategoryBreakdown, CityBucket, ExperienceBucket, JdAnalysis, Job, MarketFilter, MarketSnapshot, SalaryStats, SkillCooccurrence, SkillFrequency } from '../shared/types.js';
/**
 * 技能要求强度权重（需求 §五：required / preferred / bonus 权重不同）。
 * `weighted_demand = (required*1.0 + preferred*0.5 + bonus*0.25) / 总岗位数`。
 */
export declare const SKILL_REQUIREMENT_WEIGHTS: {
    readonly required: 1;
    readonly preferred: 0.5;
    readonly bonus: 0.25;
};
/** 岗位方向内置中文标签（需求 §八；可由 `defaultCategoryLabels` 覆盖）。 */
export declare const JOB_CATEGORY_LABELS: Readonly<Record<string, string>>;
/** 无城市信息时的占位名。 */
export declare const UNKNOWN_CITY = "\u672A\u77E5";
/** 无经验信息（不限/未标注）桶的标签。 */
export declare const UNKNOWN_EXPERIENCE_LABEL = "\u4E0D\u9650/\u672A\u6807\u6CE8";
/**
 * 按 `MarketFilter` 过滤岗位。纯函数：不修改入参，返回新数组。
 *
 * - `recent_days`：按 `last_seen_at`（退化 `collected_at`）取最近 N 天；时间无法解析时保留该岗位。
 * - `cities`：`job.city` 精确匹配，或（大小写/全半角归一化后）被城市名包含。
 * - `categories`：`job.job_category` 精确匹配（归一化后大小写不敏感）。
 * - `salary_min_k`：保留 `salary_max ?? salary_min >= 阈值`；无薪资信息一律排除。
 * - `experience_max`：保留 `experience_min` 缺失或 `<= 阈值` 的岗位。
 * - `education`：与列表匹配；学历为空的岗位仅在列表为空时保留。
 */
export declare const filterJobs: (jobs: readonly Job[], filter: MarketFilter, now?: Date) => Job[];
/**
 * 逐技能统计市场频次。
 *
 * 统计口径（全部可回溯）：
 *  - `job_ratio = present 岗位数 / 传入岗位总数`（0 除保护 → 0）。
 *  - `weighted_demand = (required*1.0 + preferred*0.5 + bonus*0.25) / 总岗位数`，夹取到 0..1。
 *  - 每个岗位对「同一技能的同一档位」最多贡献 1 次（重复提及不重复计数）。
 *  - `trend_pp` 留空，由 `market-snapshot` 跨快照补齐。
 */
export declare const computeSkillFrequencies: (jobs: readonly Job[], analyses: ReadonlyMap<string, JdAnalysis>, options?: {
    minCount?: number;
    skillNames?: ReadonlyMap<string, {
        name: string;
        category: string;
    }>;
}) => SkillFrequency[];
/**
 * 技能共现 + lift。
 *
 * - 参与配对的技能：按频次降序取前 `topSkills`（默认 40）。
 * - 每个无序对统计「两技能同时为 required 的岗位数」；岗位无解析结果时退化为
 *   归一化技能集合（视作硬性要求）。
 * - `lift = ratio / (pA * pB)`（分母为 0 时取 0，绝不出 NaN/Infinity）。
 * - 只保留 `job_count >= minCount`（默认 3）的配对，按岗位数降序，最多 120 条。
 */
export declare const computeCooccurrence: (jobs: readonly Job[], analyses: ReadonlyMap<string, JdAnalysis>, options?: {
    minCount?: number;
    topSkills?: number;
}) => SkillCooccurrence[];
/** 方向展示名：显式映射优先，其次内置中文表，最后退化为分类 ID。 */
export declare const resolveCategoryLabel: (category: string, defaultCategoryLabels?: ReadonlyMap<string, string>) => string;
/**
 * 逐方向统计。
 *
 * 关键点（需求 §八：方向之间绝不互相污染）：
 *  - 每个方向的 `top_skills` 只在**该方向自己的岗位集合**上调用 `computeSkillFrequencies`，
 *    所以 SLAM 的 Ceres/G2O 不会漏进嵌入式方向。
 *  - `job_ratio` 的分母是**全局岗位总数**，便于横向比较方向规模。
 */
export declare const computeCategoryBreakdowns: (jobs: readonly Job[], analyses: ReadonlyMap<string, JdAnalysis>, options?: {
    topSkillsPerCategory?: number;
    skillNames?: ReadonlyMap<string, {
        name: string;
        category: string;
    }>;
    /** 方向展示名覆盖表（持久化配置注入），缺省用内置中文标签表。 */
    defaultCategoryLabels?: ReadonlyMap<string, string>;
}) => CategoryBreakdown[];
/**
 * 薪资统计（K/月）。
 *
 * - 样本：`salary_min` 有限的岗位。
 * - `median_min` / `p25_min` / `p75_min` 基于 `salary_min` 升序数组（p25/p75 用最近秩法）。
 * - `median_max` 基于有 `salary_max` 的岗位。
 * - `coverage = 有薪资岗位数 / 岗位总数`（0 除保护 → 0）。
 */
export declare const computeSalaryStats: (jobs: readonly Job[]) => SalaryStats;
/** 把一个岗位归入唯一经验桶标签。 */
export declare const experienceBucketLabel: (job: Job) => string;
/**
 * 经验分布：每个岗位恰好落进一个桶；六个固定桶**始终输出**（含 0 计数），
 * 其中 `不限/未标注` 永远存在，便于前端稳定渲染。
 */
export declare const computeExperienceDistribution: (jobs: readonly Job[]) => ExperienceBucket[];
/**
 * 城市分布：按 `job.city` 分组（空值归入「未知」），岗位数降序，
 * 附带该城市有薪资样本时的 `salary_median_min`。
 */
export declare const computeCityDistribution: (jobs: readonly Job[]) => CityBucket[];
/**
 * 组装完整市场快照。
 *
 * - `snapshot_id = snap-<fnv1a32(taken_at + stableStringify(filter))>`：同一时刻 +
 *   同一过滤条件必定得到同一 ID（可重复、可对比、可去重）。
 * - `job_ids` 是全部参与统计的岗位 ID 全集，所有数字都能回溯到它。
 * - `analyzed_job_count` 只统计**确实存在 JD 解析结果**的过滤后岗位。
 */
export declare const buildMarketSnapshot: (input: {
    jobs: readonly Job[];
    analyses: ReadonlyMap<string, JdAnalysis>;
    filter?: MarketFilter;
    now?: Date;
    skillNames?: ReadonlyMap<string, {
        name: string;
        category: string;
    }>;
    topSkillsPerCategory?: number;
    minCooccurrenceCount?: number;
    defaultCategoryLabels?: ReadonlyMap<string, string>;
}) => MarketSnapshot;
