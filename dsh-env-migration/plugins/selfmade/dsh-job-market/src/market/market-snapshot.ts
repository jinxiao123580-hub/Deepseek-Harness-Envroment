/**
 * market-snapshot —— 快照历史、技能趋势与路线的**增量**调整建议（需求 §十四）
 *
 * 铁律（需求 §十四）：
 *  1. AI **绝不推翻**用户的既有学习计划。`diffRoadmap` 只产出建议（`policy: 'incremental'`），
 *     任何增删改都必须由用户确认后才生效。
 *  2. 所有理由必须引用**真实数字**（岗位占比、岗位数、百分点变化），这些数字全部来自
 *     真实快照，不做任何估计。
 *  3. 本文件不做任何 I/O：`SnapshotStore` 只是接口，读写由调用方注入的实现负责。
 */

import type {
    LearningGoal,
    LearningRoadmap,
    MarketSnapshot,
    RoadmapAdjustment,
    RoadmapChange,
    SkillFrequency,
    SkillTrend,
    SkillTrendPoint,
} from '../shared/types.js';
import { roundTo, uniquePreserveOrder } from '../shared/text.js';

/** 快照历史文件（相对工作区输出目录）。 */
export const SNAPSHOT_HISTORY_PATH = 'data/market-snapshots.json';
/** 学习路线文件（相对工作区输出目录）。 */
export const ROADMAP_PATH = 'data/learning-roadmap.json';

/** 历史默认保留的最大快照数（超出时丢弃最旧的）。 */
export const DEFAULT_MAX_SNAPSHOTS = 60;
/** 趋势方向判定阈值（百分点）：绝对值不超过它即为 `flat`。 */
export const TREND_FLAT_THRESHOLD_PP = 1;
/** 路线调整阈值（百分点）：涨跌达到该幅度才建议提高/降低优先级。 */
export const ROADMAP_DELTA_THRESHOLD_PP = 3;
/** 建议移除的门槛：技能此前覆盖率必须 >= 该比例，避免误伤冷门但真实的技能。 */
export const ROADMAP_REMOVE_MIN_PREVIOUS_RATIO = 0.03;
/** 新增建议只考虑优先级最高的前 N 个技能。 */
export const ROADMAP_PRIORITY_TOP_N = 10;

/** 持久化的快照历史容器。 */
export interface SnapshotHistory {
    version: 1;
    snapshots: MarketSnapshot[];
    updated_at: string;
}

/** 最小读写契约：调用方可注入文件 / 内存 / 远端实现（本模块不含 I/O）。 */
export interface SnapshotStore {
    read(): Promise<SnapshotHistory | undefined>;
    write(history: SnapshotHistory): Promise<void>;
}

/* ============================================================================
 * 通用小工具（纯函数）
 * ==========================================================================*/

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/** 空历史：结构合法，可直接写入磁盘。 */
export const emptyHistory = (): SnapshotHistory => ({
    version: 1,
    snapshots: [],
    updated_at: new Date().toISOString(),
});

/** 运行期垃圾数据防护：只接受带 `snapshot_id` 与 `skill_frequencies` 的快照。 */
const isUsableSnapshot = (value: unknown): value is MarketSnapshot => {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as Partial<MarketSnapshot>;
    return typeof candidate.snapshot_id === 'string' && Array.isArray(candidate.skill_frequencies);
};

/** 时间戳排序键：无法解析的时间排在最后（不丢数据，只是排序靠后）。 */
const takenAtKey = (snapshot: MarketSnapshot): string =>
    typeof snapshot.taken_at === 'string' ? snapshot.taken_at : '';

/** 按 `taken_at` 升序（稳定排序，相同时间保持原顺序）。 */
const byTakenAtAsc = (a: MarketSnapshot, b: MarketSnapshot): number => {
    const left = takenAtKey(a);
    const right = takenAtKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
};

/** 在快照里查找某技能的频次记录。 */
const findFrequency = (snapshot: MarketSnapshot, skillId: string): SkillFrequency | undefined => {
    const frequencies = Array.isArray(snapshot.skill_frequencies) ? snapshot.skill_frequencies : [];
    return frequencies.find((frequency) => frequency !== undefined && frequency.skill_id === skillId);
};

/** 0..1 比例 → `68.0%`。 */
const formatPercent = (ratio: number): string => `${roundTo(ratio * 100, 1).toFixed(1)}%`;

/** 百分点差值 → `+7.0` / `-7.0`。 */
const formatDeltaPp = (deltaPp: number): string => `${deltaPp >= 0 ? '+' : ''}${roundTo(deltaPp, 1).toFixed(1)}`;

