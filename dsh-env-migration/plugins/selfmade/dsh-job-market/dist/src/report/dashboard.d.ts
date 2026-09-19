/**
 * Dashboard 数据组装与 Markdown 报告（需求 §十五 / §十六）。
 *
 * 数据真实性约束：
 *  - 本模块 **只做搬运与展示**，绝不再自己算任何比例；
 *    所有数字都来自 `MarketSnapshot` / `GapReport` / `LearningRoadmap` 的程序计算结果。
 *  - `DashboardData.provenance` 显式声明「数字来自真实采集岗位，LLM 只参与解析/分类/归一化/解释」。
 *  - 每个技能行都带 `job_ids` 追溯能力（在 `top_skills` / `cooccurrence` 中保留）。
 */
import type { DashboardData, DashboardOverview, GapReport, Job, JobMarketConfig, LearningGoal, LearningRoadmap, MarketSnapshot, MySkillRow, RoadmapProgress, SkillFrequency } from '../shared/types.js';
import type { SnapshotHistory } from '../market/market-snapshot.js';
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
/** 组装市场总览（需求 §十五【市场总览】）。 */
export declare const buildOverview: (snapshot: MarketSnapshot, config: JobMarketConfig) => DashboardOverview;
/** 把 Gap 结果转成 Dashboard 的「我的能力」表格行（需求 §十五【我的能力】）。 */
export declare const buildMySkillRows: (gap: GapReport | undefined) => MySkillRow[];
/** 统计学习路线进度（需求 §十五【学习路线】）。 */
export declare const buildRoadmapProgress: (roadmap: LearningRoadmap | null | undefined, goals: readonly LearningGoal[] | undefined, currentWeek?: number) => RoadmapProgress | null;
/** 组装完整 Dashboard 数据。 */
export declare const buildDashboardData: (input: DashboardInput) => DashboardData;
export interface SkillTrace {
    skill: string;
    skill_id: string;
    job_ratio: number;
    job_count: number;
    required_job_ids: string[];
    preferred_job_ids: string[];
    bonus_job_ids: string[];
    /** 真实岗位摘要，用于直接展示。 */
    jobs: {
        job_id: string;
        job_title: string;
        company: string;
        city?: string;
        url: string;
        source: string;
    }[];
}
/** 从快照 + 岗位池回溯某个技能由哪些真实岗位支撑。 */
export declare const traceSkill: (snapshot: MarketSnapshot, jobs: readonly Job[], skillId: string) => SkillTrace | undefined;
/** 回溯某个岗位方向的真实岗位。 */
export declare const traceCategory: (snapshot: MarketSnapshot, jobs: readonly Job[], category: string) => {
    category: string;
    label: string;
    job_count: number;
    jobs: Job[];
} | undefined;
/** 渲染中文 Markdown 市场分析报告。所有数字均来自传入的已计算结果。 */
export declare const renderMarkdownReport: (input: {
    dashboard: DashboardData;
    snapshot: MarketSnapshot;
    skills?: readonly SkillFrequency[];
    gap?: GapReport;
    goals?: readonly LearningGoal[];
    roadmap?: LearningRoadmap | null;
    title?: string;
}) => string;
/** 便捷：从历史中取最新快照。 */
export declare const currentSnapshot: (history: SnapshotHistory | undefined) => MarketSnapshot | undefined;
