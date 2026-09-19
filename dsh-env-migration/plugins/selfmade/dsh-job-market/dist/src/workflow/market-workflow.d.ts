/**
 * 市场分析与学习规划编排层。
 *
 * 这是整个系统的「大脑」，把各模块串成需求 §二 的完整闭环：
 *
 *   配置求职方向 → 采集岗位 → 去重 → 分类 → JD 结构化 → 技能标准化
 *   → 市场需求统计 → 个人能力画像 → Gap → 学习优先级 → 阶段目标
 *   → 每周计划 → 定期重采 → 动态调整
 *
 * 本层负责 I/O（工作区读写），核心算法全部在纯函数模块里，便于单测。
 *
 * LLM 成本策略（需求 §十七）：
 *  - 先用规则 + 字典抽取显式技能（`parseJdByRule`），绝大多数岗位零模型调用
 *  - 用 `jd_hash + analysis_version + prompt_version` 做缓存，JD 未变不重复分析
 *  - 需要模型时（复杂分类 / 模糊语义 / 职责总结）由宿主 agent 完成，
 *    本层只提供 prompt 与结果回灌入口
 */
import type { GapReport, Iso, Job, JdAnalysis, JobMarketConfig, JobSearchConfig, LearningGoal, LearningRoadmap, MarketFilter, MarketSnapshot, PersonalSkillProfile, RoadmapAdjustment } from '../shared/types.js';
import type { SkillDictionary, SkillIndex } from '../taxonomy/taxonomy.js';
import { cacheStats } from '../jd/jd-cache.js';
import type { JdCacheFile } from '../jd/jd-cache.js';
import type { SnapshotHistory } from '../market/market-snapshot.js';
import type { DashboardData, SkillTrace } from '../report/dashboard.js';
import type { ParsedJd } from '../shared/types.js';
/** 工作区内的持久化路径（与上游 job-hunting 的数据约定保持一致以便共存）。 */
export declare const PATHS: {
    readonly jobs: "data/jobs.json";
    readonly jdCache: "data/jd-cache.json";
    readonly snapshots: 'data/market-snapshots.json';
    readonly personalProfile: 'profile/personal-skills.json';
    readonly goals: 'data/learning-goals.json';
    readonly roadmap: 'data/learning-roadmap.json';
    readonly jobSearch: 'config/job-search.json';
    readonly taxonomy: 'taxonomy/skill-taxonomy.json';
};
export interface WorkflowContext {
    workspaceRoot: string;
    config: JobMarketConfig;
    dictionary: SkillDictionary;
    skillIndex: SkillIndex;
    skillNames: Map<string, {
        name: string;
        category: string;
    }>;
    categoryLabels: Map<string, string>;
    warnings: string[];
    now: () => Iso;
}
/** 建立编排上下文：加载配置、taxonomy 与字典。 */
export declare const createWorkflowContext: (input: {
    workspaceRoot: string;
    config?: JobMarketConfig;
    now?: () => Iso;
}) => Promise<WorkflowContext>;
/** 由原始配置对象建立上下文（供插件入口使用）。 */
export declare const createWorkflowContextFromConfig: (input: {
    workspaceRoot: string;
    configInput?: unknown;
}) => Promise<WorkflowContext>;
export declare const readJobs: (ctx: WorkflowContext) => Promise<Job[]>;
export declare const writeJobs: (ctx: WorkflowContext, jobs: readonly Job[]) => Promise<void>;
export declare const readHistory: (ctx: WorkflowContext) => Promise<SnapshotHistory>;
export declare const readJdCache: (ctx: WorkflowContext) => Promise<JdCacheFile>;
export declare const writeJdCache: (ctx: WorkflowContext, cache: JdCacheFile) => Promise<void>;
export declare const readPersonalProfile: (ctx: WorkflowContext) => Promise<PersonalSkillProfile>;
export declare const writePersonalProfile: (ctx: WorkflowContext, profile: PersonalSkillProfile) => Promise<void>;
export declare const readGoals: (ctx: WorkflowContext) => Promise<LearningGoal[]>;
export declare const writeGoals: (ctx: WorkflowContext, goals: readonly LearningGoal[]) => Promise<void>;
export declare const readRoadmap: (ctx: WorkflowContext) => Promise<LearningRoadmap | undefined>;
export declare const writeRoadmap: (ctx: WorkflowContext, roadmap: LearningRoadmap) => Promise<void>;
/** 首次配置时把完整 taxonomy 落盘，供用户人工编辑。 */
export declare const ensureTaxonomyFile: (ctx: WorkflowContext) => Promise<string>;
/** 写入求职方向配置。 */
export declare const writeJobSearch: (ctx: WorkflowContext, search: JobSearchConfig) => Promise<void>;
export declare const readJobSearch: (ctx: WorkflowContext) => Promise<JobSearchConfig | undefined>;
export interface AnalysisBuildResult {
    /** job_id → JdAnalysis */
    analyses: Map<string, JdAnalysis>;
    cache: JdCacheFile;
    /** 本轮新解析的岗位数。 */
    computed: number;
    /** 命中缓存直接复用。 */
    cached: number;
    /** 本层实际发起的模型调用数（始终为 0：模型调用由宿主 agent 完成）。 */
    llmCalls: number;
    stats: ReturnType<typeof cacheStats>;
}
/**
 * 为岗位池构建 JD 分析结果。
 *
 * 顺序：命中缓存 → 直接复用；未命中 → 规则解析并写回缓存。
 * 同时补齐 `job.job_category`（未分类的岗位会被分类器写入）。
 */
