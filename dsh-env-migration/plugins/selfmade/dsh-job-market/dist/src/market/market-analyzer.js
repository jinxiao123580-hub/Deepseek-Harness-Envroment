/**
 * market-analyzer —— 市场需求统计（需求 §七 技能需求 / §八 方向拆分 / §十六 数据真实性）
 *
 * 铁律：
 *  1. 本文件里的每一个数字（岗位数、占比、薪资分位、加权需求、共现 lift）
 *     都**由真实岗位记录现场计算**，绝不估计、不外推、不补全。
 *  2. 每项统计都携带 `job_ids`，保证「点 68% 就能看到是哪些岗位」可回溯。
 *  3. 全部函数均为纯函数：不读写磁盘、不发网络请求；时间一律通过 `now` 注入。
 */
import { fnv1a32, stableStringify } from '../shared/hash.js';
import { clamp, normalizeText, normalizeWhitespace, roundTo, uniquePreserveOrder } from '../shared/text.js';
/* ============================================================================
 * 常量
 * ==========================================================================*/
/**
 * 技能要求强度权重（需求 §五：required / preferred / bonus 权重不同）。
 * `weighted_demand = (required*1.0 + preferred*0.5 + bonus*0.25) / 总岗位数`。
 */
export const SKILL_REQUIREMENT_WEIGHTS = {
    required: 1,
    preferred: 0.5,
    bonus: 0.25,
};
/** 岗位方向内置中文标签（需求 §八；可由 `defaultCategoryLabels` 覆盖）。 */
export const JOB_CATEGORY_LABELS = {
    'robotics-software': '机器人软件',
    'robotics-control': '机器人控制',
    ros2: 'ROS2',
    embedded: '嵌入式',
    'motion-planning': '运动规划',
    slam: 'SLAM',
    perception: '机器人感知',
    'rl-embodied': '强化学习/具身智能',
    unknown: '未分类',
};
/** 共现统计默认只用需求最高的前 N 个技能配对。 */
const DEFAULT_COOCCURRENCE_SKILL_LIMIT = 40;
/** 共现配对的最低支持度（岗位数）。 */
const DEFAULT_COOCCURRENCE_MIN_COUNT = 3;
/** 共现结果最多保留的配对数（防止结果爆炸）。 */
const COOCCURRENCE_PAIR_LIMIT = 120;
/** 每个方向默认保留的 TOP 技能数。 */
const DEFAULT_TOP_SKILLS_PER_CATEGORY = 10;
/** 技能频次表默认最低岗位数。 */
const DEFAULT_SKILL_MIN_COUNT = 1;
/** 无城市信息时的占位名。 */
export const UNKNOWN_CITY = '未知';
/** 无经验信息（不限/未标注）桶的标签。 */
export const UNKNOWN_EXPERIENCE_LABEL = '不限/未标注';
/** 一天毫秒数。 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/* ============================================================================
 * 通用小工具（纯函数）
 * ==========================================================================*/
/** 有限的数字判定（用于过滤 JSON 里可能出现的脏数据）。 */
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
/** 安全比例：永不 0 除。 */
const ratioOf = (count, total) => (total > 0 ? count / total : 0);
/** 去重并排序（稳定的 `job_ids` 输出，便于快照 diff）。 */
const sortedUnique = (values) => Array.from(new Set(values)).sort();
/** 升序排序的数值数组的中位数（空数组返回 NaN，调用方需先判空）。 */
const medianOfSorted = (sorted) => {
    const length = sorted.length;
    if (length === 0)
        return Number.NaN;
    const middle = Math.floor(length / 2);
    if (length % 2 === 1)
        return sorted[middle] ?? Number.NaN;
    const lower = sorted[middle - 1] ?? Number.NaN;
    const upper = sorted[middle] ?? Number.NaN;
    return (lower + upper) / 2;
};
/** 最近秩（nearest-rank）百分位：`p25` / `p75` 用，输入必须升序且非空。 */
const percentileOfSorted = (sorted, percentile) => {
    const length = sorted.length;
    if (length === 0)
        return Number.NaN;
    const rank = Math.ceil((percentile / 100) * length);
    const index = Math.min(length - 1, Math.max(0, rank - 1));
    return sorted[index] ?? Number.NaN;
};
/** 收集某个岗位集合里出现的薪资下限（升序）。 */
const collectSortedSalary = (jobs, key) => jobs
    .map((job) => job[key])
    .filter(isFiniteNumber)
    .sort((a, b) => a - b);
