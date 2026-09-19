/**
 * 技能体系（SkillTaxonomy）加载、校验、合并与字典索引。
 *
 * 需求 §六 要求 taxonomy **可以人工编辑，不要完全写死**，因此：
 *  - 默认体系内置在 `./default-taxonomy.js`（保证零配置可用）
 *  - 工作区可用 `taxonomy/skill-taxonomy.json` 覆盖或追加技能（见 `mergeTaxonomies`）
 *  - 合并策略是「按 id 覆盖 + 追加」，不会因为用户只写了一条技能就丢掉整个默认体系
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { normalizeText, uniquePreserveOrder } from '../shared/text.js';
import { DEFAULT_TAXONOMY, DEFAULT_TAXONOMY_VERSION } from './default-taxonomy.js';
export { DEFAULT_TAXONOMY, DEFAULT_TAXONOMY_VERSION };
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
/**
 * 校验并规范化一个 taxonomy。
 * 返回全新的对象；非法输入抛出中文 `TypeError`，便于用户直接读懂配置错误。
 */
export const validateTaxonomy = (input) => {
    if (!isRecord(input)) {
        throw new TypeError('技能体系必须是 JSON 对象');
    }
    const rawSkills = input.skills;
    if (!Array.isArray(rawSkills)) {
        throw new TypeError('技能体系缺少 skills 数组');
    }
    const seenIds = new Set();
    const skills = [];
    for (const [index, raw] of rawSkills.entries()) {
        if (!isRecord(raw)) {
            throw new TypeError(`skills[${index}] 必须是对象`);
        }
        const id = typeof raw.id === 'string' ? raw.id.trim() : '';
        if (id === '') {
            throw new TypeError(`skills[${index}] 缺少合法的 id`);
        }
        if (seenIds.has(id)) {
            throw new TypeError(`技能 id 重复：${id}`);
        }
        seenIds.add(id);
        const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : id;
        const category = typeof raw.category === 'string' && raw.category.trim() !== '' ? raw.category.trim() : 'Engineering';
        // 别名始终包含 id 与展示名，保证定义本身可被匹配到。
        const aliases = uniquePreserveOrder([...asStringArray(raw.aliases), name, id]).filter((alias) => alias.trim() !== '');
        const definition = { id, name, category, aliases };
        const parents = asStringArray(raw.parents);
        const implies = asStringArray(raw.implies);
        const related = asStringArray(raw.related);
        if (parents.length > 0)
            definition.parents = parents;
        if (implies.length > 0)
            definition.implies = implies;
        if (related.length > 0)
            definition.related = related;
        if (raw.deprecated === true)
            definition.deprecated = true;
        skills.push(definition);
    }
    const rawCategories = Array.isArray(input.categories) ? input.categories : [];
    const categories = rawCategories
        .filter(isRecord)
        .map((raw) => {
        const id = typeof raw.id === 'string' ? raw.id.trim() : '';
        const name = typeof raw.name === 'string' ? raw.name.trim() : id;
        const nameZh = typeof raw.nameZh === 'string' ? raw.nameZh.trim() : undefined;
        return nameZh === undefined ? { id, name } : { id, name, nameZh };
    })
        .filter((category) => category.id !== '');
    const version = typeof input.version === 'number' && Number.isFinite(input.version) ? input.version : DEFAULT_TAXONOMY_VERSION;
    return { version, categories, skills };
};
/**
 * 合并两个体系：`override` 中同 id 的技能整条替换，新 id 追加。
 * 用于「默认体系 + 用户工作区覆盖文件」。
 */
