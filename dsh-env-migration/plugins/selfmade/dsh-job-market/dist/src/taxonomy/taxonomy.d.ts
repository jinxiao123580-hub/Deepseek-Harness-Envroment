/**
 * 技能体系（SkillTaxonomy）加载、校验、合并与字典索引。
 *
 * 需求 §六 要求 taxonomy **可以人工编辑，不要完全写死**，因此：
 *  - 默认体系内置在 `./default-taxonomy.js`（保证零配置可用）
 *  - 工作区可用 `taxonomy/skill-taxonomy.json` 覆盖或追加技能（见 `mergeTaxonomies`）
 *  - 合并策略是「按 id 覆盖 + 追加」，不会因为用户只写了一条技能就丢掉整个默认体系
 */
import type { SkillDefinition, SkillTaxonomy } from '../shared/types.js';
import { DEFAULT_TAXONOMY, DEFAULT_TAXONOMY_VERSION } from './default-taxonomy.js';
export { DEFAULT_TAXONOMY, DEFAULT_TAXONOMY_VERSION };
/** jd-parser 依赖的字典条目契约（字段名保持与 `src/jd/jd-parser.ts` 一致）。 */
export interface SkillDictionaryEntry {
    skill_id: string;
    skill: string;
    category: string;
    aliases: string[];
    implies?: string[];
}
/** jd-parser 依赖的字典契约。 */
export interface SkillDictionary {
    lookup(alias: string): SkillDictionaryEntry | undefined;
    entries(): readonly SkillDictionaryEntry[];
}
/** 技能 id → 定义。 */
export type SkillIndex = ReadonlyMap<string, SkillDefinition>;
/**
 * 校验并规范化一个 taxonomy。
 * 返回全新的对象；非法输入抛出中文 `TypeError`，便于用户直接读懂配置错误。
 */
export declare const validateTaxonomy: (input: unknown) => SkillTaxonomy;
/**
 * 合并两个体系：`override` 中同 id 的技能整条替换，新 id 追加。
 * 用于「默认体系 + 用户工作区覆盖文件」。
 */
export declare const mergeTaxonomies: (base: SkillTaxonomy, override: SkillTaxonomy) => SkillTaxonomy;
/** 技能 id → 定义 索引。 */
export declare const buildSkillIndex: (taxonomy: SkillTaxonomy) => SkillIndex;
/** 技能 id → { name, category } 映射，供市场分析填充展示名。 */
export declare const buildSkillNameMap: (taxonomy: SkillTaxonomy) => Map<string, {
    name: string;
    category: string;
}>;
/** 分类 id → 中文/英文展示名。 */
export declare const buildCategoryLabelMap: (taxonomy: SkillTaxonomy) => Map<string, string>;
/**
 * 把 taxonomy 编译成 jd-parser 需要的字典。
 *
 * `lookup` 键为规范化后的别名（小写、半角、空白折叠），
 * 使 `C++ 17` / `c++17` / `C++17` 都能命中同一条技能。
 */
export declare const createSkillDictionary: (taxonomy: SkillTaxonomy) => SkillDictionary;
/** 从 JSON 文本解析体系。 */
export declare const parseTaxonomyJson: (text: string) => SkillTaxonomy;
/** 序列化为便于人工编辑的 JSON（技能按 id 排序，稳定输出）。 */
export declare const taxonomyToJson: (taxonomy: SkillTaxonomy) => string;
/** 包内自带的 taxonomy 文件位置（用于首次生成工作区覆盖文件）。 */
export declare const bundledTaxonomyPath: () => string;
/**
 * 加载体系：默认体系打底，若给定工作区覆盖文件存在则合并。
 * 覆盖文件缺失或损坏时 **不中断**，退回默认体系并给出提示。
 */
export declare const loadTaxonomy: (overridePath?: string) => Promise<{
    taxonomy: SkillTaxonomy;
    warning?: string;
}>;
/** 供用户在首次配置时落盘的完整体系文本。 */
export declare const defaultTaxonomyJson: () => string;
