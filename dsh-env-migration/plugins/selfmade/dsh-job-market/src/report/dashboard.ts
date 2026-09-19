/**
 * Dashboard 数据组装与 Markdown 报告（需求 §十五 / §十六）。
 *
 * 数据真实性约束：
 *  - 本模块 **只做搬运与展示**，绝不再自己算任何比例；
 *    所有数字都来自 `MarketSnapshot` / `GapReport` / `LearningRoadmap` 的程序计算结果。
 *  - `DashboardData.provenance` 显式声明「数字来自真实采集岗位，LLM 只参与解析/分类/归一化/解释」。
 *  - 每个技能行都带 `job_ids` 追溯能力（在 `top_skills` / `cooccurrence` 中保留）。
 */

import type {
    CategoryBreakdown,
    DashboardData,
    DashboardOverview,
    GapEntry,
    GapReport,
    Job,
    JobMarketConfig,
    LearningGoal,
    LearningRoadmap,
    MarketSnapshot,
    MySkillRow,
    RoadmapProgress,
    RoadmapProgressWeek,
    SkillCooccurrence,
    SkillFrequency,
    SkillTrend,
} from '../shared/types.js';
import type { SnapshotHistory } from '../market/market-snapshot.js';
import { buildAllTrends, latestSnapshot } from '../market/market-snapshot.js';
import { roundTo } from '../shared/text.js';

// DashboardData 是本模块的对外契约，供 tools 层直接引用（SkillTrace 在本文件下方定义）。
export type { DashboardData } from '../shared/types.js';

export interface DashboardInput {
    snapshot: MarketSnapshot;
    history?: SnapshotHistory;
    gap?: GapReport;
    goals?: readonly LearningGoal[];
    roadmap?: LearningRoadmap | null;
    config: JobMarketConfig;
    /** 当前周序号（1 起）；缺省按 1 计算。 */
    currentWeek?: number;
    now?: string;
}

const toIso = (value: string | undefined): string => value ?? new Date().toISOString();

/** 组装市场总览（需求 §十五【市场总览】）。 */
export const buildOverview = (snapshot: MarketSnapshot, config: JobMarketConfig): DashboardOverview => {
    const cities = new Set(snapshot.cities.map((bucket) => bucket.city));
    const categories = new Set(snapshot.categories.map((item) => item.category));
    const reliable = snapshot.job_count >= config.market.min_jobs_for_stats;
    const overview: DashboardOverview = {
        job_count: snapshot.job_count,
        category_count: categories.size,
        city_count: cities.size,
        salary: snapshot.salary,
        experience: snapshot.experience,
        analyzed_job_count: snapshot.analyzed_job_count,
        reliable,
    };
    if (!reliable) {
        overview.warning =
            `当前有效岗位仅 ${snapshot.job_count} 个，低于可信阈值 ${config.market.min_jobs_for_stats} 个；` +
            '以下比例仅供参考，建议再采集一轮以提升可信度。';
    }
    return overview;
};

/** 把 Gap 结果转成 Dashboard 的「我的能力」表格行（需求 §十五【我的能力】）。 */
export const buildMySkillRows = (gap: GapReport | undefined): MySkillRow[] => {
    if (gap === undefined) return [];
    return gap.entries.map((entry: GapEntry) => ({
        skill_id: entry.skill_id,
        skill: entry.skill,
        category: entry.category,
        // 用 job_count 与市场总岗位数反推出现率，避免引入新的口径。
        market_ratio: entry.job_count > 0 && entry.market_demand > 0 ? roundTo(Math.min(1, entry.market_demand), 4) : 0,
        market_job_count: entry.job_count,
        current_level: entry.current_level,
        target_level: entry.target_level,
        gap: roundTo(entry.skill_gap, 4),
        priority: entry.priority,
        rank: entry.rank,
        explanation: entry.explanation,
    }));
};

