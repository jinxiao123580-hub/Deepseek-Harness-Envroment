/**
 * 本地岗位导入适配器。
 *
 * 为什么必须有这条路：BrowserSkill（腾讯 `bsk`）是外部 CLI + 浏览器扩展，
 * 不是 npm 依赖，机器上没装时自动采集不可用。需求 §十九 的 MVP 验收依赖自动采集，
 * 但**采集通道不能是唯一入口** —— 用户手动导出的 JSON / CSV / Markdown
 * 必须能进入同一个岗位池，并走完全相同的去重 / 分类 / 解析 / 统计流程。
 *
 * 支持格式：
 *  - `.json`：`JobInput[]`，或 `{ jobs: JobInput[] }`，或单个对象
 *  - `.csv` ：首行表头，支持中英文列名，支持双引号包裹与字段内逗号
 *  - `.md`  ：`## 岗位标题` 分块，块内 `键：值` 行，其余文本作为描述
 */

import type { JobInput, JobSource } from '../shared/types.js';
import {
    normalizeEducation,
    normalizeWhitespace,
    parseExperience,
    parseLocation,
    parseSalary,
} from '../shared/text.js';

export type ImportFormat = 'json' | 'csv' | 'markdown';

export const detectFormat = (path: string): ImportFormat => {
    const lower = path.toLowerCase();
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.csv')) return 'csv';
    if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return 'markdown';
    return 'json';
};

const KNOWN_SOURCES: readonly JobSource[] = ['boss', 'liepin', 'zhaopin', '51job', 'iguopin', 'local', 'manual'];

const toSource = (value: string | undefined): JobSource => {
    const normalized = (value ?? '').trim().toLowerCase();
    if (normalized === '') return 'local';
    const aliases: Record<string, JobSource> = {
        boss: 'boss',
        boss直聘: 'boss',
        zhipin: 'boss',
        'boss直聘（zhipin）': 'boss',
        liepin: 'liepin',
        猎聘: 'liepin',
        zhaopin: 'zhaopin',
        智联: 'zhaopin',
        智联招聘: 'zhaopin',
        '51job': '51job',
        前程无忧: '51job',
        iguopin: 'iguopin',
        国聘: 'iguopin',
        local: 'local',
        manual: 'manual',
    };
    return aliases[normalized] ?? (KNOWN_SOURCES.includes(normalized as JobSource) ? (normalized as JobSource) : 'local');
};

/** 中英文列名 → 标准字段。 */
const COLUMN_ALIASES: Record<string, string> = {
    岗位: 'job_title',
    岗位名称: 'job_title',
    职位: 'job_title',
    职位名称: 'job_title',
    标题: 'job_title',
    title: 'job_title',
    job_title: 'job_title',
    公司: 'company',
    公司名称: 'company',
    company: 'company',
    城市: 'city',
    地点: 'city',
    工作地点: 'city',
    city: 'city',
    区: 'district',
    区域: 'district',
    district: 'district',
    薪资: 'salary_text',
    薪水: 'salary_text',
    月薪: 'salary_text',
    salary: 'salary_text',
    salary_text: 'salary_text',
    经验: 'experience_text',
    工作经验: 'experience_text',
    experience: 'experience_text',
    experience_text: 'experience_text',
    学历: 'education',
    学历要求: 'education',
    education: 'education',
    链接: 'url',
    网址: 'url',
    详情链接: 'url',
    url: 'url',
    link: 'url',
    来源: 'source',
    平台: 'source',
    source: 'source',
    发布时间: 'publish_time',
    日期: 'publish_time',
    publish_time: 'publish_time',
    描述: 'description',
    岗位描述: 'description',
    职位描述: 'description',
    description: 'description',
    要求: 'requirements',
    任职要求: 'requirements',
    岗位要求: 'requirements',
    requirements: 'requirements',
    行业: 'industry',
    industry: 'industry',
    公司规模: 'company_size',
    规模: 'company_size',
    company_size: 'company_size',
    source_job_id: 'source_job_id',
    岗位id: 'source_job_id',
};

const normalizeColumn = (raw: string): string | undefined => {
    const key = normalizeWhitespace(raw).toLowerCase().replace(/[\s_*-]/g, '');
    if (key === '') return undefined;
    for (const [alias, field] of Object.entries(COLUMN_ALIASES)) {
        if (alias.toLowerCase().replace(/[\s_*-]/g, '') === key) return field;
    }
    return undefined;
};

/** 把一行「键值对 + 长文本」的松散记录组装成 JobInput。 */
const assemble = (raw: Record<string, string>, fallbackSource: JobSource, index: number): JobInput | undefined => {
    const jobTitle = normalizeWhitespace(raw.job_title ?? '');
    const company = normalizeWhitespace(raw.company ?? '');
    if (jobTitle === '' || company === '') return undefined;

    const location = parseLocation(raw.city === undefined ? '' : `${raw.city} ${raw.district ?? ''}`);
    const salary = parseSalary(raw.salary_text ?? '');
    const experience = parseExperience(raw.experience_text ?? '');
    const description = normalizeWhitespace(raw.description ?? '');
    const requirementsText = raw.requirements ?? '';
    const requirements = requirementsText
        .split(/\r?\n|[；;]|(?<=。)/)
        .map((part) => normalizeWhitespace(part))
        .filter((part) => part !== '');

    const input: JobInput = {
        source: raw.source === undefined ? fallbackSource : toSource(raw.source),
        job_title: jobTitle,
        company,
        url: normalizeWhitespace(raw.url ?? ''),
        description,
        requirements,
        source_job_id: normalizeWhitespace(raw.source_job_id ?? '') || `local-${index + 1}`,
    };
    if (location.raw !== '') input.location = location.raw;
    if (location.city !== undefined) input.city = location.city;
    if (location.district !== undefined) input.district = location.district;
    // 只透传原文：数值统一由 JobStore.createJob 里的 parseSalary / parseExperience 解析，
    // 保证「导入」与「采集」两条入口的薪资/经验口径完全一致。
    if (salary.text !== '') input.salary_text = salary.text;
    if (experience.text !== '') input.experience_text = experience.text;
    const education = normalizeEducation(raw.education ?? '');
    if (education !== undefined) input.education = education;
    if (raw.industry !== undefined && raw.industry !== '') input.industry = normalizeWhitespace(raw.industry);
    if (raw.company_size !== undefined && raw.company_size !== '')
        input.company_size = normalizeWhitespace(raw.company_size);
    if (raw.publish_time !== undefined && raw.publish_time !== '')
        input.publish_time = normalizeWhitespace(raw.publish_time);
    return input;
};

