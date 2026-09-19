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

import type {
    JobSearchConfig,
    CollectionPlan,
    CollectionTarget,
    PlatformDefinition,
} from '../shared/types.js';
import { uniquePreserveOrder } from '../shared/text.js';
import { enabledPlatforms } from './platforms.js';
import { assertUrlAllowed } from './browser-policy.js';

/* ============================================================================
 * 一、关键词扩展（规则式，无 LLM）
 * ==========================================================================*/

/** 基础修饰词组（方向词），是「方向 family」的判定依据。 */
export const BASE_MODIFIERS: readonly string[] = [
    '机器人软件',
    '机器人控制',
    '机器人嵌入式',
    '机器人感知',
    '机器人导航',
    '机器人系统',
    '机器人',
    '运动控制',
    '运动规划',
    'SLAM',
    '感知',
    'ROS',
    'ROS2',
    '嵌入式',
    '算法',
    '驱动',
    '应用',
    '系统',
];

/**
 * 职位后缀。顺序即生成顺序（`{base}工程师` 排在 `{base}开发工程师` 之前，
 * 与需求 §四 的示例输出顺序一致）。
 */
export const ROLE_SUFFIXES: readonly string[] = [
    '工程师',
    '开发工程师',
    '软件工程师',
    '算法工程师',
    '研发工程师',
];

/**
 * 组合可行度约束（base → 允许的后缀集合）。
 * 目的：避免产出「机器人软件算法工程师」这类不存在的职位名，
 * 需求 §四 的示例输出正是靠这层过滤得到的（例如只允许
 * `机器人嵌入式软件工程师`，不产出 `机器人嵌入式工程师` 之外的怪组合）。
 */
const ALLOWED_SUFFIXES: Record<string, readonly string[]> = {
    机器人软件: ['工程师', '开发工程师', '软件工程师'],
    机器人控制: ['工程师', '算法工程师', '软件工程师'],
    机器人嵌入式: ['软件工程师', '开发工程师'],
    机器人感知: ['工程师', '算法工程师'],
    机器人导航: ['工程师', '算法工程师'],
    机器人系统: ['工程师', '软件工程师'],
    机器人: ['开发工程师', '软件工程师', '算法工程师'],
    运动控制: ['工程师', '算法工程师'],
    运动规划: ['工程师', '算法工程师'],
    SLAM: ['工程师', '算法工程师'],
    感知: ['工程师', '算法工程师'],
    ROS: ['开发工程师', '工程师'],
    ROS2: ['开发工程师', '工程师'],
    嵌入式: ['软件工程师', '开发工程师'],
    算法: ['工程师'],
    驱动: ['开发工程师'],
    应用: ['工程师', '开发工程师'],
    系统: ['工程师'],
};

/** 按长度降序匹配修饰词：`ROS2` 必须先于 `ROS` 命中，`机器人软件` 必须先于 `机器人`。 */
const BASE_PATTERN = new RegExp(
    `(${[...BASE_MODIFIERS]
        .sort((a, b) => b.length - a.length)
        .map((base) => base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})`,
);

/** 从用户给定的岗位名中抽取方向词。同一岗位名只取最长的第一个方向词。 */
const extractBases = (role: string): string[] => {
    const matched = BASE_PATTERN.exec(role)?.[1];
    return matched === undefined ? [] : [matched];
};

/**
 * 需求 §四：把用户目标岗位扩展为具体搜索关键词。
 *
 * 规则：`基础修饰词 × 职位后缀`，再叠加用户原岗位与 `extra_keywords`。
 * 输出保序去重，且 **用户自己写的岗位永远排在最前**。
 */