/** 统计学习路线进度（需求 §十五【学习路线】）。 */
export const buildRoadmapProgress = (
    roadmap: LearningRoadmap | null | undefined,
    goals: readonly LearningGoal[] | undefined,
    currentWeek = 1,
): RoadmapProgress | null => {
    if (roadmap === null || roadmap === undefined) return null;
    const goalById = new Map((goals ?? []).map((goal) => [goal.goal_id, goal]));

    const weeks: RoadmapProgressWeek[] = roadmap.weeks.map((week) => {
        const weekGoals = week.goal_ids.map((id) => goalById.get(id)).filter((goal): goal is LearningGoal => goal !== undefined);
        const done = weekGoals.filter((goal) => goal.status === 'done').length;
        const total = weekGoals.length;
        return {
            week: week.week,
            goal: week.goal,
            status: total > 0 && done === total ? 'done' : done > 0 ? 'in-progress' : 'pending',
            done_goals: done,
            total_goals: total,
        };
    });

    return {
        roadmap_id: roadmap.roadmap_id,
        mode: roadmap.mode,
        current_week: currentWeek,
        weeks,
        done_goals: weeks.reduce((total, week) => total + week.done_goals, 0),
        total_goals: weeks.reduce((total, week) => total + week.total_goals, 0),
    };
};

/** 组装完整 Dashboard 数据。 */
export const buildDashboardData = (input: DashboardInput): DashboardData => {
    const history = input.history ?? { version: 1, snapshots: [input.snapshot], updated_at: toIso(input.now) };
    const trends: SkillTrend[] = buildAllTrends(history, 15);

    return {
        generated_at: toIso(input.now),
        snapshot_id: input.snapshot.snapshot_id,
        overview: buildOverview(input.snapshot, input.config),
        top_skills: [...input.snapshot.skill_frequencies].sort((a, b) => b.job_count - a.job_count).slice(0, 30),
        cooccurrence: [...input.snapshot.cooccurrence].sort((a, b) => b.job_count - a.job_count).slice(0, 20),
        categories: [...input.snapshot.categories].sort((a, b) => b.job_count - a.job_count),
        my_skills: buildMySkillRows(input.gap),
        roadmap: buildRoadmapProgress(input.roadmap, input.goals, input.currentWeek ?? 1),
        trends,
        provenance: {
            job_source: 'collected-real-jobs',
            llm_role: 'parse-classify-normalize-explain-only',
            snapshot_count: history.snapshots.length,
        },
    };
};

/* ============================================================================
 * 追溯（需求 §十六：点 68% 能看到是哪些岗位）
 * ==========================================================================*/

export interface SkillTrace {
    skill: string;
    skill_id: string;
    job_ratio: number;
    job_count: number;
    required_job_ids: string[];
    preferred_job_ids: string[];
    bonus_job_ids: string[];
    /** 真实岗位摘要，用于直接展示。 */
    jobs: { job_id: string; job_title: string; company: string; city?: string; url: string; source: string }[];
}

/** 从快照 + 岗位池回溯某个技能由哪些真实岗位支撑。 */
export const traceSkill = (snapshot: MarketSnapshot, jobs: readonly Job[], skillId: string): SkillTrace | undefined => {
    const frequency: SkillFrequency | undefined = snapshot.skill_frequencies.find((item) => item.skill_id === skillId);
    if (frequency === undefined) return undefined;
    const byId = new Map(jobs.map((job) => [job.job_id, job]));
    const summarize = (id: string): SkillTrace['jobs'][number] | undefined => {
        const job = byId.get(id);
        if (job === undefined) return undefined;
        return {
            job_id: job.job_id,
            job_title: job.job_title,
            company: job.company,
            ...(job.city === undefined ? {} : { city: job.city }),
            url: job.url,
            source: job.source,
        };
    };
    return {
        skill: frequency.skill,
        skill_id: frequency.skill_id,
        job_ratio: frequency.job_ratio,
        job_count: frequency.job_count,
        required_job_ids: frequency.required_job_ids,
        preferred_job_ids: frequency.preferred_job_ids,
        bonus_job_ids: frequency.bonus_job_ids,
        jobs: frequency.job_ids
            .map(summarize)
            .filter((job): job is SkillTrace['jobs'][number] => job !== undefined)
            .slice(0, 200),
    };
};

