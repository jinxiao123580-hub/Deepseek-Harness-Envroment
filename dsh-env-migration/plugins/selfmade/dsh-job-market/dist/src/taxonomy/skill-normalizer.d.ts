/**
 * SkillNormalizer —— 系统核心（需求 §六）。
 *
 * 明确禁止「按字符串直接统计」。本模块负责把 JD / 简历 / 用户输入里的
 * 原始技能写法归一到规范技能 ID，并按 taxonomy 的 `implies` 关系做传递扩容。
 *
 * 需求中给出的三个必须成立的例子：
 *  - `C++` / `C++11` / `C++14` / `C++17` / `Modern C++`
 *      → `cpp17` 同时归入 `C++` 与 `Modern C++`
 *  - `ROS 2` / `ROS2` / `Robot Operating System 2` → 统一为 `ROS2`
 *  - `Ubuntu` / `Linux 开发环境` → 正确归到 `Linux`，但保留 `Ubuntu` 子标签
 *
 * 别名匹配采用 **最长优先**（longest-match），因此 `C++17` 不会被 `C` 吞掉，
 * `ROS2` 不会被 `ROS` 吞掉。
 */
import type { SkillCategory } from '../shared/types.js';
import type { SkillDictionary, SkillDictionaryEntry, SkillIndex } from './taxonomy.js';
/** 一次归一化结果。 */
export interface NormalizedSkill {
    /** 命中原文。 */
    raw: string;
    /** 主技能（命中的最具体技能）。 */
    skill_id: string;
    skill: string;
    category: SkillCategory;
    /** 由 implies 传递扩容出的其它技能 ID（不含主技能）。 */
    implied_skill_ids: string[];
    /** 主技能 + implied，去重后的完整技能 ID 集合。 */
    all_skill_ids: string[];
}
/** 规范化别名，作为字典键与匹配文本的共同基准。 */
export declare const normalizeAlias: (value: string) => string;
/**
 * 在规范化文本中查找全部字典别名命中（最长优先、不重叠）。
 *
 * 返回按出现位置排序的命中列表。重叠时保留更长者：
 * 例如文本 `c++17` 与别名 `c`、`c++`、`c++17` 同时存在时，只保留 `c++17`。
 */
export declare const findAliasMatches: (text: string, dictionary: SkillDictionary) => {
    alias: string;
    entry: SkillDictionaryEntry;
    index: number;
}[];
/** 依据 index 传递展开 `implies`（支持链式，带环保护）。 */
export declare const expandImplied: (skillId: string, index: SkillIndex) => string[];
/**
 * 归一化单个技能原文。
 * 命中失败返回 `undefined`（调用方可决定是否保留原文）。
 */
export declare const normalizeSkillToken: (raw: string, dictionary: SkillDictionary, index: SkillIndex) => NormalizedSkill | undefined;
/**
 * 归一化一组技能原文（用于已结构化的技能列表，例如简历、个人画像、平台结构化字段）。
 * 同一技能重复命中时只保留首个，并合并其 implied 集合。
 */
export declare const normalizeSkillTokens: (raws: readonly string[], dictionary: SkillDictionary, index: SkillIndex) => NormalizedSkill[];
/**
 * 从任意文本中抽取全部规范技能 ID（含 implied 扩容），保持出现顺序。
 * 这是写入 `Job.skills_normalized` 的入口。
 */
export declare const canonicalSkillIds: (text: string, dictionary: SkillDictionary, index: SkillIndex) => string[];
/**
 * 把规范技能 ID 列表还原为「主技能」列表——即剔除纯粹由 implies 产生的技能，
 * 只保留真正的命中项。用于市场统计区分「显式要求」与「隐含推导」。
 */
export declare const primarySkillIds: (text: string, dictionary: SkillDictionary) => string[];
/** 技能归一化失败的返回形状，便于批量处理时统计未识别项。 */
export interface NormalizationMiss {
    raw: string;
    reason: 'no-alias-match';
}
/** 批量归一化 + 未识别项报告。 */
export declare const normalizeWithReport: (raws: readonly string[], dictionary: SkillDictionary, index: SkillIndex) => {
    normalized: NormalizedSkill[];
    missed: NormalizationMiss[];
};
