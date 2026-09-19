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
import type { Iso, JdAnalysis, JdCacheEntry, Job } from '../shared/types.js';
export declare const JD_CACHE_PATH = "data/jd-cache.json";
export declare const JD_CACHE_SCHEMA_VERSION = 1;
export interface JdCacheFile {
    version: number;
    entries: Record<string, JdCacheEntry>;
    updated_at: Iso;
}
export interface JdCacheStats {
    /** 缓存条目总数。 */
    total: number;
    /** 当前 analysis_version 下仍有效的条目数。 */
    eligible: number;
    /** 因版本不匹配而失效的条目数。 */
    stale: number;
    /** 命中的模型调用次数合计（用于成本审计）。 */
    llmCallsTotal: number;
}
export declare const emptyJdCache: () => JdCacheFile;
/**
 * 岗位身份哈希。
 * 用途：把缓存条目绑到具体岗位身份上（同一 jd_hash 出现在不同公司时仍可区分）。
 */
export declare const computeJobHash: (job: Job) => string;
/** 组装用于解析的规范 JD 文本（岗位标题 + 描述 + 要求）。 */
export declare const jdTextOf: (job: Job) => string;
/** 归一化 JD 文本的哈希。JD 文本未变则哈希不变 → 命中缓存。 */
export declare const computeJdHash: (job: Job) => string;
/** 组装缓存键。 */
export declare const cacheKey: (input: {
    jobHash: string;
    jdHash: string;
    analysisVersion: number;
    promptVersion: number;
}) => string;
/** 从缓存读取仍有效的分析结果。版本不匹配或 JD 变更时返回 undefined（= 需要重算）。 */
export declare const readCachedAnalysis: (cache: JdCacheFile, input: {
    job: Job;
    analysisVersion: number;
    promptVersion: number;
}) => JdAnalysis | undefined;
/** 把一次分析结果写回缓存（不可变：返回新对象）。 */
export declare const writeCachedAnalysis: (cache: JdCacheFile, input: {
    job: Job;
    analysis: JdAnalysis;
    now: Iso;
}) => JdCacheFile;
/**
 * 清理失效条目：版本不匹配的一律丢弃，避免缓存无限膨胀。
 * 同时提供 maxEntries 上限（默认 20000），超出时保留最近写入的条目。
 */
export declare const pruneJdCache: (cache: JdCacheFile, input: {
    analysisVersion: number;
    promptVersion: number;
    maxEntries?: number;
}) => JdCacheFile;
/** 缓存统计（供 status 工具做成本可见性）。 */
export declare const cacheStats: (cache: JdCacheFile) => JdCacheStats;
/** 按版本统计（更细的审计视图）。 */
export declare const cacheStatsByVersion: (cache: JdCacheFile, input: {
    analysisVersion: number;
    promptVersion: number;
}) => JdCacheStats;
