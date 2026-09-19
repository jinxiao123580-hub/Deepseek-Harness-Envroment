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
import { normalizeWhitespace, toHalfWidth } from '../shared/text.js';

/** 单条方向的加权关键词规则；权重越高，证据越强。 */
export interface CategoryRule {
    category: JobCategory;
    label: string;
    /** 加权关键词信号；权重越高，代表该词对方向的指向性越强。 */
    signals: { keyword: string; weight: number }[];
}

/**
 * 分类优先级 / 并列打破顺序（固定写死，保证结果确定性）。
 * 顺序原则：越「具体」的方向越靠前（SLAM 优先于泛化的机器人软件）。
 */
const CATEGORY_PRIORITY: readonly JobCategory[] = [
    'unknown',
    'slam',
    'rl-embodied',
    'motion-planning',
    'robotics-control',
    'perception',
    'embedded',
    'ros2',
    'robotics-software',
];

/** 打分最高的分类默认置信度。 */
const UNKNOWN_CONFIDENCE = 0;

/* ============================================================================
 * 关键词规则（全部小写 + 半角，匹配前文本也做同样归一化）
 * ==========================================================================*/

export const CATEGORY_RULES: readonly CategoryRule[] = [
    {
        category: 'robotics-software',
        label: '机器人软件',
        signals: [
            { keyword: '机器人软件', weight: 5 },
            { keyword: '机器人系统', weight: 4 },
            { keyword: '上位机', weight: 4 },
            { keyword: 'ros开发', weight: 3 },
            { keyword: '软件架构', weight: 3 },
            { keyword: 'c++', weight: 2 },
            { keyword: '运动控制上位机', weight: 3 },
            { keyword: 'sdk开发', weight: 3 },
            { keyword: '中间件', weight: 3 },
        ],
    },
    {
        category: 'robotics-control',
        label: '机器人控制',
        signals: [
            { keyword: '运动控制', weight: 5 },
            { keyword: '控制算法', weight: 5 },
            { keyword: 'pid', weight: 4 },
            { keyword: '伺服', weight: 4 },
            { keyword: '电机控制', weight: 4 },
            { keyword: '力控', weight: 4 },
            { keyword: '阻抗控制', weight: 4 },
            { keyword: '轨迹跟踪', weight: 4 },
            { keyword: '动力学', weight: 3 },
            { keyword: '运动学', weight: 3 },
            { keyword: 'lqr', weight: 3 },
            { keyword: 'mpc', weight: 3 },
        ],
    },
    {
        category: 'ros2',
        label: 'ROS2',
        signals: [
            { keyword: 'ros2', weight: 5 },
            { keyword: 'ros 2', weight: 5 },
            { keyword: 'ros', weight: 4 },
            { keyword: 'rviz', weight: 3 },
            { keyword: 'tf2', weight: 3 },
            { keyword: 'urdf', weight: 3 },
            { keyword: 'nav2', weight: 4 },
            { keyword: 'moveit', weight: 3 },
            { keyword: 'rosbag', weight: 3 },
            { keyword: 'colcon', weight: 3 },
            { keyword: 'ament', weight: 3 },
            { keyword: 'micro-ros', weight: 4 },
            { keyword: 'dds', weight: 3 },
        ],
    },
    {
        category: 'embedded',
        label: '嵌入式',
        signals: [
            { keyword: '嵌入式', weight: 5 },
            { keyword: '单片机', weight: 5 },
            { keyword: 'stm32', weight: 5 },
            { keyword: 'esp32', weight: 5 },
            { keyword: 'freertos', weight: 4 },
            { keyword: 'rtos', weight: 4 },
            { keyword: '驱动开发', weight: 4 },
            { keyword: '裸机', weight: 4 },
            { keyword: 'i2c', weight: 3 },
            { keyword: 'spi', weight: 3 },
            { keyword: 'uart', weight: 3 },
            { keyword: 'can总线', weight: 3 },
            { keyword: '寄存器', weight: 3 },
            { keyword: '中断', weight: 3 },
            { keyword: '低功耗', weight: 3 },
            { keyword: 'bootloader', weight: 3 },
        ],
    },
    {
        category: 'motion-planning',
        label: '运动规划',
        signals: [
            { keyword: '运动规划', weight: 5 },
            { keyword: '路径规划', weight: 5 },
            { keyword: '轨迹规划', weight: 5 },
            { keyword: 'slam导航', weight: 3 },
            { keyword: '避障', weight: 4 },
            { keyword: 'costmap', weight: 3 },
            { keyword: 'a*', weight: 3 },
            { keyword: 'rrt', weight: 4 },
            { keyword: 'teb', weight: 3 },
            { keyword: 'dwa', weight: 3 },
            { keyword: '全局规划', weight: 4 },
            { keyword: '局部规划', weight: 4 },
        ],
    },
    {
        category: 'slam',
        label: 'SLAM',
        signals: [
            { keyword: '激光slam', weight: 5 },
            { keyword: 'vslam', weight: 5 },
            { keyword: '视觉slam', weight: 5 },
            { keyword: '建图', weight: 4 },
            { keyword: '定位', weight: 3 },
            { keyword: 'cartographer', weight: 4 },
            { keyword: 'lio-sam', weight: 4 },
            { keyword: 'orb-slam', weight: 4 },
            { keyword: '回环检测', weight: 4 },
            { keyword: '图优化', weight: 3 },
            { keyword: 'g2o', weight: 3 },
            { keyword: 'ceres', weight: 3 },
            { keyword: 'gtsam', weight: 3 },
            { keyword: '点云配准', weight: 3 },
            { keyword: 'icp', weight: 3 },
            { keyword: 'ndt', weight: 3 },
            { keyword: 'amcl', weight: 3 },
        ],
    },
    {
        category: 'perception',
        label: '机器人感知',
        signals: [
            { keyword: '感知', weight: 5 },
            { keyword: '计算机视觉', weight: 5 },
            { keyword: 'opencv', weight: 5 },
            { keyword: '点云', weight: 4 },
            { keyword: '目标检测', weight: 4 },
            { keyword: '图像处理', weight: 4 },
            { keyword: '相机标定', weight: 4 },
            { keyword: '手眼标定', weight: 4 },
            { keyword: '深度学习部署', weight: 3 },
            { keyword: 'yolo', weight: 3 },
            { keyword: 'pcl', weight: 3 },
            { keyword: '语义分割', weight: 3 },
        ],
    },
    {
        category: 'rl-embodied',
        label: '强化学习/具身智能',
        signals: [
            { keyword: '强化学习', weight: 5 },
            { keyword: '具身智能', weight: 5 },
            { keyword: '模仿学习', weight: 4 },
            { keyword: 'sim2real', weight: 4 },
            { keyword: '机器人学习', weight: 4 },
            { keyword: 'ppo', weight: 3 },
            { keyword: 'sac', weight: 3 },
            { keyword: '模仿', weight: 3 },
            { keyword: 'isaac', weight: 3 },
            { keyword: 'mujoco', weight: 3 },
            { keyword: '世界模型', weight: 3 },
        ],
    },
    {
        // 兜底：无任何命中时使用，保证下游统计不会因为空分类而丢岗位。
        category: 'unknown',
        label: '未分类',
        signals: [],
    },
];