export const expandKeywords = (config: JobSearchConfig): string[] => {
    const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

    const targetRoles = (Array.isArray(config.target_roles) ? config.target_roles : [])
        .map(asText)
        .filter((role) => role !== '');
    const extraKeywords = (Array.isArray(config.extra_keywords) ? config.extra_keywords : [])
        .map(asText)
        .filter((keyword) => keyword !== '');
    const excludeKeywords = (Array.isArray(config.exclude_keywords) ? config.exclude_keywords : [])
        .map(asText)
        .filter((keyword) => keyword !== '');

    const keywords: string[] = [];

    // 1) 用户自己的岗位优先级最高。
    keywords.push(...targetRoles);

    // 2) 从用户岗位里抽出的方向词 + 配置里显式给出的扩展词，作为生成基。
    const promptBases = uniquePreserveOrder([...extraKeywords, ...targetRoles.flatMap(extractBases)]);

    // 3) 生成变体：方向词 × 后缀，按 ALLOWED_SUFFIXES 过滤不可行组合。
    for (const base of promptBases) {
        const allowed = ALLOWED_SUFFIXES[base];
        for (const suffix of ROLE_SUFFIXES) {
            if (allowed !== undefined && !allowed.includes(suffix)) continue;
            keywords.push(`${base}${suffix}`);
        }
    }

    // 4) 排除词为「明显不相关岗位」的过滤口径，不应反过来变成搜索词。
    const excluded = new Set(excludeKeywords);
    return uniquePreserveOrder(keywords).filter((keyword) => !excluded.has(keyword));
};

/* ============================================================================
 * 二、方向 family 分组（防止跨方向混统计）
 * ==========================================================================*/

/** family 判定规则，顺序即优先级：越具体的方向越靠前。 */
const FAMILY_RULES: readonly { family: string; pattern: RegExp }[] = [
    { family: 'robotics-software', pattern: /机器人|机械臂|机械手|具身/ },
    { family: 'robotics-control', pattern: /控制|伺服|电控|运控/ },
    { family: 'ros2', pattern: /ros|导航|nav2/ },
    { family: 'embedded', pattern: /嵌入式|单片机|mcu|dsp|fpga|硬件/ },
    { family: 'motion-planning', pattern: /规划|轨迹|避障/ },
    { family: 'slam', pattern: /slam|定位|建图|里程计/ },
    { family: 'perception', pattern: /感知|视觉|视觉slam|点云|激光雷达|lidar|标定/ },
    { family: 'rl-embodied', pattern: /强化学习|模仿学习|rl|具身智能|vla/ },
];

/** 单个关键词 → 方向 family。命不中任何规则记为 `unknown`。 */
const familyOf = (keyword: string): string => {
    const normalized = keyword.toLowerCase();
    if (normalized === '') return 'unknown';
    for (const rule of FAMILY_RULES) {
        if (rule.pattern.test(normalized)) return rule.family;
    }
    return 'unknown';
};

/**
 * 按方向 family 分组。
 * 返回 `family → 关键词[]`，值保持输入顺序并已去重，
 * 便于下游「同一 family 才可合并统计」。
 */
export const keywordFamilies = (keywords: readonly string[]): Map<string, string[]> => {
    const grouped = new Map<string, string[]>();
    for (const keyword of uniquePreserveOrder(keywords)) {
        const trimmed = typeof keyword === 'string' ? keyword.trim() : '';
        if (trimmed === '') continue;
        const family = familyOf(trimmed);
        const bucket = grouped.get(family);
        if (bucket === undefined) {
            grouped.set(family, [trimmed]);
        } else {
            bucket.push(trimmed);
        }
    }
    return grouped;
};

/* ============================================================================
 * 三、采集计划
 * ==========================================================================*/

/** 默认目标上限，防止关键词 × 城市 × 页码 组合爆炸。 */
const DEFAULT_MAX_TARGETS = 200;

/** 去掉「上海」「上海市」「 上海 」之间的写法差异，才能命中城市编码表。 */
const normalizeCity = (city: string): string => {
    const trimmed = city.trim().replace(/市$/, '');
    return trimmed === '' ? city.trim() : trimmed;
};

/** 城市 → 平台城市编码；无编码时回退城市名（由调用方 URL 编码）。 */
const resolveCityValue = (platform: PlatformDefinition, city: string): string => {
    const codes = platform.city_codes;
    if (codes === undefined) return city;
    return codes[city] ?? codes[normalizeCity(city)] ?? city;
};

