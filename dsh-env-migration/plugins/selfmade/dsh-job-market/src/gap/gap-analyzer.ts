/**
 * gap-analyzer —— 技能差距分析（需求 §十）
 *
 * 绑定公式：
 *   priority = market_demand ^ w.market_demand
 *            × importance    ^ w.importance
 *            × skill_gap     ^ w.skill_gap
 *            × role_coverage ^ w.role_coverage
 *            ÷ learning_cost ^ w.learning_cost
 *
 * 设计要点：
 *  - 用「指数」而不是固定系数，使每一项的权重都是纯配置（需求 §十：权重必须可配置），
 *    且结果对每个因子保持单调：因子变大 → 优先级不变或变大。
 *  - 每个因子的取值都被归一化到 0..1（learning_cost ≥ 1），并写进 `explanation`，
 *    使用户可以追问「为什么 C++ 排第一、强化学习排第五」并拿到具体数字答案。
 *  - 只有用户已确认的技能进入计算：AI 建议（`pending_suggestions`）绝不参与。
 *  - 数据真实性：`job_count` / `job_ids` 直接取自快照的 `SkillFrequency`，可回溯到具体岗位。
 */

import type {
    GapEntry,
    GapReport,
    GapWeights,
    MarketSnapshot,
    PersonalSkillProfile,
    SkillFrequency,
    SkillLevel,
    JobCategory,
    Iso,
} from '../shared/types.js';

/* ============================================================================
 * 默认权重（配置项，不是写死在公式里的常量）
 * ==========================================================================*/

/**
 * 默认权重。
 * `category_cost` 编码「学起来有多贵」：越低越优先。
 *  - 1.0~1.5：通用工具链，边际成本最低（Programming / Linux / Engineering）
 *  - 2.0~2.5：需要硬件或在环调试，成本中等（Robotics / Embedded / Hardware / Communication）
 *  - 3.0~3.5：需要成套数学与工程直觉，成本高（Control / Planning / Perception / SLAM）
 *  - 4.0    ：需要前置数学 + 算力 + 长期迭代，成本最高（AI/RL）
 */
export const DEFAULT_GAP_WEIGHTS: GapWeights = {
    market_demand: 1,
    importance: 1.2,
    skill_gap: 1,
    role_coverage: 0.8,
    learning_cost: 1,
    category_cost: {
        Programming: 1.2,
        Linux: 1.0,
        Engineering: 1.2,
        Robotics: 2.0,
        Embedded: 2.2,
        Hardware: 2.5,
        Communication: 2.0,
        Control: 3.0,
        Planning: 3.2,
        Perception: 3.3,
        SLAM: 3.5,
        'AI/RL': 4.0,
        // 兼容常见写法（taxonomy 可能用斜杠变体）。
        'AI/ML': 4.0,
    },
    default_cost: 2.5,
};

/* ============================================================================
 * 数值工具
 * ==========================================================================*/

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** 有限数字则原样返回，否则用兜底值。 */
const finiteOr = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/* ============================================================================
 * 核心公式
 * ==========================================================================*/

/**
 * 幂函数安全实现：
 *  - 0^0 视为 1（避免 NaN，也符合「因子为 0 时该不该抹平」的直觉选择：由其他因子决定）；
 *  - 0^正数 = 0；0^负数 = Infinity（调用方不再使用，作为防御仍返回 Infinity，
 *    最终由 `Number.isFinite` 兜底）。
 */
const safePow = (base: number, exponent: number): number => {
    if (base === 0) {
        if (exponent === 0) return 1;
        return exponent > 0 ? 0 : Number.POSITIVE_INFINITY;
    }
    return Math.pow(base, exponent);
};

/**
 * 原始公式，导出以便直接单测。
 * 输入因子按定义应为：market_demand / importance / skill_gap / role_coverage ∈ [0,1]，
 * learning_cost ≥ 1；本函数内部再做一次夹取，保证任何调用都得到确定性有限值。
 */
