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

import type {
    GapReport,
    Iso,
    Job,
    JdAnalysis,
    JobMarketConfig,
    JobSearchConfig,
    LearningGoal,
    LearningRoadmap,
    MarketFilter,
    MarketSnapshot,
    PersonalSkillProfile,
    RoadmapAdjustment,
} from '../shared/types.js';
import { defaultConfig, parseConfig } from '../shared/config.js';
import { hashValue } from '../shared/hash.js';
import {
    loadTaxonomy,
    buildSkillIndex,
    buildSkillNameMap,
    buildCategoryLabelMap,
    createSkillDictionary,
    defaultTaxonomyJson,
} from '../taxonomy/taxonomy.js';
import type { SkillDictionary, SkillIndex } from '../taxonomy/taxonomy.js';
import { canonicalSkillIds } from '../taxonomy/skill-normalizer.js';
import { classifyJob } from '../classify/job-category-classifier.js';
import { parseJdByRule, buildJdAnalysisPrompt, ingestLlmAnalysis } from '../jd/jd-parser.js';
import {
    JD_CACHE_PATH,
    cacheStats,
    emptyJdCache,
    pruneJdCache,
    readCachedAnalysis,
    writeCachedAnalysis,
} from '../jd/jd-cache.js';
import type { JdCacheFile } from '../jd/jd-cache.js';
import { buildMarketSnapshot } from '../market/market-analyzer.js';
import { appendSnapshot, buildAllTrends, diffRoadmap, emptyHistory, latestSnapshot } from '../market/market-snapshot.js';
import type { SnapshotHistory } from '../market/market-snapshot.js';
import { planGoals } from '../plan/goal-planner.js';
import { instantiateProject, PROJECT_CATALOG } from '../plan/project-catalog.js';
import { planRoadmap } from '../plan/learning-roadmap.js';
import { analyzeGap } from '../gap/gap-analyzer.js';
import { emptyPersonalProfile, migratePersonalProfile, setSkillLevel, summarizeProfile } from '../profile/personal-skill-profile.js';
import { JOBS_PATH, createJob, upsertJobs } from '../store/job-store.js';
import {
    ensureOutputTree,
    readWorkspaceJson,
    writeWorkspaceJson,
} from '../workspace/workspace.js';
import { buildDashboardData, renderMarkdownReport, traceSkill } from '../report/dashboard.js';
import type { DashboardData, SkillTrace } from '../report/dashboard.js';
import type { ParsedJd } from '../shared/types.js';

/** 工作区内的持久化路径（与上游 job-hunting 的数据约定保持一致以便共存）。 */
export const PATHS = {
    jobs: JOBS_PATH,
    jdCache: JD_CACHE_PATH,
    snapshots: 'data/market-snapshots.json',
    personalProfile: 'profile/personal-skills.json',
    goals: 'data/learning-goals.json',
    roadmap: 'data/learning-roadmap.json',
    jobSearch: 'config/job-search.json',
    taxonomy: 'taxonomy/skill-taxonomy.json',
} as const;

export interface WorkflowContext {
    workspaceRoot: string;
    config: JobMarketConfig;
    dictionary: SkillDictionary;
    skillIndex: SkillIndex;
    skillNames: Map<string, { name: string; category: string }>;
    categoryLabels: Map<string, string>;
    warnings: string[];
    now: () => Iso;
}

/** 建立编排上下文：加载配置、taxonomy 与字典。 */
export const createWorkflowContext = async (input: {
    workspaceRoot: string;
    config?: JobMarketConfig;
    now?: () => Iso;
}): Promise<WorkflowContext> => {
    const config = input.config ?? defaultConfig;
    const taxonomyPath = config.taxonomyPath ?? `${input.workspaceRoot}/${PATHS.taxonomy}`;
    const { taxonomy, warning } = await loadTaxonomy(taxonomyPath);
    const warnings: string[] = [];
    if (warning !== undefined) warnings.push(warning);

    return {
        workspaceRoot: input.workspaceRoot,
        config,
        dictionary: createSkillDictionary(taxonomy),
        skillIndex: buildSkillIndex(taxonomy),
        skillNames: buildSkillNameMap(taxonomy),
        categoryLabels: buildCategoryLabelMap(taxonomy),
        warnings,
        now: input.now ?? (() => new Date().toISOString()),
    };
};

