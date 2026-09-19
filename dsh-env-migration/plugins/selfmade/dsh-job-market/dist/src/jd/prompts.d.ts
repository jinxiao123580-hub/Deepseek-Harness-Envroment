/**
 * jd/prompts —— JD 解析相关的共享提示词片段。
 *
 * 本插件 **自己不发任何模型调用**：DSH 宿主 Agent 负责推理。
 * 因此这里的字符串是「交给宿主 Agent 的严格 JSON 请求」的公共部分，
 * 由 `buildJdAnalysisPrompt` 组装后交给宿主。
 *
 * 红线（需求 §十六）：
 *  - 模型只允许 解析 / 分类 / 归一化 / 解释；
 *  - 模型 **不得** 编造数量、比例、薪资、岗位数、趋势；
 *  - 模型只能输出严格 JSON。
 */
/** 系统提示词：划定模型权限边界，并强制 JSON 输出。 */
export declare const JD_SYSTEM_PROMPT: string;
/** `ParsedJd` 的精确 JSON 骨架（17 个键，全部为空），作为输出契约。 */
export declare const JD_JSON_SKELETON: string;
/** 输出规则清单（中文），用于约束模型行为。 */
export declare const JD_OUTPUT_RULES: string[];
/** 职责一句话总结的提示词（唯一允许的解释类用法，且不得引入数字）。 */
export declare const RESPONSIBILITY_SUMMARY_PROMPT: string;
/** 方向分类澄清提示词：仅在规则打分置信度过低时使用。 */
export declare const CATEGORY_DISAMBIGUATION_PROMPT: string;