/** 用实际值替换模板占位符。城市名做 URL 编码，城市编码保持原样。 */
const buildUrl = (platform: PlatformDefinition, keyword: string, city: string | undefined, page: number): string => {
    const cityValue = city === undefined ? '' : resolveCityValue(platform, city);
    return platform.search_url_template
        .replace('{keyword}', encodeURIComponent(keyword))
        .replace('{city}', encodeURIComponent(cityValue))
        .replace('{page}', String(page));
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 生成只读采集计划。
 *
 * 展开维度：平台（默认 `enabledPlatforms()`）× 扩展关键词 × 城市 × 页码。
 * 每条 URL 都必须通过 `assertUrlAllowed`；失败者进入 `rejected` 并保留
 * 抛出的原始英文错误信息作为 `reason`，便于日志与测试断言。
 */
export const planCollection = (input: {
    config: JobSearchConfig;
    platforms?: readonly PlatformDefinition[];
    now?: string;
    /** 目标数量上限，默认 200。 */
    maxTargets?: number;
}): CollectionPlan => {
    const config = input.config;
    const platforms = input.platforms ?? enabledPlatforms();
    const now = input.now ?? new Date().toISOString();
    const rawMax = input.maxTargets ?? DEFAULT_MAX_TARGETS;
    const maxTargets = Number.isFinite(rawMax) ? Math.max(0, Math.trunc(rawMax)) : DEFAULT_MAX_TARGETS;

    const expandedKeywords = expandKeywords(config);
    const excludeKeywords = (Array.isArray(config.exclude_keywords) ? config.exclude_keywords : [])
        .map((keyword) => (typeof keyword === 'string' ? keyword.trim() : ''))
        .filter((keyword) => keyword !== '');
    const excluded = new Set(excludeKeywords);

    const pagesRaw = config.max_pages_per_keyword;
    const pages = Number.isFinite(pagesRaw) && pagesRaw > 0 ? Math.trunc(pagesRaw) : 1;

    const configuredCities = (Array.isArray(config.locations) ? config.locations : [])
        .map((city) => (typeof city === 'string' ? city.trim() : ''))
        .filter((city) => city !== '');
    const cities: (string | undefined)[] = configuredCities.length > 0 ? uniquePreserveOrder(configuredCities) : [undefined];

    // 计划自身声明的白名单 = 参与平台的精确主机名。
    // 注意：真正生效的白名单仍以 browserSkill.allowedDomains 为准；
    // 若某个平台的搜索主机名未登记进配置（例如智联的 sou.zhaopin.com），
    // 这里生成的 URL 会在下面的校验中被拒并进入 `rejected`，而不是被静默放行。
    const allowedDomains = uniquePreserveOrder(platforms.map((platform) => platform.hostname.trim().toLowerCase()));

    const targets: CollectionTarget[] = [];
    const rejected: { url: string; reason: string }[] = [];
    let truncated = false;

    outer: for (const platform of platforms) {
        for (const keyword of expandedKeywords) {
            if (keyword === '' || excluded.has(keyword)) continue;
            for (let page = 1; page <= pages; page += 1) {
                for (const city of cities) {
                    if (targets.length >= maxTargets) {
                        truncated = true;
                        break outer;
                    }
                    const url = buildUrl(platform, keyword, city, page);
                    try {
                        assertUrlAllowed(url, allowedDomains);
                    } catch (error) {
                        rejected.push({ url, reason: errorMessage(error) });
                        continue;
                    }
                    const target: CollectionTarget = { platform: platform.id, keyword, page, url };
                    if (city !== undefined) target.city = city;
                    targets.push(target);
                }
            }
        }
    }

    if (truncated) {
        // 截断是「计划已满」而非安全拒绝，但同样需要让用户看见。
        rejected.push({ url: '', reason: '已达到 maxTargets 上限' });
    }

    return {
        generated_at: now,
        expanded_keywords: expandedKeywords,
        targets,
        rejected,
    };
};
