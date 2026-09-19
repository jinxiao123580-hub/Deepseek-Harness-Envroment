/**
 * goal-planner —— 可验收学习目标生成（需求 §十一）
 *
 * 绝对规则：**禁止产出「学习 C++」「学习 ROS2」「学习 SLAM」这类不可验收的目标**。
 * 因此本模块做三件事：
 *  1. `CAPABILITY_BREAKDOWN`：把每个技能 ID 展开成具体能力点（长周期拆解）；
 *  2. 每条能力点生成 **一条可观察的验收标准**（能跑出结果、能看到输出、能拿出截图/日志）；
 *  3. `canCompleteGoal`：只有全部验收标准都被满足（并提交了证据串）才允许标记 done。
 *
 * 数据真实性：`market_coverage` / `market_job_count` / `market_job_ids` 全部来自
 * `MarketSnapshot.skill_frequencies`（真实岗位统计），可以直接回溯到具体岗位。
 * 快照里没有真实岗位数据的技能 **不生成目标**，否则目标本身就无法被市场验证。
 *
 * 纯函数：无 I/O、无随机、无隐式时间依赖。
 */
import type { GapReport, LearningGoal, MarketSnapshot, ProjectPlan } from '../shared/types.js';
/**
 * 技能 → 具体能力点。
 * 「掌握 ROS2」不可验收，「能搭出 map→odom→base_link→laser 的 TF tree」才可验收，
 * 这张表就是这条规则的可执行版本。
 */
export declare const CAPABILITY_BREAKDOWN: Record<string, string[]>;
/**
 * 由 Gap 报告生成可验收学习目标。
 *
 * 生成规则：
 *  - 只处理 `gap.entries` 中排名靠前的技能（`limit` 控制数量，默认 12）；
 *  - 技能必须能在快照中找到真实统计，且覆盖率 ≥ `minCoverage`（默认 0.05），
 *    否则不生成目标 —— 没有任何岗位要求的能力不该占据学习计划；
 *  - 每个目标都带 ≥2 条可观察验收标准，`status` 一律为 `pending`；
 *  - `goal_id` 固定为 `goal-<skill_id>`，可重复执行得到完全一致的结果；
 *  - 传入 `project` 时，覆盖该技能的阶段会把 `recommended_project_id` 挂上，
 *    让「学这个技能」直接落到一个可建造的项目阶段上。
 */
export declare const planGoals: (input: {
    gap: GapReport;
    snapshot: MarketSnapshot;
    /** How many goals to produce. Default 12. */
    limit?: number;
    /** Optional project to attach to the relevant goals. */
    project?: ProjectPlan;
    /** Minimum market coverage (0..1) for a goal to be created. Default 0.05. */
    minCoverage?: number;
    /**
     * 目标生成时间。`LearningGoal` 本身不携带生成时间字段（时间信息在
     * `GapReport.generated_at` 与 `MarketSnapshot.taken_at` 上），因此这里保留入参
     * 仅为契约兼容与未来扩展，不参与任何计算结果。
     */
    now?: string;
}) => LearningGoal[];
/**
 * 校验目标是否可以被标记为 done。
 *
 * 规则：
 *  - 目标必须有 `acceptance_criteria`；**空验收标准一律不允许完成**
 *    （这正是「学习 C++」这类不可验收目标不能被勾掉的技术保障）；
 *  - 提交的 `completedCriteria` 去空白后，要么与某条验收标准完全一致，
 *    要么被该条验收标准包含（允许用户写更短的证据描述）；
 *  - 任一验收标准缺失即 `ok: false`，并如实列出缺失项与缺口数量无关的原文。
 */
export declare const canCompleteGoal: (goal: LearningGoal, completedCriteria: readonly string[]) => {
    ok: boolean;
    missing: string[];
};