export const computePriority = (
    factors: {
        market_demand: number;
        importance: number;
        skill_gap: number;
        role_coverage: number;
        learning_cost: number;
    },
    weights: GapWeights,
): number => {
    const marketDemand = clamp01(finiteOr(factors.market_demand, 0));
    const importance = clamp01(finiteOr(factors.importance, 0));
    const skillGap = clamp01(finiteOr(factors.skill_gap, 0));
    const roleCoverage = clamp01(finiteOr(factors.role_coverage, 0));
    const learningCost = Math.max(1, finiteOr(factors.learning_cost, 1));

    const wMarketDemand = finiteOr(weights?.market_demand, 1);
    const wImportance = finiteOr(weights?.importance, 1);
    const wSkillGap = finiteOr(weights?.skill_gap, 1);
    const wRoleCoverage = finiteOr(weights?.role_coverage, 1);
    const wLearningCost = finiteOr(weights?.learning_cost, 1);

    const numerator =
        safePow(marketDemand, wMarketDemand) *
        safePow(importance, wImportance) *
        safePow(skillGap, wSkillGap) *
        safePow(roleCoverage, wRoleCoverage);
    const denominator = safePow(learningCost, wLearningCost);

    const priority = numerator / denominator;
    if (!Number.isFinite(priority)) return 0;
    // 优先级只用于排序与展示，归一到 0..1 更便于用户理解（公式单调性不受影响）。
    return clamp01(priority);
};

/** 按技能大类取学习成本（≥1）。`opts.difficulty` 可覆盖权重表中的基础难度。 */
export const learningCostFor = (
    category: string,
    weights: GapWeights,
    opts?: { difficulty?: number },
): number => {
    const explicit = opts !== undefined ? finiteOr(opts.difficulty, Number.NaN) : Number.NaN;
    if (Number.isFinite(explicit)) return Math.max(1, explicit);

    const table = weights?.category_cost ?? {};
    const key = typeof category === 'string' ? category.trim() : '';
    // 大小写不敏感查找（taxonomy 里可能出现 `ai/rl` 之类写法）。
    const lowerKey = key.toLowerCase();
    let matched: number | undefined;
    for (const [name, cost] of Object.entries(table)) {
        if (name === key || name.toLowerCase() === lowerKey) {
            matched = cost;
            break;
        }
    }
    const fallback = finiteOr(weights?.default_cost, DEFAULT_GAP_WEIGHTS.default_cost);
    const cost = matched !== undefined && Number.isFinite(matched) ? matched : fallback;
    return Math.max(1, cost);
};

/* ============================================================================
 * 因子计算
 * ==========================================================================*/

/** 单个目标方向内，要求某技能的岗位占比（比例 + 该方向岗位总数 + 该技能是否出现）。 */
const categoryRatio = (
    category: JobCategory,
    skillId: string,
    snapshot: MarketSnapshot,
    frequency: SkillFrequency | undefined,
    presence: { skillJobIds: Set<string>; hasJobIds: boolean },
): { ratio: number; total: number; appeared: boolean } => {
    const breakdown = snapshot.categories.find((item) => item.category === category);

    if (breakdown !== undefined) {
        const total = breakdown.job_count;
        if (breakdown.job_ids.length > 0) {
            const matched = presence.hasJobIds
                ? breakdown.job_ids.filter((jobId) => presence.skillJobIds.has(jobId))
                : // 快照未提供该技能的 job_ids 时，用 top_skills 是否收录作为出现证据。
                  breakdown.top_skills.some((item) => item.skill_id === skillId)
                  ? breakdown.job_ids
                  : [];
            const ratio = total > 0 ? Math.min(1, matched.length / total) : 0;
            return { ratio, total, appeared: matched.length > 0 };
        }
        // 该方向没有岗位明细时，退化为它是自己的 top_skills 统计。
        const fromTopSkills = breakdown.top_skills.find((item) => item.skill_id === skillId);
        if (fromTopSkills !== undefined) {
            const ratio = total > 0 ? Math.min(1, fromTopSkills.job_count / total) : 0;
            return { ratio, total, appeared: fromTopSkills.job_count > 0 };
        }
        return { ratio: 0, total, appeared: false };
    }

    // 快照没有该方向的细分统计时，退化为全局口径（仍在 0..1 内）。
    const total = snapshot.job_count;
    const ratio =
        total > 0 ? Math.min(1, (frequency?.job_count ?? 0) / total) : clamp01(frequency?.weighted_demand ?? 0);
    return { ratio, total, appeared: (frequency?.job_count ?? 0) > 0 };
};