/** 回溯某个岗位方向的真实岗位。 */
export const traceCategory = (
    snapshot: MarketSnapshot,
    jobs: readonly Job[],
    category: string,
): { category: string; label: string; job_count: number; jobs: Job[] } | undefined => {
    const breakdown: CategoryBreakdown | undefined = snapshot.categories.find((item) => item.category === category);
    if (breakdown === undefined) return undefined;
    const wanted = new Set(breakdown.job_ids);
    return {
        category: breakdown.category,
        label: breakdown.label,
        job_count: breakdown.job_count,
        jobs: jobs.filter((job) => wanted.has(job.job_id)),
    };
};

/* ============================================================================
 * Markdown 报告
 * ==========================================================================*/

const pct = (value: number): string => `${roundTo(value * 100, 1)}%`;

/** 渲染中文 Markdown 市场分析报告。所有数字均来自传入的已计算结果。 */
export const renderMarkdownReport = (input: {
    dashboard: DashboardData;
    snapshot: MarketSnapshot;
    skills?: readonly SkillFrequency[];
    gap?: GapReport;
    goals?: readonly LearningGoal[];
    roadmap?: LearningRoadmap | null;
    title?: string;
}): string => {
    const { dashboard, snapshot } = input;
    const lines: string[] = [];
    const title = input.title ?? '招聘市场需求分析报告';

    lines.push(`# ${title}`);
    lines.push('');
    lines.push(`- 生成时间：${dashboard.generated_at}`);
    lines.push(`- 快照 ID：\`${snapshot.snapshot_id}\``);
    lines.push(`- 统计岗位数：**${snapshot.job_count}**（已解析 JD：${snapshot.analyzed_job_count}）`);
    lines.push(`- 历史快照数：${dashboard.provenance.snapshot_count}`);
    lines.push('');
    if (dashboard.overview.warning !== undefined) {
        lines.push(`> ⚠️ ${dashboard.overview.warning}`);
        lines.push('');
    }

    lines.push('## 一、市场总览');
    lines.push('');
    lines.push('| 指标 | 值 |');
    lines.push('| --- | --- |');
    lines.push(`| 岗位数量 | ${dashboard.overview.job_count} |`);
    lines.push(`| 岗位方向数 | ${dashboard.overview.category_count} |`);
    lines.push(`| 覆盖城市数 | ${dashboard.overview.city_count} |`);
    if (snapshot.salary.median_min !== undefined) {
        lines.push(`| 薪资中位数（下限） | ${snapshot.salary.median_min}K/月 |`);
    }
    if (snapshot.salary.median_max !== undefined) {
        lines.push(`| 薪资中位数（上限） | ${snapshot.salary.median_max}K/月 |`);
    }
    lines.push(`| 薪资信息披露率 | ${pct(snapshot.salary.coverage)} |`);
    lines.push('');

    lines.push('## 二、技能需求排行');
    lines.push('');
    lines.push('| # | 技能 | 类别 | 岗位数 | 出现率 | Required | Preferred | 加权需求 | 趋势 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    const skills = input.skills ?? dashboard.top_skills;
    skills.slice(0, 30).forEach((skill, index) => {
        const trend =
            skill.trend_pp === undefined
                ? '—'
                : `${skill.trend_pp > 0 ? '+' : ''}${roundTo(skill.trend_pp, 1)}pp`;
        lines.push(
            `| ${index + 1} | ${skill.skill} | ${skill.category} | ${skill.job_count} | ${pct(skill.job_ratio)} | ` +
                `${pct(skill.required_ratio)} | ${pct(skill.preferred_ratio)} | ${roundTo(skill.weighted_demand, 3)} | ${trend} |`,
        );
    });
    lines.push('');
    lines.push('> 每个百分比都可回溯：调用 `job_market_trace_skill` 传入技能名即可列出要求该技能的真实岗位。');
    lines.push('');

    lines.push('## 三、技能共现（真正成套出现的组合）');
    lines.push('');
    lines.push('| 组合 | 同时要求岗位数 | 占比 | 提升度 lift |');
    lines.push('| --- | --- | --- | --- |');
    for (const pair of dashboard.cooccurrence.slice(0, 15)) {
        lines.push(`| ${pair.a} + ${pair.b} | ${pair.job_count} | ${pct(pair.ratio)} | ${roundTo(pair.lift, 2)} |`);
    }
    lines.push('');

    lines.push('## 四、岗位方向分布（分方向统计，不跨方向混算）');
    lines.push('');
    for (const category of dashboard.categories) {
        lines.push(`### ${category.label}（${category.job_count} 个岗位，占 ${pct(category.job_ratio)}）`);
        lines.push('');
        if (category.top_skills.length > 0) {
            lines.push('方向内 TOP 技能：');
            lines.push('');
            lines.push('| 技能 | 岗位数 | 出现率 |');
            lines.push('| --- | --- | --- |');
            for (const skill of category.top_skills.slice(0, 10)) {
                lines.push(`| ${skill.skill} | ${skill.job_count} | ${pct(skill.job_ratio)} |`);
            }
            lines.push('');
        }
    }

    if (input.gap !== undefined && input.gap.entries.length > 0) {
        lines.push('## 五、我的能力与学习优先级');
        lines.push('');
        lines.push('| 优先级 | 技能 | 市场占比 | 当前等级 | 目标等级 | 差距 | 解释 |');
        lines.push('| --- | --- | --- | --- | --- | --- | --- |');
        for (const entry of input.gap.entries.slice(0, 20)) {
            lines.push(
                `| ${entry.rank} | ${entry.skill} | ${pct(entry.market_demand)} | ${entry.current_level} | ${entry.target_level} | ` +
                    `${roundTo(entry.skill_gap, 2)} | ${entry.explanation} |`,
            );
        }
        lines.push('');
        if (input.gap.excluded.length > 0) {
            lines.push('未纳入排名的技能：');
            lines.push('');
            for (const item of input.gap.excluded.slice(0, 15)) {
                lines.push(`- ${item.skill}：${item.reason}`);
            }
            lines.push('');
        }
    }

    if (input.roadmap !== null && input.roadmap !== undefined) {
        lines.push(`## 六、学习路线（${input.roadmap.mode} 周）`);
        lines.push('');
        for (const week of input.roadmap.weeks) {
            lines.push(`### 第 ${week.week} 周：${week.goal}`);
            lines.push('');
            lines.push(`- **为什么学**：${week.why}`);
            lines.push(`- **对应岗位**：${week.covered_job_count} 个（${pct(week.covered_job_ratio)}）`);
            lines.push(`- **预计投入**：${week.estimated_hours} 小时`);
            lines.push('- **具体任务**：');
            for (const task of week.tasks) lines.push(`  - ${task}`);
            lines.push('- **验收条件**：');
            for (const criteria of week.acceptance) lines.push(`  - [ ] ${criteria}`);
            lines.push(`- **项目产出**：${week.deliverable}`);
            lines.push('');
        }
        if (input.roadmap.project !== undefined) {
            const project = input.roadmap.project;
            lines.push(`### 贯穿项目：${project.name}`);
            lines.push('');
            lines.push(project.description);
            lines.push('');
            lines.push(
                `完成该项目预计覆盖目标岗位 TOP${project.top20_total} 技能中的 **${project.top20_covered}** 项，` +
                    `覆盖 ${project.market_job_count} 个岗位（${pct(project.market_coverage)}）。`,
            );
            lines.push('');
        }
    }

    if (dashboard.trends.length > 0) {
        lines.push('## 七、技能需求趋势');
        lines.push('');
        lines.push('| 技能 | 首次占比 | 最新占比 | 变化 | 方向 |');
        lines.push('| --- | --- | --- | --- | --- |');
        for (const trend of dashboard.trends.slice(0, 15)) {
            const first = trend.points[0];
            const last = trend.points[trend.points.length - 1];
            if (first === undefined || last === undefined) continue;
            const arrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
            lines.push(
                `| ${trend.skill} | ${pct(first.job_ratio)} | ${pct(last.job_ratio)} | ${trend.delta_pp > 0 ? '+' : ''}${roundTo(
                    trend.delta_pp,
                    1,
                )}pp | ${arrow} |`,
            );
        }
        lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('本报告中所有数量、比例、薪资与趋势均由程序基于真实采集岗位计算；');
    lines.push('模型仅参与 JD 解析、岗位分类、技能归一化与文字解释，不参与任何统计数值的生成。');
    lines.push('');

    return lines.join('\n');
};

/** 便捷：从历史中取最新快照。 */
export const currentSnapshot = (history: SnapshotHistory | undefined): MarketSnapshot | undefined =>
    latestSnapshot(history);
