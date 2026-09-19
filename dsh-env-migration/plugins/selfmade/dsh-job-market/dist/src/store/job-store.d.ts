/**
 * 岗位存储与去重（需求 §三）。
 *
 * 关键语义（上游 `dedupeJobs` 缺失的部分）：
 *  - **跨平台、跨日期去重**：`dedupe_key` = 规范化(公司) + 规范化(职位) + 城市，**不含来源平台**
 *  - 同一岗位重复出现时 **只更新 `last_seen_at` 并累加 `seen_count`**，绝不作为新岗位计数
 *  - 跨平台命中时把新平台并入 `sources`，保留首次采集的 `job_id`
 *  - 两套键：`platform_key`（同平台精确身份）与 `dedupe_key`（跨平台身份）
 */
import type { Iso, Job, JobInput, JobSource } from '../shared/types.js';
/** 单平台内的精确身份键：优先 URL，其次平台岗位号，最后退化到来源+公司+职位+城市。 */
export declare const buildPlatformKey: (input: {
    source: JobSource;
    url?: string;
    source_job_id?: string;
    company: string;
    job_title: string;
    city?: string;
}) => string;
/**
 * 跨平台、跨日期身份键。
 * 刻意 **不包含 source**，因此同一岗位在 BOSS 与猎聘上会被判定为同一岗位。
 */
export declare const buildDedupeKey: (input: {
    company: string;
    job_title: string;
    city?: string;
}) => string;
/** 规范岗位 ID：`job-<fnv1a32(dedupeKey)>`（与上游同算法，便于互相核对）。 */
export declare const makeJobId: (dedupeKey: string) => string;
export interface CreateJobOptions {
    /** 采集批次时间。 */
    now?: Iso;
    /** 可选：从文本抽取规范技能 ID（由 SkillNormalizer 提供）。 */
    normalizeSkills?: (text: string) => string[];
}
/** 由采集/导入输入构造规范 `Job`。 */
export declare const createJob: (input: JobInput, options?: CreateJobOptions) => Job;
/** 合并同一岗位的两次观测。以 `existing` 为主体，只补充/刷新。 */
export declare const mergeJob: (existing: Job, incoming: Job, now: Iso) => Job;
export interface UpsertResult {
    /** 合并后的完整岗位池。 */
    jobs: Job[];
    /** 本轮首次出现的岗位 ID。 */
    newJobIds: string[];
    /** 本轮重复出现、仅刷新了 last_seen_at 的岗位 ID。 */
    updatedJobIds: string[];
}
/**
 * 增量合并岗位池。
 *
 * 先按 `platform_key` 命中（同平台同一岗位），再按 `dedupe_key` 命中（跨平台同一岗位）；
 * 都不命中才算新岗位。因此：
 *  - 跨平台重复 → 不新增计数
 *  - 跨日期重复 → 不新增计数，只更新 `last_seen_at`
 */
export declare const upsertJobs: (existing: readonly Job[], incoming: readonly Job[], now?: Iso) => UpsertResult;
/** 岗位池的持久化契约（便于测试注入内存实现）。 */
export interface JobStore {
    read(): Promise<Job[]>;
    write(jobs: readonly Job[]): Promise<void>;
}
export declare const JOBS_PATH = "data/jobs.json";
/** 岗位池快速查询辅助。 */
export declare const indexJobsById: (jobs: readonly Job[]) => Map<string, Job>;
export declare const jobsByCategory: (jobs: readonly Job[], category: string) => Job[];
export declare const jobsByCity: (jobs: readonly Job[], city: string) => Job[];
/** 为便于追溯与审计，生成岗位池指纹（内容变化即变化）。 */
export declare const jobsFingerprint: (jobs: readonly Job[]) => string;
