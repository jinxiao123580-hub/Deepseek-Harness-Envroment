/**
 * 学习路线生成（需求 §十三）。
 *
 * 输出 4 / 8 / 12 周三档（默认 8 周），每周必须包含：
 *   本周目标 / 具体任务 / 为什么学 / 对应多少岗位 / 预计投入时间 / 验收条件 / 项目产出
 *
 * 排序原则（不是简单按优先级堆叠）：
 *   1. 先按技能大类的「学习依赖相位」排序 —— 编程与 Linux 是地基，
 *      ROS2/嵌入式是中层，控制/规划/SLAM/感知/强化学习是上层；
 *   2. 同相位内按难度升序（先易后难，保证每周都有可交付成果）；
 *   3. 再按市场岗位数降序（同难度先学更值钱的）。
 *
 * 这样做的原因：Gap 优先级回答的是「什么最值得学」，
 * 而路线回答的是「按什么顺序学得会」——两者不能混为一谈。
 */

import type {
    Iso,
    LearningGoal,
    LearningRoadmap,
    MarketSnapshot,
    ProjectPlan,
    RoadmapWeek,
    SkillCategory,
} from '../shared/types.js';
import { clamp, roundTo } from '../shared/text.js';
import { hashValue } from '../shared/hash.js';

export const DEFAULT_ROADMAP_WEEKS: 4 | 8 | 12 = 8;
export const DEFAULT_HOURS_PER_WEEK = 15;
/** 每个难度点折算的学习小时数。 */
export const HOURS_PER_DIFFICULTY = 4;
export const VALID_ROADMAP_MODES: readonly (4 | 8 | 12)[] = [4, 8, 12];

/**
 * 学习依赖相位。数字越小越先学。
 * 未列出的自定义大类排在中间之后（默认 6），保证自定义技能不会被挤到最后。
 */
const PHASE_RANK: Record<string, number> = {
    Programming: 1,
    Linux: 2,
    Embedded: 3,
    Communication: 4,
    Hardware: 5,
    Robotics: 6,
    Control: 7,
    Planning: 8,
    SLAM: 9,
    Perception: 10,
    'AI/RL': 11,
    Engineering: 12,
};

const phaseOf = (category: SkillCategory | undefined): number =>
    category === undefined ? 6 : PHASE_RANK[category] ?? 6;

export interface PlanRoadmapInput {
    goals: readonly LearningGoal[];
    snapshot: MarketSnapshot;
    mode?: 4 | 8 | 12;
    project?: ProjectPlan;
    now?: Iso;
    hoursPerWeek?: number;
    basedOnProfileUpdatedAt?: Iso;
}

const isMode = (value: number | undefined): value is 4 | 8 | 12 =>
    value === 4 || value === 8 || value === 12;

/** 把有序目标尽量均匀地切成 weeks 份（前面的周可以多 1 个目标）。 */
const chunkEvenly = <T>(items: readonly T[], weeks: number): T[][] => {
    const buckets: T[][] = Array.from({ length: weeks }, () => []);
    if (items.length === 0) return buckets;
    if (items.length <= weeks) {
        items.forEach((item, index) => buckets[index]?.push(item));
        return buckets;
    }
    const base = Math.floor(items.length / weeks);
    const extra = items.length % weeks;
    let cursor = 0;
    for (let index = 0; index < weeks; index += 1) {
        const size = base + (index < extra ? 1 : 0);
        buckets[index] = items.slice(cursor, cursor + size);
        cursor += size;
    }
    return buckets;
};

const pct = (value: number): string => `${roundTo(value * 100, 1)}%`;

/** 本周「为什么学」：必须引用真实岗位数量与比例。 */
const buildWhy = (weekGoals: readonly LearningGoal[], snapshot: MarketSnapshot, categoryName: string): string => {
    const jobCount = Math.max(...weekGoals.map((goal) => goal.market_job_count), 0);
    const coverage = Math.max(...weekGoals.map((goal) => goal.market_coverage), 0);
    const names = weekGoals.map((goal) => goal.skill).join('、');
    return (
        `${names} 在最近统计窗口内出现在 ${jobCount} 个真实岗位中（覆盖 ${pct(coverage)} 的目标岗位），` +
        `属于 ${categoryName} 方向的高频要求；先补齐这些能力可以直接解锁最多的岗位。`
    );
};

/** 本周项目产出：优先绑定项目阶段，否则给出通用可验收产出。 */
const buildDeliverable = (
    weekGoals: readonly LearningGoal[],
    project: ProjectPlan | undefined,
    stageIndex: number,
): string => {
    if (project !== undefined && project.stages.length > 0) {
        const stage = project.stages[stageIndex % project.stages.length];
        if (stage !== undefined) {
            return `${project.name} —— ${stage.name}${stage.detail === undefined ? '' : `：${stage.detail}`}`;
        }
    }
    const primary = weekGoals[0];
    if (primary === undefined) return '整理本周学习记录，输出可验收的能力证据。';
    return `完成「${primary.title}」的可运行 Demo，并把代码与说明提交到 GitHub / 本地仓库作为能力证据。`;
};

/**
 * 生成学习路线。
 *
 * 注意：`goals` 预期已经由 GapAnalyzer + GoalPlanner 产出（带优先级与验收标准）。
 * 本函数只负责排序、分周与文案，不会新增或删除目标。
 */
