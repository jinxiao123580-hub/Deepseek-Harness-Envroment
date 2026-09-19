/**
 * JD 解析缓存（需求 §十七：LLM 成本控制）。
 *
 * 缓存键 = jd_hash + analysis_version + prompt_version。
 *  - JD 文本没变 → 不重复分析
 *  - 解析规则升级（analysis_version）→ 自动全部失效并重算
 *  - 提示词升级（prompt_version）→ 同样失效
 *
 * 这是「JD 未变不重复分析」这条硬性要求的落地点。
 */
import { hashValue } from '../shared/hash.js';
import { normalizeText } from '../shared/text.js';
export const JD_CACHE_PATH = 'data/jd-cache.json';
export const JD_CACHE_SCHEMA_VERSION = 1;
export const emptyJdCache = () => ({
    version: JD_CACHE_SCHEMA_VERSION,
    entries: {},
    updated_at: new Date(0).toISOString(),
});
/**
 * 岗位身份哈希。
 * 用途：把缓存条目绑到具体岗位身份上（同一 jd_hash 出现在不同公司时仍可区分）。
 */
export const computeJobHash = (job) => hashValue('jd-job', [job.job_id, job.company, job.job_title]);
/** 组装用于解析的规范 JD 文本（岗位标题 + 描述 + 要求）。 */
export const jdTextOf = (job) => normalizeText([job.job_title, job.description ?? '', ...job.requirements].filter((part) => part !== '').join('\n'));
/** 归一化 JD 文本的哈希。JD 文本未变则哈希不变 → 命中缓存。 */
export const computeJdHash = (job) => hashValue('jd-text', jdTextOf(job));
/** 组装缓存键。 */
export const cacheKey = (input) => `${input.jobHash}:${input.jdHash}:a${input.analysisVersion}:p${input.promptVersion}`;
/** 从缓存读取仍有效的分析结果。版本不匹配或 JD 变更时返回 undefined（= 需要重算）。 */
export const readCachedAnalysis = (cache, input) => {
    if (cache.version !== JD_CACHE_SCHEMA_VERSION)
        return undefined;
    const jobHash = computeJobHash(input.job);
    const jdHash = computeJdHash(input.job);
    const key = cacheKey({
        jobHash,
        jdHash,
        analysisVersion: input.analysisVersion,
        promptVersion: input.promptVersion,
    });
    const entry = cache.entries[key];
    if (entry === undefined)
        return undefined;
    // 双保险：即使键对上了，也再核对一次 JD 哈希与版本，避免人为改坏缓存文件后误命中。
    if (entry.jd_hash !== jdHash)
        return undefined;
    if (entry.analysis_version !== input.analysisVersion)
        return undefined;
    if (entry.prompt_version !== input.promptVersion)
        return undefined;
    return entry.analysis;
};
/** 把一次分析结果写回缓存（不可变：返回新对象）。 */
export const writeCachedAnalysis = (cache, input) => {
    const jobHash = computeJobHash(input.job);
    const jdHash = computeJdHash(input.job);
    const key = cacheKey({
        jobHash,
        jdHash,
        analysisVersion: input.analysis.analysis_version,
        promptVersion: input.analysis.prompt_version,
    });
    const entry = {
        jd_hash: jdHash,
        job_hash: jobHash,
        analysis_version: input.analysis.analysis_version,
        prompt_version: input.analysis.prompt_version,
        analysis: input.analysis,
        created_at: input.now,
    };
    return {
        version: JD_CACHE_SCHEMA_VERSION,
        entries: { ...cache.entries, [key]: entry },
        updated_at: input.now,
    };
};
/**
 * 清理失效条目：版本不匹配的一律丢弃，避免缓存无限膨胀。
 * 同时提供 maxEntries 上限（默认 20000），超出时保留最近写入的条目。
 */
export const pruneJdCache = (cache, input) => {
    const maxEntries = input.maxEntries ?? 20_000;
    const kept = [];
    for (const [key, entry] of Object.entries(cache.entries)) {
        if (entry.analysis_version !== input.analysisVersion)
            continue;
        if (entry.prompt_version !== input.promptVersion)
            continue;
        kept.push([key, entry]);
    }
    if (kept.length <= maxEntries) {
        const entries = {};
        for (const [key, entry] of kept)
            entries[key] = entry;
        return { version: JD_CACHE_SCHEMA_VERSION, entries, updated_at: cache.updated_at };
    }
    kept.sort((a, b) => (a[1].created_at < b[1].created_at ? 1 : a[1].created_at > b[1].created_at ? -1 : 0));
    const entries = {};
    for (const [key, entry] of kept.slice(0, maxEntries))
        entries[key] = entry;
    return { version: JD_CACHE_SCHEMA_VERSION, entries, updated_at: cache.updated_at };
};
/** 缓存统计（供 status 工具做成本可见性）。 */
export const cacheStats = (cache) => {
    const all = Object.values(cache.entries);
    // 缓存文件在写入前已由 pruneJdCache 过滤，故文件内条目默认全部有效；
    // 精确的版本有效性请用 cacheStatsByVersion。
    return {
        total: all.length,
        eligible: all.length,
        stale: 0,
        llmCallsTotal: all.reduce((total, entry) => total + (entry.analysis.llm_calls ?? 0), 0),
    };
};
/** 按版本统计（更细的审计视图）。 */
export const cacheStatsByVersion = (cache, input) => {
    const all = Object.values(cache.entries);
    const current = all.filter((entry) => entry.analysis_version === input.analysisVersion && entry.prompt_version === input.promptVersion);
    return {
        total: all.length,
        eligible: current.length,
        stale: all.length - current.length,
        llmCallsTotal: all.reduce((total, entry) => total + (entry.analysis.llm_calls ?? 0), 0),
    };
};
//# sourceMappingURL=jd-cache.js.map