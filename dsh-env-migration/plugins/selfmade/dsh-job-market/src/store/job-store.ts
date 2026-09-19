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
import { fnv1a32, hashValue } from '../shared/hash.js';
import {
    normalizeCompanyForDedupe,
    normalizeEducation,
    normalizeJobTitleForDedupe,
    normalizeUrl,
    normalizeWhitespace,
    parseExperience,
    parseLocation,
    parseSalary,
    uniquePreserveOrder,
} from '../shared/text.js';

/** 单平台内的精确身份键：优先 URL，其次平台岗位号，最后退化到来源+公司+职位+城市。 */
export const buildPlatformKey = (input: {
    source: JobSource;
    url?: string;
    source_job_id?: string;
    company: string;
    job_title: string;
    city?: string;
}): string => {
    const url = normalizeUrl(input.url);
    if (url !== '') return `url:${url}`;
    if (input.source_job_id !== undefined && input.source_job_id.trim() !== '') {
        return `src:${input.source}:${input.source_job_id.trim()}`;
    }
    return `fallback:${input.source}:${normalizeCompanyForDedupe(input.company)}|${normalizeJobTitleForDedupe(
        input.job_title,
    )}|${normalizeWhitespace(input.city)}`;
};

/**
 * 跨平台、跨日期身份键。
 * 刻意 **不包含 source**，因此同一岗位在 BOSS 与猎聘上会被判定为同一岗位。
 */
export const buildDedupeKey = (input: { company: string; job_title: string; city?: string }): string =>
    `${normalizeCompanyForDedupe(input.company)}|${normalizeJobTitleForDedupe(input.job_title)}|${normalizeWhitespace(
        input.city,
    )}`;

/** 规范岗位 ID：`job-<fnv1a32(dedupeKey)>`（与上游同算法，便于互相核对）。 */
export const makeJobId = (dedupeKey: string): string => `job-${fnv1a32(dedupeKey)}`;

export interface CreateJobOptions {
    /** 采集批次时间。 */
    now?: Iso;
    /** 可选：从文本抽取规范技能 ID（由 SkillNormalizer 提供）。 */
    normalizeSkills?: (text: string) => string[];
}

/** 由采集/导入输入构造规范 `Job`。 */
export const createJob = (input: JobInput, options: CreateJobOptions = {}): Job => {
    const now = options.now ?? new Date().toISOString();
    const collectedAt = input.collected_at ?? now;

    const jobTitle = normalizeWhitespace(input.job_title);
    const company = normalizeWhitespace(input.company);

    const location = parseLocation(input.city ?? input.location);
    const city = normalizeWhitespace(input.city) !== '' ? normalizeWhitespace(input.city) : location.city;
    const district = normalizeWhitespace(input.district) !== '' ? normalizeWhitespace(input.district) : location.district;

    const salary = parseSalary(input.salary_text);
    const experience = parseExperience(input.experience_text);

    const requirements = uniquePreserveOrder(
        (input.requirements ?? []).map((item) => normalizeWhitespace(item)).filter((item) => item !== ''),
    );

    const dedupeKey = buildDedupeKey({ company, job_title: jobTitle, city });
    const platformKey = buildPlatformKey({
        source: input.source,
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.source_job_id === undefined ? {} : { source_job_id: input.source_job_id }),
        company,
        job_title: jobTitle,
        ...(city === undefined ? {} : { city }),
    });

    const skillText = [jobTitle, input.description ?? '', ...requirements].join('\n');
    const skillsNormalized = options.normalizeSkills === undefined ? [] : options.normalizeSkills(skillText);
    const skillsRaw = options.normalizeSkills === undefined ? [] : extractRawSkillTokens(skillText);

    const job: Job = {
        job_id: makeJobId(dedupeKey),
        source: input.source,
        sources: [input.source],
        platform_key: platformKey,
        dedupe_key: dedupeKey,
        url: normalizeUrl(input.url),
        job_title: jobTitle,
        normalized_job_title: normalizeWhitespace(jobTitle),
        job_category: 'unknown',
        company,
        requirements,
        collected_at: collectedAt,
        first_seen_at: collectedAt,
        last_seen_at: collectedAt,
        seen_count: 1,
        skills_raw: skillsRaw,
        skills_normalized: skillsNormalized,
    };

    if (input.source_job_id !== undefined && input.source_job_id.trim() !== '') {
        job.source_job_id = input.source_job_id.trim();
    }
    if (city !== undefined && city !== '') job.city = city;
    if (district !== undefined && district !== '') job.district = district;
    if (input.company_size !== undefined && input.company_size.trim() !== '') {
        job.company_size = normalizeWhitespace(input.company_size);
    }
    if (input.industry !== undefined && input.industry.trim() !== '') {
        job.industry = normalizeWhitespace(input.industry);
    }
    if (input.description !== undefined && input.description.trim() !== '') {
        job.description = input.description.trim();
    }
    if (salary.min !== undefined) job.salary_min = salary.min;
    if (salary.max !== undefined) job.salary_max = salary.max;
    if (salary.months !== undefined) job.salary_months = salary.months;
    if (salary.text !== '') job.salary_text = salary.text;
    if (experience.min !== undefined) job.experience_min = experience.min;
    if (experience.max !== undefined) job.experience_max = experience.max;
    if (experience.text !== '') job.experience_text = experience.text;
    const education = normalizeEducation(input.education);
    if (education !== '') job.education = education;
    if (input.publish_time !== undefined && input.publish_time.trim() !== '') {
        job.publish_time = input.publish_time.trim();
    }
    return job;
};

