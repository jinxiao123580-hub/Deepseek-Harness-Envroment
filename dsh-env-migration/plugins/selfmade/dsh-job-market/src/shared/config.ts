/**
 * 插件配置：默认值 + 校验。
 *
 * 设计对齐上游 `dsh-job-hunting/dist/src/config/{default-config,schema}.js`：
 *  - 导出 `Config` 供 cordis 的 `~standard` 校验使用（见 `src/index.ts`）
 *  - `browserSkill.mode` 强制 `'read-only'`（需求 §十八，不可配置为 write）
 *
 * Gap 权重来自 `src/gap/gap-analyzer.ts`，避免两处定义漂移。
 */

import type {
    BrowserSkillPolicyConfig,
    JobMarketConfig,
    JobSearchConfig,
    LlmCostConfig,
    MarketConfig,
} from './types.js';
import { DEFAULT_GAP_WEIGHTS } from '../gap/gap-analyzer.js';

/** 五个招聘站点的精确主机名白名单（需求 §三 / §十八）。 */
export const DEFAULT_BROWSER_ALLOWED_DOMAINS: readonly string[] = [
    'www.51job.com',
    'www.zhipin.com',
    'www.liepin.com',
    'www.zhaopin.com',
    'www.iguopin.com',
];

export const DEFAULT_OUTPUT_DIR = 'job-market-site';

/** 默认求职方向（需求 §四 的示例）。 */
export const DEFAULT_TARGET_ROLES: readonly string[] = [
    '机器人软件工程师',
    '机器人控制算法工程师',
    'ROS2开发工程师',
    '机器人嵌入式工程师',
];

export const DEFAULT_LOCATIONS: readonly string[] = ['上海', '杭州', '苏州', '南京'];

export const defaultJobSearch: JobSearchConfig = {
    target_roles: [...DEFAULT_TARGET_ROLES],
    expanded_keywords: [],
    extra_keywords: [],
    locations: [...DEFAULT_LOCATIONS],
    exclude_keywords: ['销售', '市场', '运营', '客服', '人事', '行政', '财务'],
    experience_min: 0,
    experience_max: 3,
    salary_min_k: 15,
    max_pages_per_keyword: 2,
};

export const DEFAULT_BROWSER_POLICY_CONFIG: BrowserSkillPolicyConfig = {
    enabled: true,
    executable: 'bsk',
    mode: 'read-only',
    allowedDomains: [...DEFAULT_BROWSER_ALLOWED_DOMAINS],
    additionalAllowedDomains: [],
    requireUserApproval: true,
    maxItemsPerRun: 50,
    minIntervalMs: 1000,
};

export const defaultLlmCost: LlmCostConfig = {
    enabled: true,
    analysis_version: 1,
    prompt_version: 1,
    max_calls_per_run: 40,
};

export const defaultMarket: MarketConfig = {
    recent_days: 30,
    min_jobs_for_stats: 30,
    min_cooccurrence_count: 3,
    top_skills_per_category: 10,
};

export const defaultConfig: JobMarketConfig = {
    outputDir: DEFAULT_OUTPUT_DIR,
    jobSearch: defaultJobSearch,
    browserSkill: DEFAULT_BROWSER_POLICY_CONFIG,
    llm: defaultLlmCost,
    market: defaultMarket,
    gapWeights: DEFAULT_GAP_WEIGHTS,
    defaultRoadmapWeeks: 8,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const asStringArray = (value: unknown, fallback: readonly string[]): string[] =>
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => item !== '')
        : [...fallback];