/** 分类 ID → 中文标签。 */
export const CATEGORY_LABELS: ReadonlyMap<string, string> = new Map(
    CATEGORY_RULES.map((rule) => [rule.category as string, rule.label] as const),
);

/* ============================================================================
 * 匹配原语
 * ==========================================================================*/

/** 归一化待匹配文本：半角化 → 小写 → 空白折叠。 */
const normalizeForMatch = (value: string): string => normalizeWhitespace(toHalfWidth(value)).toLowerCase();

/** 纯 ASCII 信号：需要在替换时补词边界，避免 `ros` 命中 `ros2`。 */
const isAsciiSignal = (keyword: string): boolean => /^[\x20-\x7e]+$/.test(keyword);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 缓存 `关键词 → 计数正则`，避免重复编译。 */
const countPatternCache = new Map<string, RegExp>();

const countPattern = (keyword: string): RegExp => {
    const cached = countPatternCache.get(keyword);
    if (cached !== undefined) return cached;
    const pattern = isAsciiSignal(keyword)
        ? new RegExp(`(?<![a-z0-9+#._])${escapeRegExp(keyword)}(?![a-z0-9+#._])`, 'g')
        : new RegExp(escapeRegExp(keyword), 'g');
    countPatternCache.set(keyword, pattern);
    return pattern;
};

/** 统计关键词在已归一化文本中的出现次数（不重叠）。 */
const countOccurrences = (haystack: string, keyword: string): number => {
    if (keyword === '' || haystack === '') return 0;
    const pattern = new RegExp(countPattern(keyword).source, 'g');
    let count = 0;
    while (pattern.exec(haystack) !== null) {
        count += 1;
        // 空匹配保护：正则不可能为空，但保持防御性。
        if (pattern.lastIndex === 0) break;
    }
    return count;
};