const collectSkillLabelIndex = (jobs, analyses) => {
    const names = new Map();
    const categories = new Map();
    for (const job of jobs) {
        const analysis = analyses.get(job.job_id);
        if (analysis === undefined)
            continue;
        const mentions = Array.isArray(analysis.mentions) ? analysis.mentions : [];
        for (const mention of mentions) {
            if (mention === undefined || mention === null)
                continue;
            const skillId = mention.skill_id;
            if (typeof skillId !== 'string' || skillId === '')
                continue;
            if (typeof mention.skill === 'string' && mention.skill !== '' && !names.has(skillId)) {
                names.set(skillId, mention.skill);
            }
            if (mention.category !== undefined && mention.category !== '' && !categories.has(skillId)) {
                categories.set(skillId, mention.category);
            }
            // 附带技能（implies）只借主技能的大类，不借名字（名字留给其自身作为主技能时）。
            const implied = Array.isArray(mention.implied_skill_ids) ? mention.implied_skill_ids : [];
            for (const impliedId of implied) {
                if (typeof impliedId !== 'string' || impliedId === '')
                    continue;
                if (mention.category !== undefined && mention.category !== '' && !categories.has(impliedId)) {
                    categories.set(impliedId, mention.category);
                }
            }
        }
    }
    return { names, categories };
};
/** 解析技能展示名与大类：显式 `skillNames` 优先，其次 JD 观察值，最后退化为技能 ID。 */
const resolveSkillLabel = (skillId, index, skillNames) => {
    const provided = skillNames?.get(skillId);
    if (provided !== undefined) {
        return {
            name: typeof provided.name === 'string' && provided.name !== '' ? provided.name : skillId,
            category: typeof provided.category === 'string' && provided.category !== ''
                ? provided.category
                : 'unknown',
        };
    }
    const name = index.names.get(skillId);
    const category = index.categories.get(skillId);
    return {
        name: name !== undefined && name !== '' ? name : skillId,
        category: category ?? 'unknown',
    };
};
/** 强度排序：required > preferred > bonus。 */
const STRENGTH_RANK = { required: 3, preferred: 2, bonus: 1 };
/**
 * 汇总「某个岗位对某个技能的强度」。
 *
 * 关键约束：**每个岗位对每个技能只落一个强度档**（取最高档）。
 *
 * 为什么必须如此：同一份 JD 里同一个技能可能既出现在标题（required），
 * 又出现在「了解…优先」那句（preferred）。如果两档都各记一次，
 * 三档计数之和会超过 job_count，「required 比例 + preferred 比例」会变成重叠区间，
 * 用户无法从比例读出真实结构（需求 §七 要求这三档是**可分别解读**的）。
 * 做成划分后恒有 required + preferred + bonus == job_count，可直接当分母验算。
 */
