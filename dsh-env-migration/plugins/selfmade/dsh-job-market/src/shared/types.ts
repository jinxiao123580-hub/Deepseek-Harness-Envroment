/**
 * dsh-job-market — 统一领域模型（唯一契约源）
 *
 * 设计原则（对应需求 §十六 数据真实性）：
 *  - 所有“数量 / 比例 / 薪资 / 岗位数 / 趋势”都由程序基于真实岗位计算，
 *    LLM 只允许参与「解析 / 分类 / 归一化 / 解释」。
 *  - 任何统计结果都必须携带 `job_ids`，以支持“点 68% 看到是哪些岗位”的回溯。
 *  - AI 不得擅自认定用户已掌握某项技能：`PersonalSkill.source` 必须可区分
 *    `user` 与 `ai-suggested`，后者不得计入 Gap。
 */

/** ISO 8601 时间戳字符串。 */
export type Iso = string;

/* ============================================================================
 * 一、岗位（需求 §三）
 * ==========================================================================*/

/** 采集来源。已知平台 + 允许自定义字符串。 */
export type KnownSource = 'boss' | 'liepin' | 'zhilian' | '51job' | 'iguopin' | 'local' | 'browser-skill';
export type JobSource = KnownSource | (string & {});

/** 岗位方向分类 ID（需求 §八 至少支持这 8 类）。 */
export type KnownJobCategory =
    | 'robotics-software'
    | 'robotics-control'
    | 'ros2'
    | 'embedded'
    | 'motion-planning'
    | 'slam'
    | 'perception'
    | 'rl-embodied'
    | 'unknown';
export type JobCategory = KnownJobCategory | (string & {});

/** 技能要求强度（需求 §五：required / preferred / bonus 权重不同）。 */
export type SkillRequirement = 'required' | 'preferred' | 'bonus';

/**
 * 统一 Job 结构。
 *
 * 跨平台去重说明：
 *  - `platform_key` 用于同平台内识别同一岗位（优先 URL，退化到公司+职位+城市）。
 *  - `dedupe_key` 用于 **跨平台、跨日期** 识别同一岗位（公司+职位+城市 的规范化签名）。
 *  - 同一岗位再次出现时 **不新增计数**，只更新 `last_seen_at` 并把来源并入 `sources`。
 */
export interface Job {
    /** 规范内部 ID：`job-<fnv1a32(dedupe_key)>`，跨平台稳定。 */
    job_id: string;
    /** 首次采集到该岗位时的来源平台。 */
    source: JobSource;
    /** 该岗位出现过的全部来源平台（跨平台合并时追加）。 */
    sources: JobSource[];
    /** 平台自身的岗位 ID（若页面提供）。 */
    source_job_id?: string;
    /** 平台内身份键，用于同平台精确去重。 */
    platform_key: string;
    /** 跨平台身份键，用于跨平台/跨日期去重。 */
    dedupe_key: string;
    url: string;

    job_title: string;
    normalized_job_title: string;
    job_category: JobCategory;

    company: string;
    company_size?: string;
    industry?: string;

    city?: string;
    district?: string;

    /** 单位：K/月（千元人民币每月）。 */
    salary_min?: number;
    salary_max?: number;
    /** 薪资月数，如 13 / 14 / 15。 */
    salary_months?: number;
    /** 薪资原文，便于回溯与人工核对。 */
    salary_text?: string;

    /** 单位：年。 */
    experience_min?: number;
    experience_max?: number;
    /** 经验原文区间，便于回溯。 */
    experience_text?: string;
    education?: string;

    description?: string;
    requirements: string[];

    publish_time?: Iso;
    collected_at: Iso;
    first_seen_at: Iso;
    /** 每次再次见到该岗位都刷新；重复出现不计为新岗位。 */
    last_seen_at: Iso;
    /** 已被观察到的次数（含首次）。 */
    seen_count: number;

    skills_raw: string[];
    skills_normalized: string[];
}

/** 采集/导入时的输入形状（字段可缺失，由 JobStore 补全）。 */
export interface JobInput {
    source: JobSource;
    source_job_id?: string;
    url?: string;
    job_title: string;
    company: string;
    location?: string;
    city?: string;
    district?: string;
    salary_text?: string;
    /** 经验要求原文，如「3-5年」。 */
    experience_text?: string;
    /** 学历要求原文，如「本科及以上」。 */
    education?: string;
    description?: string;
    requirements?: readonly string[];
    publish_time?: string;
    company_size?: string;
    industry?: string;
    /** 采集批次时间；缺省用当前时间。 */
    collected_at?: Iso;
}