export const mergeTaxonomies = (base, override) => {
    const byId = new Map();
    for (const skill of base.skills)
        byId.set(skill.id, skill);
    for (const skill of override.skills)
        byId.set(skill.id, skill);
    const categoriesById = new Map();
    for (const category of base.categories)
        categoriesById.set(category.id, category);
    for (const category of override.categories)
        categoriesById.set(category.id, category);
    return {
        version: Math.max(base.version, override.version),
        categories: [...categoriesById.values()],
        skills: [...byId.values()],
    };
};
/** 技能 id → 定义 索引。 */
export const buildSkillIndex = (taxonomy) => new Map(taxonomy.skills.map((skill) => [skill.id, skill]));
/** 技能 id → { name, category } 映射，供市场分析填充展示名。 */
export const buildSkillNameMap = (taxonomy) => new Map(taxonomy.skills.map((skill) => [skill.id, { name: skill.name, category: skill.category }]));
/** 分类 id → 中文/英文展示名。 */
export const buildCategoryLabelMap = (taxonomy) => {
    const labels = new Map();
    for (const category of taxonomy.categories) {
        labels.set(category.id, category.nameZh ?? category.name);
    }
    return labels;
};
/**
 * 把 taxonomy 编译成 jd-parser 需要的字典。
 *
 * `lookup` 键为规范化后的别名（小写、半角、空白折叠），
 * 使 `C++ 17` / `c++17` / `C++17` 都能命中同一条技能。
 */
export const createSkillDictionary = (taxonomy) => {
    const index = new Map();
    const entries = [];
    for (const skill of taxonomy.skills) {
        if (skill.deprecated === true)
            continue;
        const entry = {
            skill_id: skill.id,
            skill: skill.name,
            category: skill.category,
            aliases: skill.aliases.map((alias) => normalizeText(alias)),
        };
        if (skill.implies !== undefined && skill.implies.length > 0) {
            entry.implies = [...skill.implies];
        }
        entries.push(entry);
        for (const alias of entry.aliases) {
            if (alias === '')
                continue;
            // 冲突时先注册者获胜：默认体系在前，用户覆盖在后但同 id 已替换，
            // 因此这里用「不覆盖已有别名」保证确定性。
            if (!index.has(alias))
                index.set(alias, entry);
        }
    }
    return {
        lookup: (alias) => index.get(normalizeText(alias)),
        entries: () => entries,
    };
};
/** 从 JSON 文本解析体系。 */
export const parseTaxonomyJson = (text) => {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        throw new TypeError(`技能体系 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return validateTaxonomy(parsed);
};
/** 序列化为便于人工编辑的 JSON（技能按 id 排序，稳定输出）。 */
export const taxonomyToJson = (taxonomy) => {
    const sorted = {
        version: taxonomy.version,
        categories: taxonomy.categories,
        skills: [...taxonomy.skills].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
    return `${JSON.stringify(sorted, null, 2)}\n`;
};
/** 包内自带的 taxonomy 文件位置（用于首次生成工作区覆盖文件）。 */
export const bundledTaxonomyPath = () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/src/taxonomy → 包根 → taxonomy/skill-taxonomy.json
    return resolve(here, '..', '..', '..', 'taxonomy', 'skill-taxonomy.json');
};
/**
 * 加载体系：默认体系打底，若给定工作区覆盖文件存在则合并。
 * 覆盖文件缺失或损坏时 **不中断**，退回默认体系并给出提示。
 */
export const loadTaxonomy = async (overridePath) => {
    const base = validateTaxonomy(DEFAULT_TAXONOMY);
    if (overridePath === undefined || overridePath === '') {
        return { taxonomy: base };
    }
    try {
        const text = await readFile(overridePath, 'utf8');
        const override = parseTaxonomyJson(text);
        return { taxonomy: mergeTaxonomies(base, override) };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            taxonomy: base,
            warning: `自定义技能体系未能加载（${message}），已回退到内置体系。`,
        };
    }
};
/** 供用户在首次配置时落盘的完整体系文本。 */
export const defaultTaxonomyJson = () => taxonomyToJson(validateTaxonomy(DEFAULT_TAXONOMY));
//# sourceMappingURL=taxonomy.js.map