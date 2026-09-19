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
import { normalizeText } from '../shared/text.js';
/** 规范化别名，作为字典键与匹配文本的共同基准。 */
export const normalizeAlias = (value) => normalizeText(value);
/** 判断别名是否为「纯 ASCII」——纯 ASCII 需要词边界，中文别名按子串匹配。 */
const isAsciiAlias = (alias) => /^[\x20-\x7e]+$/.test(alias);
/** ASCII 别名两侧的边界字符集合：不允许字母/数字/`+`/`#`/`.`/`_` 相邻。 */
const isBoundaryChar = (char) => char === undefined || !/[a-z0-9+#._]/i.test(char);
/**
 * 在规范化文本中查找全部字典别名命中（最长优先、不重叠）。
 *
 * 返回按出现位置排序的命中列表。重叠时保留更长者：
 * 例如文本 `c++17` 与别名 `c`、`c++`、`c++17` 同时存在时，只保留 `c++17`。
 */
export const findAliasMatches = (text, dictionary) => {
    const haystack = normalizeAlias(text);
    if (haystack === '')
        return [];
    // 收集所有可能的命中位置，然后按「起点升序、长度降序」贪心选取不重叠者。
    const candidates = [];
    for (const entry of dictionary.entries()) {
        for (const alias of entry.aliases) {
            if (alias === '')
                continue;
            const ascii = isAsciiAlias(alias);
            let from = 0;
            for (;;) {
                const index = haystack.indexOf(alias, from);
                if (index === -1)
                    break;
                from = index + 1;
                if (ascii) {
                    const before = index === 0 ? undefined : haystack[index - 1];
                    const after = haystack[index + alias.length];
                    if (!isBoundaryChar(before) || !isBoundaryChar(after))
                        continue;
                }
                candidates.push({ alias, entry, index });
            }
        }
    }
    candidates.sort((a, b) => {
        if (a.index !== b.index)
            return a.index - b.index;
        if (a.alias.length !== b.alias.length)
            return b.alias.length - a.alias.length;
        return a.entry.skill_id < b.entry.skill_id ? -1 : 1;
    });
    const chosen = [];
    let consumedUntil = -1;
    for (const candidate of candidates) {
        if (candidate.index < consumedUntil)
            continue;
        // 同一起点上，已排序保证更长别名先被选中。
        chosen.push(candidate);
        consumedUntil = candidate.index + candidate.alias.length;
    }
    return chosen;
};
/** 依据 index 传递展开 `implies`（支持链式，带环保护）。 */
export const expandImplied = (skillId, index) => {
    const collected = [];
    const visited = new Set([skillId]);
    const queue = [skillId];
    while (queue.length > 0) {
        const current = queue.shift();
        const definition = index.get(current);
        if (definition === undefined)
            continue;
        for (const implied of definition.implies ?? []) {
            if (visited.has(implied))
                continue;
            visited.add(implied);
            collected.push(implied);
            queue.push(implied);
        }
    }
    return collected;
};
/**
 * 归一化单个技能原文。
 * 命中失败返回 `undefined`（调用方可决定是否保留原文）。
 */
export const normalizeSkillToken = (raw, dictionary, index) => {
    const matches = findAliasMatches(raw, dictionary);
    if (matches.length === 0)
        return undefined;
    // 单一技能原文：取最长的那个命中作为主技能。
    const best = matches.reduce((longest, current) => current.alias.length > longest.alias.length ? current : longest);
    const implied = expandImplied(best.entry.skill_id, index);
    return {
        raw,
        skill_id: best.entry.skill_id,
        skill: best.entry.skill,
        category: best.entry.category,
        implied_skill_ids: implied,
        all_skill_ids: [best.entry.skill_id, ...implied],
    };
};
/**
 * 归一化一组技能原文（用于已结构化的技能列表，例如简历、个人画像、平台结构化字段）。
 * 同一技能重复命中时只保留首个，并合并其 implied 集合。
 */
export const normalizeSkillTokens = (raws, dictionary, index) => {
    const merged = new Map();
    for (const raw of raws) {
        const normalized = normalizeSkillToken(raw, dictionary, index);
        if (normalized === undefined)
            continue;
        const existing = merged.get(normalized.skill_id);
        if (existing === undefined) {
            merged.set(normalized.skill_id, normalized);
            continue;
        }
        const all = new Set([...existing.all_skill_ids, ...normalized.all_skill_ids]);
        const implied = new Set([...existing.implied_skill_ids, ...normalized.implied_skill_ids]);
        merged.set(normalized.skill_id, {
            ...existing,
            implied_skill_ids: [...implied],
            all_skill_ids: [...all],
        });
    }
    return [...merged.values()];
};
/**
 * 从任意文本中抽取全部规范技能 ID（含 implied 扩容），保持出现顺序。
 * 这是写入 `Job.skills_normalized` 的入口。
 */
export const canonicalSkillIds = (text, dictionary, index) => {
    const matches = findAliasMatches(text, dictionary);
    const result = [];
    const seen = new Set();
    for (const match of matches) {
        const ids = [match.entry.skill_id, ...expandImplied(match.entry.skill_id, index)];
        for (const id of ids) {
            if (seen.has(id))
                continue;
            seen.add(id);
            result.push(id);
        }
    }
    return result;
};
/**
 * 把规范技能 ID 列表还原为「主技能」列表——即剔除纯粹由 implies 产生的技能，
 * 只保留真正的命中项。用于市场统计区分「显式要求」与「隐含推导」。
 */
export const primarySkillIds = (text, dictionary) => {
    const seen = new Set();
    const result = [];
    for (const match of findAliasMatches(text, dictionary)) {
        if (seen.has(match.entry.skill_id))
            continue;
        seen.add(match.entry.skill_id);
        result.push(match.entry.skill_id);
    }
    return result;
};
/** 批量归一化 + 未识别项报告。 */
export const normalizeWithReport = (raws, dictionary, index) => {
    const normalized = [];
    const missed = [];
    for (const raw of raws) {
        const result = normalizeSkillToken(raw, dictionary, index);
        if (result === undefined) {
            missed.push({ raw, reason: 'no-alias-match' });
            continue;
        }
        normalized.push(result);
    }
    return { normalized, missed };
};
//# sourceMappingURL=skill-normalizer.js.map