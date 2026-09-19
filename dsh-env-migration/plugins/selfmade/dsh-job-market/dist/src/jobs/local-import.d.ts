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
export type ImportFormat = 'json' | 'csv' | 'markdown';
export declare const detectFormat: (path: string) => ImportFormat;
/** 解析 JSON 内容。 */
export declare const parseJsonJobs: (content: string, fallbackSource?: JobSource) => JobInput[];
/** 解析 CSV 内容。 */
export declare const parseCsvJobs: (content: string, fallbackSource?: JobSource) => JobInput[];
/** 解析 Markdown 内容：`## 标题` 分块 + 块内 `键：值`。 */
export declare const parseMarkdownJobs: (content: string, fallbackSource?: JobSource) => JobInput[];
/** 按格式解析岗位文本。 */
export declare const parseJobContent: (content: string, format: ImportFormat, fallbackSource?: JobSource) => JobInput[];
