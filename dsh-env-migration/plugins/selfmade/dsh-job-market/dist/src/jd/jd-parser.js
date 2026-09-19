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
import { normalizeEducation, normalizeText, normalizeWhitespace, parseExperience, toHalfWidth, uniquePreserveOrder } from '../shared/text.js';
import { JD_JSON_SKELETON, JD_OUTPUT_RULES, JD_SYSTEM_PROMPT } from './prompts.js';
/* ============================================================================
 * 一、空结构
 * ==========================================================================*/
/** 全部 17 个键的空 `ParsedJd`（与 `JD_JSON_SKELETON` 严格一致，顺序也一致）。 */
export const emptyParsedJd = () => ({
    category: '',
    core_skills: [],
    optional_skills: [],
    programming_languages: [],
    frameworks: [],
    robotics_skills: [],
    embedded_skills: [],
    algorithm_skills: [],
    tools: [],
    os_platforms: [],
    hardware: [],
    communication_protocols: [],
    degree_requirement: '',
    experience_requirement: '',
    domain_knowledge: [],
    responsibilities: [],
    keywords: [],
});
/* ============================================================================
 * 二、JD 分节
 * ==========================================================================*/
/** 职责类小节标题。 */
const RESPONSIBILITY_HEADERS = [
    '岗位职责',
    '工作职责',
    '职责描述',
    '职位描述',
    '你将负责',
    '工作内容',
];
/** 要求类小节标题。 */
const REQUIREMENT_HEADERS = [
    '任职要求',
    '岗位要求',
    '任职资格',
    '职位要求',
    '我们希望你',
    '技能要求',
    '加分项',
];
const HEADER_PREFIX = String.raw `[\s\d.、()（）\-*•·【】\[\]]*`;
const HEADER_SUFFIX = String.raw `[\s:：、.。\-]*`;
const RESPONSIBILITY_HEADER_PATTERN = new RegExp(`^${HEADER_PREFIX}(${RESPONSIBILITY_HEADERS.join('|')})${HEADER_SUFFIX}`, 'i');
const REQUIREMENT_HEADER_PATTERN = new RegExp(`^${HEADER_PREFIX}(${REQUIREMENT_HEADERS.join('|')})${HEADER_SUFFIX}`, 'i');
/** 条目前缀噪声：`-`、`•`、`1.`、`(1)`、`①`、`、`、`*`。 */
const BULLET_PREFIX_PATTERN = /^[\s]*[-–—•·*※▪◦]*(?:\d{1,2}\s*[.、)）]|[（(]\s*\d{1,2}\s*[)）]|[一二三四五六七八九十]{1,2}\s*[、.）)]|[①-⑳]|[、,，])?\s*/;
const stripBullet = (line) => normalizeWhitespace(line.replace(BULLET_PREFIX_PATTERN, ''));
/**
 * 按中文 JD 常见小节标题切分文本。
 * 找不到任何标题时：`responsibilities` 为空，所有行归入 `requirements`。
 */
export const splitJdSections = (text) => {
    const responsibilities = [];
    const requirements = [];
    const source = toHalfWidth(typeof text === 'string' ? text : '');
    if (normalizeWhitespace(source) === '')
        return { responsibilities, requirements };
    // 既在小节标题处切分，也在换行处切分。
    const segments = source.split(/\r\n|\r|\n/);
    let current;
    for (const segment of segments) {
        const line = normalizeWhitespace(segment);
        if (line === '')
            continue;
        if (RESPONSIBILITY_HEADER_PATTERN.test(line) || REQUIREMENT_HEADER_PATTERN.test(line)) {
            const isRequirementHeader = REQUIREMENT_HEADER_PATTERN.test(line);
            current = isRequirementHeader ? 'requirements' : 'responsibilities';
            // 标题行本身可能带内容（如「任职要求：1. 本科以上」），保留冒号后的残句。
            const residue = stripBullet(line.replace(isRequirementHeader ? REQUIREMENT_HEADER_PATTERN : RESPONSIBILITY_HEADER_PATTERN, ''));
            if (residue !== '')
                (current === 'requirements' ? requirements : responsibilities).push(residue);
            continue;
        }
        const bullet = stripBullet(line);
        if (bullet === '')
            continue;
        if (current === 'responsibilities')
            responsibilities.push(bullet);
        else if (current === 'requirements')
            requirements.push(bullet);
        else
            requirements.push(bullet);
    }
    return { responsibilities, requirements };
};
/* ============================================================================
 * 三、要求强度推断（需求 §五 —— 最关键的一环）
 * ==========================================================================*/