/**
 * 拼接待打分文本。权重通过「重复拼接」实现：
 * 职位名 ×3、职位描述 ×2、任职要求 ×2。
 */
const buildWeightedHaystack = (input: {
    title: string;
    description?: string;
    requirements?: readonly string[];
}): string => {
    const title = normalizeForMatch(input.title ?? '');
    const description = normalizeForMatch(input.description ?? '');
    const requirements = normalizeForMatch((input.requirements ?? []).join(' '));
    const parts: string[] = [];
    // 权重理由：岗位标题是**方向本身**，JD 正文只是佐证。
    // 早期实现用 标题×3 / 描述×2 / 要求×2，结果「机器人软件工程师」
    // 因为正文里 ROS2 被提到 4 次而被判成 ros2 方向——标题反被淹没。
    // 改成 标题×4 / 描述×2 / 要求×1：正文内部本就会互相复述，
    // 要求段再算两遍等于把同一句话放大，属于虚高分。
    for (let index = 0; index < 4; index += 1) parts.push(title);
    for (let index = 0; index < 2; index += 1) parts.push(description);
    parts.push(requirements);
    return parts.join(' \n ');
};

interface ScoredRule {
    rule: CategoryRule;
    score: number;
    evidence: string[];
}

/** 对单条规则打分，并收集命中证据（按权重降序、同权重按出现顺序）。 */
const scoreRule = (rule: CategoryRule, haystack: string): ScoredRule => {
    let score = 0;
    const hits: { keyword: string; weight: number }[] = [];
    for (const signal of rule.signals) {
        const occurrences = countOccurrences(haystack, signal.keyword);
        if (occurrences <= 0) continue;
        score += signal.weight * occurrences;
        hits.push(signal);
    }
    hits.sort((a, b) => (a.weight !== b.weight ? b.weight - a.weight : a.keyword < b.keyword ? -1 : 1));
    return { rule, score, evidence: hits.map((hit) => `${hit.keyword}(${hit.weight})`) };
};

/** 并列打破：优先级表内的顺序；表中不存在的自定义分类排在最后（按字典序）。 */
const priorityIndex = (category: JobCategory): number => {
    const index = CATEGORY_PRIORITY.indexOf(category);
    return index === -1 ? CATEGORY_PRIORITY.length : index;
};

const compareScored = (a: ScoredRule, b: ScoredRule): number => {
    if (a.score !== b.score) return b.score - a.score;
    const pa = priorityIndex(a.rule.category);
    const pb = priorityIndex(b.rule.category);
    if (pa !== pb) return pa - pb;
    return a.rule.category < b.rule.category ? -1 : a.rule.category > b.rule.category ? 1 : 0;
};

/** 保留 2 位小数。 */
const round2 = (value: number): number => Math.round(value * 100) / 100;

export const classifyJob = (input: {
    title: string;
    description?: string;
    requirements?: readonly string[];
}): { category: JobCategory; confidence: number; evidence: string[] } => {
    const haystack = buildWeightedHaystack(input);
    if (haystack.trim() === '') {
        return { category: 'unknown', confidence: UNKNOWN_CONFIDENCE, evidence: [] };
    }

    const scored = CATEGORY_RULES.map((rule) => scoreRule(rule, haystack)).sort(compareScored);
    const best = scored[0];
    if (best === undefined || best.score <= 0) {
        // 全部为 0 分：明确落到 unknown，置信度 0。
        return { category: 'unknown', confidence: UNKNOWN_CONFIDENCE, evidence: [] };
    }

    // 次高分：忽略 unknown 自身的 0 分，避免把兜底规则当成竞争方向。
    const runnerUp = scored.find((item) => item !== best && item.score > 0);
    const secondBest = runnerUp?.score ?? 0;
    const confidence = Math.min(1, Math.max(0, best.score / (best.score + secondBest + 1)));

    return {
        category: best.rule.category,
        confidence: round2(confidence),
        evidence: best.evidence.slice(0, 8),
    };
};

/** 批量分类，返回 `job_id → category`。 */
export const classifyJobs = (jobs: readonly Job[]): Map<string, JobCategory> => {
    const result = new Map<string, JobCategory>();
    for (const job of jobs) {
        if (job === null || typeof job !== 'object') continue;
        result.set(
            job.job_id,
            classifyJob({
                title: job.job_title ?? '',
                description: job.description,
                requirements: job.requirements ?? [],
            }).category,
        );
    }
    return result;
};

