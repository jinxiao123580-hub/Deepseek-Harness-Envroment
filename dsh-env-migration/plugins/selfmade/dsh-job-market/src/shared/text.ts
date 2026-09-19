/**
 * 文本规范化原语。
 *
 * 这些函数是岗位标准化、技能标准化与去重的共同基础，因此必须 **纯函数、可单测**。
 * 规则对齐并扩展上游 `dsh-job-hunting/dist/src/domain/job-ledger.js`：
 *  - 空白折叠：`value?.replace(/\s+/g, ' ').trim() ?? ''`
 *  - URL 规范化：清 hash、去 pathname 尾部 `/`、`searchParams.sort()`
 */

/** 全角转半角（含全角空格 U+3000）。 */
export const toHalfWidth = (value: string): string =>
    value
        .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/\u3000/g, ' ');

/** 折叠空白并去首尾空格。 */
export const normalizeWhitespace = (value: string | undefined | null): string =>
    value?.replace(/\s+/g, ' ').trim() ?? '';

/** 规范化文本，可选大小写折叠。用于匹配与去重键。 */
export const normalizeText = (value: string | undefined | null, options: { lower?: boolean } = {}): string => {
    const normalized = normalizeWhitespace(toHalfWidth(value ?? ''));
    return options.lower === false ? normalized : normalized.toLowerCase();
};