/** 加分/锦上添花标记。 */
const BONUS_PATTERN = /(加分项|加分|优先考虑但非必须|锦上添花|加分条件|加分技能|nice\s*to\s*have|plus\s*points?)/i;
/** 「有 … 更好 / 有 … 更佳」这类弱条件（不再单独判 preferred，见下方顺序说明）。 */
const BONUS_SOFT_PATTERN = /有[^。；;\n]{0,20}(更好|更佳)/;
/** 优先/偏好标记。 */
const PREFERRED_PATTERN = /(优先|更佳|更好|preferred|is\s+a\s*plus|a\s*plus(?!\s*points?))/i;
/** 弱了解型动词（单独出现时视为弱要求）。 */
const WEAK_VERB_PATTERN = /(了解|知晓|接触过|有所了解|听说过)/;
/** 硬性要求标记。 */
const REQUIRED_PATTERN = /(必须|要求|熟练掌握|精通|扎实|深入理解|熟悉|掌握|具备|任职要求|能够独立|required|proficient|must)/i;
/** 明确硬性标记（用于「长而含糊句子」的兜底判断）。 */
const HARD_MARKER_PATTERN = /(必须|熟练掌握|精通|扎实|深入理解|掌握|具备|能够独立|要求)/i;
/** 任职要求小节标题（句子落在这个小节内时默认 required）。 */
const REQUIREMENT_SECTION_PATTERN = /(任职要求|岗位要求|任职资格|职位要求|我们希望你|技能要求)/;
/**
 * 推断一句话的技能要求强度。
 *
 * 顺序（必须严格遵守，否则「熟练掌握 C++」与「了解 Python 优先」会被混为一谈）：
 *  1. 加分标记        → `bonus`（除非同时出现硬性标记，如「必须…，有…加分」）
 *  2. 优先 / 弱了解   → `preferred`
 *  3. 硬性标记        → `required`
 *  4. 兜底            → 长而含糊的句子给 `preferred`，其余给 `required`
 */
export const inferRequirementStrength = (sentence) => {
    const text = normalizeText(typeof sentence === 'string' ? sentence : '');
    if (text === '')
        return 'required';
    const hasHard = HARD_MARKER_PATTERN.test(text);
    // 1) 加分项
    if (BONUS_PATTERN.test(text)) {
        if (!hasHard)
            return 'bonus';
    }
    if (BONUS_SOFT_PATTERN.test(text) && !hasHard)
        return 'bonus';
    // 2) 优先 / 弱了解
    if (PREFERRED_PATTERN.test(text) || WEAK_VERB_PATTERN.test(text))
        return 'preferred';
    // 3) 硬性要求
    if (REQUIRED_PATTERN.test(text))
        return 'required';
    // 4) 兜底：长而含糊 → preferred，其余 → required
    return text.length >= 14 ? 'preferred' : 'required';
};
/* ============================================================================
 * 四、技能提及抽取（字典 + 最长优先 + 词边界）
 * ==========================================================================*/