export const planRoadmap = (input: PlanRoadmapInput): LearningRoadmap => {
    const now = input.now ?? new Date().toISOString();
    const mode: 4 | 8 | 12 = isMode(input.mode) ? input.mode : DEFAULT_ROADMAP_WEEKS;
    const hoursPerWeek = input.hoursPerWeek ?? DEFAULT_HOURS_PER_WEEK;

    // skill_id → category，用于相位排序
    const categoryBySkill = new Map<string, SkillCategory>(
        input.snapshot.skill_frequencies.map((item) => [item.skill_id, item.category]),
    );

    const ordered = [...input.goals].sort((a, b) => {
        const phaseDiff = phaseOf(categoryBySkill.get(a.skill_id)) - phaseOf(categoryBySkill.get(b.skill_id));
        if (phaseDiff !== 0) return phaseDiff;
        if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;
        if (b.market_job_count !== a.market_job_count) return b.market_job_count - a.market_job_count;
        return a.skill_id < b.skill_id ? -1 : a.skill_id > b.skill_id ? 1 : 0;
    });

    const buckets = chunkEvenly(ordered, mode);
    const weeks: RoadmapWeek[] = [];

    for (let index = 0; index < mode; index += 1) {
        const weekGoals = buckets[index] ?? [];
        const week = index + 1;
        const category = categoryBySkill.get(weekGoals[0]?.skill_id ?? '') ?? 'Engineering';

        const coveredJobCount = Math.max(...weekGoals.map((goal) => goal.market_job_count), 0);
        const coveredJobRatio = Math.max(...weekGoals.map((goal) => goal.market_coverage), 0);

        const difficultySum = weekGoals.reduce((total, goal) => total + goal.difficulty, 0);
        const estimatedHours = clamp(roundTo(difficultySum * HOURS_PER_DIFFICULTY, 1), 0, hoursPerWeek);

        const tasks = weekGoals.flatMap((goal) =>
            goal.learning_content.length > 0
                ? goal.learning_content.map((content) => `【${goal.skill}】${content}`)
                : [`【${goal.skill}】${goal.title}`],
        );
        const acceptance = weekGoals.flatMap((goal) => goal.acceptance_criteria);
        const goalIds = weekGoals.map((goal) => goal.goal_id);

        const goalTitle =
            weekGoals.length === 0
                ? `阶段复盘：把前 ${index} 周的能力证据整理成可展示的成果`
                : weekGoals.map((goal) => goal.title).join(' + ');

        weeks.push({
            week,
            goal: goalTitle,
            tasks: tasks.length > 0 ? tasks : ['复盘前几周成果，补齐缺失的能力证据。'],
            why:
                weekGoals.length === 0
                    ? '本阶段没有新增必学技能：把时间投入项目整合与作品集打磨，比继续堆零散知识点更能提升通过率。'
                    : buildWhy(weekGoals, input.snapshot, String(category)),
            covered_job_count: coveredJobCount,
            covered_job_ratio: roundTo(coveredJobRatio, 4),
            estimated_hours: estimatedHours,
            acceptance: acceptance.length > 0 ? acceptance : ['能独立演示本周成果并解释设计取舍。'],
            deliverable: buildDeliverable(weekGoals, input.project, index),
            goal_ids: goalIds,
            ...(input.project === undefined ? {} : { project_id: input.project.project_id }),
        });
    }

    const roadmapId = `roadmap-${mode}w-${hashValue('roadmap', [
        input.snapshot.snapshot_id,
        ordered.map((goal) => goal.goal_id),
        now.slice(0, 10),
    ])}`;

    return {
        roadmap_id: roadmapId,
        mode,
        generated_at: now,
        based_on_snapshot_id: input.snapshot.snapshot_id,
        based_on_profile_updated_at: input.basedOnProfileUpdatedAt ?? now,
        weeks,
        ...(input.project === undefined ? {} : { project: input.project }),
        goal_ids: ordered.map((goal) => goal.goal_id),
    };
};

/**
 * 标记某个目标完成（需求 §十一：只有满足验收标准才能标记完成）。
 *
 * 这里不自行判断验收标准是否真的达成——那需要人的证据；
 * 但强制要求调用方显式传入确认，且目标必须已有非空验收标准。
 */
export const completeGoalInRoadmap = (
    goals: readonly LearningGoal[],
    input: { goalId: string; confirmed: boolean; now?: Iso },
): { goals: LearningGoal[]; completed?: LearningGoal; error?: string } => {
    const goal = goals.find((item) => item.goal_id === input.goalId);
    if (goal === undefined) {
        return { goals: [...goals], error: `找不到目标 ${input.goalId}` };
    }
    if (goal.acceptance_criteria.length === 0) {
        return { goals: [...goals], error: `目标 ${input.goalId} 没有验收标准，不允许标记完成` };
    }
    if (!input.confirmed) {
        return { goals: [...goals], error: '标记完成需要确认：请确认全部验收标准都已满足。' };
    }
    const completed: LearningGoal = {
        ...goal,
        status: 'done',
        completed_at: input.now ?? new Date().toISOString(),
    };
    return {
        goals: goals.map((item) => (item.goal_id === input.goalId ? completed : item)),
        completed,
    };
};