/* ============================================================================
 * 二、技能 Taxonomy（需求 §六）
 * ==========================================================================*/

/** 技能大类。允许自定义扩展。 */
export type KnownSkillCategory =
    | 'Programming'
    | 'Robotics'
    | 'Embedded'
    | 'Control'
    | 'Planning'
    | 'SLAM'
    | 'Perception'
    | 'AI/RL'
    | 'Linux'
    | 'Engineering'
    | 'Hardware'
    | 'Communication';
export type SkillCategory = KnownSkillCategory | (string & {});

/** 单条技能定义（可在 taxonomy JSON 中人工编辑）。 */
export interface SkillDefinition {
    /** 稳定 ID，小写 kebab/短名，如 `cpp`、`ros2`、`modern-cpp`。 */
    id: string;
    /** 展示名，如 `C++`、`ROS2`。 */
    name: string;
    category: SkillCategory;
    /** 匹配别名（大小写不敏感）。匹配时按长度降序，长别名优先。 */
    aliases: string[];
    /** 上位技能 ID。例如 `tf2` 的 parent 可为 `ros2`。 */
    parents?: string[];
    /**
     * 命中本技能时 **额外计入** 的技能 ID。
     * 例：`cpp17` → implies `cpp` 与 `modern-cpp`（需求 §六 明确要求）。
     */
    implies?: string[];
    /** 相关技能，仅用于推荐，不参与统计。 */
    related?: string[];
    /** 标记为过时（保留兼容但默认不参与统计）。 */
    deprecated?: boolean;
}

export interface SkillCategoryDefinition {
    id: SkillCategory;
    name: string;
    nameZh?: string;
}

/** 可人工编辑的技能体系。 */
export interface SkillTaxonomy {
    version: number;
    categories: SkillCategoryDefinition[];
    skills: SkillDefinition[];
}

/** 一次技能提及：原文 → 规范技能，并带要求强度与证据。 */
export interface SkillMention {
    /** 命中原文，如 `C++17`。 */
    raw: string;
    /** 规范化后的主技能 ID，如 `cpp`。 */
    skill_id: string;
    /** 主技能展示名，如 `C++`。 */
    skill: string;
    category: SkillCategory;
    /** 由 implies / parents 扩容出的附带技能 ID（如 `modern-cpp`）。 */
    implied_skill_ids: string[];
    requirement: SkillRequirement;
    /** 0..1。规则精确别名命中为高，模糊语义为低。 */
    confidence: number;
    /** 原文证据片段，供人工核对。 */
    evidence: string;
    /** 提取方式。 */
    method: 'dictionary' | 'rule' | 'llm';
}

/* ============================================================================
 * 三、JD 结构化解析（需求 §五）
 * ==========================================================================*/

/**
 * LLM / 规则产出的 JD 结构化结果。
 * 字段名严格对齐需求 §五 的 JSON 契约。
 */
export interface ParsedJd {
    category: string;
    core_skills: string[];
    optional_skills: string[];
    programming_languages: string[];
    frameworks: string[];
    robotics_skills: string[];
    embedded_skills: string[];
    algorithm_skills: string[];
    tools: string[];
    os_platforms: string[];
    hardware: string[];
    communication_protocols: string[];
    degree_requirement: string;
    experience_requirement: string;
    domain_knowledge: string[];
    responsibilities: string[];
    keywords: string[];
}

/** JD 解析的完整结果：结构化字段 + 归一化技能提及 + 溯源信息。 */
export interface JdAnalysis {
    parsed: ParsedJd;
    /** 归一化技能提及，区分 required / preferred / bonus 并带权重。 */
    mentions: SkillMention[];
    /** 解析器实际采用的路径。 */
    via: 'rule' | 'llm' | 'hybrid';
    analysis_version: number;
    prompt_version: number;
    analyzed_at: Iso;
    /** 本次解析是否调用了模型（用于成本审计）。 */
    llm_calls: number;
}

export interface JdCacheEntry {
    /** 归一化 JD 文本的哈希。 */
    jd_hash: string;
    /** 岗位身份哈希（job_id）。 */
    job_hash: string;
    analysis_version: number;
    prompt_version: number;
    analysis: JdAnalysis;
    created_at: Iso;
}

/* ============================================================================
 * 四、市场需求分析（需求 §七 / §八）
 * ==========================================================================*/