/** 由原始配置对象建立上下文（供插件入口使用）。 */
export const createWorkflowContextFromConfig = async (input: {
    workspaceRoot: string;
    configInput?: unknown;
}): Promise<WorkflowContext> =>
    createWorkflowContext({ workspaceRoot: input.workspaceRoot, config: parseConfig(input.configInput) });

/* ============================================================================
 * 读 / 写
 * ==========================================================================*/

export const readJobs = async (ctx: WorkflowContext): Promise<Job[]> =>
    (await readWorkspaceJson<Job[]>(ctx.workspaceRoot, PATHS.jobs)) ?? [];

export const writeJobs = async (ctx: WorkflowContext, jobs: readonly Job[]): Promise<void> =>
    writeWorkspaceJson(ctx.workspaceRoot, PATHS.jobs, jobs);

export const readHistory = async (ctx: WorkflowContext): Promise<SnapshotHistory> =>
    (await readWorkspaceJson<SnapshotHistory>(ctx.workspaceRoot, PATHS.snapshots)) ?? emptyHistory();

export const readJdCache = async (ctx: WorkflowContext): Promise<JdCacheFile> =>
    (await readWorkspaceJson<JdCacheFile>(ctx.workspaceRoot, PATHS.jdCache)) ?? emptyJdCache();

export const writeJdCache = async (ctx: WorkflowContext, cache: JdCacheFile): Promise<void> =>
    writeWorkspaceJson(ctx.workspaceRoot, PATHS.jdCache, cache);

export const readPersonalProfile = async (ctx: WorkflowContext): Promise<PersonalSkillProfile> =>
    migratePersonalProfile(await readWorkspaceJson<unknown>(ctx.workspaceRoot, PATHS.personalProfile));

export const writePersonalProfile = async (ctx: WorkflowContext, profile: PersonalSkillProfile): Promise<void> =>
    writeWorkspaceJson(ctx.workspaceRoot, PATHS.personalProfile, profile);

export const readGoals = async (ctx: WorkflowContext): Promise<LearningGoal[]> =>
    (await readWorkspaceJson<LearningGoal[]>(ctx.workspaceRoot, PATHS.goals)) ?? [];

export const writeGoals = async (ctx: WorkflowContext, goals: readonly LearningGoal[]): Promise<void> =>
    writeWorkspaceJson(ctx.workspaceRoot, PATHS.goals, goals);

export const readRoadmap = async (ctx: WorkflowContext): Promise<LearningRoadmap | undefined> =>
    readWorkspaceJson<LearningRoadmap>(ctx.workspaceRoot, PATHS.roadmap);

export const writeRoadmap = async (ctx: WorkflowContext, roadmap: LearningRoadmap): Promise<void> =>
    writeWorkspaceJson(ctx.workspaceRoot, PATHS.roadmap, roadmap);

/** 首次配置时把完整 taxonomy 落盘，供用户人工编辑。 */
export const ensureTaxonomyFile = async (ctx: WorkflowContext): Promise<string> => {
    const path = `${ctx.workspaceRoot}/${PATHS.taxonomy}`;
    const existing = await readWorkspaceJson<unknown>(ctx.workspaceRoot, PATHS.taxonomy);
    if (existing === undefined) {
        await ensureOutputTree(ctx.workspaceRoot);
        await writeWorkspaceJson(ctx.workspaceRoot, PATHS.taxonomy, JSON.parse(defaultTaxonomyJson()));
    }
    return path;
};

/** 写入求职方向配置。 */
export const writeJobSearch = async (ctx: WorkflowContext, search: JobSearchConfig): Promise<void> =>
    writeWorkspaceJson(ctx.workspaceRoot, PATHS.jobSearch, search);

