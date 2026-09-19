/**
 * 文本规范化原语。
 *
 * 这些函数是岗位标准化、技能标准化与去重的共同基础，因此必须 **纯函数、可单测**。
 * 规则对齐并扩展上游 `dsh-job-hunting/dist/src/domain/job-ledger.js`：
 *  - 空白折叠：`value?.replace(/\s+/g, ' ').trim() ?? ''`
 *  - URL 规范化：清 hash、去 pathname 尾部 `/`、`searchParams.sort()`
 */
/** 全角转半角（含全角空格 U+3000）。 */
export declare const toHalfWidth: (value: string) => string;
/** 折叠空白并去首尾空格。 */
export declare const normalizeWhitespace: (value: string | undefined | null) => string;
/** 规范化文本，可选大小写折叠。用于匹配与去重键。 */
export declare const normalizeText: (value: string | undefined | null, options?: {
    lower?: boolean;
}) => string;
/** 查找键：折叠大小写并去掉全部空白与常见标点。 */
export declare const normalizeLookupKey: (value: string | undefined | null) => string;
/** 保序去重。 */
export declare const uniquePreserveOrder: <T>(values: readonly T[]) => T[];
/** 限制到闭区间。 */
export declare const clamp: (value: number, min: number, max: number) => number;
/** 保留小数位。 */
export declare const roundTo: (value: number, digits?: number) => number;
export declare const normalizeUrl: (value: string | undefined | null) => string;
/** 取 URL 主机名（小写）。非法 URL 返回空串。 */
export declare const urlHostname: (value: string) => string;
/**
 * 公司名归一化，用于跨平台去重。
 * 去掉分支机构括号（如「（上海）」）与常见公司后缀，使
 * 「XX科技有限公司」与「XX科技」判定为同一家。
 */
export declare const normalizeCompanyForDedupe: (value: string | undefined | null) => string;
/**
 * 职位名归一化，用于跨平台去重。
 * 例如「高级机器人软件工程师（ROS2）」与「机器人软件工程师」→ 同一个键。
 */
export declare const normalizeJobTitleForDedupe: (value: string | undefined | null) => string;
export interface ParsedLocation {
    city?: string;
    district?: string;
    raw: string;
}
/**
 * 拆分地点字符串。
 * 支持「上海·浦东新区」「北京-海淀区」「深圳 南山区」「上海浦东新区」等写法。
 */
export declare const parseLocation: (value: string | undefined | null) => ParsedLocation;
export interface ParsedSalary {
    /** K/月（千元人民币每月）。 */
    min?: number;
    max?: number;
    /** 薪资月数，如 13。 */
    months?: number;
    /** 原始文本，始终保留以便回溯。 */
    text: string;
}
/**
 * 解析薪资文本为 K/月。
 *
 * 覆盖：`15-25K`、`15-25K·13薪`、`1.5-2.5万`、`25-45万/年`、
 * `8千-1.2万`、`600元/天`、`15K以上`、`面议`。
 */
export declare const parseSalary: (value: string | undefined | null) => ParsedSalary;
export interface ParsedExperience {
    /** 年。 */
    min?: number;
    max?: number;
    text: string;
}
/**
 * 解析经验要求文本为年数区间。
 * 覆盖：`3-5年`、`3年以上`、`1年以内`、`经验不限`、`应届生`。
 */
export declare const parseExperience: (value: string | undefined | null) => ParsedExperience;
/** 学历规范名（按需求从低到高）。 */
export type EducationLevel = '不限' | '高中' | '中专/中技' | '大专' | '本科' | '硕士' | '博士';
/** 归一化学历要求（取文中出现的最高学历）。 */
export declare const normalizeEducation: (value: string | undefined | null) => string;