/** 统计过滤条件。 */
export interface MarketFilter {
    /** 只统计最近 N 天发布/更新；0 或缺省表示全部。 */
    recent_days?: number;
    cities?: string[];
    categories?: JobCategory[];
    /** 最低薪资下限（K/月）。 */
    salary_min_k?: number;
    experience_max?: number;
    education?: string[];
}

/** 单个技能的市场统计。所有比例都是 0..1 的小数，且都可回溯到 job_ids。 */
export interface SkillFrequency {
    skill_id: string;
    skill: string;
    category: SkillCategory;
    /** 出现该技能的岗位数。 */
    job_count: number;
    /** job_count / 总岗位数。 */
    job_ratio: number;
    required_count: number;
    required_ratio: number;
    preferred_count: number;
    preferred_ratio: number;
    bonus_count: number;
    bonus_ratio: number;
    /**
     * 需求加权得分 = (required*1.0 + preferred*0.5 + bonus*0.25) / 总岗位数。
     * 这是 GapAnalyzer 的 market_demand 输入。
     */
    weighted_demand: number;
    /** 相对上一快照 job_ratio 的变化（百分点，正数为上升）。 */
    trend_pp?: number;
    /** 可回溯：要求该技能的真实岗位 ID 列表。 */
    required_job_ids: string[];
    preferred_job_ids: string[];
    bonus_job_ids: string[];
    /** 并集，便于直接回溯“哪些岗位要求 ROS2”。 */
    job_ids: string[];
}

/** 技能共现（需求 §七：ROS2+C++、ROS2+Linux、SLAM+C++、Nav2+ROS2 等）。 */
export interface SkillCooccurrence {
    a: string;
    b: string;
    /** 两个技能同时 required 出现在同一岗位的岗位数。 */
    job_count: number;
    /** job_count / 总岗位数。 */
    ratio: number;
    /**
     * 提升度 lift = P(a,b) / (P(a)*P(b))。
     * >1 表示真正“成套出现”，<1 表示互相排斥。用于判断成套技能组合。
     */
    lift: number;
    job_ids: string[];
}

/** 单个岗位方向的统计（需求 §八：不同方向必须分开统计）。 */
export interface CategoryBreakdown {
    category: JobCategory;
    label: string;
    job_count: number;
    job_ratio: number;
    salary_median_min?: number;
    salary_median_max?: number;
    /** 该方向内的技能频率 TOP N（方向内统计，不外溢）。 */
    top_skills: SkillFrequency[];
    job_ids: string[];
}

/** 薪资分布。 */
export interface SalaryStats {
    sample_count: number;
    median_min?: number;
    median_max?: number;
    p25_min?: number;
    p75_min?: number;
    /** 有薪资信息的岗位占比。 */
    coverage: number;
}

/** 经验分布。 */
export interface ExperienceBucket {
    label: string;
    min: number;
    max?: number;
    job_count: number;
    job_ratio: number;
}

/** 城市分布。 */
export interface CityBucket {
    city: string;
    job_count: number;
    job_ratio: number;
    salary_median_min?: number;
}

/** 市场快照：可持久化、可对比、可回溯（需求 §七 / §十四）。 */
export interface MarketSnapshot {
    snapshot_id: string;
    taken_at: Iso;
    filter: MarketFilter;
    /** 参与统计的岗位总数（去重后）。 */
    job_count: number;
    /** 纳入统计的岗位 ID 全集，所有统计都能回溯到这里。 */
    job_ids: string[];
    skill_frequencies: SkillFrequency[];
    cooccurrence: SkillCooccurrence[];
    categories: CategoryBreakdown[];
    salary: SalaryStats;
    experience: ExperienceBucket[];
    /** 岗位数 TOP 城市。 */
    cities: CityBucket[];
    /** 有 JD 解析结果的岗位数（解析覆盖率）。 */
    analyzed_job_count: number;
}

/** 技能需求随时间的变化点（需求 §十四 趋势）。 */
export interface SkillTrendPoint {
    snapshot_id: string;
    taken_at: Iso;
    job_ratio: number;
    required_ratio: number;
    job_count: number;
}

export interface SkillTrend {
    skill_id: string;
    skill: string;
    points: SkillTrendPoint[];
    /** 首末差值（百分点）。 */
    delta_pp: number;
    direction: 'up' | 'down' | 'flat';
}

/* ============================================================================
 * 五、个人能力画像（需求 §九）
 * ==========================================================================*/