export const readJobSearch = async (ctx: WorkflowContext): Promise<JobSearchConfig | undefined> =>
    readWorkspaceJson<JobSearchConfig>(ctx.workspaceRoot, PATHS.jobSearch);

/* ============================================================================
 * JD 解析（规则优先 + 缓存，需求 §十七）
 * ==========================================================================*/

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
export const buildAnalyses = async (
    ctx: WorkflowContext,
    jobs: readonly Job[],
    options: { existingCache?: JdCacheFile; maxJobs?: number } = {},
): Promise<{ result: AnalysisBuildResult; jobs: Job[] }> => {
    let cache = pruneJdCache(options.existingCache ?? (await readJdCache(ctx)), {
        analysisVersion: ctx.config.llm.analysis_version,
        promptVersion: ctx.config.llm.prompt_version,
    });

    const analyses = new Map<string, JdAnalysis>();
    const updatedJobs: Job[] = [];
    let computed = 0;
    let cached = 0;

    const limit = options.maxJobs ?? jobs.length;
    const slice = jobs.slice(0, limit);

    for (const job of slice) {
        // 1) 补分类（需求 §八：所有岗位必须经过分类器）
        let working = job;
        if (working.job_category === undefined || working.job_category === '' || working.job_category === 'unknown') {
            const classified = classifyJob({
                title: working.job_title,
                ...(working.description === undefined ? {} : { description: working.description }),
                requirements: working.requirements,
            });
            if (classified.category !== 'unknown') {
                working = { ...working, job_category: classified.category };
            }
        }
        // 2) 补技能（用于市场统计的共同口径）
        if (working.skills_normalized.length === 0) {
            const text = [working.job_title, working.description ?? '', ...working.requirements].join('\n');
            working = { ...working, skills_normalized: canonicalSkillIds(text, ctx.dictionary, ctx.skillIndex) };
        }
        updatedJobs.push(working);

        // 3) JD 分析：缓存优先
        const hit = readCachedAnalysis(cache, {
            job: working,
            analysisVersion: ctx.config.llm.analysis_version,
            promptVersion: ctx.config.llm.prompt_version,
        });
        if (hit !== undefined) {
            analyses.set(working.job_id, hit);
            cached += 1;
            continue;
        }
        const analysis = parseJdByRule({
            job: working,
            dictionary: ctx.dictionary,
            analysisVersion: ctx.config.llm.analysis_version,
            promptVersion: ctx.config.llm.prompt_version,
            now: ctx.now(),
        });
        analyses.set(working.job_id, analysis);
        cache = writeCachedAnalysis(cache, { job: working, analysis, now: ctx.now() });
        computed += 1;
    }

    if (limit < jobs.length) {
        // 超出本轮配额：其余岗位沿用其 skills_normalized，不参与分析
        updatedJobs.push(...jobs.slice(limit));
    }

    return {
        result: { analyses, cache, computed, cached, llmCalls: 0, stats: cacheStats(cache) },
        jobs: updatedJobs,
    };
};

/** 取得「需要模型深度解析」的 prompt（供宿主 agent 调用模型后回灌）。 */
export const prepareJdPrompt = (
    ctx: WorkflowContext,
    job: Job,
): { system: string; prompt: string; jsonHint: string } =>
    buildJdAnalysisPrompt({ job, promptVersion: ctx.config.llm.prompt_version });

/** 把模型返回的结构化 JD 回灌进缓存。 */
export const ingestJdAnalysis = async (
    ctx: WorkflowContext,
    input: { job: Job; parsed: ParsedJd },
): Promise<JdAnalysis> => {
    const analysis = ingestLlmAnalysis({
        job: input.job,
        parsed: input.parsed,
        dictionary: ctx.dictionary,
        analysisVersion: ctx.config.llm.analysis_version,
        promptVersion: ctx.config.llm.prompt_version,
        now: ctx.now(),
    });
    const cache = writeCachedAnalysis(await readJdCache(ctx), { job: input.job, analysis, now: ctx.now() });
    await writeJdCache(ctx, cache);
    return analysis;
};

