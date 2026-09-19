/**
 * job-category-classifier —— 岗位方向分类（需求 §八）。
 *
 * 铁律（需求 §十六 数据真实性）：
 *  本模块 **完全不需要模型**。分类只由「加权关键词字典 + 确定性打分」完成，
 *  因此分类结果可复现、可解释、可人工核对，并且零成本。
 *  模型只允许在规则置信度极低时做「澄清」（见 `CATEGORY_DISAMBIGUATION_PROMPT`），
 *  且绝不参与任何数量/比例计算。
 *
 * 输出：
 *  - `CATEGORY_RULES`：8 个方向 + unknown 兜底，共 9 条规则。
 *  - `classifyJob`：返回方向、置信度（0..1）与命中证据（如 `运动控制(5)`）。
 *  - `normalizeJobTitle`：写入 `Job.normalized_job_title` 的规范化职位名。
 */
import type { Job, JobCategory } from '../shared/types.js';
/** 单条方向的加权关键词规则；权重越高，证据越强。 */
export interface CategoryRule {
    category: JobCategory;
    label: string;
    /** 加权关键词信号；权重越高，代表该词对方向的指向性越强。 */
    signals: {
        keyword: string;
        weight: number;
    }[];
}
export declare const CATEGORY_RULES: readonly CategoryRule[];
/** 分类 ID → 中文标签。 */
export declare const CATEGORY_LABELS: ReadonlyMap<string, string>;
export declare const classifyJob: (input: {
    title: string;
    description?: string;
    requirements?: readonly string[];
}) => {
    category: JobCategory;
    confidence: number;
    evidence: string[];
};
/** 批量分类，返回 `job_id → category`。 */
export declare const classifyJobs: (jobs: readonly Job[]) => Map<string, JobCategory>;
/** 规范化职位名：去括号噪声、去城市后缀、统一 C++ 写法、映射常见同义词。 */
export declare const normalizeJobTitle: (title: string) => string;
