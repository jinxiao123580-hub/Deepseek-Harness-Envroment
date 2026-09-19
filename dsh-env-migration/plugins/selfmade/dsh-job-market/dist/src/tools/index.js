/**
 * DSH 工具注册层。
 *
 * 每个工具对应需求里的一个用户动作，用户只要在 DSH 里说一句自然语言，
 * 宿主 agent 就会挑对应工具执行：
 *
 *   「分析一下现在机器人软件岗位需要什么」→ job_market_analyze
 *   「根据目前岗位市场给我生成未来8周学习计划」→ job_market_plan_learning
 *   「更新一下求职市场」→ job_market_update
 *
 * 安全约束（需求 §十八）在这里落地为参数级强制：
 *  - 采集类工具必须 `confirmed: true`（const 约束，模型无法默认填 true）
 *  - 采集走 `collectWithBrowserSkill`，内部强制只读模式 + 域名白名单 + 人工批准
 *  - 个人能力写入必须 `confirmed: true`，AI 不得擅自认定已掌握
 */
import { readFile } from 'node:fs/promises';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { parseConfig } from '../shared/config.js';
import { detectFormat, parseJobContent } from '../jobs/local-import.js';
import { PLATFORMS, enabledPlatforms, rawJobRecordsToInputs } from '../collect/platforms.js';
import { planCollection } from '../collect/search-planner.js';
import { BrowserHumanAssistanceRequiredError, BrowserSkillUnavailableError, checkBrowserSkill, collectWithBrowserSkill, createSafeBskRunner, } from '../collect/browser-collector.js';
import { canonicalSkillIds } from '../taxonomy/skill-normalizer.js';
import { confirmSuggestion, setSkillLevel } from '../profile/personal-skill-profile.js';
import { traceSkillInWorkspace } from '../workflow/market-workflow.js';
import { analyzeMarket, createWorkflowContextFromConfig, ensureTaxonomyFile, getPersonalSummary, getStatus, getTrends, ingestJdAnalysis, ingestJobInputs, newPersonalProfile, planLearning, prepareJdPrompt, readGoals, readJobSearch, readJobs, readPersonalProfile, readRoadmap, updateMarket, writeGoals, writeJobSearch, writePersonalProfile, PATHS, } from '../workflow/market-workflow.js';
import { renderMarkdownReport } from '../report/dashboard.js';
import { resolveOutputRoot, writeWorkspaceJson } from '../workspace/workspace.js';
const jsonOutput = {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) ?? 'null' }],
};
/** 去掉 Map / undefined 等不可序列化的东西，保证能安全返回给模型。 */
const asJson = (value) => JSON.parse(JSON.stringify(value));
const SKILL_LEVELS = [0, 1, 2, 3, 4, 5];
/** 把用户写的技能名（可能是别名）解析成稳定的 skill_id。 */
const resolveSkillRef = (ctx, raw) => {
    const query = raw.trim();
    if (query === '')
        throw new TypeError('技能不能为空。');
    const ids = canonicalSkillIds(query, ctx.dictionary, ctx.skillIndex);
    const first = ids[0];
    if (first !== undefined) {
        const meta = ctx.skillNames.get(first);
        return { skill_id: first, skill: meta?.name ?? query };
    }
    // 退化：自定义技能——用规范化后的名字直接作为 ID，保证用户可以录入体系外的技能。
    const fallback = query.toLowerCase().replace(/\s+/g, '-');
    return { skill_id: fallback, skill: query };
};
/**
 * 工具工厂。
 *
 * `resolveWorkspace` 由插件入口提供（与上游 job-hunting 完全一致的方式），
 * 每次执行都重新解析，保证多工作区/多会话下不会串数据。
 */