const buildJobSkillView = (job, analysis) => {
    const present = new Set();
    const strongest = new Map();
    const record = (id, strength) => {
        present.add(id);
        const previous = strongest.get(id);
        if (previous === undefined || STRENGTH_RANK[strength] > STRENGTH_RANK[previous]) {
            strongest.set(id, strength);
        }
    };
    if (analysis !== undefined && analysis !== null) {
        const mentions = Array.isArray(analysis.mentions) ? analysis.mentions : [];
        for (const mention of mentions) {
            if (mention === undefined || mention === null)
                continue;
            const implied = Array.isArray(mention.implied_skill_ids) ? mention.implied_skill_ids : [];
            const ids = uniquePreserveOrder([mention.skill_id, ...implied].filter((id) => typeof id === 'string' && id !== ''));
            const strength = mention.requirement === 'preferred' ? 'preferred' : mention.requirement === 'bonus' ? 'bonus' : 'required';
            for (const id of ids)
                record(id, strength);
        }
    }
    const normalized = Array.isArray(job.skills_normalized) ? job.skills_normalized : [];
    for (const id of normalized) {
        if (typeof id !== 'string' || id === '')
            continue;
        // 完全没有分析结果时视为 required（此时 skills_normalized 是唯一依据）；
        // 已有分析但规则没抽出该技能时记 preferred —— 保守，不夸大硬性要求。
        record(id, analysis === undefined || analysis === null ? 'required' : 'preferred');
    }
    const required = new Set();
    const preferred = new Set();
    const bonus = new Set();
    for (const [id, strength] of strongest) {
        if (strength === 'bonus')
            bonus.add(id);
        else if (strength === 'preferred')
            preferred.add(id);
        else
            required.add(id);
    }
    return { present, required, preferred, bonus };
};
/* ============================================================================
 * 一、过滤（需求 §七 统计口径）
 * ==========================================================================*/