const asNumber = (value: unknown, fallback: number | undefined, field: string): number | undefined => {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${field} 必须是有限数字`);
    }
    return value;
};

const asPositiveInt = (value: unknown, fallback: number, field: string): number => {
    const resolved = asNumber(value, fallback, field);
    if (resolved === undefined || !Number.isInteger(resolved) || resolved <= 0) {
        throw new TypeError(`${field} 必须是正整数`);
    }
    return resolved;
};

const asRoadmapWeeks = (value: unknown, fallback: 4 | 8 | 12): 4 | 8 | 12 => {
    if (value === undefined || value === null) return fallback;
    if (value === 4 || value === 8 || value === 12) return value;
    throw new TypeError('defaultRoadmapWeeks 只能是 4、8 或 12');
};

/**
 * 校验并合并配置。
 * 传入部分配置即与默认值深合并；非法值抛出中文 `TypeError`。
 */
export const parseConfig = (input?: unknown): JobMarketConfig => {
    if (input === undefined || input === null) {
        return structuredClone(defaultConfig);
    }
    if (!isRecord(input)) {
        throw new TypeError('配置必须是对象');
    }

    const searchInput = isRecord(input.jobSearch) ? input.jobSearch : {};
    const browserInput = isRecord(input.browserSkill) ? input.browserSkill : {};
    const llmInput = isRecord(input.llm) ? input.llm : {};
    const marketInput = isRecord(input.market) ? input.market : {};
    const weightsInput = isRecord(input.gapWeights) ? input.gapWeights : {};

    const mode = browserInput.mode ?? 'read-only';
    if (mode !== 'read-only') {
        throw new TypeError('browserSkill.mode 必须是 "read-only"（本插件不支持写入式采集）');
    }

    const allowedDomains = asStringArray(browserInput.allowedDomains, DEFAULT_BROWSER_ALLOWED_DOMAINS);
    if (allowedDomains.length === 0) {
        throw new TypeError('browserSkill.allowedDomains 至少需要一个主机名');
    }

    const jobSearch: JobSearchConfig = {
        target_roles: asStringArray(searchInput.target_roles, DEFAULT_TARGET_ROLES),
        expanded_keywords: asStringArray(searchInput.expanded_keywords, []),
        extra_keywords: asStringArray(searchInput.extra_keywords, []),
        locations: asStringArray(searchInput.locations, DEFAULT_LOCATIONS),
        exclude_keywords: asStringArray(searchInput.exclude_keywords, defaultJobSearch.exclude_keywords),
        max_pages_per_keyword: asPositiveInt(
            searchInput.max_pages_per_keyword,
            defaultJobSearch.max_pages_per_keyword,
            'jobSearch.max_pages_per_keyword',
        ),
    };
    const experienceMin = asNumber(searchInput.experience_min, defaultJobSearch.experience_min, 'jobSearch.experience_min');
    const experienceMax = asNumber(searchInput.experience_max, defaultJobSearch.experience_max, 'jobSearch.experience_max');
    const salaryMinK = asNumber(searchInput.salary_min_k, defaultJobSearch.salary_min_k, 'jobSearch.salary_min_k');
    if (experienceMin !== undefined) jobSearch.experience_min = experienceMin;
    if (experienceMax !== undefined) jobSearch.experience_max = experienceMax;
    if (salaryMinK !== undefined) jobSearch.salary_min_k = salaryMinK;

    if (jobSearch.target_roles.length === 0) {
        throw new TypeError('jobSearch.target_roles 不能为空：请至少配置一个目标岗位');
    }

    const browserSkill: BrowserSkillPolicyConfig = {
        enabled: browserInput.enabled !== false,
        executable:
            typeof browserInput.executable === 'string' && browserInput.executable.trim() !== ''
                ? browserInput.executable.trim()
                : DEFAULT_BROWSER_POLICY_CONFIG.executable,
        mode: 'read-only',
        allowedDomains,
        additionalAllowedDomains: asStringArray(browserInput.additionalAllowedDomains, []),
        requireUserApproval: browserInput.requireUserApproval !== false,
        maxItemsPerRun: asPositiveInt(
            browserInput.maxItemsPerRun,
            DEFAULT_BROWSER_POLICY_CONFIG.maxItemsPerRun,
            'browserSkill.maxItemsPerRun',
        ),
        minIntervalMs: asPositiveInt(
            browserInput.minIntervalMs,
            DEFAULT_BROWSER_POLICY_CONFIG.minIntervalMs,
            'browserSkill.minIntervalMs',
        ),
    };

    const llm: LlmCostConfig = {
        enabled: llmInput.enabled !== false,
        analysis_version: asPositiveInt(llmInput.analysis_version, defaultLlmCost.analysis_version, 'llm.analysis_version'),
        prompt_version: asPositiveInt(llmInput.prompt_version, defaultLlmCost.prompt_version, 'llm.prompt_version'),
        max_calls_per_run: asPositiveInt(
            llmInput.max_calls_per_run,
            defaultLlmCost.max_calls_per_run,
            'llm.max_calls_per_run',
        ),
    };

    const market: MarketConfig = {
        recent_days: asNumber(marketInput.recent_days, defaultMarket.recent_days, 'market.recent_days') ?? defaultMarket.recent_days,
        min_jobs_for_stats:
            asPositiveInt(marketInput.min_jobs_for_stats, defaultMarket.min_jobs_for_stats, 'market.min_jobs_for_stats'),
        min_cooccurrence_count: asPositiveInt(
            marketInput.min_cooccurrence_count,
            defaultMarket.min_cooccurrence_count,
            'market.min_cooccurrence_count',
        ),
        top_skills_per_category: asPositiveInt(
            marketInput.top_skills_per_category,
            defaultMarket.top_skills_per_category,
            'market.top_skills_per_category',
        ),
    };

    const gapWeights = {
        ...DEFAULT_GAP_WEIGHTS,
        ...weightsInput,
        category_cost: {
            ...DEFAULT_GAP_WEIGHTS.category_cost,
            ...(isRecord(weightsInput.category_cost) ? weightsInput.category_cost : {}),
        },
    } as JobMarketConfig['gapWeights'];

    const outputDir =
        typeof input.outputDir === 'string' && input.outputDir.trim() !== ''
            ? input.outputDir.trim()
            : DEFAULT_OUTPUT_DIR;

    const result: JobMarketConfig = {
        outputDir,
        jobSearch,
        browserSkill,
        llm,
        market,
        gapWeights,
        defaultRoadmapWeeks: asRoadmapWeeks(input.defaultRoadmapWeeks, defaultConfig.defaultRoadmapWeeks),
    };
    if (typeof input.taxonomyPath === 'string' && input.taxonomyPath.trim() !== '') {
        result.taxonomyPath = input.taxonomyPath.trim();
    }
    return result;
};

/** 解析后的完整域名白名单（allowedDomains + additionalAllowedDomains，去重）。 */
export const resolvedAllowedDomains = (config: JobMarketConfig): string[] => [
    ...new Set([...config.browserSkill.allowedDomains, ...config.browserSkill.additionalAllowedDomains]),
];
