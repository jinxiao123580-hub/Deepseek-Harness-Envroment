/**
 * 学习路线生成（需求 §十三）。
 *
 * 输出 4 / 8 / 12 周三档（默认 8 周），每周必须包含：
 *   本周目标 / 具体任务 / 为什么学 / 对应多少岗位 / 预计投入时间 / 验收条件 / 项目产出
 *
 * 排序原则（不是简单按优先级堆叠）：
 *   1. 先按技能大类的「学习依赖相位」排序 —— 编程与 Linux 是地基，
 *      ROS2/嵌入式是中层，控制/规划/SLAM/感知/强化学习是上层；
 *   2. 同相位内按难度升序（先易后难，保证每周都有可交付成果）；
 *   3. 再按市场岗位数降序（同难度先学更值钱的）。
 *
 * 这样做的原因：Gap 优先级回答的是「什么最值得学」，
 * 而路线回答的是「按什么顺序学得会」——两者不能混为一谈。
 */
import type { Iso, LearningGoal, LearningRoadmap, MarketSnapshot, ProjectPlan } from '../shared/types.js';
export declare const DEFAULT_ROADMAP_WEEKS: 4 | 8 | 12;
export declare const DEFAULT_HOURS_PER_WEEK = 15;
/** 每个难度点折算的学习小时数。 */
export declare const HOURS_PER_DIFFICULTY = 4;
export declare const VALID_ROADMAP_MODES: readonly (4 | 8 | 12)[];
export interface PlanRoadmapInput {
    goals: readonly LearningGoal[];
    snapshot: MarketSnapshot;
    mode?: 4 | 8 | 12;
    project?: ProjectPlan;
    now?: Iso;
    hoursPerWeek?: number;
    basedOnProfileUpdatedAt?: Iso;
}
/**
 * 生成学习路线。
 *
 * 注意：`goals` 预期已经由 GapAnalyzer + GoalPlanner 产出（带优先级与验收标准）。
 * 本函数只负责排序、分周与文案，不会新增或删除目标。
 */
export declare const planRoadmap: (input: PlanRoadmapInput) => LearningRoadmap;
/**
 * 标记某个目标完成（需求 §十一：只有满足验收标准才能标记完成）。
 *
 * 这里不自行判断验收标准是否真的达成——那需要人的证据；
 * 但强制要求调用方显式传入确认，且目标必须已有非空验收标准。
 */
export declare const completeGoalInRoadmap: (goals: readonly LearningGoal[], input: {
    goalId: string;
    confirmed: boolean;
    now?: Iso;
}) => {
    goals: LearningGoal[];
    completed?: LearningGoal;
    error?: string;
};