/** 规范化别名：半角 → 小写 → 空白折叠。 */
const normalizeAlias = (value) => normalizeText(value);
/** 纯 ASCII 别名需要词边界，中文别名按子串匹配。 */
const isAsciiAlias = (alias) => /^[\x20-\x7e]+$/.test(alias);
/** ASCII 别名两侧不允许出现字母/数字/`+`/`#`/`.`/`_`，避免 `c` 命中 `c++` / `cmake`。 */
const isBoundaryChar = (char) => char === undefined || !/[a-z0-9+#._]/i.test(char);
/** 字典 → 别名表的缓存（纯派生数据，按字典实例缓存，避免重复排序）。 */
const aliasTableCache = new WeakMap();
const buildAliasTable = (dictionary) => {
    const records = [];
    for (const entry of dictionary.entries()) {
        for (const raw of entry.aliases) {
            const alias = normalizeAlias(raw);
            if (alias === '')
                continue;
            records.push({ alias, entry });
        }
    }
    // 最长别名优先；同长度按技能 ID 字典序，保证确定性。
    records.sort((a, b) => {
        if (a.alias.length !== b.alias.length)
            return b.alias.length - a.alias.length;
        if (a.entry.skill_id !== b.entry.skill_id)
            return a.entry.skill_id < b.entry.skill_id ? -1 : 1;
        return a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0;
    });
    return records;
};
const getAliasTable = (dictionary) => {
    const cached = aliasTableCache.get(dictionary);
    if (cached !== undefined)
        return cached;
    const table = buildAliasTable(dictionary);
    aliasTableCache.set(dictionary, table);
    return table;
};
const SENTENCE_BREAK_PATTERN = /[。；;！!？?\n\r]/;
/** 把文本切成句子并记录原文下标（半角化会改变字符长度，因此必须用同一份半角文本）。 */
const splitSentences = (text) => {
    const spans = [];
    let buffer = '';
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (SENTENCE_BREAK_PATTERN.test(char)) {
            const trimmed = buffer.trim();
            if (trimmed !== '') {
                const leading = buffer.length - buffer.trimStart().length;
                spans.push({ text: trimmed, start: start + leading, end: start + leading + trimmed.length });
            }
            buffer = '';
            start = index + 1;
            continue;
        }
        buffer += char;
    }
    const trimmed = buffer.trim();
    if (trimmed !== '') {
        const leading = buffer.length - buffer.trimStart().length;
        spans.push({ text: trimmed, start: start + leading, end: start + leading + trimmed.length });
    }
    return spans;
};
/** 二分查找包含给定下标的句子。 */
const findSentence = (spans, index) => {
    let low = 0;
    let high = spans.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const span = spans[mid];
        if (index < span.start)
            high = mid - 1;
        else if (index >= span.end)
            low = mid + 1;
        else
            return span;
    }
    return undefined;
};
const EVIDENCE_MAX_LENGTH = 120;
const buildEvidence = (spans, start, end, fallback) => {
    const span = findSentence(spans, start) ?? findSentence(spans, end - 1);
    const text = span?.text ?? fallback;
    return text.length <= EVIDENCE_MAX_LENGTH ? text : `${text.slice(0, EVIDENCE_MAX_LENGTH - 1)}…`;
};
/** 传递展开 `implies`（带环保护）。 */
const expandImplied = (entry, dictionary) => {
    const collected = [];
    const visited = new Set([entry.skill_id]);
    const queue = [...(entry.implies ?? [])];
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === '' || visited.has(current))
            continue;
        visited.add(current);
        collected.push(current);
        const next = dictionary.lookup(current);
        if (next?.implies === undefined)
            continue;
        for (const implied of next.implies)
            queue.push(implied);
    }
    return collected;
};
/** 半角文本 → 上下文缓存（按文本字符串缓存，避免对同一 JD 重复切句）。 */
const textContextCache = new Map();
const TEXT_CONTEXT_CACHE_MAX = 512;
const buildHeaderHits = (text) => {
    const hits = [];
    const linePattern = /[^\n\r]+/g;
    let match;
    while ((match = linePattern.exec(text)) !== null) {
        const line = match[0];
        const lineStart = match.index;
        const requirementHit = REQUIREMENT_SECTION_PATTERN.exec(line);
        if (requirementHit !== null) {
            hits.push({ index: lineStart + requirementHit.index, requirement: 'requirements' });
            continue;
        }
        const responsibilityHit = RESPONSIBILITY_HEADERS.reduce((found, header) => {
            if (found !== -1)
                return found;
            return line.indexOf(header);
        }, -1);
        if (responsibilityHit !== -1) {
            hits.push({ index: lineStart + responsibilityHit, requirement: 'responsibilities' });
        }
    }
    hits.sort((a, b) => a.index - b.index);
    return hits;
};
const getTextContext = (haystack) => {
    const cached = textContextCache.get(haystack);
    if (cached !== undefined)
        return cached;
    const context = {
        haystack,
        spans: splitSentences(haystack),
        headerHits: buildHeaderHits(haystack),
    };
    if (textContextCache.size >= TEXT_CONTEXT_CACHE_MAX)
        textContextCache.clear();
    textContextCache.set(haystack, context);
    return context;
};
/**
 * 从文本中抽取技能提及。
 * 最长别名优先、ASCII 走词边界、中文走子串；同一「技能 + 强度」桶内只保留置信度最高的一条。
 */