/** 0=完全不会 1=知道基本概念 2=做过 Demo 3=可以独立完成项目 4=熟练解决实际问题 5=深入掌握。 */
export type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type EvidenceKind = 'project' | 'work' | 'github' | 'experiment' | 'resume' | 'course' | 'other';

export interface SkillEvidence {
    kind: EvidenceKind;
    title: string;
    detail?: string;
    url?: string;
    date?: string;
}

export interface PersonalSkill {
    skill_id: string;
    current_level: SkillLevel;
    target_level: SkillLevel;
    evidence: SkillEvidence[];
    last_updated: Iso;
    /** 0..1，用户自评为 1，AI 推断不得高于 0.5。 */
    confidence: number;
    /** `user` = 用户确认；`ai-suggested` = AI 建议，**不得计入 Gap**。 */
    source: 'user' | 'ai-suggested';
    note?: string;
}

/** AI 建议但未确认的技能，单独存放，绝不参与 Gap 计算。 */
export interface PersonalSkillSuggestion {
    skill_id: string;
    suggested_level: SkillLevel;
    reason: string;
    evidence: SkillEvidence[];
    created_at: Iso;
}

export interface PersonalSkillProfile {
    schemaVersion: number;
    updated_at: Iso;
    skills: Record<string, PersonalSkill>;
    pending_suggestions: PersonalSkillSuggestion[];
    /** 用户目标岗位方向，用于 role_coverage。 */
    target_categories: JobCategory[];
    /** 用户目标岗位名称。 */
    target_roles: string[];
}

/* ============================================================================
 * 六、Gap 分析（需求 §十）
 * ==========================================================================*/

/**
 * 可配置权重（需求 §十：具体权重做成配置项）。
 * 公式：priority = market_demand × importance × skill_gap × role_coverage ÷ learning_cost
 */
export interface GapWeights {
    /** market_demand 指数（放大/缩小市场需求影响力）。 */
    market_demand: number;
    importance: number;
    skill_gap: number;
    role_coverage: number;
    /** learning_cost 的指数；越大越惩罚高成本技能。 */
    learning_cost: number;
    /** 学习成本按技能大类的基础难度（1..5）。 */
    category_cost: Record<string, number>;
    /** 默认学习成本（未在 category_cost 中登记时使用）。 */
    default_cost: number;
}

/** 单个技能的 Gap 结果，含完整可解释因子。 */
export interface GapEntry {
    skill_id: string;
    skill: string;
    category: SkillCategory;
    /** 0..1，来自 SkillFrequency.weighted_demand。 */
    market_demand: number;
    /** 0..1，该技能对目标岗位方向的关键度。 */
    importance: number;
    current_level: SkillLevel;
    target_level: SkillLevel;
    /** (target_level - current_level) / 5，范围 0..1。 */
    skill_gap: number;
    /** 0..1，覆盖了多少个目标方向。 */
    role_coverage: number;
    /** >=1，学习成本分母。 */
    learning_cost: number;
    /** 最终优先级得分。 */
    priority: number;
    rank: number;
    /** 人类可读解释，回答“为什么 C++ 排第一”。 */
    explanation: string;
    /** 可回溯岗位数与样例。 */
    job_count: number;
    job_ids: string[];
}

export interface GapReport {
    generated_at: Iso;
    snapshot_id: string;
    weights: GapWeights;
    entries: GapEntry[];
    /** 被排除的技能（已达标 / 无市场数据 / 仅 AI 建议），带原因。 */
    excluded: { skill_id: string; skill: string; reason: string }[];
}

/* ============================================================================
 * 七、学习目标与路线（需求 §十一 / §十二 / §十三）
 * ==========================================================================*/

export type GoalStatus = 'pending' | 'in-progress' | 'done' | 'blocked';

/**
 * 可验收的学习目标。禁止“学习 C++”这类不可验收目标：
 * `acceptance_criteria` 必须非空，且只有全部满足才可标记 done。
 */
export interface LearningGoal {
    goal_id: string;
    skill_id: string;
    skill: string;
    /** 具体能力标题，如「掌握 ROS2 TF2」。 */
    title: string;
    /** 能力点拆分，如 TF2 目标里的 map→odom→base_link→laser。 */
    sub_skills: string[];
    learning_content: string[];
    /** 1..5。 */
    difficulty: number;
    /** 覆盖岗位比例 0..1。 */
    market_coverage: number;
    market_job_count: number;
    market_job_ids: string[];
    /** 验收标准（必须非空）。 */
    acceptance_criteria: string[];
    recommended_project_id?: string;
    status: GoalStatus;
    completed_at?: Iso;
}