/* ============================================================================
 * 用例 1：分析市场（「分析一下现在机器人软件岗位需要什么」）
 * ==========================================================================*/

export interface AnalyzeMarketResult {
    snapshot: MarketSnapshot;
    history: SnapshotHistory;
    dashboard: DashboardData;
    analysis: AnalysisBuildResult;
    warnings: string[];
}

export const analyzeMarket = async (
    ctx: WorkflowContext,
    options: { filter?: MarketFilter; persist?: boolean; writeReport?: boolean } = {},
): Promise<AnalyzeMarketResult> => {
    const warnings = [...ctx.warnings];
    const rawJobs = await readJobs(ctx);
    if (rawJobs.length === 0) {
        warnings.push('岗位库为空：请先执行一次采集（job_market_collect_jobs）或导入岗位后再分析。');
    }

    const { result: analysis, jobs } = await buildAnalyses(ctx, rawJobs);
    if (analysis.computed > 0) {
        await writeJobs(ctx, jobs);
        await writeJdCache(ctx, analysis.cache);
    }

    const filter: MarketFilter =
        options.filter ??
        (ctx.config.market.recent_days > 0 ? { recent_days: ctx.config.market.recent_days } : {});

    const snapshot = buildMarketSnapshot({
        jobs,
        analyses: analysis.analyses,
        filter,
        now: new Date(ctx.now()),
        skillNames: ctx.skillNames,
        topSkillsPerCategory: ctx.config.market.top_skills_per_category,
        minCooccurrenceCount: ctx.config.market.min_cooccurrence_count,
        defaultCategoryLabels: ctx.categoryLabels,
    });

    const history = appendSnapshot(await readHistory(ctx), snapshot);
    const personal = await readPersonalProfile(ctx);
    const gap =
        Object.keys(personal.skills).length > 0
            ? analyzeGap({ snapshot, profile: personal, weights: ctx.config.gapWeights, now: ctx.now() })
            : undefined;
    const roadmap = await readRoadmap(ctx);
    const goals = await readGoals(ctx);

    const dashboard = buildDashboardData({
        snapshot,
        history,
        ...(gap === undefined ? {} : { gap }),
        goals,
        roadmap: roadmap ?? null,
        config: ctx.config,
        now: ctx.now(),
    });

    if (options.persist !== false) {
        await writeWorkspaceJson(ctx.workspaceRoot, PATHS.snapshots, history);
        if (options.writeReport !== false) {
            const markdown = renderMarkdownReport({
                dashboard,
                snapshot,
                ...(gap === undefined ? {} : { gap }),
                goals,
                roadmap: roadmap ?? null,
            });
            const date = ctx.now().slice(0, 10);
            await writeWorkspaceJson(ctx.workspaceRoot, `reports/market-${date}.json`, dashboard);
            // Markdown 用文本写入（writeWorkspaceJson 会 JSON 序列化，故直接写文件）
            const { writeFileAtomic } = await import('../workspace/workspace.js');
            await writeFileAtomic(`${ctx.workspaceRoot}/reports/market-${date}.md`, markdown);
        }
    }

    return { snapshot, history, dashboard, analysis, warnings };
};

/* ============================================================================
 * 用例 2：生成学习计划（「给我生成未来8周学习计划」）
 * ==========================================================================*/

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
    autoAssessed: { skill_id: string; skill: string; market_job_count: number }[];
    warnings: string[];
}

/** 纳入规划的最低市场出现岗位数：只出现 1 次的技能噪声太大，不值得排进学习计划。 */
export const AUTO_ASSESS_MIN_JOB_COUNT = 2;
/** 单次最多自动纳入多少个未评估技能，避免把整张 taxonomy 灌进计划。 */
export const AUTO_ASSESS_LIMIT = 15;
/** 未评估技能的默认目标等级：3 = 能独立完成项目，即「能拿下这个岗位」的门槛。 */
export const AUTO_ASSESS_TARGET_LEVEL = 3;