export const createJobMarketTools = (resolveWorkspace, config) => {
    // WorkflowContext 载入 taxonomy（约 180 个技能），按工作区缓存避免每次调用重读。
    const contextCache = new Map();
    const getContext = async (workspace) => {
        const cached = contextCache.get(workspace.path);
        if (cached !== undefined)
            return await cached;
        const created = createWorkflowContextFromConfig({
            workspaceRoot: workspace.path,
            configInput: config,
        });
        contextCache.set(workspace.path, created);
        return await created;
    };
    return [
        /* ------------------------------------------------------------------
         * 0. 状态与配置
         * ----------------------------------------------------------------*/
        defineTool({
            name: 'job_market_status',
            description: 'Show the active Workspace, job-market state (job pool, snapshots, personal skill profile, roadmap) and configured safety defaults. [求职市场状态]',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                return asJson(await getStatus(ctx));
            },
        }),
        defineTool({
            name: 'job_market_configure',
            description: 'Set the job-search target direction: roles, cities, experience and salary floor, extra keywords and exclusions. Persists to config/job-search.json in the active Workspace. [配置求职方向]',
            parameters: {
                target_roles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Target roles, e.g. ["机器人软件工程师","ROS2开发","机器人控制算法","机器人嵌入式工程师"].',
                },
                locations: { type: 'array', items: { type: 'string' }, description: 'Target cities, e.g. ["上海","杭州","苏州","南京"].' },
                experience_min: { type: 'number', description: 'Minimum years of experience (0-3 for fresh graduates).' },
                experience_max: { type: 'number', description: 'Maximum years of experience.' },
                salary_min_k: { type: 'number', description: 'Minimum monthly salary floor in K (e.g. 15 means 15K).' },
                keywords: { type: 'array', items: { type: 'string' }, description: 'Extra search keywords to expand on.' },
                exclude_keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords that disqualify a job (e.g. 销售).' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const current = (await readJobSearch(await getContext(workspace))) ?? {};
                const next = {
                    ...current,
                    ...(args.target_roles === undefined ? {} : { target_roles: args.target_roles }),
                    ...(args.locations === undefined ? {} : { locations: args.locations }),
                    ...(args.experience_min === undefined ? {} : { experience_min: args.experience_min }),
                    ...(args.experience_max === undefined ? {} : { experience_max: args.experience_max }),
                    ...(args.salary_min_k === undefined ? {} : { salary_min_k: args.salary_min_k }),
                    ...(args.keywords === undefined ? {} : { keywords: args.keywords }),
                    ...(args.exclude_keywords === undefined ? {} : { exclude_keywords: args.exclude_keywords }),
                };
                const ctx = await getContext(workspace);
                await writeJobSearch(ctx, next);
                const taxonomyPath = await ensureTaxonomyFile(ctx);
                return asJson({
                    saved: true,
                    configPath: PATHS.jobSearch,
                    taxonomyPath,
                    search: next,
                    note: '求职方向已保存。下一步可调用 job_market_plan_collection 生成采集计划。',
                });
            },
        }),
        /* ------------------------------------------------------------------
         * 1. 采集（需求 §四 / §十八：只读 + 白名单 + 显式确认）
         * ----------------------------------------------------------------*/
        defineTool({
            name: 'job_market_plan_collection',
            description: 'Expand the configured target roles into concrete search keywords and build a read-only collection plan with allowlisted search URLs per platform. Call this BEFORE collecting, then show the URLs to the user. [生成采集计划]',
            parameters: {
                max_targets: { type: 'number', description: 'Cap on number of planned URLs (default 200).' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const search = (await readJobSearch(ctx)) ?? config.jobSearch;
                const plan = planCollection({
                    config: search,
                    platforms: enabledPlatforms(),
                    now: ctx.now(),
                    ...(args.max_targets === undefined ? {} : { maxTargets: args.max_targets }),
                });
                const browserStatus = await checkBrowserSkill(config.browserSkill.executable, createSafeBskRunner(config.browserSkill.executable));
                return asJson({
                    plan,
                    platforms: PLATFORMS,
                    browserSkill: { ...browserStatus, executable: config.browserSkill.executable, mode: config.browserSkill.mode },
                    allowedDomains: config.browserSkill.allowedDomains,
                    nextStep: plan.targets.length === 0
                        ? '计划里没有任何 URL：请先检查 browserSkill.allowedDomains 是否覆盖了各平台搜索主机名（例如智联的 sou.zhaopin.com），并确认 target_roles / locations 已配置。'
                        : '请把上面这些 URL 展示给用户，取得明确同意后再调用 job_market_collect_jobs（confirmed: true）。',
                });
            },
        }),
        defineTool({
            name: 'job_market_collect_jobs',
            description: 'Read visible job postings through the read-only Tencent/BrowserSkill session for allowlisted URLs, then merge and deduplicate them into the active Workspace job pool. Requires explicit user confirmation. [只读采集岗位]',
            parameters: {
                urls: {
                    type: 'array',
                    items: { type: 'string' },
                    required: true,
                    description: 'HTTP(S) URLs on the configured allowlisted job sites (from job_market_plan_collection).',
                },
                confirmed: {
                    type: 'boolean',
                    const: true,
                    required: true,
                    description: 'Explicitly confirm this read-only collection run. Never set without asking the user.',
                },
                source: { type: 'string', description: 'Stable source label, e.g. boss / liepin / zhaopin.' },
                platform: { type: 'string', description: 'Platform id this URL batch belongs to (boss, liepin, zhaopin, 51job, iguopin).' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const raw = await collectWithBrowserSkill({
                    urls: args.urls,
                    config: config.browserSkill,
                    userApproved: args.confirmed === true,
                    executable: config.browserSkill.executable,
                    source: args.source ?? 'browser-skill',
                    collectedAt: ctx.now(),
                    ...(args.platform === undefined ? {} : { platformId: args.platform }),
                }, createSafeBskRunner(config.browserSkill.executable));
                const merged = await ingestJobInputs(ctx, rawJobRecordsToInputs(raw, (args.source ?? 'browser-skill'), ctx.now()));
                return asJson({
                    source: args.source ?? 'browser-skill',
                    collected: raw.length,
                    newJobs: merged.newJobCount,
                    updatedJobs: merged.updatedJobCount,
                    totalJobs: merged.totalJobCount,
                    note: '重复出现的岗位只刷新 last_seen_at 与 seen_count，不计为新岗位。',
                });
            },
        }),
        defineTool({
            name: 'job_market_import_jobs',
            description: 'Import job postings from a local JSON / CSV / Markdown file inside the active Workspace, then merge and deduplicate into the job pool. Use this when BrowserSkill is unavailable. [导入本地岗位]',
            parameters: {
                path: { type: 'string', required: true, description: 'Workspace-relative file path, e.g. input/jobs-boss.json.' },
                format: { type: 'string', enum: ['json', 'csv', 'markdown'], description: 'File format; auto-detected from extension when omitted.' },
                source: { type: 'string', description: 'Fallback source label for rows without one.' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const format = args.format ?? detectFormat(args.path);
                const content = await readFile(resolveOutputRoot(workspace, args.path), 'utf8');
                const inputs = parseJobContent(content, format, (args.source ?? 'local'));
                if (inputs.length === 0) {
                    throw new Error(`未能从 ${args.path} 解析出任何岗位。请确认格式（${format}）与字段（至少需要岗位名称与公司名称）。`);
                }
                const merged = await ingestJobInputs(ctx, inputs);
                return asJson({
                    parsed: inputs.length,
                    newJobs: merged.newJobCount,
                    updatedJobs: merged.updatedJobCount,
                    totalJobs: merged.totalJobCount,
                });
            },
        }),
        /* ------------------------------------------------------------------
         * 2. 市场分析（需求 §五~§八）
         * ----------------------------------------------------------------*/
        defineTool({
            name: 'job_market_analyze',
            description: 'Classify every job, normalize skill mentions, parse JDs (rule-first with caching), then compute the market snapshot: skill frequency with required/preferred/bonus split, cooccurrence lift, per-direction breakdowns, salary and experience distributions. All numbers are computed by code, never by the model. [市场分析]',
            parameters: {
                recent_days: { type: 'number', description: 'Only count jobs seen within N days; 0 means all jobs.' },
                cities: { type: 'array', items: { type: 'string' }, description: 'Restrict to these cities.' },
                categories: { type: 'array', items: { type: 'string' }, description: 'Restrict to these job categories.' },
                salary_min_k: { type: 'number', description: 'Only count jobs whose salary floor is at least this many K.' },
                experience_max: { type: 'number', description: 'Only count jobs requiring at most this many years.' },
                write_report: { type: 'boolean', description: 'Write a Markdown report into reports/ (default true).' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const filter = {
                    ...(args.recent_days === undefined ? {} : { recent_days: args.recent_days }),
                    ...(args.cities === undefined ? {} : { cities: args.cities }),
                    ...(args.categories === undefined ? {} : { categories: args.categories }),
                    ...(args.salary_min_k === undefined ? {} : { salary_min_k: args.salary_min_k }),
                    ...(args.experience_max === undefined ? {} : { experience_max: args.experience_max }),
                };
                const result = await analyzeMarket(ctx, {
                    filter,
                    persist: true,
                    writeReport: args.write_report !== false,
                });
                return asJson({
                    snapshot: result.snapshot,
                    dashboard: result.dashboard,
                    jdParsing: {
                        newlyParsed: result.analysis.computed,
                        fromCache: result.analysis.cached,
                        llmCalls: result.analysis.llmCalls,
                    },
                    warnings: result.warnings,
                });
            },
        }),
        defineTool({
            name: 'job_market_dashboard',
            description: 'Return the six-block dashboard (market overview, skill ranking, job directions, my capability, learning roadmap, trends) built from the latest snapshot. Includes provenance so every figure is traceable. [市场看板]',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const result = await analyzeMarket(ctx, { persist: true, writeReport: false });
                return asJson({ dashboard: result.dashboard, warnings: result.warnings });
            },
        }),
        defineTool({
            name: 'job_market_trace_skill',
            description: 'Prove a statistic: given a skill name, list the exact real jobs that require / prefer it, with company, title, city, url and source. Use this whenever the user challenges a number such as "ROS2 68%". [技能数据回溯]',
            parameters: {
                skill: { type: 'string', required: true, description: 'Skill name or alias, e.g. ROS2, C++, 运动规划.' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const trace = await traceSkillInWorkspace(ctx, args.skill);
                if (trace === undefined) {
                    const jobs = await readJobs(ctx);
                    throw new Error(`技能「${args.skill}」在当前快照里没有匹配记录（岗位池 ${jobs.length} 个）。` +
                        '可能是尚未运行 job_market_analyze，或该技能写法不在 taxonomy 中。');
                }
                return asJson(trace);
            },
        }),
        defineTool({
            name: 'job_market_trends',
            description: 'Show how skill demand evolved across saved market snapshots (e.g. ROS2 61% → 68% → 72%), with direction and delta in percentage points. [需求趋势]',
            parameters: {
                limit: { type: 'number', description: 'Max number of skills to return (default 20).' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const trends = await getTrends(ctx, args.limit ?? 20);
                if (trends.length === 0) {
                    throw new Error('还没有足够的历史快照来计算趋势：至少需要累计两次市场分析。');
                }
                return asJson({ trends });
            },
        }),
        /* ------------------------------------------------------------------
         * 3. 个人能力画像（需求 §九）
         * ----------------------------------------------------------------*/
        defineTool({
            name: 'job_market_get_skill_profile',
            description: 'Read the personal skill profile: 0-5 levels, target levels, evidence, last update and confidence, plus any pending AI suggestions that still need confirmation. [查看我的能力]',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const profile = await readPersonalProfile(ctx);
                return asJson({ profile, summary: await getPersonalSummary(ctx) });
            },
        }),
        defineTool({
            name: 'job_market_set_skill',
            description: 'Record the user\'s own skill level (0=none, 1=concept, 2=demo, 3=independent project, 4=solves real problems, 5=deep mastery) with evidence, and the target level. Only the user may declare mastery; never infer it. [设置技能等级]',
            parameters: {
                skill: { type: 'string', required: true, description: 'Skill name or alias, e.g. C++, ROS2, Linux.' },
                current_level: { type: 'number', enum: SKILL_LEVELS, required: true, description: 'Current level 0-5.' },
                target_level: { type: 'number', enum: SKILL_LEVELS, description: 'Target level 0-5; defaults to current_level.' },
                evidence: {
                    type: 'array',
                    items: { type: 'json' },
                    description: 'Evidence entries, e.g. [{"kind":"project","detail":"基于 ROS2 的移动机器人导航","url":"https://github.com/..."}].',
                },
                note: { type: 'string', description: 'Optional free-form note.' },
                confirmed: {
                    type: 'boolean',
                    const: true,
                    required: true,
                    description: 'The user explicitly stated this self-assessment.',
                },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const ref = resolveSkillRef(ctx, args.skill);
                const profile = await readPersonalProfile(ctx);
                const next = setSkillLevel(profile, {
                    skill_id: ref.skill_id,
                    current_level: args.current_level,
                    ...(args.target_level === undefined ? {} : { target_level: args.target_level }),
                    ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
                    ...(args.note === undefined ? {} : { note: args.note }),
                    now: ctx.now(),
                });
                await writePersonalProfile(ctx, next);
                return asJson({ skill_id: ref.skill_id, skill: ref.skill, profile: next.skills[ref.skill_id] });
            },
        }),
        defineTool({
            name: 'job_market_confirm_skill_suggestion',
            description: 'Confirm or dismiss an AI-suggested skill level. AI suggestions never take effect automatically: only an explicit confirmation writes them into the profile. [确认技能建议]',
            parameters: {
                skill: { type: 'string', required: true, description: 'Skill name or alias of the pending suggestion.' },
                confirmed: { type: 'boolean', required: true, description: 'true to accept the suggestion, false to dismiss it.' },
                current_level: { type: 'number', enum: SKILL_LEVELS, description: 'Override the suggested level.' },
                target_level: { type: 'number', enum: SKILL_LEVELS, description: 'Override the target level.' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const ref = resolveSkillRef(ctx, args.skill);
                const profile = await readPersonalProfile(ctx);
                if (args.confirmed !== true) {
                    // 驳回建议：只从 pending_suggestions 里移除，绝不触碰 skills，
                    // 因此驳回动作对 Gap 计算没有任何影响。
                    const dismissed = {
                        ...profile,
                        pending_suggestions: profile.pending_suggestions.filter((item) => item.skill_id !== ref.skill_id),
                        updated_at: ctx.now(),
                    };
                    await writePersonalProfile(ctx, dismissed);
                    return asJson({ dismissed: true, skill_id: ref.skill_id });
                }
                const next = confirmSuggestion(profile, {
                    skill_id: ref.skill_id,
                    confirmed: true,
                    ...(args.current_level === undefined ? {} : { current_level: args.current_level }),
                    ...(args.target_level === undefined ? {} : { target_level: args.target_level }),
                    now: ctx.now(),
                });
                await writePersonalProfile(ctx, next);
                return asJson({ confirmed: true, skill_id: ref.skill_id, profile: next.skills[ref.skill_id] });
            },
        }),
        /* ------------------------------------------------------------------
         * 4. Gap 与学习计划（需求 §十~§十三）
         * ----------------------------------------------------------------*/
        defineTool({
            name: 'job_market_plan_learning',
            description: 'Compute the skill gap (priority = market_demand × importance × skill_gap × role_coverage ÷ learning_cost, with per-skill explanation), then generate verifiable stage goals and a 4/8/12-week learning roadmap driven by a real robotics project. [生成学习计划]',
            parameters: {
                weeks: { type: 'number', enum: [4, 8, 12], description: 'Roadmap length in weeks; default 8.' },
                project_id: { type: 'string', description: 'Project template id from the project catalog; default is the mobile robot track.' },
                limit: { type: 'number', description: 'Max number of goals to plan (default 12).' },
                hours_per_week: { type: 'number', description: 'Study hours available per week (default 15).' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const result = await planLearning(ctx, {
                    ...(args.weeks === undefined ? {} : { weeks: args.weeks }),
                    ...(args.project_id === undefined ? {} : { projectId: args.project_id }),
                    ...(args.limit === undefined ? {} : { limit: args.limit }),
                    ...(args.hours_per_week === undefined ? {} : { hoursPerWeek: args.hours_per_week }),
                });
                const markdown = renderMarkdownReport({
                    dashboard: (await analyzeMarket(ctx, { persist: false, writeReport: false })).dashboard,
                    snapshot: result.snapshot,
                    gap: result.gap,
                    goals: result.goals,
                    roadmap: result.roadmap,
                    title: `${result.roadmap.mode} 周学习路线`,
                });
                await writeWorkspaceJson(ctx.workspaceRoot, `reports/roadmap-${ctx.now().slice(0, 10)}.md`, markdown);
                return asJson({
                    gap: result.gap,
                    goals: result.goals,
                    roadmap: result.roadmap,
                    autoAssessed: result.autoAssessed,
                    autoAssessedNote: result.autoAssessed.length === 0
                        ? null
                        : `${result.autoAssessed.length} 个市场高频技能你没有评估过等级，本次按 0 级临时纳入（未写入个人画像）。` +
                            '请向用户确认这些技能的真实基础，再用 job_market_set_skill 更新后重新生成计划。',
                    warnings: result.warnings,
                    markdown,
                });
            },
        }),
        defineTool({
            name: 'job_market_complete_goal',
            description: 'Mark a learning goal as done. Only allowed when the goal has explicit acceptance criteria and the user confirms they are all met. [标记目标完成]',
            parameters: {
                goal_id: { type: 'string', required: true, description: 'Goal id from job_market_plan_learning output.' },
                confirmed: {
                    type: 'boolean',
                    const: true,
                    required: true,
                    description: 'The user confirmed every acceptance criterion is satisfied.',
                },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const goals = await readGoals(ctx);
                const { completeGoalInRoadmap } = await import('../plan/learning-roadmap.js');
                const outcome = completeGoalInRoadmap(goals, {
                    goalId: args.goal_id,
                    confirmed: args.confirmed === true,
                    now: ctx.now(),
                });
                if (outcome.error !== undefined)
                    throw new Error(outcome.error);
                await writeGoals(ctx, outcome.goals);
                return asJson({ completed: outcome.completed });
            },
        }),
        /* ------------------------------------------------------------------
         * 5. 增量更新与动态调整（需求 §十四）
         * ----------------------------------------------------------------*/
        defineTool({
            name: 'job_market_update',
            description: 'Re-analyze the market on the current job pool, append a new snapshot, and produce an incremental adjustment proposal (continue / add / raise / lower / remove) with reasons. It never overthrows the existing plan. [更新求职市场]',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const result = await updateMarket(ctx);
                return asJson({
                    snapshot: result.snapshot,
                    snapshotCount: result.history.snapshots.length,
                    adjustment: result.adjustment ?? null,
                    policy: '增量调整：不会直接推翻既有学习计划，只给出继续/新增/提高/降低/删除建议及原因。',
                    warnings: result.warnings,
                });
            },
        }),
        /* ------------------------------------------------------------------
         * 6. LLM 兜底通道（需求 §十七）
         * ----------------------------------------------------------------*/
        defineTool({
            name: 'job_market_prepare_jd_prompt',
            description: 'Return the structured-JD extraction prompt for one job. Use only when rule-based parsing is clearly insufficient (ambiguous seniority, mixed responsibilities). The model then returns ParsedJd JSON which you feed back via job_market_ingest_jd_analysis. [准备 JD 解析 prompt]',
            parameters: {
                job_id: { type: 'string', required: true, description: 'Job id from the job pool.' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const jobs = await readJobs(ctx);
                const job = jobs.find((item) => item.job_id === args.job_id);
                if (job === undefined)
                    throw new Error(`找不到岗位 ${args.job_id}（岗位池共 ${jobs.length} 个）。`);
                return asJson({ job_id: job.job_id, ...prepareJdPrompt(ctx, job) });
            },
        }),
        defineTool({
            name: 'job_market_ingest_jd_analysis',
            description: 'Write a model-produced ParsedJd back into the JD cache, normalizing its skills into taxonomy ids and required/preferred/bonus weights. The cache is keyed by JD hash + analysis/prompt version, so unchanged JDs are never re-analyzed. [回灌 JD 解析结果]',
            parameters: {
                job_id: { type: 'string', required: true, description: 'Job id being analyzed.' },
                parsed: { type: 'json', required: true, description: 'ParsedJd object with the 17 required fields.' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const jobs = await readJobs(ctx);
                const job = jobs.find((item) => item.job_id === args.job_id);
                if (job === undefined)
                    throw new Error(`找不到岗位 ${args.job_id}。`);
                const analysis = await ingestJdAnalysis(ctx, { job, parsed: args.parsed });
                return asJson({
                    job_id: job.job_id,
                    via: analysis.via,
                    mentionCount: analysis.mentions.length,
                    mentions: analysis.mentions,
                });
            },
        }),
        /* ------------------------------------------------------------------
         * 7. 首次配置辅助
         * ----------------------------------------------------------------*/
        defineTool({
            name: 'job_market_init',
            description: 'One-time setup for the active Workspace: create the output directory tree, write the editable skill taxonomy file, and initialize the personal skill profile from the configured target roles. Safe to re-run. [初始化工作区]',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                const workspace = await resolveWorkspace(exec);
                const ctx = await getContext(workspace);
                const taxonomyPath = await ensureTaxonomyFile(ctx);
                const search = (await readJobSearch(ctx)) ?? config.jobSearch;
                const existing = await readPersonalProfile(ctx);
                if (Object.keys(existing.skills).length === 0 && existing.pending_suggestions.length === 0) {
                    await writePersonalProfile(ctx, newPersonalProfile(search.target_roles));
                }
                return asJson({
                    workspace: workspace.path,
                    taxonomyPath,
                    taxonomySkillCount: ctx.skillIndex.size,
                    jobSearchPath: PATHS.jobSearch,
                    skillProfilePath: PATHS.personalProfile,
                    roadmapPath: PATHS.roadmap,
                    nextSteps: [
                        '1) job_market_configure 配置目标岗位与城市',
                        '2) job_market_set_skill 录入你自己的技能等级',
                        '3) job_market_plan_collection → job_market_collect_jobs 采集岗位',
                        '4) job_market_analyze 出市场分析',
                        '5) job_market_plan_learning 出 8 周学习计划',
                    ],
                });
            },
        }),
    ];
};
/** 供工具层复用的错误类型导出，便于宿主 agent 区分「需要人工介入」。 */
export { BrowserHumanAssistanceRequiredError, BrowserSkillUnavailableError };
//# sourceMappingURL=index.js.map