/** 取岗位的“最近可见时间”：优先 `last_seen_at`，退化到 `collected_at`。 */
const jobTimestamp = (job) => {
    for (const candidate of [job.last_seen_at, job.collected_at]) {
        if (typeof candidate !== 'string' || candidate === '')
            continue;
        const parsed = Date.parse(candidate);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
};
/**
 * 按 `MarketFilter` 过滤岗位。纯函数：不修改入参，返回新数组。
 *
 * - `recent_days`：按 `last_seen_at`（退化 `collected_at`）取最近 N 天；时间无法解析时保留该岗位。
 * - `cities`：`job.city` 精确匹配，或（大小写/全半角归一化后）被城市名包含。
 * - `categories`：`job.job_category` 精确匹配（归一化后大小写不敏感）。
 * - `salary_min_k`：保留 `salary_max ?? salary_min >= 阈值`；无薪资信息一律排除。
 * - `experience_max`：保留 `experience_min` 缺失或 `<= 阈值` 的岗位。
 * - `education`：与列表匹配；学历为空的岗位仅在列表为空时保留。
 */
export const filterJobs = (jobs, filter, now) => {
    const all = Array.isArray(jobs) ? jobs : [];
    const criteria = filter ?? {};
    const recentDays = criteria.recent_days;
    let cutoff;
    if (isFiniteNumber(recentDays) && recentDays > 0) {
        const reference = now ?? new Date();
        const referenceTime = reference.getTime();
        if (Number.isFinite(referenceTime))
            cutoff = referenceTime - recentDays * MS_PER_DAY;
    }
    const cityFilters = Array.isArray(criteria.cities)
        ? criteria.cities.map((city) => normalizeText(city)).filter((city) => city !== '')
        : [];
    const categoryFilters = Array.isArray(criteria.categories)
        ? criteria.categories.map((category) => normalizeText(category)).filter((category) => category !== '')
        : [];
    const educationFilters = Array.isArray(criteria.education)
        ? criteria.education.map((education) => normalizeText(education)).filter((education) => education !== '')
        : [];
    const salaryMinK = criteria.salary_min_k;
    const experienceMax = criteria.experience_max;
    return all.filter((job) => {
        if (job === undefined || job === null)
            return false;
        if (cutoff !== undefined) {
            const timestamp = jobTimestamp(job);
            // 时间缺失时宁可保留（无法证明其“过期”），绝不凭空丢弃真实岗位。
            if (timestamp !== undefined && timestamp < cutoff)
                return false;
        }
        if (cityFilters.length > 0) {
            const city = normalizeText(job.city);
            if (city === '')
                return false;
            const matched = cityFilters.some((filterCity) => city === filterCity || city.includes(filterCity));
            if (!matched)
                return false;
        }
        if (categoryFilters.length > 0) {
            const category = normalizeText(job.job_category);
            if (category === '' || !categoryFilters.includes(category))
                return false;
        }
        if (isFiniteNumber(salaryMinK)) {
            const basis = isFiniteNumber(job.salary_max) ? job.salary_max : job.salary_min;
            if (!isFiniteNumber(basis) || basis < salaryMinK)
                return false;
        }
        if (isFiniteNumber(experienceMax)) {
            const min = job.experience_min;
            if (isFiniteNumber(min) && min > experienceMax)
                return false;
        }
        if (educationFilters.length > 0) {
            const education = normalizeText(job.education);
            if (education === '')
                return false;
            const matched = educationFilters.some((filterEducation) => education === filterEducation || education.includes(filterEducation));
            if (!matched)
                return false;
        }
        return true;
    });
};
/**
 * 逐技能统计市场频次。
 *
 * 统计口径（全部可回溯）：
 *  - `job_ratio = present 岗位数 / 传入岗位总数`（0 除保护 → 0）。
 *  - `weighted_demand = (required*1.0 + preferred*0.5 + bonus*0.25) / 总岗位数`，夹取到 0..1。
 *  - 每个岗位对「同一技能的同一档位」最多贡献 1 次（重复提及不重复计数）。
 *  - `trend_pp` 留空，由 `market-snapshot` 跨快照补齐。
 */
export const computeSkillFrequencies = (jobs, analyses, options = {}) => {
    const all = Array.isArray(jobs) ? jobs : [];
    const totalJobs = all.length;
    const minCount = isFiniteNumber(options.minCount) ? options.minCount : DEFAULT_SKILL_MIN_COUNT;
    const skillNames = options.skillNames;
    const labelIndex = collectSkillLabelIndex(all, analyses);
    const aggregates = new Map();
    for (const job of all) {
        if (job === undefined || job === null)
            continue;
        const view = buildJobSkillView(job, analyses.get(job.job_id));
        for (const skillId of view.present) {
            let aggregate = aggregates.get(skillId);
            if (aggregate === undefined) {
                aggregate = {
                    skill_id: skillId,
                    present: new Set(),
                    required: new Set(),
                    preferred: new Set(),
                    bonus: new Set(),
                };
                aggregates.set(skillId, aggregate);
            }
            aggregate.present.add(job.job_id);
            if (view.required.has(skillId))
                aggregate.required.add(job.job_id);
            if (view.preferred.has(skillId))
                aggregate.preferred.add(job.job_id);
            if (view.bonus.has(skillId))
                aggregate.bonus.add(job.job_id);
        }
    }
    const frequencies = [];
    for (const aggregate of aggregates.values()) {
        const jobCount = aggregate.present.size;
        if (jobCount < minCount)
            continue;
        const label = resolveSkillLabel(aggregate.skill_id, labelIndex, skillNames);
        const requiredCount = aggregate.required.size;
        const preferredCount = aggregate.preferred.size;
        const bonusCount = aggregate.bonus.size;
        const weighted = totalJobs > 0
            ? (requiredCount * SKILL_REQUIREMENT_WEIGHTS.required +
                preferredCount * SKILL_REQUIREMENT_WEIGHTS.preferred +
                bonusCount * SKILL_REQUIREMENT_WEIGHTS.bonus) /
                totalJobs
            : 0;
        frequencies.push({
            skill_id: aggregate.skill_id,
            skill: label.name,
            category: label.category,
            job_count: jobCount,
            job_ratio: ratioOf(jobCount, totalJobs),
            required_count: requiredCount,
            required_ratio: ratioOf(requiredCount, totalJobs),
            preferred_count: preferredCount,
            preferred_ratio: ratioOf(preferredCount, totalJobs),
            bonus_count: bonusCount,
            bonus_ratio: ratioOf(bonusCount, totalJobs),
            weighted_demand: clamp(Number.isFinite(weighted) ? weighted : 0, 0, 1),
            required_job_ids: sortedUnique([...aggregate.required]),
            preferred_job_ids: sortedUnique([...aggregate.preferred]),
            bonus_job_ids: sortedUnique([...aggregate.bonus]),
            job_ids: sortedUnique([...aggregate.present]),
        });
    }
    // 需求从高到低：岗位数 → 硬性要求数 → 加权需求 → 技能 ID（保证稳定输出）。
    frequencies.sort((a, b) => b.job_count - a.job_count ||
        b.required_count - a.required_count ||
        b.weighted_demand - a.weighted_demand ||
        (a.skill_id < b.skill_id ? -1 : a.skill_id > b.skill_id ? 1 : 0));
    return frequencies;
};
/* ============================================================================
 * 三、技能共现（需求 §七）
 * ==========================================================================*/
/** 取两个集合的交集（升序结果），按较小集合遍历以降低开销。 */
const intersectSorted = (a, b) => {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    const shared = [];
    for (const id of small) {
        if (large.has(id))
            shared.push(id);
    }
    return shared.sort();
};
/**
 * 技能共现 + lift。
 *
 * - 参与配对的技能：按频次降序取前 `topSkills`（默认 40）。
 * - 每个无序对统计「两技能同时为 required 的岗位数」；岗位无解析结果时退化为
 *   归一化技能集合（视作硬性要求）。
 * - `lift = ratio / (pA * pB)`（分母为 0 时取 0，绝不出 NaN/Infinity）。
 * - 只保留 `job_count >= minCount`（默认 3）的配对，按岗位数降序，最多 120 条。
 */
export const computeCooccurrence = (jobs, analyses, options = {}) => {
    const all = Array.isArray(jobs) ? jobs : [];
    const totalJobs = all.length;
    const minCount = isFiniteNumber(options.minCount) ? options.minCount : DEFAULT_COOCCURRENCE_MIN_COUNT;
    const skillLimit = isFiniteNumber(options.topSkills) ? options.topSkills : DEFAULT_COOCCURRENCE_SKILL_LIMIT;
    if (totalJobs === 0)
        return [];
    const frequencies = computeSkillFrequencies(all, analyses);
    const skillIds = frequencies.slice(0, Math.max(0, skillLimit)).map((frequency) => frequency.skill_id);
    if (skillIds.length < 2)
        return [];
    const requiredJobs = new Map();
    for (const skillId of skillIds)
        requiredJobs.set(skillId, new Set());
    for (const job of all) {
        if (job === undefined || job === null)
            continue;
        const analysis = analyses.get(job.job_id);
        const view = buildJobSkillView(job, analysis);
        const hardSkills = analysis === undefined || analysis === null ? view.present : view.required;
        for (const skillId of hardSkills) {
            requiredJobs.get(skillId)?.add(job.job_id);
        }
    }
    const pairs = [];
    for (let i = 0; i < skillIds.length; i += 1) {
        for (let j = i + 1; j < skillIds.length; j += 1) {
            const a = skillIds[i];
            const b = skillIds[j];
            if (a === undefined || b === undefined)
                continue;
            const setA = requiredJobs.get(a);
            const setB = requiredJobs.get(b);
            if (setA === undefined || setB === undefined)
                continue;
            const jobIds = intersectSorted(setA, setB);
            if (jobIds.length < minCount)
                continue;
            const ratio = ratioOf(jobIds.length, totalJobs);
            const probabilityA = ratioOf(setA.size, totalJobs);
            const probabilityB = ratioOf(setB.size, totalJobs);
            const denominator = probabilityA * probabilityB;
            const lift = denominator > 0 ? ratio / denominator : 0;
            pairs.push({
                a,
                b,
                job_count: jobIds.length,
                ratio,
                lift: Number.isFinite(lift) ? lift : 0,
                job_ids: jobIds,
            });
        }
    }
    pairs.sort((x, y) => y.job_count - x.job_count ||
        y.lift - x.lift ||
        (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) ||
        (x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
    return pairs.slice(0, COOCCURRENCE_PAIR_LIMIT);
};
/* ============================================================================
 * 四、方向拆分（需求 §八）
 * ==========================================================================*/
/** 方向展示名：显式映射优先，其次内置中文表，最后退化为分类 ID。 */
export const resolveCategoryLabel = (category, defaultCategoryLabels) => {
    const provided = defaultCategoryLabels?.get(category);
    if (provided !== undefined && provided !== '')
        return provided;
    return JOB_CATEGORY_LABELS[category] ?? category;
};
/**
 * 逐方向统计。
 *
 * 关键点（需求 §八：方向之间绝不互相污染）：
 *  - 每个方向的 `top_skills` 只在**该方向自己的岗位集合**上调用 `computeSkillFrequencies`，
 *    所以 SLAM 的 Ceres/G2O 不会漏进嵌入式方向。
 *  - `job_ratio` 的分母是**全局岗位总数**，便于横向比较方向规模。
 */
export const computeCategoryBreakdowns = (jobs, analyses, options = {}) => {
    const all = Array.isArray(jobs) ? jobs : [];
    const totalJobs = all.length;
    const topSkillsPerCategory = isFiniteNumber(options.topSkillsPerCategory)
        ? Math.max(0, options.topSkillsPerCategory)
        : DEFAULT_TOP_SKILLS_PER_CATEGORY;
    const groups = new Map();
    for (const job of all) {
        if (job === undefined || job === null)
            continue;
        const raw = normalizeWhitespace(job.job_category);
        const category = raw === '' ? 'unknown' : raw;
        const bucket = groups.get(category);
        if (bucket === undefined)
            groups.set(category, [job]);
        else
            bucket.push(job);
    }
    const breakdowns = [];
    for (const [category, categoryJobs] of groups) {
        const minValues = collectSortedSalary(categoryJobs, 'salary_min');
        const maxValues = collectSortedSalary(categoryJobs, 'salary_max');
        const breakdown = {
            category: category,
            label: resolveCategoryLabel(category, options.defaultCategoryLabels),
            job_count: categoryJobs.length,
            job_ratio: ratioOf(categoryJobs.length, totalJobs),
            top_skills: computeSkillFrequencies(categoryJobs, analyses, {
                skillNames: options.skillNames,
            }).slice(0, topSkillsPerCategory),
            job_ids: sortedUnique(categoryJobs.map((job) => job.job_id)),
        };
        if (minValues.length > 0)
            breakdown.salary_median_min = roundTo(medianOfSorted(minValues), 1);
        if (maxValues.length > 0)
            breakdown.salary_median_max = roundTo(medianOfSorted(maxValues), 1);
        breakdowns.push(breakdown);
    }
    breakdowns.sort((a, b) => b.job_count - a.job_count ||
        (String(a.category) < String(b.category) ? -1 : String(a.category) > String(b.category) ? 1 : 0));
    return breakdowns;
};
/* ============================================================================
 * 五、薪资（需求 §七）
 * ==========================================================================*/
/**
 * 薪资统计（K/月）。
 *
 * - 样本：`salary_min` 有限的岗位。
 * - `median_min` / `p25_min` / `p75_min` 基于 `salary_min` 升序数组（p25/p75 用最近秩法）。
 * - `median_max` 基于有 `salary_max` 的岗位。
 * - `coverage = 有薪资岗位数 / 岗位总数`（0 除保护 → 0）。
 */
export const computeSalaryStats = (jobs) => {
    const all = Array.isArray(jobs) ? jobs : [];
    const totalJobs = all.length;
    const minValues = collectSortedSalary(all, 'salary_min');
    const maxValues = collectSortedSalary(all, 'salary_max');
    const stats = {
        sample_count: minValues.length,
        coverage: ratioOf(minValues.length, totalJobs),
    };
    if (minValues.length > 0) {
        stats.median_min = roundTo(medianOfSorted(minValues), 1);
        stats.p25_min = roundTo(percentileOfSorted(minValues, 25), 1);
        stats.p75_min = roundTo(percentileOfSorted(minValues, 75), 1);
    }
    if (maxValues.length > 0) {
        stats.median_max = roundTo(medianOfSorted(maxValues), 1);
    }
    return stats;
};
/* ============================================================================
 * 六、经验分布（需求 §七）
 * ==========================================================================*/
/** 固定经验桶定义（顺序即输出顺序）。 */
const EXPERIENCE_BUCKETS = [
    { label: UNKNOWN_EXPERIENCE_LABEL, min: 0 },
    { label: '应届/1年以内', min: 0, max: 1 },
    { label: '1-3年', min: 1, max: 3 },
    { label: '3-5年', min: 3, max: 5 },
    { label: '5-10年', min: 5, max: 10 },
    { label: '10年以上', min: 10 },
];
/** 按经验**下限**归桶（下界闭合、上界开放）。 */
const bucketByLowerBound = (years) => years < 3 ? '1-3年' : years < 5 ? '3-5年' : years < 10 ? '5-10年' : '10年以上';
/**
 * 仅在「下限为 0 但上限明显大于 1」时改按**上限**归桶，
 * 目的是把 0-3 年这类岗位与真正的应届岗区分开（需求 §七）。
 */
const bucketByUpperBound = (years) => years <= 3 ? '1-3年' : years <= 5 ? '3-5年' : years <= 10 ? '5-10年' : '10年以上';
/** 把一个岗位归入唯一经验桶标签。 */
export const experienceBucketLabel = (job) => {
    const min = job.experience_min;
    const max = job.experience_max;
    if (!isFiniteNumber(min))
        return UNKNOWN_EXPERIENCE_LABEL;
    if (min <= 0) {
        if (!isFiniteNumber(max) || max <= 1)
            return '应届/1年以内';
        return bucketByUpperBound(max);
    }
    return bucketByLowerBound(min);
};
/**
 * 经验分布：每个岗位恰好落进一个桶；六个固定桶**始终输出**（含 0 计数），
 * 其中 `不限/未标注` 永远存在，便于前端稳定渲染。
 */
export const computeExperienceDistribution = (jobs) => {
    const all = Array.isArray(jobs) ? jobs : [];
    const totalJobs = all.length;
    const counts = new Map();
    for (const bucket of EXPERIENCE_BUCKETS)
        counts.set(bucket.label, 0);
    for (const job of all) {
        if (job === undefined || job === null)
            continue;
        const label = experienceBucketLabel(job);
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return EXPERIENCE_BUCKETS.map((bucket) => {
        const jobCount = counts.get(bucket.label) ?? 0;
        const entry = {
            label: bucket.label,
            min: bucket.min,
            job_count: jobCount,
            job_ratio: ratioOf(jobCount, totalJobs),
        };
        if (bucket.max !== undefined)
            entry.max = bucket.max;
        return entry;
    });
};
/* ============================================================================
 * 七、城市分布（需求 §七）
 * ==========================================================================*/
/**
 * 城市分布：按 `job.city` 分组（空值归入「未知」），岗位数降序，
 * 附带该城市有薪资样本时的 `salary_median_min`。
 */
export const computeCityDistribution = (jobs) => {
    const all = Array.isArray(jobs) ? jobs : [];
    const totalJobs = all.length;
    const groups = new Map();
    for (const job of all) {
        if (job === undefined || job === null)
            continue;
        const city = normalizeWhitespace(job.city);
        const key = city === '' ? UNKNOWN_CITY : city;
        const bucket = groups.get(key);
        if (bucket === undefined)
            groups.set(key, [job]);
        else
            bucket.push(job);
    }
    const buckets = [];
    for (const [city, cityJobs] of groups) {
        const minValues = collectSortedSalary(cityJobs, 'salary_min');
        const entry = {
            city,
            job_count: cityJobs.length,
            job_ratio: ratioOf(cityJobs.length, totalJobs),
        };
        if (minValues.length > 0)
            entry.salary_median_min = roundTo(medianOfSorted(minValues), 1);
        buckets.push(entry);
    }
    buckets.sort((a, b) => b.job_count - a.job_count || (a.city < b.city ? -1 : a.city > b.city ? 1 : 0));
    return buckets;
};
/* ============================================================================
 * 八、快照组装（需求 §七 / §十四）
 * ==========================================================================*/
/** 规范化过滤条件：丢掉空值/无效值，保证同一语义的过滤条件得到同一个 snapshot_id。 */
const normalizeFilter = (filter) => {
    const result = {};
    if (filter === undefined || filter === null)
        return result;
    if (isFiniteNumber(filter.recent_days) && filter.recent_days > 0)
        result.recent_days = filter.recent_days;
    if (Array.isArray(filter.cities) && filter.cities.length > 0)
        result.cities = [...filter.cities];
    if (Array.isArray(filter.categories) && filter.categories.length > 0) {
        result.categories = [...filter.categories];
    }
    if (isFiniteNumber(filter.salary_min_k))
        result.salary_min_k = filter.salary_min_k;
    if (isFiniteNumber(filter.experience_max))
        result.experience_max = filter.experience_max;
    if (Array.isArray(filter.education) && filter.education.length > 0)
        result.education = [...filter.education];
    return result;
};
/** 按 `job_id` 去重（保留首次出现），对齐快照「去重后岗位数」的口径。 */
const dedupeJobsById = (jobs) => {
    const seen = new Set();
    const result = [];
    for (const job of jobs) {
        if (job === undefined || job === null)
            continue;
        if (seen.has(job.job_id))
            continue;
        seen.add(job.job_id);
        result.push(job);
    }
    return result;
};
/**
 * 组装完整市场快照。
 *
 * - `snapshot_id = snap-<fnv1a32(taken_at + stableStringify(filter))>`：同一时刻 +
 *   同一过滤条件必定得到同一 ID（可重复、可对比、可去重）。
 * - `job_ids` 是全部参与统计的岗位 ID 全集，所有数字都能回溯到它。
 * - `analyzed_job_count` 只统计**确实存在 JD 解析结果**的过滤后岗位。
 */
export const buildMarketSnapshot = (input) => {
    const takenAtDate = input.now ?? new Date();
    const takenAt = Number.isFinite(takenAtDate.getTime())
        ? takenAtDate.toISOString()
        : new Date().toISOString();
    const filter = normalizeFilter(input.filter);
    const jobs = dedupeJobsById(filterJobs(input.jobs ?? [], filter, takenAtDate));
    const skillFrequencies = computeSkillFrequencies(jobs, input.analyses, {
        skillNames: input.skillNames,
    });
    const cooccurrence = computeCooccurrence(jobs, input.analyses, {
        minCount: input.minCooccurrenceCount,
    });
    const categories = computeCategoryBreakdowns(jobs, input.analyses, {
        topSkillsPerCategory: input.topSkillsPerCategory,
        skillNames: input.skillNames,
        defaultCategoryLabels: input.defaultCategoryLabels,
    });
    const analyzedJobCount = jobs.filter((job) => input.analyses.has(job.job_id)).length;
    return {
        snapshot_id: `snap-${fnv1a32(`${takenAt}${stableStringify(filter)}`)}`,
        taken_at: takenAt,
        filter,
        job_count: jobs.length,
        job_ids: sortedUnique(jobs.map((job) => job.job_id)),
        skill_frequencies: skillFrequencies,
        cooccurrence,
        categories,
        salary: computeSalaryStats(jobs),
        experience: computeExperienceDistribution(jobs),
        cities: computeCityDistribution(jobs),
        analyzed_job_count: analyzedJobCount,
    };
};
//# sourceMappingURL=market-analyzer.js.map