export const planLearning = async (
    ctx: WorkflowContext,
    options: { weeks?: 4 | 8 | 12; limit?: number; projectId?: string; hoursPerWeek?: number } = {},
): Promise<PlanLearningResult> => {
    const warnings = [...ctx.warnings];
    const history = await readHistory(ctx);
    let snapshot = latestSnapshot(history);
    if (snapshot === undefined) {
        const analyzed = await analyzeMarket(ctx, { persist: true });
        snapshot = analyzed.snapshot;
        warnings.push(...analyzed.warnings);
    }

    const profile = await readPersonalProfile(ctx);
    const confirmedCount = Object.values(profile.skills).filter((skill) => skill.source === 'user').length;
    if (confirmedCount === 0) {
        warnings.push(
            '尚未录入任何已确认的个人技能等级：请先用 job_market_set_skill 录入 0-5 级能力与证据。' +
                '系统不会自行假定你已掌握某项技能。',
        );
    }

    /*
     * 未评估技能的处理。
     *
     * GapAnalyzer 只遍历用户已确认的技能，这保证了「AI 不得擅自认定已掌握」（需求 §九）
     * ——但也带来一个反直觉的后果：用户没评估过的高频技能（Nav2、TF2、SLAM…）
     * 会从学习计划里整个消失，于是「市场要什么」和「我该学什么」脱节。
     *
     * 折中做法：在**内存里**为市场高频、且用户未评估的技能补一条 0 级条目，
     * 目标是 3 级（能独立完成项目）。方向是保守的——假设你不会，而不是假设你会。
     *
     * 三条硬保证：
     *  1. 绝不写回 profile/personal-skills.json，用户画像保持「只有本人声明」的纯净；
     *  2. autoAssessed 如实回传，工具层会明确告知用户「这些是按 0 级临时纳入的」；
     *  3. 只纳入出现 ≥ AUTO_ASSESS_MIN_JOB_COUNT 个岗位的技能，滤掉单次噪声。
     */
    const knownSkillIds = new Set(Object.keys(profile.skills));
    const autoAssessed: { skill_id: string; skill: string; market_job_count: number }[] = [];
    let planningProfile = profile;
    const candidates = [...snapshot.skill_frequencies]
        .filter((item) => !knownSkillIds.has(item.skill_id) && item.job_count >= AUTO_ASSESS_MIN_JOB_COUNT)
        .sort((a, b) => b.weighted_demand - a.weighted_demand || b.job_count - a.job_count)
        .slice(0, AUTO_ASSESS_LIMIT);
    for (const candidate of candidates) {
        planningProfile = setSkillLevel(planningProfile, {
            skill_id: candidate.skill_id,
            current_level: 0,
            target_level: AUTO_ASSESS_TARGET_LEVEL,
            now: ctx.now(),
        });
        autoAssessed.push({
            skill_id: candidate.skill_id,
            skill: candidate.skill,
            market_job_count: candidate.job_count,
        });
    }
    if (autoAssessed.length > 0) {
        warnings.push(
            `有 ${autoAssessed.length} 个市场高频技能你尚未评估等级，本次按 0 级临时纳入计划：` +
                `${autoAssessed.map((item) => item.skill).join('、')}。` +
                '如果你其实已有基础，请用 job_market_set_skill 录入真实等级后重新生成计划，' +
                '否则计划会偏保守。这些临时等级没有写入你的个人画像。',
        );
    }

    const gap = analyzeGap({
        snapshot,
        profile: planningProfile,
        weights: ctx.config.gapWeights,
        limit: options.limit ?? 30,
        now: ctx.now(),
    });

    const template =
        options.projectId === undefined
            ? PROJECT_CATALOG[0]
            : PROJECT_CATALOG.find((item) => item.project_id === options.projectId) ?? PROJECT_CATALOG[0];
    const frequencies = new Map(
        snapshot.skill_frequencies.map((item) => [
            item.skill_id,
            { job_count: item.job_count, job_ratio: item.job_ratio, job_ids: item.job_ids },
        ]),
    );
    const topSkillIds = [...snapshot.skill_frequencies]
        .sort((a, b) => b.job_count - a.job_count)
        .slice(0, 20)
        .map((item) => item.skill_id);
    const project =
        template === undefined ? undefined : instantiateProject(template, frequencies, snapshot.job_count, { topSkillIds });

    const planGoalsInput = {
        gap,
        snapshot,
        limit: options.limit ?? 12,
        now: ctx.now(),
        ...(project === undefined ? {} : { project }),
    };
    const goals = planGoals(planGoalsInput);

    const roadmap = planRoadmap({
        goals,
        snapshot,
        mode: options.weeks ?? ctx.config.defaultRoadmapWeeks,
        ...(project === undefined ? {} : { project }),
        now: ctx.now(),
        ...(options.hoursPerWeek === undefined ? {} : { hoursPerWeek: options.hoursPerWeek }),
    });

    await writeGoals(ctx, goals);
    await writeRoadmap(ctx, roadmap);
    // 注意：只写 goals 与 roadmap。autoAssessed 的临时等级**不落盘**，个人画像保持纯净。
    return { snapshot, profile, gap, goals, roadmap, autoAssessed, warnings };
};

