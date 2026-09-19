/**
 * jd-parser —— JD 结构化解析（需求 §五 / §十六 / §十七）。
 *
 * 三条铁律：
 *  1. **默认路径不调用模型**：`parseJdByRule` 完全由规则 + 技能字典产出结构化结果，
 *     所以「岗位数 / 比例」这类统计永远不会被模型污染（需求 §十六）。
 *  2. **同一份 JD 不重复调用模型**：技能先用字典抽出来，只有「模糊语义 / 职责总结」
 *     才交给宿主 Agent（需求 §十七）；缓存键见 `jd-cache.ts`。
 *  3. **本插件自己不发起 LLM 调用**：`buildJdAnalysisPrompt` 只负责「准备严格 JSON 请求」，
 *     `ingestLlmAnalysis` 只负责「吸收宿主 Agent 的结构化回复」。
 *
 * 要求强度（需求 §五）是最关键的一环：
 *  「熟练掌握 C++」= required 与「了解 Python 优先」= preferred 绝不能同权重。
 *  因此 `extractMentions` 会把每一条命中还原到 **所在句子**，再按句子推断强度。
 */
import type { Job, JdAnalysis, ParsedJd, SkillMention, SkillRequirement } from '../shared/types.js';
/** 技能字典条目契约（与 `src/taxonomy/taxonomy.ts` 的 `SkillDictionaryEntry` 结构一致）。 */
export interface SkillDictionaryEntry {
    skill_id: string;
    skill: string;
    category: string;
    aliases: string[];
    implies?: string[];
}
/** 技能字典契约（实现见 `createSkillDictionary`）。 */
export interface SkillDictionary {
    lookup(alias: string): SkillDictionaryEntry | undefined;
    entries(): readonly SkillDictionaryEntry[];
}
/** 全部 17 个键的空 `ParsedJd`（与 `JD_JSON_SKELETON` 严格一致，顺序也一致）。 */
export declare const emptyParsedJd: () => ParsedJd;
/**
 * 按中文 JD 常见小节标题切分文本。
 * 找不到任何标题时：`responsibilities` 为空，所有行归入 `requirements`。
 */
export declare const splitJdSections: (text: string) => {
    responsibilities: string[];
    requirements: string[];
};
/**
 * 推断一句话的技能要求强度。
 *
 * 顺序（必须严格遵守，否则「熟练掌握 C++」与「了解 Python 优先」会被混为一谈）：
 *  1. 加分标记        → `bonus`（除非同时出现硬性标记，如「必须…，有…加分」）
 *  2. 优先 / 弱了解   → `preferred`
 *  3. 硬性标记        → `required`
 *  4. 兜底            → 长而含糊的句子给 `preferred`，其余给 `required`
 */
export declare const inferRequirementStrength: (sentence: string) => SkillRequirement;
export declare const extractMentions: (text: string, dictionary: SkillDictionary) => SkillMention[];
/**
 * 规则路径：从真实岗位记录确定性地产出 `JdAnalysis`。
 * `llm_calls` 恒为 0 —— 这条路径不消耗任何模型额度（需求 §十六 / §十七）。
 */
export declare const parseJdByRule: (input: {
    job: Job;
    dictionary: SkillDictionary;
    analysisVersion: number;
    promptVersion: number;
    now?: string;
}) => JdAnalysis;
/**
 * 组装交给宿主 Agent 的严格 JSON 请求。
 *
 * 本函数 **只准备请求**，不调用任何模型：真正推理由 DSH 宿主 Agent 完成，
 * 回复再由 `ingestLlmAnalysis` 吸收。整段提示词控制在 4000 字符以内，
 * 超长时截断岗位描述并在提示词中显著标注。
 */
export declare const buildJdAnalysisPrompt: (input: {
    job: Job;
    promptVersion: number;
}) => {
    system: string;
    prompt: string;
    jsonHint: string;
};
/**
 * 吸收宿主 Agent 的结构化回复（混合路径）。
 *
 * - 技能提及 **始终由规则重新抽取**：`required / preferred / bonus` 的判定基于真实句子，
 *   比模型自由发挥可信（需求 §五）。
 * - 结构化分桶采用模型结果（复杂归类正是模型擅长的部分），但统一清洗类型。
 */
export declare const ingestLlmAnalysis: (input: {
    job: Job;
    parsed: ParsedJd;
    dictionary: SkillDictionary;
    analysisVersion: number;
    promptVersion: number;
    now?: string;
}) => JdAnalysis;