export declare const buildAnalyses: (ctx: WorkflowContext, jobs: readonly Job[], options?: {
    existingCache?: JdCacheFile;
    maxJobs?: number;
}) => Promise<{
    result: AnalysisBuildResult;
    jobs: Job[];
}>;
/** 取得「需要模型深度解析」的 prompt（供宿主 agent 调用模型后回灌）。 */
export declare const prepareJdPrompt: (ctx: WorkflowContext, job: Job) => {
    system: string;
    prompt: string;
    jsonHint: string;
};
/** 把模型返回的结构化 JD 回灌进缓存。 */
export declare const ingestJdAnalysis: (ctx: WorkflowContext, input: {
    job: Job;
    parsed: ParsedJd;
}) => Promise<JdAnalysis>;
export interface AnalyzeMarketResult {
    snapshot: MarketSnapshot;
    history: SnapshotHistory;
    dashboard: DashboardData;
    analysis: AnalysisBuildResult;
    warnings: string[];
}
export declare const analyzeMarket: (ctx: WorkflowContext, options?: {
    filter?: MarketFilter;
    persist?: boolean;
    writeReport?: boolean;
}) => Promise<AnalyzeMarketResult>;
export interface PlanLearningResult {
    snapshot: MarketSnapshot;
    profile: PersonalSkillProfile;
    gap: GapReport;
    goals: LearningGoal[];
    roadmap: LearningRoadmap;
    /**
     * 用户尚未评估、但市场高频要求，因而被按 0 级纳入本次规划的技能。
     * 这些技能**没有**写进个人画像，只是本次计算的临时假设。
     */
    autoAssessed: {
        skill_id: string;
        skill: string;
        market_job_count: number;
    }[];
    warnings: string[];
}
/** 纳入规划的最低市场出现岗位数：只出现 1 次的技能噪声太大，不值得排进学习计划。 */
export declare const AUTO_ASSESS_MIN_JOB_COUNT = 2;
/** 单次最多自动纳入多少个未评估技能，避免把整张 taxonomy 灌进计划。 */
export declare const AUTO_ASSESS_LIMIT = 15;
/** 未评估技能的默认目标等级：3 = 能独立完成项目，即「能拿下这个岗位」的门槛。 */
export declare const AUTO_ASSESS_TARGET_LEVEL = 3;
export declare const planLearning: (ctx: WorkflowContext, options?: {
    weeks?: 4 | 8 | 12;
    limit?: number;
    projectId?: string;
    hoursPerWeek?: number;
}) => Promise<PlanLearningResult>;
export interface UpdateMarketResult {
    snapshot: MarketSnapshot;
    history: SnapshotHistory;
    adjustment?: RoadmapAdjustment;
    warnings: string[];
}
export declare const updateMarket: (ctx: WorkflowContext) => Promise<UpdateMarketResult>;
export interface StatusResult {
    workspaceRoot: string;
    jobCount: number;
    analyzedJobCount: number;
    categoryCount: number;
    cityCount: number;
    snapshotCount: number;
    latestSnapshotId?: string;
    personalSkillCount: number;
    confirmedSkillCount: number;
    goalCount: number;
    doneGoalCount: number;
    roadmapMode?: number;
    taxonomySkillCount: number;
    browserSkill: {
        enabled: boolean;
        executable: string;
        mode: string;
        allowedDomains: string[];
    };
    llm: {
        analysisVersion: number;
        promptVersion: number;
        cachedAnalyses: number;
    };
    policy: {
        autoApply: false;
        bypassRestrictions: false;
        readOnlyCollection: true;
    };
    warnings: string[];
}
export declare const getStatus: (ctx: WorkflowContext) => Promise<StatusResult>;
/** 技能追溯（需求 §十六）。 */
export declare const traceSkillInWorkspace: (ctx: WorkflowContext, skillQuery: string) => Promise<SkillTrace | undefined>;
/** 汇总趋势（需求 §十四）。 */
export declare const getTrends: (ctx: WorkflowContext, limit?: number) => Promise<import("../shared/types.js").SkillTrend[]>;
/** 个人画像摘要。 */
export declare const getPersonalSummary: (ctx: WorkflowContext) => Promise<string>;
/** 在导入/采集后规范化一批岗位输入并写入岗位池（去重 + last_seen_at 语义）。 */
export declare const ingestJobInputs: (ctx: WorkflowContext, inputs: readonly import('../shared/types.js').JobInput[]) => Promise<{
    newJobCount: number;
    updatedJobCount: number;
    totalJobCount: number;
}>;
/** 岗位池指纹，便于判断是否需要重算。 */
export declare const jobsFingerprintOf: (jobs: readonly Job[]) => string;
/** 空个人画像（首次配置用）。 */
export declare const newPersonalProfile: (targetRoles: readonly string[]) => PersonalSkillProfile;