/**
 * 为「技能提及抽取」规范化文本：折叠水平空白，但**保留换行**。
 *
 * 为什么不能用 `normalizeText`：它会把 `\n` 一并折成空格，
 * 于是「任职要求」里的多条 bullet 会被粘成同一个句子。
 * 结果是 `['熟练掌握 C++', '了解 Python 优先']` 里那条「优先」会污染整段，
 * 让 C++ 也被判成 preferred —— 直接违反需求 §五
 * 「必须区分 required / preferred / bonus，『熟练掌握C++』与『了解Python优先』权重不同」。
 *
 * 换行是 JD 天然的条目边界，必须留给 `splitSentences` 使用。
 */
const normalizeKeepingLineBreaks = (value) => value
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .toLowerCase();
export const extractMentions = (text, dictionary) => {
    const source = toHalfWidth(typeof text === 'string' ? text : '');
    if (normalizeWhitespace(source) === '')
        return [];
    const haystack = normalizeKeepingLineBreaks(source);
    if (haystack === '')
        return [];
    const table = getAliasTable(dictionary);
    if (table.length === 0)
        return [];
    const context = getTextContext(haystack);
    const spans = context.spans;
    const headerHits = context.headerHits;
    /** 判断下标是否位于「任职要求」小节内。 */
    const inRequirementSection = (index) => {
        let current;
        for (const hit of headerHits) {
            if (hit.index > index)
                break;
            current = hit;
        }
        return current?.requirement === 'requirements';
    };
    const collected = [];
    let cursor = 0;
    while (cursor < haystack.length) {
        const char = haystack[cursor];
        if (char === ' ') {
            cursor += 1;
            continue;
        }
        let matched;
        for (const record of table) {
            const alias = record.alias;
            if (!haystack.startsWith(alias, cursor))
                continue;
            if (isAsciiAlias(alias)) {
                const before = cursor === 0 ? undefined : haystack[cursor - 1];
                const after = haystack[cursor + alias.length];
                if (!isBoundaryChar(before) || !isBoundaryChar(after))
                    continue;
            }
            matched = record;
            break;
        }
        if (matched === undefined) {
            cursor += 1;
            continue;
        }
        const alias = matched.alias;
        const start = cursor;
        const end = cursor + alias.length;
        const raw = source.slice(start, end);
        const sentence = findSentence(spans, start)?.text ?? '';
        const requirement = sentence === ''
            ? inRequirementSection(start)
                ? 'required'
                : 'preferred'
            : inferRequirementStrength(sentence);
        const chineseOnly = !isAsciiAlias(alias);
        const confidence = chineseOnly && alias.length > 4 ? 0.7 : 0.95;
        collected.push({
            raw,
            skill_id: matched.entry.skill_id,
            skill: matched.entry.skill,
            category: matched.entry.category,
            implied_skill_ids: expandImplied(matched.entry, dictionary),
            requirement,
            confidence,
            evidence: buildEvidence(spans, start, end, sentence),
            method: 'dictionary',
        });
        cursor = end;
    }
    // 去重：同一 skill_id + 同一强度桶只保留置信度最高（并列时保留更早出现）的一条。
    const best = new Map();
    for (const mention of collected) {
        const key = `${mention.skill_id}\u0000${mention.requirement}`;
        const existing = best.get(key);
        if (existing === undefined || mention.confidence > existing.confidence) {
            best.set(key, mention);
        }
    }
    return [...best.values()];
};
/* ============================================================================
 * 五、规则解析（默认路径，零模型调用）
 * ==========================================================================*/