/** 查找键：折叠大小写并去掉全部空白与常见标点。 */
export const normalizeLookupKey = (value: string | undefined | null): string =>
    normalizeText(value)
        .replace(/[\s\u00b7\-—_/\\|,，.。;；:：!！?？"'“”‘’`~^*+#&@$%()（）[\]【】{}<>《》]/g, '')
        .trim();

/** 保序去重。 */
export const uniquePreserveOrder = <T>(values: readonly T[]): T[] => {
    const seen = new Set<T>();
    const result: T[] = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
};

/** 限制到闭区间。 */
export const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

/** 保留小数位。 */
export const roundTo = (value: number, digits = 1): number => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

/* ============================================================================
 * URL 规范化（对齐上游 job-ledger.normalizeUrl）
 * ==========================================================================*/

export const normalizeUrl = (value: string | undefined | null): string => {
    const normalized = normalizeWhitespace(toHalfWidth(value ?? ''));
    if (normalized === '') return '';
    try {
        const url = new URL(normalized);
        url.hash = '';
        if (url.pathname.length > 1) {
            url.pathname = url.pathname.replace(/\/+$/, '');
        }
        url.searchParams.sort();
        return url.toString();
    } catch {
        return normalized;
    }
};

/** 取 URL 主机名（小写）。非法 URL 返回空串。 */
export const urlHostname = (value: string): string => {
    try {
        return new URL(value).hostname.trim().toLowerCase();
    } catch {
        return '';
    }
};

/* ============================================================================
 * 公司 / 职位名规范化（用于跨平台去重）
 * ==========================================================================*/

const COMPANY_BRANCH_PATTERN = /[（(][^）)]{1,6}[）)]/g;
const COMPANY_SUFFIX_PATTERN =
    /(股份有限公司|有限责任公司|有限公司|科技有限公司|网络科技|信息技术|企业管理|人力资源|分公司|公司|集团|科技|实业|商贸)$/g;

/**
 * 公司名归一化，用于跨平台去重。
 * 去掉分支机构括号（如「（上海）」）与常见公司后缀，使
 * 「XX科技有限公司」与「XX科技」判定为同一家。
 */
export const normalizeCompanyForDedupe = (value: string | undefined | null): string => {
    let key = normalizeText(value).replace(COMPANY_BRANCH_PATTERN, '');
    key = key.replace(/[\s\u00b7\-—_/\\|,，.。;；:：]/g, '');
    // 反复剥离后缀，处理「XX科技有限公司」这类叠加后缀。
    for (let index = 0; index < 4; index += 1) {
        const next = key.replace(COMPANY_SUFFIX_PATTERN, '');
        if (next === key) break;
        key = next;
    }
    return key;
};

const TITLE_NOISE_PATTERN =
    /(高级|资深|初级|中级|专家|首席|急招|急聘|诚聘|招聘|双休|五险一金|包吃|包住|包住宿|提供住宿|周末双休|base|职位|岗位|全职|兼职|长期|短期|储备|管培生?)/g;

/**
 * 职位名归一化，用于跨平台去重。
 * 例如「高级机器人软件工程师（ROS2）」与「机器人软件工程师」→ 同一个键。
 */
export const normalizeJobTitleForDedupe = (value: string | undefined | null): string => {
    let key = normalizeText(value).replace(/[（(][^）)]*[）)]/g, '');
    key = key.replace(TITLE_NOISE_PATTERN, '');
    return key.replace(/[\s\u00b7\-—_/\\|,，.。;；:：!！?？"'“”‘’`~^*+#&@$%()（）[\]【】{}<>《》]/g, '');
};

/* ============================================================================
 * 地点拆分
 * ==========================================================================*/

const MAJOR_CITIES = [
    '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '武汉', '西安',
    '天津', '重庆', '长沙', '郑州', '青岛', '合肥', '宁波', '东莞', '佛山', '无锡',
    '厦门', '福州', '济南', '大连', '沈阳', '哈尔滨', '长春', '昆明', '南昌', '贵阳',
    '南宁', '太原', '石家庄', '兰州', '银川', '西宁', '乌鲁木齐', '呼和浩特', '海口',
    '珠海', '中山', '惠州', '温州', '嘉兴', '常州', '南通', '徐州', '烟台', '潍坊',
    '泉州', '绍兴', '台州', '金华', '保定', '洛阳', '香港', '澳门', '台北',
];

export interface ParsedLocation {
    city?: string;
    district?: string;
    raw: string;
}

/**
 * 拆分地点字符串。
 * 支持「上海·浦东新区」「北京-海淀区」「深圳 南山区」「上海浦东新区」等写法。
 */
export const parseLocation = (value: string | undefined | null): ParsedLocation => {
    const raw = normalizeWhitespace(toHalfWidth(value ?? ''));
    if (raw === '') return { raw };

    const parts = raw
        .split(/[\u00b7\u2022\u30fb\-\u2014\u2013/\\|,，]/)
        .map((part) => normalizeWhitespace(part))
        .filter((part) => part !== '');

    if (parts.length >= 2) {
        const city = stripCitySuffix(parts[0] ?? '');
        const district = parts.slice(1).join(' ');
        return district === '' ? { city, raw } : { city, district, raw };
    }

    const single = raw;
    const matchedCity = MAJOR_CITIES.find((city) => single.startsWith(city));
    if (matchedCity !== undefined) {
        const district = normalizeWhitespace(single.slice(matchedCity.length));
        return district === '' ? { city: matchedCity, raw } : { city: matchedCity, district, raw };
    }
    return { city: stripCitySuffix(single), raw };
};

const stripCitySuffix = (value: string): string => {
    const trimmed = normalizeWhitespace(value);
    return trimmed.endsWith('市') ? trimmed.slice(0, -1) : trimmed;
};

/* ============================================================================
 * 薪资解析
 * ==========================================================================*/

export interface ParsedSalary {
    /** K/月（千元人民币每月）。 */
    min?: number;
    max?: number;
    /** 薪资月数，如 13。 */
    months?: number;
    /** 原始文本，始终保留以便回溯。 */
    text: string;
}

const SALARY_NA_PATTERN = /(面议|薪资面议|待遇面议|negotiable|保密)/i;
const ANNUAL_PATTERN = /(\/\s*年|年薪|年\s*薪|per\s*year)/i;
const DAILY_PATTERN = /(\/\s*天|元\s*\/\s*天|日薪|per\s*day)/i;
const MONTHS_PATTERN = /(\d{1,2})\s*薪/;
const NUMBER_WITH_UNIT_PATTERN = /(\d+(?:\.\d+)?)\s*(万|千|k|K|元)?/g;

/** 每月按 21.75 个工作日折算日薪。 */
const WORKDAYS_PER_MONTH = 21.75;

/**
 * 解析薪资文本为 K/月。
 *
 * 覆盖：`15-25K`、`15-25K·13薪`、`1.5-2.5万`、`25-45万/年`、
 * `8千-1.2万`、`600元/天`、`15K以上`、`面议`。
 */
export const parseSalary = (value: string | undefined | null): ParsedSalary => {
    const text = normalizeWhitespace(toHalfWidth(value ?? ''));
    if (text === '' || SALARY_NA_PATTERN.test(text)) {
        return { text };
    }

    const monthsMatch = MONTHS_PATTERN.exec(text);
    const months = monthsMatch?.[1] !== undefined ? Number.parseInt(monthsMatch[1], 10) : undefined;

    // 移除「N薪」以免其数字被误当作薪资数值。
    const scrubbed = text.replace(/(\d{1,2})\s*薪/g, ' ');

    const isAnnual = ANNUAL_PATTERN.test(scrubbed);
    const isDaily = DAILY_PATTERN.test(scrubbed);

    const tokens: { value: number; unit?: string }[] = [];
    const matcher = new RegExp(NUMBER_WITH_UNIT_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(scrubbed)) !== null) {
        const numeric = Number.parseFloat(match[1] ?? '');
        if (!Number.isFinite(numeric)) continue;
        const unit = match[2];
        tokens.push(unit === undefined ? { value: numeric } : { value: numeric, unit });
    }
    if (tokens.length === 0) {
        return months === undefined ? { text } : { months, text };
    }

    // 无单位数字继承串中首个显式单位（「1.5-2.5万」→ 两者都按万）。
    const globalUnit = tokens.find((token) => token.unit !== undefined)?.unit;

    const toMonthlyK = (token: { value: number; unit?: string }): number => {
        const unit = token.unit ?? globalUnit;
        let amount: number;
        switch (unit) {
            case '万':
                amount = token.value * 10;
                break;
            case '千':
            case 'k':
            case 'K':
                amount = token.value;
                break;
            case '元':
                amount = token.value / 1000;
                break;
            default:
                // 无任何单位：按 K 处理（招聘平台最常见写法）。
                amount = token.value;
                break;
        }
        if (isAnnual) amount /= 12;
        if (isDaily) amount *= WORKDAYS_PER_MONTH;
        return amount;
    };

    const converted = tokens.map(toMonthlyK).filter((amount) => Number.isFinite(amount) && amount > 0);
    if (converted.length === 0) {
        return months === undefined ? { text } : { months, text };
    }

    const isOpenEnded = /(以上|起|及以上|\+)/.test(scrubbed);
    const sorted = [...converted].sort((a, b) => a - b);
    const min = sorted[0];
    const max = isOpenEnded || sorted.length === 1 ? undefined : sorted[sorted.length - 1];

    const result: ParsedSalary = { text };
    if (min !== undefined) result.min = roundTo(min, 1);
    if (max !== undefined && result.min !== undefined && max > result.min) result.max = roundTo(max, 1);
    if (months !== undefined) result.months = months;
    return result;
};

/* ============================================================================
 * 经验 / 学历解析
 * ==========================================================================*/

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
export const parseExperience = (value: string | undefined | null): ParsedExperience => {
    const text = normalizeWhitespace(toHalfWidth(value ?? ''));
    if (text === '') return { text };
    if (/(不限|无要求|无经验要求|经验不限)/.test(text)) return { text };
    if (/(应届|在校|实习|无经验|毕业生)/.test(text)) return { min: 0, max: 1, text };

    const range = /(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*年/.exec(text);
    if (range !== null) {
        const min = Number.parseFloat(range[1] ?? '');
        const max = Number.parseFloat(range[2] ?? '');
        return Number.isFinite(min) && Number.isFinite(max) ? { min, max, text } : { text };
    }

    const openEnded = /(\d+(?:\.\d+)?)\s*年\s*(以上|及以上|\+)/.exec(text);
    if (openEnded !== null) {
        const min = Number.parseFloat(openEnded[1] ?? '');
        return Number.isFinite(min) ? { min, text } : { text };
    }

    const upperBounded = /(\d+(?:\.\d+)?)\s*年\s*(以内|以下)/.exec(text);
    if (upperBounded !== null) {
        const max = Number.parseFloat(upperBounded[1] ?? '');
        return Number.isFinite(max) ? { min: 0, max, text } : { text };
    }

    const single = /(\d+(?:\.\d+)?)\s*年/.exec(text);
    if (single !== null) {
        const years = Number.parseFloat(single[1] ?? '');
        return Number.isFinite(years) ? { min: years, max: years, text } : { text };
    }

    return { text };
};

/** 学历规范名（按需求从低到高）。 */
export type EducationLevel = '不限' | '高中' | '中专/中技' | '大专' | '本科' | '硕士' | '博士';

const EDUCATION_RULES: { level: EducationLevel; pattern: RegExp }[] = [
    { level: '博士', pattern: /(博士|phd|doctor)/i },
    { level: '硕士', pattern: /(硕士|研究生|master|mba)/i },
    { level: '本科', pattern: /(本科|学士|bachelor)/i },
    { level: '大专', pattern: /(大专|专科|高职|college)/i },
    { level: '中专/中技', pattern: /(中专|中技|技校|职高)/ },
    { level: '高中', pattern: /(高中|普高)/ },
    { level: '不限', pattern: /(不限|无要求|学历不限)/ },
];

/** 归一化学历要求（取文中出现的最高学历）。 */
export const normalizeEducation = (value: string | undefined | null): string => {
    const text = normalizeText(value);
    if (text === '') return '';
    // 规则表已按学历从高到低排列，首个命中即为最高学历。
    for (const rule of EDUCATION_RULES) {
        if (rule.pattern.test(text)) return rule.level;
    }
    return normalizeWhitespace(value);
};