/** 项目驱动（需求 §十二）。 */
export interface ProjectStage {
    /** 阶段名，如 `micro-ROS`。 */
    name: string;
    detail?: string;
    skill_ids: string[];
}

export interface ProjectPlan {
    project_id: string;
    name: string;
    description: string;
    stages: ProjectStage[];
    /** 本项目覆盖的全部技能 ID。 */
    covered_skill_ids: string[];
    /** 覆盖了目标岗位 TOP20 技能中的几项。 */
    top20_covered: number;
    top20_total: number;
    /** 覆盖岗位比例。 */
    market_coverage: number;
    market_job_count: number;
}

export interface RoadmapWeek {
    week: number;
    /** 本周目标（一句话）。 */
    goal: string;
    /** 具体任务。 */
    tasks: string[];
    /** 为什么学（需求 §十三）。 */
    why: string;
    /** 对应多少岗位。 */
    covered_job_count: number;
    covered_job_ratio: number;
    estimated_hours: number;
    acceptance: string[];
    /** 项目产出。 */
    deliverable: string;
    goal_ids: string[];
    project_id?: string;
}

export interface LearningRoadmap {
    roadmap_id: string;
    /** 4 / 8 / 12 周模式，默认 8。 */
    mode: 4 | 8 | 12;
    generated_at: Iso;
    based_on_snapshot_id: string;
    based_on_profile_updated_at: Iso;
    weeks: RoadmapWeek[];
    project?: ProjectPlan;
    goal_ids: string[];
}

/* ============================================================================
 * 八、动态调整（需求 §十四）
 * ==========================================================================*/

export type RoadmapChangeAction = 'continue' | 'add' | 'raise' | 'lower' | 'remove';

export interface RoadmapChange {
    action: RoadmapChangeAction;
    skill_id: string;
    skill: string;
    /** 必须解释原因。 */
    reason: string;
    /** 变化前后指标（如 job_ratio）。 */
    from?: number;
    to?: number;
}

export interface RoadmapAdjustment {
    generated_at: Iso;
    previous_roadmap_id: string;
    previous_snapshot_id: string;
    new_snapshot_id: string;
    /** 显式声明：不推翻原计划，只做增量调整建议。 */
    policy: 'incremental';
    changes: RoadmapChange[];
    summary: string;
}

/* ============================================================================
 * 九、采集（需求 §四 / §十八）
 * ==========================================================================*/

export interface PlatformDefinition {
    id: JobSource;
    name: string;
    /** 精确主机名，用于只读白名单校验。 */
    hostname: string;
    /**
     * 搜索页 URL 模板，占位符：{keyword} {city} {page}。
     * 注意：只读采集，绝不包含投递/登录路径。
     */
    search_url_template: string;
    /** 城市名 → 平台城市编码。缺省表示平台用城市名直接拼接。 */
    city_codes?: Record<string, string>;
    enabled: boolean;
    /** 已知限制说明，例如需要登录才能翻页。 */
    notes?: string;
}

/** 一次具体采集目标。 */
export interface CollectionTarget {
    platform: JobSource;
    keyword: string;
    city?: string;
    page: number;
    url: string;
}

export interface CollectionPlan {
    generated_at: Iso;
    expanded_keywords: string[];
    targets: CollectionTarget[];
    /** 被安全策略拒绝的目标及原因。 */
    rejected: { url: string; reason: string }[];
}

export type HumanAssistanceReason = 'login' | 'captcha' | 'otp' | 'payment' | 'submit-confirmation';

export interface CollectionOutcome {
    platform: JobSource;
    target: CollectionTarget;
    status: 'ok' | 'needs-human' | 'failed' | 'skipped';
    job_count: number;
    reason?: string;
    human_reason?: HumanAssistanceReason;
    /** 该平台是否应停止本轮后续采集（需求 §十八）。 */
    abort_platform: boolean;
}

export interface CollectionRun {
    run_id: string;
    started_at: Iso;
    finished_at: Iso;
    outcomes: CollectionOutcome[];
    new_job_count: number;
    updated_job_count: number;
    total_job_count: number;
}

/* ============================================================================
 * 十、配置
 * ==========================================================================*/