/* ============================================================================
 * 职位名规范化（写入 Job.normalized_job_title）
 * ==========================================================================*/

/** 括号及其内容：中英文括号、方括号、书名号。 */
const BRACKET_PATTERN = /[（(【\[《][^）)】\]》]*[）)】\]》]/g;
/** 末尾城市后缀，如「机器人软件工程师（深圳）」「ROS 开发 - 上海」。 */
const TRAILING_CITY_PATTERN =
    /[\s\-—·、|/]*[（(【\[]?(北京|上海|广州|深圳|杭州|南京|苏州|成都|武汉|西安|天津|重庆|长沙|郑州|青岛|合肥|宁波|东莞|佛山|无锡|厦门|福州|济南|大连|沈阳|哈尔滨|长春|昆明|南昌|贵阳|南宁|太原|石家庄|兰州|银川|西宁|乌鲁木齐|呼和浩特|海口|珠海|中山|惠州|温州|嘉兴|常州|南通|徐州|烟台|潍坊|泉州|绍兴|台州|金华|保定|洛阳)[市]?[）)】\]]?$/;

/** 同义词 → 规范写法（键与值均为小写 + 半角形式）。 */
const TITLE_SYNONYMS: readonly (readonly [string, string])[] = [
    ['c++', 'C++'],
    ['cpp', 'C++'],
    ['c++开发', 'C++开发'],
    ['c#', 'C#'],
    ['golang', 'Go'],
    ['go语言', 'Go'],
    ['python', 'Python'],
    ['ros2', 'ROS2'],
    ['ros 2', 'ROS2'],
    ['ros', 'ROS'],
    ['slam', 'SLAM'],
    ['vslam', 'VSLAM'],
    ['linux', 'Linux'],
    ['ubuntu', 'Ubuntu'],
    ['fpga', 'FPGA'],
    ['dsp', 'DSP'],
    ['mcu', 'MCU'],
    ['算法工程师', '算法工程师'],
    ['软件工程师', '软件工程师'],
    ['嵌入式工程师', '嵌入式工程师'],
    ['机器人软件工程师', '机器人软件工程师'],
    ['机器人工程师', '机器人工程师'],
    ['研发工程师', '研发工程师'],
    ['开发工程师', '开发工程师'],
    ['上位机', '上位机'],
    ['运动控制', '运动控制'],
    ['运动规划', '运动规划'],
    ['路径规划', '路径规划'],
    ['导航算法', '导航算法'],
    ['感知算法', '感知算法'],
    ['控制算法', '控制算法'],
    ['强化学习', '强化学习'],
    ['具身智能', '具身智能'],
];

/** 按长度降序排列同义词，保证「最长优先」（`ros 2` 先于 `ros`）。 */
const TITLE_SYNONYM_LIST = [...TITLE_SYNONYMS].sort((a, b) => (a[0].length !== b[0].length ? b[0].length - a[0].length : a[0] < b[0] ? -1 : 1));

/** 规范化职位名：去括号噪声、去城市后缀、统一 C++ 写法、映射常见同义词。 */
export const normalizeJobTitle = (title: string): string => {
    if (typeof title !== 'string' || title.trim() === '') return '';
    const lowered = normalizeWhitespace(toHalfWidth(title)).toLowerCase();

    // 1) 去掉方括号/圆括号内的级别、城市、福利等噪声。
    let key = lowered.replace(BRACKET_PATTERN, ' ');
    // 2) 去掉末尾未加括号的城市后缀。
    key = key.replace(TRAILING_CITY_PATTERN, ' ');
    key = normalizeWhitespace(key);

    // 3) 同义词归一 + `c++ 开发` / `c ++` 这类空白统一（最长优先，单遍扫描）。
    const pieces: string[] = [];
    let cursor = 0;
    while (cursor < key.length) {
        let matched = false;
        for (const [from, to] of TITLE_SYNONYM_LIST) {
            if (from !== '' && key.startsWith(from, cursor)) {
                pieces.push(to);
                cursor += from.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;
        pieces.push(key[cursor] as string);
        cursor += 1;
    }
    key = pieces.join('');

    // 4) 清理因替换产生的多余空白与首尾标点。
    key = key.replace(/\s*\+\s*/g, '++');
    key = key.replace(/c\s*\+\+/gi, 'C++');
    key = normalizeWhitespace(key).replace(/^[\s\-—·、|/,，.。;；:：]+/, '').replace(/[\s\-—·、|/,，.。;；:：]+$/, '');
    return normalizeWhitespace(key);
};