/* ============================================================================
 * 用例 3：增量更新市场（「更新一下求职市场」）
 * ==========================================================================*/

export interface UpdateMarketResult {
    snapshot: MarketSnapshot;
    history: SnapshotHistory;
    adjustment?: RoadmapAdjustment;
    warnings: string[];
}

export const updateMarket = async (ctx: WorkflowContext): Promise<UpdateMarketResult> => {
    const warnings = [...ctx.warnings];
    const previousHistory = await readHistory(ctx);
    const previousSnapshot = latestSnapshot(previousHistory);
    const previousRoadmap = await readRoadmap(ctx);

    const analyzed = await analyzeMarket(ctx, { persist: true });
    warnings.push(...analyzed.warnings);

    let adjustment: RoadmapAdjustment | undefined;
    if (previousRoadmap !== undefined && previousSnapshot !== undefined) {
        const personal = await readPersonalProfile(ctx);
        const gap = analyzeGap({
            snapshot: analyzed.snapshot,
            profile: personal,
            weights: ctx.config.gapWeights,
            now: ctx.now(),
        });
        adjustment = diffRoadmap({
            previousRoadmap,
            previousSnapshot,
            newSnapshot: analyzed.snapshot,
            newPriorityOrder: gap.entries.map((entry) => entry.skill_id),
            now: ctx.now(),
        });
    } else if (previousRoadmap === undefined) {
        warnings.push('尚未生成学习路线，因此没有可对比的调整建议。请先运行一次学习计划生成。');
    }

    return {
        snapshot: analyzed.snapshot,
        history: analyzed.history,
        ...(adjustment === undefined ? {} : { adjustment }),
        warnings,
    };
};

/* ============================================================================
 * 用例 4：状态与追溯
 * ==========================================================================*/

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
    browserSkill: { enabled: boolean; executable: string; mode: string; allowedDomains: string[] };
    llm: { analysisVersion: number; promptVersion: number; cachedAnalyses: number };
    policy: { autoApply: false; bypassRestrictions: false; readOnlyCollection: true };
    warnings: string[];
}