/** 解析 JSON 内容。 */
export const parseJsonJobs = (content: string, fallbackSource: JobSource = 'local'): JobInput[] => {
    const parsed: unknown = JSON.parse(content);
    const list: unknown[] = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { jobs?: unknown }).jobs)
          ? ((parsed as { jobs: unknown[] }).jobs)
          : [parsed];

    const results: JobInput[] = [];
    list.forEach((item, index) => {
        if (typeof item !== 'object' || item === null) return;
        const record = item as Record<string, unknown>;
        const raw: Record<string, string> = {};
        for (const [key, value] of Object.entries(record)) {
            const field = normalizeColumn(key);
            if (field === undefined) continue;
            if (value === null || value === undefined) continue;
            raw[field] = Array.isArray(value) ? value.map(String).join('\n') : String(value);
        }
        // JSON 里若给了结构化数值字段而没有可读文本，就合成一段原文，
        // 统一交给 JobStore 里的 parseSalary / parseExperience 归一化——
        // 数值只在一个地方解析，避免两条口径漂移。
        const numericText = (minKey: string, maxKey: string, unit: string): string | undefined => {
            const min = record[minKey];
            const max = record[maxKey];
            const minOk = typeof min === 'number' && Number.isFinite(min);
            const maxOk = typeof max === 'number' && Number.isFinite(max);
            if (minOk && maxOk) return `${min}-${max}${unit}`;
            if (minOk) return `${min}${unit}以上`;
            if (maxOk) return `${max}${unit}以下`;
            return undefined;
        };
        if (raw.salary_text === undefined || raw.salary_text === '') {
            const synthesized = numericText('salary_min', 'salary_max', 'K');
            if (synthesized !== undefined) raw.salary_text = synthesized;
        }
        if (raw.experience_text === undefined || raw.experience_text === '') {
            const synthesized = numericText('experience_min', 'experience_max', '年');
            if (synthesized !== undefined) raw.experience_text = synthesized;
        }
        const input = assemble(raw, toSource(typeof record.source === 'string' ? record.source : undefined), index);
        if (input === undefined) return;
        results.push(input);
    });
    return results;
};

/** 解析 CSV 的一行（支持双引号包裹与转义的双引号）。 */
const parseCsvLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (inQuotes) {
            if (char === '"') {
                if (line[index + 1] === '"') {
                    current += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);
    return fields;
};

/** 解析 CSV 内容。 */
export const parseCsvJobs = (content: string, fallbackSource: JobSource = 'local'): JobInput[] => {
    const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
    const headerLine = lines[0];
    if (headerLine === undefined) return [];
    const headers = parseCsvLine(headerLine).map((header) => normalizeColumn(header));
    const results: JobInput[] = [];
    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line === undefined) continue;
        const cells = parseCsvLine(line);
        const raw: Record<string, string> = {};
        headers.forEach((field, column) => {
            if (field === undefined) return;
            raw[field] = cells[column] ?? '';
        });
        const input = assemble(raw, fallbackSource, index - 1);
        if (input !== undefined) results.push(input);
    }
    return results;
};

/** 解析 Markdown 内容：`## 标题` 分块 + 块内 `键：值`。 */
export const parseMarkdownJobs = (content: string, fallbackSource: JobSource = 'local'): JobInput[] => {
    const results: JobInput[] = [];
    const blocks = content.split(/\r?\n(?=#{2,3}\s)/);
    blocks.forEach((block, index) => {
        const lines = block.split(/\r?\n/);
        const heading = lines[0]?.match(/^#{2,3}\s+(.*)$/);
        if (heading === null || heading === undefined) return;
        const raw: Record<string, string> = { job_title: normalizeWhitespace(heading[1] ?? '') };
        const bodyLines: string[] = [];
        for (const line of lines.slice(1)) {
            const match = line.match(/^\s*[-*]?\s*([^：:]{1,12})\s*[：:]\s*(.*)$/);
            if (match === null) {
                if (line.trim() !== '') bodyLines.push(line.trim());
                continue;
            }
            const field = normalizeColumn(match[1] ?? '');
            if (field === undefined) {
                bodyLines.push(line.trim());
                continue;
            }
            raw[field] = raw[field] === undefined ? (match[2] ?? '') : `${raw[field]}\n${match[2] ?? ''}`;
        }
        raw.description = [raw.description ?? '', ...bodyLines].filter((part) => part !== '').join('\n');
        const input = assemble(raw, fallbackSource, index);
        if (input !== undefined) results.push(input);
    });
    return results;
};

/** 按格式解析岗位文本。 */
export const parseJobContent = (
    content: string,
    format: ImportFormat,
    fallbackSource: JobSource = 'local',
): JobInput[] => {
    if (format === 'csv') return parseCsvJobs(content, fallbackSource);
    if (format === 'markdown') return parseMarkdownJobs(content, fallbackSource);
    return parseJsonJobs(content, fallbackSource);
};
