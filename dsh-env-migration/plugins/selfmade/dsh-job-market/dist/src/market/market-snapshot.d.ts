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
import type { LearningRoadmap, MarketSnapshot, RoadmapAdjustment, SkillTrend } from '../shared/types.js';
/** 快照历史文件（相对工作区输出目录）。 */
export declare const SNAPSHOT_HISTORY_PATH = "data/market-snapshots.json";
/** 学习路线文件（相对工作区输出目录）。 */
export declare const ROADMAP_PATH = "data/learning-roadmap.json";
/** 历史默认保留的最大快照数（超出时丢弃最旧的）。 */
export declare const DEFAULT_MAX_SNAPSHOTS = 60;
/** 趋势方向判定阈值（百分点）：绝对值不超过它即为 `flat`。 */
export declare const TREND_FLAT_THRESHOLD_PP = 1;
/** 路线调整阈值（百分点）：涨跌达到该幅度才建议提高/降低优先级。 */
export declare const ROADMAP_DELTA_THRESHOLD_PP = 3;
/** 建议移除的门槛：技能此前覆盖率必须 >= 该比例，避免误伤冷门但真实的技能。 */
export declare const ROADMAP_REMOVE_MIN_PREVIOUS_RATIO = 0.03;
/** 新增建议只考虑优先级最高的前 N 个技能。 */
export declare const ROADMAP_PRIORITY_TOP_N = 10;
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
/** 空历史：结构合法，可直接写入磁盘。 */
export declare const emptyHistory: () => SnapshotHistory;
/**
 * 追加一份快照：
 *  - 同一 `snapshot_id` 视为同一次统计，**覆盖**旧记录（不重复累积）；
 *  - 输出按 `taken_at` 升序，保持时间线可读；
 *  - 最多保留 `maxEntries`（默认 60）份，最旧的被丢弃。
 *
 * `updated_at` 取历史中最新的 `taken_at`，保证同一输入得到同一输出（可重复、可 diff）。
 */
export declare const appendSnapshot: (history: SnapshotHistory | undefined, snapshot: MarketSnapshot, maxEntries?: number) => SnapshotHistory;
/** 最新快照（`taken_at` 最大；并列取靠后者）。 */
export declare const latestSnapshot: (history: SnapshotHistory | undefined) => MarketSnapshot | undefined;
/**
 * 指定技能的历史趋势（按 `taken_at` 升序）。
 *
 * - 每个包含该技能的快照产出一个 `SkillTrendPoint`；同一快照 ID 只保留最后一次。
 * - `delta_pp = (末次 job_ratio - 首次 job_ratio) * 100`，保留 1 位小数。
 * - `direction`：> +1pp 为 `up`，< -1pp 为 `down`，否则 `flat`。
 * - 历史中**完全不存在**的技能不产出趋势（没有数据就不编造趋势）。
 */
export declare const buildSkillTrends: (history: SnapshotHistory, skillIds: readonly string[]) => SkillTrend[];
/**
 * 最新快照里出现的**全部**技能趋势，需求上升最快者排在最前
 * （并列时当前覆盖率更高的优先，再并列按技能 ID 稳定排序）。
 */
export declare const buildAllTrends: (history: SnapshotHistory, limit?: number) => SkillTrend[];
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
export declare const diffRoadmap: (input: {
    previousRoadmap: LearningRoadmap;
    previousSnapshot?: MarketSnapshot;
    newSnapshot: MarketSnapshot;
    /** 技能 ID，按新优先级从高到低排序。 */
    newPriorityOrder?: readonly string[];
    now?: string;
}) => RoadmapAdjustment;