/** 从 JD 文本中抽取「原始技能写法」，仅用于展示与回溯，不参与统计。 */
const extractRawSkillTokens = (text: string): string[] => {
    const matches = text.match(/[A-Za-z][A-Za-z0-9+#.\-]{1,19}/g) ?? [];
    const chinese = text.match(/[\u4e00-\u9fa5]{2,8}(?:算法|控制|规划|框架|工具|协议|总线|系统|引擎|平台|模型)/g) ?? [];
    return uniquePreserveOrder([...matches, ...chinese].map((item) => item.trim()).filter((item) => item !== '')).slice(
        0,
        120,
    );
};

/** 合并同一岗位的两次观测。以 `existing` 为主体，只补充/刷新。 */
export const mergeJob = (existing: Job, incoming: Job, now: Iso): Job => {
    const sources = uniquePreserveOrder<JobSource>([...existing.sources, ...incoming.sources, incoming.source]);
    const merged: Job = {
        ...existing,
        sources,
        last_seen_at: maxIso(existing.last_seen_at, incoming.last_seen_at, now),
        first_seen_at: minIso(existing.first_seen_at, incoming.first_seen_at),
        seen_count: existing.seen_count + 1,
        skills_raw: uniquePreserveOrder([...existing.skills_raw, ...incoming.skills_raw]).slice(0, 200),
        skills_normalized: uniquePreserveOrder([...existing.skills_normalized, ...incoming.skills_normalized]),
        requirements: uniquePreserveOrder([...existing.requirements, ...incoming.requirements]),
    };

    // 补齐缺失字段；不覆盖已有值，避免跨平台合并时丢失首次采集的权威信息。
    fillIfMissing(merged, 'url', incoming.url);
    fillIfMissing(merged, 'source_job_id', incoming.source_job_id);
    fillIfMissing(merged, 'company_size', incoming.company_size);
    fillIfMissing(merged, 'industry', incoming.industry);
    fillIfMissing(merged, 'description', incoming.description);
    fillIfMissing(merged, 'district', incoming.district);
    fillIfMissing(merged, 'city', incoming.city);
    fillIfMissing(merged, 'salary_text', incoming.salary_text);
    fillIfMissing(merged, 'experience_text', incoming.experience_text);
    fillIfMissing(merged, 'education', incoming.education);
    fillIfMissing(merged, 'publish_time', incoming.publish_time);
    fillNumberIfMissing(merged, 'salary_min', incoming.salary_min);
    fillNumberIfMissing(merged, 'salary_max', incoming.salary_max);
    fillNumberIfMissing(merged, 'salary_months', incoming.salary_months);
    fillNumberIfMissing(merged, 'experience_min', incoming.experience_min);
    fillNumberIfMissing(merged, 'experience_max', incoming.experience_max);
    return merged;
};

const fillIfMissing = <K extends keyof Job>(target: Job, key: K, value: Job[K] | undefined): void => {
    const current = target[key];
    if (current === undefined || current === '') {
        if (value !== undefined && value !== '') {
            target[key] = value;
        }
    }
};

const fillNumberIfMissing = <K extends keyof Job>(target: Job, key: K, value: Job[K] | undefined): void => {
    if (target[key] === undefined && value !== undefined) {
        target[key] = value;
    }
};

const maxIso = (...values: Iso[]): Iso =>
    values.reduce((latest, current) => (current > latest ? current : latest), values[0] ?? '');

const minIso = (...values: Iso[]): Iso =>
    values.reduce((earliest, current) => (current < earliest ? current : earliest), values[0] ?? '');

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
export const upsertJobs = (existing: readonly Job[], incoming: readonly Job[], now?: Iso): UpsertResult => {
    const stamp = now ?? new Date().toISOString();
    const jobs = existing.map((job) => ({ ...job }));
    const byPlatform = new Map<string, number>();
    const byDedupe = new Map<string, number>();
    jobs.forEach((job, index) => {
        byPlatform.set(job.platform_key, index);
        if (!byDedupe.has(job.dedupe_key)) byDedupe.set(job.dedupe_key, index);
    });

    const newJobIds: string[] = [];
    const updatedJobIds: string[] = [];

    for (const candidate of incoming) {
        const platformIndex = byPlatform.get(candidate.platform_key);
        const dedupeIndex = platformIndex ?? byDedupe.get(candidate.dedupe_key);
        if (dedupeIndex === undefined) {
            const index = jobs.length;
            jobs.push(candidate);
            byPlatform.set(candidate.platform_key, index);
            if (!byDedupe.has(candidate.dedupe_key)) byDedupe.set(candidate.dedupe_key, index);
            newJobIds.push(candidate.job_id);
            continue;
        }
        const target = jobs[dedupeIndex];
        if (target === undefined) continue;
        jobs[dedupeIndex] = mergeJob(target, candidate, stamp);
        updatedJobIds.push(target.job_id);
    }

    return { jobs, newJobIds: uniquePreserveOrder(newJobIds), updatedJobIds: uniquePreserveOrder(updatedJobIds) };
};

/** 岗位池的持久化契约（便于测试注入内存实现）。 */
export interface JobStore {
    read(): Promise<Job[]>;
    write(jobs: readonly Job[]): Promise<void>;
}

export const JOBS_PATH = 'data/jobs.json';

/** 岗位池快速查询辅助。 */
export const indexJobsById = (jobs: readonly Job[]): Map<string, Job> =>
    new Map(jobs.map((job) => [job.job_id, job]));

export const jobsByCategory = (jobs: readonly Job[], category: string): Job[] =>
    jobs.filter((job) => job.job_category === category);

export const jobsByCity = (jobs: readonly Job[], city: string): Job[] =>
    jobs.filter((job) => normalizeWhitespace(job.city) === normalizeWhitespace(city));

/** 为便于追溯与审计，生成岗位池指纹（内容变化即变化）。 */
export const jobsFingerprint = (jobs: readonly Job[]): string =>
    hashValue(
        'jobs',
        jobs.map((job) => [job.job_id, job.last_seen_at, job.seen_count]),
    );