export const getStatus = async (ctx: WorkflowContext): Promise<StatusResult> => {
    const jobs = await readJobs(ctx);
    const history = await readHistory(ctx);
    const snapshot = latestSnapshot(history);
    const personal = await readPersonalProfile(ctx);
    const goals = await readGoals(ctx);
    const roadmap = await readRoadmap(ctx);
    const cache = await readJdCache(ctx);

    const status: StatusResult = {
        workspaceRoot: ctx.workspaceRoot,
        jobCount: jobs.length,
        analyzedJobCount: snapshot?.analyzed_job_count ?? 0,
        categoryCount: new Set(jobs.map((job) => job.job_category)).size,
        cityCount: new Set(jobs.map((job) => job.city).filter((city): city is string => city !== undefined)).size,
        snapshotCount: history.snapshots.length,
        personalSkillCount: Object.keys(personal.skills).length,
        confirmedSkillCount: Object.values(personal.skills).filter((skill) => skill.source === 'user').length,
        goalCount: goals.length,
        doneGoalCount: goals.filter((goal) => goal.status === 'done').length,
        taxonomySkillCount: ctx.skillIndex.size,
        browserSkill: {
            enabled: ctx.config.browserSkill.enabled,
            executable: ctx.config.browserSkill.executable,
            mode: ctx.config.browserSkill.mode,
            allowedDomains: ctx.config.browserSkill.allowedDomains,
        },
        llm: {
            analysisVersion: ctx.config.llm.analysis_version,
            promptVersion: ctx.config.llm.prompt_version,
            cachedAnalyses: cacheStats(cache).total,
        },
        policy: { autoApply: false, bypassRestrictions: false, readOnlyCollection: true },
        warnings: [...ctx.warnings],
    };
    if (snapshot !== undefined) status.latestSnapshotId = snapshot.snapshot_id;
    if (roadmap !== undefined) status.roadmapMode = roadmap.mode;
    if (status.jobCount === 0) {
        status.warnings.push('岗位库为空。请先运行 job_market_plan_collection 生成采集计划并确认采集。');
    }
    return status;
};

/** 技能追溯（需求 §十六）。 */
export const traceSkillInWorkspace = async (
    ctx: WorkflowContext,
    skillQuery: string,
): Promise<SkillTrace | undefined> => {
    const history = await readHistory(ctx);
    const snapshot = latestSnapshot(history);
    if (snapshot === undefined) return undefined;
    const jobs = await readJobs(ctx);

    // 支持「按技能名」或「按技能 ID」查询，并对别名做一次归一化。
    const normalized = canonicalSkillIds(skillQuery, ctx.dictionary, ctx.skillIndex);
    const candidates = [skillQuery, ...normalized];
    for (const candidate of candidates) {
        const trace = traceSkill(snapshot, jobs, candidate);
        if (trace !== undefined) return trace;
    }
    // 退化：按展示名模糊匹配
    const byName = snapshot.skill_frequencies.find(
        (item) => item.skill.includes(skillQuery) || item.skill_id.includes(skillQuery),
    );
    return byName === undefined ? undefined : traceSkill(snapshot, jobs, byName.skill_id);
};

/** 汇总趋势（需求 §十四）。 */
export const getTrends = async (ctx: WorkflowContext, limit = 20) => {
    const history = await readHistory(ctx);
    return buildAllTrends(history, limit);
};

/** 个人画像摘要。 */
export const getPersonalSummary = async (ctx: WorkflowContext): Promise<string> => {
    const profile = await readPersonalProfile(ctx);
    return summarizeProfile(profile);
};

/** 在导入/采集后规范化一批岗位输入并写入岗位池（去重 + last_seen_at 语义）。 */
export const ingestJobInputs = async (
    ctx: WorkflowContext,
    inputs: readonly import('../shared/types.js').JobInput[],
): Promise<{ newJobCount: number; updatedJobCount: number; totalJobCount: number }> => {
    const existing = await readJobs(ctx);
    const now = ctx.now();
    const normalizeSkills = (text: string): string[] => canonicalSkillIds(text, ctx.dictionary, ctx.skillIndex);
    const created = inputs.map((input) => createJob(input, { now, normalizeSkills }));
    const result = upsertJobs(existing, created, now);
    await writeJobs(ctx, result.jobs);
    return {
        newJobCount: result.newJobIds.length,
        updatedJobCount: result.updatedJobIds.length,
        totalJobCount: result.jobs.length,
    };
};

/** 岗位池指纹，便于判断是否需要重算。 */
export const jobsFingerprintOf = (jobs: readonly Job[]): string =>
    hashValue(
        'jobs',
        jobs.map((job) => [job.job_id, job.last_seen_at, job.seen_count]),
    );

/** 空个人画像（首次配置用）。 */
export const newPersonalProfile = (targetRoles: readonly string[]): PersonalSkillProfile =>
    emptyPersonalProfile({ target_roles: [...targetRoles] });