export interface JobSearchConfig {
    /** 目标岗位，如「机器人软件工程师」。 */
    target_roles: string[];
    /** 自动扩展出的搜索词（由 SearchPlanner 生成，可人工覆盖）。 */
    expanded_keywords: string[];
    /** 人工指定的额外搜索词。 */
    extra_keywords: string[];
    /** 目标城市。 */
    locations: string[];
    /** 排除词（用于过滤明显不相关的岗位）。 */
    exclude_keywords: string[];
    experience_min?: number;
    experience_max?: number;
    /** 最低薪资下限（K/月）。 */
    salary_min_k?: number;
    /** 每个平台每关键词最多翻几页。 */
    max_pages_per_keyword: number;
}

export interface BrowserSkillPolicyConfig {
    enabled: boolean;
    executable: string;
    /** 只读模式，不可更改为 write（需求 §十八）。 */
    mode: 'read-only';
    allowedDomains: string[];
    additionalAllowedDomains: string[];
    requireUserApproval: boolean;
    maxItemsPerRun: number;
    minIntervalMs: number;
}

export interface LlmCostConfig {
    enabled: boolean;
    /** 分析版本号：变更解析逻辑时递增，使缓存失效。 */
    analysis_version: number;
    /** 提示词版本号：变更提示词时递增，使缓存失效。 */
    prompt_version: number;
    /** 单轮最多调用模型的 JD 数，防止成本失控。 */
    max_calls_per_run: number;
}

export interface MarketConfig {
    /** 统计窗口天数。 */
    recent_days: number;
    /** 低于该岗位数时给出统计可信度警告。 */
    min_jobs_for_stats: number;
    /** 共现统计的最小支持度。 */
    min_cooccurrence_count: number;
    /** 每个方向保留的 TOP 技能数。 */
    top_skills_per_category: number;
}

export interface JobMarketConfig {
    outputDir: string;
    /** 自定义 taxonomy 文件路径；缺省用包内默认 + 工作区覆盖。 */
    taxonomyPath?: string;
    jobSearch: JobSearchConfig;
    browserSkill: BrowserSkillPolicyConfig;
    llm: LlmCostConfig;
    market: MarketConfig;
    gapWeights: GapWeights;
    /** 路线默认周数（需求 §十三 默认 8）。 */
    defaultRoadmapWeeks: 4 | 8 | 12;
}

/* ============================================================================
 * 十一、LLM 抽象（可注入、可测试、可审计）
 * ==========================================================================*/

export interface LlmCompleteRequest {
    system?: string;
    prompt: string;
    /** 期望的 JSON 结构提示（仅作为提示，不依赖模型严格遵循）。 */
    jsonHint?: string;
    /** 期望的输出 token 上限。 */
    maxTokens?: number;
}

export interface LlmClient {
    complete(request: LlmCompleteRequest): Promise<string>;
}

/* ============================================================================
 * 十二、Dashboard（需求 §十五）
 * ==========================================================================*/

export interface DashboardOverview {
    job_count: number;
    category_count: number;
    city_count: number;
    salary: SalaryStats;
    experience: ExperienceBucket[];
    analyzed_job_count: number;
    /** 统计是否可信（岗位数是否达到 min_jobs_for_stats）。 */
    reliable: boolean;
    warning?: string;
}

export interface MySkillRow {
    skill_id: string;
    skill: string;
    category: SkillCategory;
    market_ratio: number;
    market_job_count: number;
    current_level: SkillLevel;
    target_level: SkillLevel;
    gap: number;
    priority: number;
    rank: number;
    explanation: string;
}

export interface RoadmapProgressWeek {
    week: number;
    goal: string;
    status: GoalStatus;
    done_goals: number;
    total_goals: number;
}

export interface RoadmapProgress {
    roadmap_id: string;
    mode: 4 | 8 | 12;
    current_week: number;
    weeks: RoadmapProgressWeek[];
    done_goals: number;
    total_goals: number;
}

export interface DashboardData {
    generated_at: Iso;
    snapshot_id: string;
    overview: DashboardOverview;
    top_skills: SkillFrequency[];
    cooccurrence: SkillCooccurrence[];
    categories: CategoryBreakdown[];
    my_skills: MySkillRow[];
    roadmap: RoadmapProgress | null;
    trends: SkillTrend[];
    /** 数据来源声明，强调真实性。 */
    provenance: {
        job_source: 'collected-real-jobs';
        llm_role: 'parse-classify-normalize-explain-only';
        snapshot_count: number;
    };
}