/** 词典大类 → `ParsedJd` 分桶字段。 */
const BUCKET_BY_TAXONOMY_CATEGORY = {
    Programming: 'programming_languages',
    Robotics: 'robotics_skills',
    Embedded: 'embedded_skills',
    Control: 'algorithm_skills',
    Planning: 'algorithm_skills',
    SLAM: 'algorithm_skills',
    Perception: 'algorithm_skills',
    'AI/RL': 'algorithm_skills',
    Linux: 'os_platforms',
    Engineering: 'tools',
    Hardware: 'hardware',
    Communication: 'communication_protocols',
};
/** 领域知识启发式：2-8 个汉字且包含下列词根之一。 */
const DOMAIN_NOUN_PATTERN = /[\u4e00-\u9fa5]{2,8}/g;
const DOMAIN_NOUN_KEYWORDS = ['领域', '行业', '业务', '场景', '系统', '算法', '架构'];
/** 关键词抽取停用词（中英混合，保留技术词）。 */
const KEYWORD_STOPWORDS = new Set([
    '的', '了', '和', '与', '及', '或', '在', '有', '是', '为', '对', '等', '中', '上', '下', '并', '能', '会',
    '岗位', '职责', '工作', '要求', '任职', '职位', '描述', '公司', '团队', '相关', '经验', '能力', '熟悉',
    '掌握', '了解', '负责', '具备', '优先', '以及', '以上', '具有', '良好', '一定', '完成', '参与', '进行',
    'and', 'the', 'for', 'with', 'you', 'are', 'our', 'will', 'have', 'has', 'that', 'this', 'from', 'your',
    'job', 'work', 'team', 'must', 'plus', 'preferred', 'required', 'good', 'able', 'etc', 'using', 'use',
]);
const TOKEN_PATTERN = /[a-z][a-z0-9+#._-]{0,23}|[\u4e00-\u9fa5]{2,8}/g;
const tokenizeForKeywords = (text) => {
    const haystack = normalizeText(text);
    const tokens = [];
    let match;
    const pattern = new RegExp(TOKEN_PATTERN.source, 'g');
    while ((match = pattern.exec(haystack)) !== null) {
        const token = match[0].replace(/^[._-]+|[._-]+$/g, '');
        if (token.length < 2)
            continue;
        if (KEYWORD_STOPWORDS.has(token))
            continue;
        if (/^\d+$/.test(token))
            continue;
        tokens.push(token);
    }
    return tokens;
};
/** 取标题 + 要求文本中出现频次最高的 15 个非停用词。 */
const extractKeywords = (job, requirements) => {
    const tokens = tokenizeForKeywords([job.job_title ?? '', ...requirements].join(' '));
    const counts = new Map();
    for (const token of tokens)
        counts.set(token, (counts.get(token) ?? 0) + 1);
    return [...counts.entries()]
        .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
        .slice(0, 15)
        .map(([token]) => token);
};
/** 从要求文本中收割「领域/行业」类名词短语，排除已命中的技能原文。 */
const extractDomainKnowledge = (requirements, skillRaws) => {
    const excluded = normalizeText(skillRaws.join(' '));
    const found = [];
    const seen = new Set();
    for (const text of requirements) {
        const haystack = normalizeText(text);
        const pattern = new RegExp(DOMAIN_NOUN_PATTERN.source, 'g');
        let match;
        while ((match = pattern.exec(haystack)) !== null) {
            const noun = match[0];
            if (seen.has(noun))
                continue;
            if (!DOMAIN_NOUN_KEYWORDS.some((keyword) => noun.includes(keyword)))
                continue;
            if (excluded.includes(noun))
                continue;
            seen.add(noun);
            found.push(noun);
            if (found.length >= 12)
                return found;
        }
    }
    return found;
};
/**
 * 合并后的 JD 文本（标题 + 描述 + 要求），技能抽取的统一输入。
 *
 * 注意这里**不能**用 `normalizeWhitespace`：它会把 `\n` 折成空格，
 * 于是「标题 / 描述 / 每条要求」全部粘成一句话，
 * `splitSentences` 就再也切不出条目边界，
 * 「熟练掌握 C++」会被同段的「了解 Python 优先」带成 preferred。
 * 每个数组元素单独成行，换行即是条目边界。
 */
const buildJdText = (job, sections) => [
    job.job_title ?? '',
    job.description ?? '',
    ...(job.requirements ?? []),
    ...sections.responsibilities,
    ...sections.requirements,
]
    .filter((part) => typeof part === 'string' && part !== '')
    .join('\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
/**
 * 规则路径：从真实岗位记录确定性地产出 `JdAnalysis`。
 * `llm_calls` 恒为 0 —— 这条路径不消耗任何模型额度（需求 §十六 / §十七）。
 */
export const parseJdByRule = (input) => {
    const { job, dictionary } = input;
    const sections = splitJdSections([job.description ?? '', ...(job.requirements ?? [])].join('\n'));
    const mentions = extractMentions(buildJdText(job, sections), dictionary);
    const categoryBySkillId = new Map();
    for (const entry of dictionary.entries()) {
        if (!categoryBySkillId.has(entry.skill_id))
            categoryBySkillId.set(entry.skill_id, entry.category);
    }
    const required = mentions.filter((mention) => mention.requirement === 'required');
    const optional = mentions.filter((mention) => mention.requirement !== 'required');
    const buckets = {
        programming_languages: [],
        frameworks: [],
        robotics_skills: [],
        embedded_skills: [],
        algorithm_skills: [],
        tools: [],
        os_platforms: [],
        hardware: [],
        communication_protocols: [],
    };
    for (const mention of mentions) {
        const taxonomyCategory = categoryBySkillId.get(mention.skill_id) ?? mention.category;
        const bucket = BUCKET_BY_TAXONOMY_CATEGORY[taxonomyCategory];
        if (bucket === undefined || !(bucket in buckets))
            continue;
        buckets[bucket].push(mention.skill);
    }
    const experience = parseExperience(job.experience_text ?? '');
    const parsed = {
        category: job.job_category !== undefined && job.job_category !== '' ? job.job_category : 'unknown',
        core_skills: uniquePreserveOrder(required.map((mention) => mention.skill)),
        optional_skills: uniquePreserveOrder(optional.map((mention) => mention.skill)),
        programming_languages: uniquePreserveOrder(buckets.programming_languages),
        frameworks: uniquePreserveOrder(buckets.frameworks),
        robotics_skills: uniquePreserveOrder(buckets.robotics_skills),
        embedded_skills: uniquePreserveOrder(buckets.embedded_skills),
        algorithm_skills: uniquePreserveOrder(buckets.algorithm_skills),
        tools: uniquePreserveOrder(buckets.tools),
        os_platforms: uniquePreserveOrder(buckets.os_platforms),
        hardware: uniquePreserveOrder(buckets.hardware),
        communication_protocols: uniquePreserveOrder(buckets.communication_protocols),
        degree_requirement: normalizeEducation(job.education ?? ''),
        experience_requirement: experience.text,
        domain_knowledge: extractDomainKnowledge(sections.requirements, mentions.map((mention) => mention.raw)),
        responsibilities: sections.responsibilities,
        keywords: extractKeywords(job, sections.requirements),
    };
    return {
        parsed,
        mentions,
        via: 'rule',
        analysis_version: input.analysisVersion,
        prompt_version: input.promptVersion,
        analyzed_at: input.now ?? new Date().toISOString(),
        llm_calls: 0,
    };
};
/* ============================================================================
 * 六、模型路径：准备请求（本插件不发起调用）
 * ==========================================================================*/
/** 整个提示词的字符上限。 */
const PROMPT_MAX_LENGTH = 4000;
/** 描述字段单独的上限，保证标题/要求能完整出现。 */
const DESCRIPTION_MAX_LENGTH = 1600;
const truncate = (value, max) => value.length <= max ? { text: value, truncated: false } : { text: value.slice(0, max), truncated: true };
/**
 * 组装交给宿主 Agent 的严格 JSON 请求。
 *
 * 本函数 **只准备请求**，不调用任何模型：真正推理由 DSH 宿主 Agent 完成，
 * 回复再由 `ingestLlmAnalysis` 吸收。整段提示词控制在 4000 字符以内，
 * 超长时截断岗位描述并在提示词中显著标注。
 */
export const buildJdAnalysisPrompt = (input) => {
    const { job } = input;
    const description = truncate(normalizeWhitespace(job.description ?? ''), DESCRIPTION_MAX_LENGTH);
    const requirements = (job.requirements ?? [])
        .filter((item) => typeof item === 'string' && normalizeWhitespace(item) !== '')
        .map((item) => normalizeWhitespace(item));
    const requirementsBlock = requirements.length === 0 ? '（JD 未单独列出要求段落）' : requirements.map((line, index) => `${index + 1}. ${line}`).join('\n');
    const head = [
        `提示词版本：${input.promptVersion}`,
        '任务：把下面这条真实招聘 JD 解析成结构化 JSON（只做解析 / 分类 / 归一化 / 解释）。',
        '',
        '【岗位信息】',
        `职位名称：${normalizeWhitespace(job.job_title ?? '') || '（缺失）'}`,
        `公司：${normalizeWhitespace(job.company ?? '') || '（缺失）'}`,
        `城市：${normalizeWhitespace(job.city ?? '') || '（缺失）'}`,
        job.job_category !== undefined && job.job_category !== '' ? `规则初判方向：${job.job_category}（如明显不符可在 category 中纠正）` : '规则初判方向：unknown',
        `学历字段：${normalizeWhitespace(job.education ?? '') || '（缺失）'}`,
        `经验字段：${normalizeWhitespace(job.experience_text ?? '') || '（缺失）'}`,
        '',
        '【职位描述】',
        description.text === '' ? '（JD 未提供描述）' : description.text,
        description.truncated ? '（注意：职位描述过长，已在此处截断，请只依据以上可见内容解析）' : '',
        '',
        '【任职要求】',
        requirementsBlock,
        '',
    ]
        .filter((line) => line !== '')
        .join('\n');
    const tail = ['', '【输出约束】', ...JD_OUTPUT_RULES.map((rule, index) => `${index + 1}. ${rule}`), '', '【输出 JSON 骨架（键名与类型必须完全一致）】', JD_JSON_SKELETON].join('\n');
    const overflow = head.length + tail.length - PROMPT_MAX_LENGTH;
    const headText = overflow > 0 ? `${truncate(head, Math.max(600, head.length - overflow - 200)).text}\n（注意：原始 JD 文本过长，为控制长度已再次截断）\n` : head;
    return {
        system: JD_SYSTEM_PROMPT,
        prompt: `${headText}${tail}`,
        jsonHint: JD_JSON_SKELETON,
    };
};
/* ============================================================================
 * 七、模型路径：吸收 Agent 的结构化回复
 * ==========================================================================*/
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
const asString = (value) => (typeof value === 'string' ? value : '');
/** 清洗模型输出：保证 17 个键都存在且类型正确，丢弃非字符串元素。 */
const sanitizeParsedJd = (value) => {
    const empty = emptyParsedJd();
    if (!isRecord(value))
        return empty;
    return {
        category: asString(value.category),
        core_skills: asStringArray(value.core_skills),
        optional_skills: asStringArray(value.optional_skills),
        programming_languages: asStringArray(value.programming_languages),
        frameworks: asStringArray(value.frameworks),
        robotics_skills: asStringArray(value.robotics_skills),
        embedded_skills: asStringArray(value.embedded_skills),
        algorithm_skills: asStringArray(value.algorithm_skills),
        tools: asStringArray(value.tools),
        os_platforms: asStringArray(value.os_platforms),
        hardware: asStringArray(value.hardware),
        communication_protocols: asStringArray(value.communication_protocols),
        degree_requirement: asString(value.degree_requirement),
        experience_requirement: asString(value.experience_requirement),
        domain_knowledge: asStringArray(value.domain_knowledge),
        responsibilities: asStringArray(value.responsibilities),
        keywords: asStringArray(value.keywords),
    };
};
/**
 * 吸收宿主 Agent 的结构化回复（混合路径）。
 *
 * - 技能提及 **始终由规则重新抽取**：`required / preferred / bonus` 的判定基于真实句子，
 *   比模型自由发挥可信（需求 §五）。
 * - 结构化分桶采用模型结果（复杂归类正是模型擅长的部分），但统一清洗类型。
 */
export const ingestLlmAnalysis = (input) => {
    const { job, dictionary } = input;
    const modelParsed = sanitizeParsedJd(input.parsed);
    const sections = splitJdSections([job.description ?? '', ...(job.requirements ?? [])].join('\n'));
    const mentions = extractMentions(buildJdText(job, sections), dictionary);
    const parsed = {
        ...modelParsed,
        category: modelParsed.category !== '' ? modelParsed.category : job.job_category !== undefined && job.job_category !== '' ? job.job_category : 'unknown',
        degree_requirement: modelParsed.degree_requirement !== '' ? modelParsed.degree_requirement : normalizeEducation(job.education ?? ''),
        experience_requirement: modelParsed.experience_requirement !== '' ? modelParsed.experience_requirement : parseExperience(job.experience_text ?? '').text,
        responsibilities: modelParsed.responsibilities.length > 0 ? modelParsed.responsibilities : sections.responsibilities,
    };
    return {
        parsed,
        mentions,
        via: 'hybrid',
        analysis_version: input.analysisVersion,
        prompt_version: input.promptVersion,
        analyzed_at: input.now ?? new Date().toISOString(),
        llm_calls: 1,
    };
};
//# sourceMappingURL=jd-parser.js.map