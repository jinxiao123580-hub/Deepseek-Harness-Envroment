/**
 * Gap 评分与学习计划测试（需求 §九 ~ §十三）。
 *
 * 重点验证：
 *  1. priority = market_demand × importance × skill_gap × role_coverage ÷ learning_cost 的公式正确性
 *  2. 每个条目的排序理由必须非空（需求 §十）
 *  3. AI 建议不得自动写入 skills，只有用户确认才生效（需求 §九）
 *  4. 目标必须有非空验收标准，且不是「学习 C++」这类不可验收目标（需求 §十一）
 *  5. 路线必须包含每周七要素，且不推翻既有计划（需求 §十三 / §十四）
 */
export {};