/* ============================================================================
 * 一、历史维护
 * ==========================================================================*/

/**
 * 追加一份快照：
 *  - 同一 `snapshot_id` 视为同一次统计，**覆盖**旧记录（不重复累积）；
 *  - 输出按 `taken_at` 升序，保持时间线可读；
 *  - 最多保留 `maxEntries`（默认 60）份，最旧的被丢弃。
 *
 * `updated_at` 取历史中最新的 `taken_at`，保证同一输入得到同一输出（可重复、可 diff）。
 */
export const appendSnapshot = (
    history: SnapshotHistory | undefined,
    snapshot: MarketSnapshot,
    maxEntries: number = DEFAULT_MAX_SNAPSHOTS,
): SnapshotHistory => {
    const limit =
        isFiniteNumber(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : DEFAULT_MAX_SNAPSHOTS;

    const previous = history !== undefined && history !== null && Array.isArray(history.snapshots)
        ? history.snapshots
        : [];

    const order: string[] = [];
    const byId = new Map<string, MarketSnapshot>();
    for (const entry of previous) {
        if (!isUsableSnapshot(entry)) continue;
        if (!byId.has(entry.snapshot_id)) order.push(entry.snapshot_id);
        byId.set(entry.snapshot_id, entry);
    }
    if (isUsableSnapshot(snapshot)) {
        if (!byId.has(snapshot.snapshot_id)) order.push(snapshot.snapshot_id);
        // 同 ID 覆盖：以本次写入的快照为准。
        byId.set(snapshot.snapshot_id, snapshot);
    }

    const snapshots = order
        .map((snapshotId) => byId.get(snapshotId))
        .filter((entry): entry is MarketSnapshot => entry !== undefined)
        .sort(byTakenAtAsc);
    const kept = snapshots.length > limit ? snapshots.slice(snapshots.length - limit) : snapshots;

    const newest = kept.length > 0 ? kept[kept.length - 1] : undefined;
    const updatedAt =
        newest !== undefined && takenAtKey(newest) !== ''
            ? takenAtKey(newest)
            : history?.updated_at !== undefined && history.updated_at !== ''
              ? history.updated_at
              : takenAtKey(snapshot);

    return { version: 1, snapshots: kept, updated_at: updatedAt };
};

/** 历史中的快照（按 `taken_at` 升序），容忍脏数据。 */
const chronologicalSnapshots = (history: SnapshotHistory | undefined): MarketSnapshot[] => {
    const snapshots = history !== undefined && history !== null && Array.isArray(history.snapshots)
        ? history.snapshots
        : [];
    return snapshots.filter(isUsableSnapshot).slice().sort(byTakenAtAsc);
};

/** 最新快照（`taken_at` 最大；并列取靠后者）。 */
export const latestSnapshot = (history: SnapshotHistory | undefined): MarketSnapshot | undefined => {
    const snapshots = chronologicalSnapshots(history);
    return snapshots.length > 0 ? snapshots[snapshots.length - 1] : undefined;
};

/* ============================================================================
 * 二、技能趋势（需求 §十四）
 * ==========================================================================*/

/**
 * 指定技能的历史趋势（按 `taken_at` 升序）。
 *
 * - 每个包含该技能的快照产出一个 `SkillTrendPoint`；同一快照 ID 只保留最后一次。
 * - `delta_pp = (末次 job_ratio - 首次 job_ratio) * 100`，保留 1 位小数。
 * - `direction`：> +1pp 为 `up`，< -1pp 为 `down`，否则 `flat`。
 * - 历史中**完全不存在**的技能不产出趋势（没有数据就不编造趋势）。
 */
export const buildSkillTrends = (
    history: SnapshotHistory,
    skillIds: readonly string[],
): SkillTrend[] => {
    const snapshots = chronologicalSnapshots(history);
    const requested = Array.isArray(skillIds) ? skillIds : [];
    const trends: SkillTrend[] = [];

    for (const skillId of uniquePreserveOrder(requested)) {
        if (typeof skillId !== 'string' || skillId === '') continue;

        const pointsById = new Map<string, SkillTrendPoint>();
        let skillName = '';
        for (const snapshot of snapshots) {
            const frequency = findFrequency(snapshot, skillId);
            if (frequency === undefined) continue;
            if (typeof frequency.skill === 'string' && frequency.skill !== '') skillName = frequency.skill;
            pointsById.set(snapshot.snapshot_id, {
                snapshot_id: snapshot.snapshot_id,
                taken_at: typeof snapshot.taken_at === 'string' ? snapshot.taken_at : '',
                job_ratio: isFiniteNumber(frequency.job_ratio) ? frequency.job_ratio : 0,
                required_ratio: isFiniteNumber(frequency.required_ratio) ? frequency.required_ratio : 0,
                job_count: isFiniteNumber(frequency.job_count) ? frequency.job_count : 0,
            });
        }

        const points = [...pointsById.values()];
        if (points.length === 0) continue;

        const first = points[0];
        const last = points[points.length - 1];
        if (first === undefined || last === undefined) continue;
        const deltaPp = roundTo((last.job_ratio - first.job_ratio) * 100, 1);

        trends.push({
            skill_id: skillId,
            skill: skillName !== '' ? skillName : skillId,
            points,
            delta_pp: deltaPp,
            direction: deltaPp > TREND_FLAT_THRESHOLD_PP ? 'up' : deltaPp < -TREND_FLAT_THRESHOLD_PP ? 'down' : 'flat',
        });
    }

    return trends;
};

/**
 * 最新快照里出现的**全部**技能趋势，需求上升最快者排在最前
 * （并列时当前覆盖率更高的优先，再并列按技能 ID 稳定排序）。
 */
export const buildAllTrends = (history: SnapshotHistory, limit?: number): SkillTrend[] => {
    const newest = latestSnapshot(history);
    if (newest === undefined) return [];

    const frequencies = Array.isArray(newest.skill_frequencies) ? newest.skill_frequencies : [];
    const skillIds = uniquePreserveOrder(
        frequencies
            .filter((frequency) => frequency !== undefined && typeof frequency.skill_id === 'string')
            .map((frequency) => frequency.skill_id),
    );
    if (skillIds.length === 0) return [];

    const trends = buildSkillTrends(history, skillIds);
    // 排序：**先按最新市场占比降序**，再按变化幅度降序。
    //
    // 为什么不能只按 delta_pp 排：limit 截断会把「占比高但本次下降」的核心技能
    // 排到最末尾而整条丢掉——恰恰是用户最关心的那种（ROS2 从 75% 掉到 50%）。
    // 重要性优先保证高频技能永远可见，同占比时再让变化大的浮上来。
    const latestRatio = (trend: SkillTrend): number => {
        const point = trend.points[trend.points.length - 1];
        return point === undefined ? 0 : point.job_ratio;
    };
    trends.sort(
        (a, b) =>
            latestRatio(b) - latestRatio(a) ||
            Math.abs(b.delta_pp) - Math.abs(a.delta_pp) ||
            (a.skill_id < b.skill_id ? -1 : a.skill_id > b.skill_id ? 1 : 0),
    );

    return isFiniteNumber(limit) && limit > 0 ? trends.slice(0, Math.floor(limit)) : trends;
};

/* ============================================================================
 * 三、路线增量调整（需求 §十四）
 * ==========================================================================*/

/** 从路线里还原出的「已有学习目标」视图。 */
interface PreviousGoal {
    skill_id: string;
    skill: string;
}

/** `goal-ros2` / `goal-ros2-tf2` 这类 ID 去掉前缀后更接近技能 ID。 */
const stripGoalPrefix = (value: string): string => (value.startsWith('goal-') ? value.slice(5) : value);

/**
 * 还原上一份路线覆盖的技能。
 *
 * `LearningRoadmap` 本身只保存 `goal_ids`（目标正文在目标库里），因此：
 *  - 若路线对象上附带了 `goals`（带 `skill_id` 的完整目标），优先使用；
 *  - 否则退化为把 `goal_id` 当作技能 ID 猜测。猜不中时市场数据查不到，
 *    不会产生任何调整建议，因此**不会误伤**用户计划。
 */
const collectPreviousGoals = (roadmap: LearningRoadmap): PreviousGoal[] => {
    if (roadmap === undefined || roadmap === null) return [];
    const extended = roadmap as LearningRoadmap & { goals?: readonly LearningGoal[] };
    if (Array.isArray(extended.goals) && extended.goals.length > 0) {
        const goals: PreviousGoal[] = [];
        for (const goal of extended.goals) {
            if (goal === undefined || goal === null) continue;
            const skillId = typeof goal.skill_id === 'string' ? goal.skill_id : '';
            if (skillId === '') continue;
            goals.push({
                skill_id: skillId,
                skill: typeof goal.skill === 'string' && goal.skill !== '' ? goal.skill : skillId,
            });
        }
        return dedupeGoals(goals);
    }

    const goalIds = Array.isArray(roadmap.goal_ids) ? roadmap.goal_ids : [];
    const goals: PreviousGoal[] = [];
    for (const goalId of goalIds) {
        if (typeof goalId !== 'string' || goalId === '') continue;
        const skillId = stripGoalPrefix(goalId);
        goals.push({ skill_id: skillId, skill: skillId });
    }
    return dedupeGoals(goals);
};

/** 同一技能只保留一个目标视图（避免重复建议）。 */
const dedupeGoals = (goals: readonly PreviousGoal[]): PreviousGoal[] => {
    const seen = new Set<string>();
    const result: PreviousGoal[] = [];
    for (const goal of goals) {
        if (seen.has(goal.skill_id)) continue;
        seen.add(goal.skill_id);
        result.push(goal);
    }
    return result;
};

/** 统计各动作条数，用于生成中文摘要。 */
const countActions = (changes: readonly RoadmapChange[]): Record<RoadmapChange['action'], number> => {
    const counts: Record<RoadmapChange['action'], number> = {
        continue: 0,
        add: 0,
        raise: 0,
        lower: 0,
        remove: 0,
    };
    for (const change of changes) counts[change.action] += 1;
    return counts;
};

/**
 * 对比「上一份路线 + 上一份快照」与「最新快照」，产出**增量**调整建议。
 *
 * 规则（需求 §十四，绝不推翻用户计划）：
 *  1. 原有目标若仍有市场数据 → `continue`（理由引用当前覆盖率与岗位数）。
 *  2. 覆盖率上升 >= 3pp 且进入新优先级 TOP10 → `raise`（而不是 continue）。
 *  3. 覆盖率下降 >= 3pp → `lower`。
 *  4. 新快照里彻底没有数据、而此前 >= 3% → `remove`（理由必须说明「需用户确认」）。
 *  5. 新优先级 TOP10 中尚未被任何目标覆盖的技能 → `add`。
 *  `policy` 恒为 `'incremental'`；每条建议都必须带真实数字的中文理由。
 */
export const diffRoadmap = (input: {
    previousRoadmap: LearningRoadmap;
    previousSnapshot?: MarketSnapshot;
    newSnapshot: MarketSnapshot;
    /** 技能 ID，按新优先级从高到低排序。 */
    newPriorityOrder?: readonly string[];
    now?: string;
}): RoadmapAdjustment => {
    const generatedAt =
        typeof input.now === 'string' && input.now !== '' ? input.now : new Date().toISOString();
    const newSnapshot = input.newSnapshot;
    const previousSnapshot = input.previousSnapshot;
    const previousRoadmap = input.previousRoadmap;

    const priorityOrder = uniquePreserveOrder(
        (Array.isArray(input.newPriorityOrder) ? input.newPriorityOrder : []).filter(
            (skillId): skillId is string => typeof skillId === 'string' && skillId !== '',
        ),
    );
    const topPriority = priorityOrder.slice(0, ROADMAP_PRIORITY_TOP_N);

    const previousGoals = collectPreviousGoals(previousRoadmap);
    const coveredSkillIds = new Set(previousGoals.map((goal) => goal.skill_id));
    const changes: RoadmapChange[] = [];

    for (const goal of previousGoals) {
        const skillId = goal.skill_id;
        const current = findFrequency(newSnapshot, skillId);
        const before = previousSnapshot !== undefined ? findFrequency(previousSnapshot, skillId) : undefined;

        if (current === undefined) {
            // 规则 4：新快照完全没有该技能的数据。
            const beforeRatio = before?.job_ratio;
            if (isFiniteNumber(beforeRatio) && beforeRatio >= ROADMAP_REMOVE_MIN_PREVIOUS_RATIO) {
                changes.push({
                    action: 'remove',
                    skill_id: skillId,
                    skill: goal.skill,
                    reason:
                        `${goal.skill}（${skillId}）在最新快照中已没有任何岗位要求` +
                        `（上一快照覆盖 ${formatPercent(beforeRatio)}，${before?.job_count ?? 0} 个岗位）。` +
                        `建议从路线中移除该项；此为建议、需你确认后才会生效。`,
                    from: beforeRatio,
                    to: 0,
                });
            }
            continue;
        }

        const skillName =
            typeof current.skill === 'string' && current.skill !== '' ? current.skill : goal.skill;
        const currentRatio = isFiniteNumber(current.job_ratio) ? current.job_ratio : 0;
        const deltaPp =
            before !== undefined && isFiniteNumber(before.job_ratio)
                ? roundTo((currentRatio - before.job_ratio) * 100, 1)
                : undefined;
        const beforeRatio = before !== undefined && isFiniteNumber(before.job_ratio) ? before.job_ratio : undefined;

        if (deltaPp !== undefined && deltaPp >= ROADMAP_DELTA_THRESHOLD_PP && topPriority.includes(skillId)) {
            // 规则 2：需求明显上升且已进入优先级 TOP10 → 提高优先级。
            changes.push({
                action: 'raise',
                skill_id: skillId,
                skill: skillName,
                reason:
                    `${skillName} 岗位占比从 ${formatPercent(beforeRatio ?? 0)} 升至 ${formatPercent(currentRatio)}` +
                    `（${formatDeltaPp(deltaPp)} 个百分点），且已进入需求 TOP10，建议提高优先级。`,
                from: beforeRatio ?? 0,
                to: currentRatio,
            });
            continue;
        }

        if (deltaPp !== undefined && deltaPp <= -ROADMAP_DELTA_THRESHOLD_PP) {
            // 规则 3：需求明显收缩 → 降低优先级（但不推翻原计划）。
            changes.push({
                action: 'lower',
                skill_id: skillId,
                skill: skillName,
                reason:
                    `${skillName} 岗位占比从 ${formatPercent(beforeRatio ?? 0)} 降至 ${formatPercent(currentRatio)}` +
                    `（${formatDeltaPp(deltaPp)} 个百分点），市场需求在收缩，建议降低优先级、把时间留给上升技能。`,
                from: beforeRatio ?? 0,
                to: currentRatio,
            });
            continue;
        }

        // 规则 1：其余情况保持原计划继续。
        changes.push({
            action: 'continue',
            skill_id: skillId,
            skill: skillName,
            reason:
                `${skillName} 当前被 ${current.job_count ?? 0} 个岗位要求` +
                `（岗位占比 ${formatPercent(currentRatio)}）` +
                (deltaPp !== undefined ? `，较上一快照 ${formatDeltaPp(deltaPp)} 个百分点` : '') +
                `，需求稳定，建议按原计划继续。`,
            from: beforeRatio,
            to: currentRatio,
        });
    }

    // 规则 5：新优先级 TOP10 中尚未被任何目标覆盖的技能 → 新增建议。
    for (const skillId of topPriority) {
        if (coveredSkillIds.has(skillId)) continue;
        const current = findFrequency(newSnapshot, skillId);
        const skillName =
            current !== undefined && typeof current.skill === 'string' && current.skill !== ''
                ? current.skill
                : skillId;
        const currentRatio = current !== undefined && isFiniteNumber(current.job_ratio) ? current.job_ratio : 0;
        const jobCount = current !== undefined && isFiniteNumber(current.job_count) ? current.job_count : 0;
        changes.push({
            action: 'add',
            skill_id: skillId,
            skill: skillName,
            reason:
                current !== undefined
                    ? `${skillName} 在最新快照中被 ${jobCount} 个岗位要求（岗位占比 ${formatPercent(currentRatio)}），` +
                      `已进入需求 TOP10 且你当前的路线没有覆盖它，建议新增一个学习目标。`
                    : `${skillName} 在最新快照中暂无岗位要求（0 个岗位 / 0.0%），` +
                      `但按你给出的技能优先级排序进入了 TOP10，建议新增学习目标（市场热度请以下一次快照复核）。`,
            to: currentRatio,
        });
    }

    const counts = countActions(changes);
    const summary =
        `本次仅产出增量调整建议（policy=incremental），不会推翻你的原计划：` +
        `基于最新快照 ${newSnapshot.snapshot_id}（共 ${newSnapshot.job_count ?? 0} 个岗位）` +
        `对比上一份路线 ${previousRoadmap?.roadmap_id ?? ''}` +
        `${previousSnapshot !== undefined ? `（上一快照 ${previousSnapshot.snapshot_id}）` : '（无上一快照）'}，` +
        `共 ${changes.length} 条建议 —— 继续 ${counts.continue} 项、提高优先级 ${counts.raise} 项、` +
        `降低优先级 ${counts.lower} 项、新增 ${counts.add} 项、建议移除 ${counts.remove} 项。` +
        `所有变更都只是建议，需你确认后才会写入学习路线。`;

    return {
        generated_at: generatedAt,
        previous_roadmap_id: previousRoadmap?.roadmap_id ?? '',
        previous_snapshot_id:
            previousSnapshot?.snapshot_id ?? previousRoadmap?.based_on_snapshot_id ?? '',
        new_snapshot_id: newSnapshot.snapshot_id,
        policy: 'incremental',
        changes,
        summary,
    };
};
