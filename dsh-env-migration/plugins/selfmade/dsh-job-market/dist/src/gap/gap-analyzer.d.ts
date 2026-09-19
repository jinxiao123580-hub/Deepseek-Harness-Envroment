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
import type { GapReport, GapWeights, MarketSnapshot, PersonalSkillProfile, JobCategory, Iso } from '../shared/types.js';
/**
 * 默认权重。
 * `category_cost` 编码「学起来有多贵」：越低越优先。
 *  - 1.0~1.5：通用工具链，边际成本最低（Programming / Linux / Engineering）
 *  - 2.0~2.5：需要硬件或在环调试，成本中等（Robotics / Embedded / Hardware / Communication）
 *  - 3.0~3.5：需要成套数学与工程直觉，成本高（Control / Planning / Perception / SLAM）
 *  - 4.0    ：需要前置数学 + 算力 + 长期迭代，成本最高（AI/RL）
 */
export declare const DEFAULT_GAP_WEIGHTS: GapWeights;
/**
 * 原始公式，导出以便直接单测。
 * 输入因子按定义应为：market_demand / importance / skill_gap / role_coverage ∈ [0,1]，
 * learning_cost ≥ 1；本函数内部再做一次夹取，保证任何调用都得到确定性有限值。
 */
export declare const computePriority: (factors: {
    market_demand: number;
    importance: number;
    skill_gap: number;
    role_coverage: number;
    learning_cost: number;
}, weights: GapWeights) => number;
/** 按技能大类取学习成本（≥1）。`opts.difficulty` 可覆盖权重表中的基础难度。 */
export declare const learningCostFor: (category: string, weights: GapWeights, opts?: {
    difficulty?: number;
}) => number;
/**
 * 生成 Gap 报告。
 * 只有「用户已确认」且「在市场快照中出现」且「当前等级低于目标等级」的技能进入 `entries`；
 * 其余全部进 `excluded` 并附中文原因。
 */
export declare const analyzeGap: (input: {
    snapshot: MarketSnapshot;
    profile: PersonalSkillProfile;
    weights?: Partial<GapWeights>;
    targetCategories?: readonly JobCategory[];
    limit?: number;
    now?: Iso;
}) => GapReport;
