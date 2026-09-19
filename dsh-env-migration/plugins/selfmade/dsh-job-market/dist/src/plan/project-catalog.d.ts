/**
 * project-catalog —— 项目驱动模板（需求 §十二）
 *
 * 设计约束（对应需求 §十一「禁止不可验收目标」）：
 *  - 一个「学 ROS2」式的目标无法验收，但「让移动机器人从 MCU 一路跑到 Nav2 自主导航」
 *    可以验收。因此这里把技能学习全部挂到 **真实可构建的机器人项目** 上，
 *    每个模板都是一条有序的、可逐阶段验证的建造链。
 *  - 模板只是「建造顺序 + 每阶段练哪些技能」，不含任何统计数字；
 *    所有覆盖率数字都由 `instantiateProject` 基于真实快照计算，避免出现假数字。
 *  - `covered_skill_ids` 只统计 **本次快照里真的出现过岗位** 的技能：
 *    没有市场数据的技能不算覆盖，否则覆盖率会被虚高。
 */
import type { ProjectPlan } from '../shared/types.js';
/** 项目模板：阶段有序，每阶段声明它训练的技能 ID。 */
export interface ProjectTemplate {
    project_id: string;
    name: string;
    description: string;
    /** Ordered build stages; each stage names the skills it exercises. */
    stages: {
        name: string;
        detail: string;
        skill_ids: string[];
    }[];
}
/**
 * 项目模板目录，按「边际学习成本递增」排序（最便宜/最基础在前）：
 *  1. mobile-robot            全栈主线，复用最通用的 ROS2/嵌入式技能
 *  2. embedded-motion-control 底层运动控制，硬件在环但技能面窄
 *  3. ros2-arm                机械臂 + MoveIt2，需要运动学与轨迹规划
 *  4. slam-navigation         激光 SLAM 与导航，需要后端优化与概率论
 *  5. vision-perception       视觉感知，需要标定与深度学习
 *  6. rl-embodied             仿真 + 强化学习 + sim2real，前期成本最高
 */
export declare const PROJECT_CATALOG: ProjectTemplate[];
/** 快照里单条技能的统计形状（`SkillFrequency` 的结构子集）。 */
type SkillFrequencyLike = {
    job_count: number;
    job_ratio: number;
    job_ids: readonly string[];
};
/**
 * 把项目模板实例化成可交付的 `ProjectPlan`。
 *
 *  - `stages[].skill_ids` 保留模板声明的完整技能清单（建造计划不该被统计数据删掉）；
 *  - `covered_skill_ids` 只包含 **快照里真有岗位** 的技能（覆盖数字必须可回溯）；
 *  - `market_job_count` = 这些技能 `job_ids` 的并集大小（不是简单相加，避免重复计岗位）；
 *  - `market_coverage` = `market_job_count / totalJobs`，`totalJobs <= 0` 时记 0；
 *  - `top20_covered` 统计覆盖了目标 TOP 技能中的几项，`top20_total` 为清单长度。
 */
export declare const instantiateProject: (template: ProjectTemplate, skillFrequencies: ReadonlyMap<string, SkillFrequencyLike>, totalJobs: number, opts?: {
    topSkillIds?: readonly string[];
}) => ProjectPlan;
export {};
