/**
 * dsh-job-market — 统一领域模型（唯一契约源）
 *
 * 设计原则（对应需求 §十六 数据真实性）：
 *  - 所有“数量 / 比例 / 薪资 / 岗位数 / 趋势”都由程序基于真实岗位计算，
 *    LLM 只允许参与「解析 / 分类 / 归一化 / 解释」。
 *  - 任何统计结果都必须携带 `job_ids`，以支持“点 68% 看到是哪些岗位”的回溯。
 *  - AI 不得擅自认定用户已掌握某项技能：`PersonalSkill.source` 必须可区分
 *    `user` 与 `ai-suggested`，后者不得计入 Gap。
 */
export {};
//# sourceMappingURL=types.js.map