/** 目标方向列表：显式入参 > 画像目标方向 > 快照中岗位数最多的方向（保证确定性）。 */
const resolveTargetCategories = (
    explicit: readonly JobCategory[] | undefined,
    profile: PersonalSkillProfile,
    snapshot: MarketSnapshot,
): JobCategory[] => {
    if (explicit !== undefined && explicit.length > 0) return Array.from(new Set(explicit));
    const fromProfile = profile.target_categories ?? [];
    if (fromProfile.length > 0) return Array.from(new Set(fromProfile));
    return [...snapshot.categories]
        .sort((a, b) => b.job_count - a.job_count || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0))
        .map((item) => item.category);
};

/** 中文百分数，便于写进解释句。 */
const percent = (value: number): number => Math.round(value * 100);

/* ============================================================================
 * 主入口
 * ==========================================================================*/

/**
 * 生成 Gap 报告。
 * 只有「用户已确认」且「在市场快照中出现」且「当前等级低于目标等级」的技能进入 `entries`；
 * 其余全部进 `excluded` 并附中文原因。
 */
export const analyzeGap = (input: {
    snapshot: MarketSnapshot;
    profile: PersonalSkillProfile;
    weights?: Partial<GapWeights>;
    targetCategories?: readonly JobCategory[];
    limit?: number;
    now?: Iso;
}): GapReport => {
    const { snapshot, profile } = input;
    const weights: GapWeights = {
        ...DEFAULT_GAP_WEIGHTS,
        ...(input.weights ?? {}),
        category_cost: { ...DEFAULT_GAP_WEIGHTS.category_cost, ...(input.weights?.category_cost ?? {}) },
    };

    const now: Iso =
        typeof input.now === 'string' && input.now.trim() !== ''
            ? input.now
            : typeof snapshot.taken_at === 'string' && snapshot.taken_at !== ''
              ? snapshot.taken_at
              : new Date().toISOString();

    const targets = resolveTargetCategories(input.targetCategories, profile, snapshot);
    const frequencyBySkill = new Map<string, SkillFrequency>();
    for (const frequency of snapshot.skill_frequencies ?? []) {
        if (!frequencyBySkill.has(frequency.skill_id)) frequencyBySkill.set(frequency.skill_id, frequency);
    }

    const entries: GapEntry[] = [];
    const excluded: { skill_id: string; skill: string; category?: string; reason: string }[] = [];

    // 已确认技能，按 skill_id 排序保证遍历顺序确定。
    const confirmed = Object.values(profile.skills ?? {})
        .filter((skill) => skill !== null && typeof skill === 'object')
        .filter((skill) => skill.source === 'user')
        .sort((a, b) => {
            const left = a.skill_id ?? '';
            const right = b.skill_id ?? '';
            return left < right ? -1 : left > right ? 1 : 0;
        })
        .map((skill) => ({ ...skill }));

    for (const skill of confirmed) {
        const skillId = typeof skill.skill_id === 'string' && skill.skill_id !== '' ? skill.skill_id : '';
        if (skillId === '') continue;

        const frequency = frequencyBySkill.get(skillId);
        const displayName = frequency?.skill ?? skillId;
        if (frequency === undefined) {
            // 市场数据中未出现该技能 → 不参与排序（但如实告知用户）。
            excluded.push({
                skill_id: skillId,
                skill: displayName,
                category: undefined,
                reason: '市场数据中未出现该技能',
            });
            continue;
        }

        const currentLevel = finiteOr(skill.current_level, 0) as SkillLevel;
        const targetLevel = finiteOr(skill.target_level, currentLevel) as SkillLevel;

        // market_demand：直接用快照的加权需求（已是 0..1）。
        const marketDemand = clamp01(finiteOr(frequency.weighted_demand, 0));

        // skill_gap：(target - current) / 5；无差距则排除。
        const skillGap = clamp01((targetLevel - currentLevel) / 5);
        if (targetLevel <= currentLevel || skillGap <= 0) {
            excluded.push({
                skill_id: skillId,
                skill: displayName,
                category: frequency.category,
                reason: '当前等级已达到目标等级',
            });
            continue;
        }

        // importance：所有目标方向中「要求该技能的岗位占比」的最大值。
        // role_coverage：该技能「出现过」的目标方向占全部目标方向的比例。
        // 出现判定用「该技能的全局岗位集 ∩ 该方向岗位集」，可回溯且不受 top_skills 截断影响；
        // 仅当快照未提供 job_ids（如从仅聚合的报表还原）时，才退化用 top_skills 是否收录来判定。
        const skillJobIds = new Set(frequency.job_ids ?? []);
        const hasJobIds = skillJobIds.size > 0;
        let importance = 0;
        let resolvedCategories = 0;
        let coverageHits = 0;
        for (const category of targets) {
            const { ratio, total, appeared } = categoryRatio(category, skillId, snapshot, frequency, {
                skillJobIds,
                hasJobIds,
            });
            if (total > 0) resolvedCategories += 1;
            if (ratio > importance) importance = ratio;
            if (appeared) coverageHits += 1;
        }
        // 目标方向无法解析时退化为市场需求，避免整表塌成 0。
        if (resolvedCategories === 0) importance = marketDemand;
        importance = clamp01(importance);

        // 无目标方向时按覆盖 1 处理。
        const roleCoverage = targets.length === 0 ? 1 : clamp01(coverageHits / targets.length);

        // learning_cost：按技能大类（≥1）。
        const learningCost = learningCostFor(String(frequency.category ?? ''), weights);

        const priority = computePriority(
            {
                market_demand: marketDemand,
                importance,
                skill_gap: skillGap,
                role_coverage: roleCoverage,
                learning_cost: learningCost,
            },
            weights,
        );

        const jobIds = Array.isArray(frequency.job_ids) ? [...frequency.job_ids] : [];
        const jobCount = finiteOr(frequency.job_count, jobIds.length);
        const coverageText =
            targets.length === 0 ? '未设置目标方向（按 1 计）' : `${coverageHits}/${targets.length} 个目标方向`;
        const explanation =
            `${displayName}：市场加权需求 ${round2(marketDemand)}（${percent(marketDemand)}% 岗位要求，` +
            `共 ${jobCount} 个岗位），对目标方向关键度 ${round2(importance)}，` +
            `当前 ${currentLevel} 级→目标 ${targetLevel} 级（差距 ${round2(skillGap)}），` +
            `覆盖 ${coverageText}，学习成本 ${round2(learningCost)} → ` +
            `优先级 ${round3(priority)}。`;

        entries.push({
            skill_id: skillId,
            skill: displayName,
            category: frequency.category,
            market_demand: round2(marketDemand),
            importance: round2(importance),
            current_level: currentLevel,
            target_level: targetLevel,
            skill_gap: round2(skillGap),
            role_coverage: round2(roleCoverage),
            learning_cost: round2(learningCost),
            priority: round3(priority),
            rank: 0,
            explanation,
            job_count: jobCount,
            job_ids: jobIds,
        });
    }

    // 排序：优先级降序 → 岗位数降序 → skill_id 字母序（完全确定性）。
    entries.sort(
        (a, b) =>
            b.priority - a.priority ||
            b.job_count - a.job_count ||
            (a.skill_id < b.skill_id ? -1 : a.skill_id > b.skill_id ? 1 : 0),
    );
    entries.forEach((entry, index) => {
        entry.rank = index + 1;
    });

    const limit = finiteOr(input.limit, 0);
    const ranked = limit > 0 ? entries.slice(0, Math.floor(limit)) : entries;

    // 未进入前 N 名的技能也要如实说明原因。
    const excludedRows: { skill_id: string; skill: string; reason: string }[] = excluded.map((item) => ({
        skill_id: item.skill_id,
        skill: item.skill,
        reason: item.reason,
    }));
    for (const entry of entries.slice(ranked.length)) {
        excludedRows.push({
            skill_id: entry.skill_id,
            skill: entry.skill,
            reason: `未进入前 ${ranked.length} 名（当前排名第 ${entry.rank}，优先级 ${entry.priority}）`,
        });
    }
    // AI 建议一律不参与计算，这里显式声明，避免用户误以为已被计入。
    for (const suggestion of profile.pending_suggestions ?? []) {
        excludedRows.push({
            skill_id: suggestion.skill_id,
            skill: suggestion.skill_id,
            reason: '仅 AI 建议，未经用户确认，不参与 Gap 计算',
        });
    }

    return {
        generated_at: now,
        snapshot_id: snapshot.snapshot_id,
        weights,
        entries: ranked,
        excluded: excludedRows,
    };
};
