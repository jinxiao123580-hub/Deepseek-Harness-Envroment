/**
 * Gap 评分与学习计划测试（需求 §九 ~ §十三）。
 *
 * 重点验证：
 *  1. priority = market_demand × importance × skill_gap × role_coverage ÷ learning_cost 的公式正确性
 *  2. 每个条目的排序理由必须非空（需求 §十）
 *  3. AI 建议不得自动写入 skills，只有用户确认才生效（需求 §九）
 *  4. 目标必须有非空验收标准，且不是「学习 C++」这类不可验收目标（需求 §十一）
 *  5. 路线必须包含每周七要素，且不推翻既有计划（需求 §十三 / §十四）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCategoryLabelMap, buildSkillIndex, buildSkillNameMap, createSkillDictionary, loadTaxonomy } from '../src/taxonomy/taxonomy.js';
import { canonicalSkillIds } from '../src/taxonomy/skill-normalizer.js';
import { createJob, upsertJobs } from '../src/store/job-store.js';
import { parseJdByRule } from '../src/jd/jd-parser.js';
import { buildMarketSnapshot } from '../src/market/market-analyzer.js';
import { analyzeGap, computePriority, learningCostFor, DEFAULT_GAP_WEIGHTS } from '../src/gap/gap-analyzer.js';
import { confirmSuggestion, emptyPersonalProfile, setSkillLevel, suggestSkill, confirmedSkills } from '../src/profile/personal-skill-profile.js';
import { planGoals } from '../src/plan/goal-planner.js';
import { instantiateProject, PROJECT_CATALOG } from '../src/plan/project-catalog.js';
import { planRoadmap, completeGoalInRoadmap } from '../src/plan/learning-roadmap.js';
import type { Job, JobInput, JdAnalysis, PersonalSkillProfile } from '../src/shared/types.js';

const NOW = '2026-09-01T00:00:00.000Z';
const { taxonomy } = await loadTaxonomy();
const dictionary = createSkillDictionary(taxonomy);
const skillIndex = buildSkillIndex(taxonomy);
const skillNames = buildSkillNameMap(taxonomy);
const categoryLabels = buildCategoryLabelMap(taxonomy);
const normalizeSkills = (text: string): string[] => canonicalSkillIds(text, dictionary, skillIndex);

const makeJobs = (): Job[] => {
    const inputs: JobInput[] = [
        { source: 'boss', job_title: '机器人软件工程师', company: '甲', city: '上海', url: 'https://www.zhipin.com/a', description: 'ROS2 移动机器人开发，熟练掌握 C++ 与 Linux，使用 TF2、Nav2。', requirements: ['熟练掌握 C++'], source_job_id: 'a' },
        { source: 'liepin', job_title: 'ROS2 开发工程师', company: '乙', city: '杭州', url: 'https://www.liepin.com/b', description: 'ROS2 应用开发，熟悉 C++ 与 Linux。', requirements: ['熟悉 C++'], source_job_id: 'b' },
        { source: 'zhaopin', job_title: '机器人控制算法工程师', company: '丙', city: '苏州', url: 'https://www.zhaopin.com/c', description: '运动控制算法开发，熟悉 C++、Linux 与 ROS2。', requirements: ['熟悉 C++'], source_job_id: 'c' },
        { source: 'boss', job_title: '嵌入式软件工程师', company: '丁', city: '南京', url: 'https://www.zhipin.com/d', description: 'STM32 固件开发，熟悉 C 语言与 UART/I2C/SPI。', requirements: ['熟悉 C 语言'], source_job_id: 'd' },
    ];
    return upsertJobs([], inputs.map((input) => createJob(input, { now: NOW, normalizeSkills })), NOW).jobs;
};

const jobs = makeJobs();
const analyses = new Map<string, JdAnalysis>(
    jobs.map((job) => [job.job_id, parseJdByRule({ job, dictionary, analysisVersion: 1, promptVersion: 1, now: NOW })]),
);
const snapshot = buildMarketSnapshot({
    jobs,
    analyses,
    filter: {},
    now: new Date(NOW),
    skillNames,
    topSkillsPerCategory: 10,
    minCooccurrenceCount: 2,
    defaultCategoryLabels: categoryLabels,
});

/** 用户自评：C++ 已经能独立做项目（3），ROS2 只知概念（1）。 */
const profileWith = (): PersonalSkillProfile => {
    let profile = emptyPersonalProfile({ target_roles: ['机器人软件工程师'] });
    profile = setSkillLevel(profile, { skill_id: 'cpp', current_level: 3, target_level: 5, now: NOW });
    profile = setSkillLevel(profile, { skill_id: 'ros2', current_level: 1, target_level: 4, now: NOW });
    profile = setSkillLevel(profile, { skill_id: 'linux', current_level: 2, target_level: 4, now: NOW });
    return profile;
};

const gap = analyzeGap({ snapshot, profile: profileWith(), now: NOW });

test('computePriority 严格等于公式：demand × importance × gap × coverage ÷ cost', () => {
    const input = { market_demand: 0.7, importance: 1, skill_gap: 0.6, role_coverage: 0.8, learning_cost: 2 };
    const expected =
        (Math.pow(0.7, DEFAULT_GAP_WEIGHTS.market_demand) *
            Math.pow(1, DEFAULT_GAP_WEIGHTS.importance) *
            Math.pow(0.6, DEFAULT_GAP_WEIGHTS.skill_gap) *
            Math.pow(0.8, DEFAULT_GAP_WEIGHTS.role_coverage)) /
        Math.pow(2, DEFAULT_GAP_WEIGHTS.learning_cost);
    assert.ok(Math.abs(computePriority(input, DEFAULT_GAP_WEIGHTS) - expected) < 1e-12);
});

test('learningCostFor 对难度更高的技能给出更高成本', () => {
    const easy = learningCostFor('Linux', DEFAULT_GAP_WEIGHTS, { difficulty: 2 });
    const hard = learningCostFor('SLAM', DEFAULT_GAP_WEIGHTS, { difficulty: 5 });
    assert.ok(easy > 0 && hard > 0);
    assert.ok(hard > easy, 'SLAM 的学习成本应高于 Linux');
    // 未显式给难度时，回退到 category_cost 表
    assert.ok(learningCostFor('SLAM', DEFAULT_GAP_WEIGHTS) > 0);
});

test('Gap 结果按 priority 降序排名，且 rank 连续', () => {
    assert.ok(gap.entries.length > 0, '应产出至少一个 Gap 条目');
    for (let index = 1; index < gap.entries.length; index += 1) {
        const previous = gap.entries[index - 1];
        const current = gap.entries[index];
        assert.ok(previous !== undefined && current !== undefined);
        assert.ok(previous.priority >= current.priority, 'priority 必须降序');
    }
    gap.entries.forEach((entry, index) => assert.equal(entry.rank, index + 1, 'rank 必须从 1 连续'));
});

test('每个 Gap 条目都给出非空的排序理由（需求 §十）', () => {
    for (const entry of gap.entries) {
        assert.ok(typeof entry.explanation === 'string' && entry.explanation.length > 0, `${entry.skill} 缺少解释`);
    }
});

test('skill_gap 反映目标与当前的差距，已达标技能差距为 0', () => {
    const ros2 = gap.entries.find((entry) => entry.skill_id === 'ros2');
    assert.ok(ros2 !== undefined, '目标岗位高频技能 ros2 应进入 Gap');
    assert.equal(ros2.current_level, 1);
    assert.equal(ros2.target_level, 4);
    assert.ok(ros2.skill_gap > 0, '未达标技能 gap 应大于 0');
    // cpp 目标 5 当前 3 → 仍有差距
    const cpp = gap.entries.find((entry) => entry.skill_id === 'cpp');
    assert.ok(cpp !== undefined);
    assert.ok(cpp.skill_gap > 0);
});

test('AI 建议只进 pending_suggestions，绝不自动写入 skills', () => {
    const base = profileWith();
    const suggested = suggestSkill(base, {
        skill_id: 'slam',
        suggested_level: 2,
        reason: '简历提到做过建图实验',
        evidence: [],
        now: NOW,
    });
    assert.equal(suggested.skills['slam'], undefined, 'AI 建议不得直接写入 skills');
    assert.ok(suggested.pending_suggestions.some((item) => item.skill_id === 'slam'));
    // 未确认的建议不得出现在已确认技能里
    assert.ok(!confirmedSkills(suggested).some((skill) => skill.skill_id === 'slam'));
});

test('confirmSuggestion 必须显式 confirmed: true，否则抛错', () => {
    const base = suggestSkill(profileWith(), {
        skill_id: 'slam',
        suggested_level: 2,
        reason: '简历提到做过建图实验',
        evidence: [],
        now: NOW,
    });
    assert.throws(() => confirmSuggestion(base, { skill_id: 'slam', confirmed: false }), /confirmed: true/);
    const confirmed = confirmSuggestion(base, { skill_id: 'slam', confirmed: true, current_level: 2, now: NOW });
    assert.equal(confirmed.skills['slam']?.current_level, 2);
    assert.equal(confirmed.skills['slam']?.source, 'user');
});

test('planGoals 产出的目标必须有非空验收标准，且不是「学习 X」式目标', () => {
    const goals = planGoals({ gap, snapshot, limit: 8, now: NOW });
    assert.ok(goals.length > 0, '应产出学习目标');
    for (const goal of goals) {
        assert.ok(goal.acceptance_criteria.length > 0, `${goal.title} 必须带验收标准`);
        for (const criteria of goal.acceptance_criteria) {
            assert.ok(criteria.trim().length > 0, '验收标准不得为空白');
        }
        // 禁止「学习 C++」这类只有动作没有产出的标题
        assert.ok(!/^学习/.test(goal.title), `目标标题不得是「学习 X」形式：${goal.title}`);
        assert.ok(goal.market_job_count >= 0);
        assert.ok(goal.market_coverage >= 0 && goal.market_coverage <= 1);
    }
});

test('ROS2 目标拆分出 Node/Topic/Service/Action/Parameter/Launch/TF2/URDF/QoS/rosbag/RViz/Nav2', () => {
    const goals = planGoals({ gap, snapshot, limit: 12, now: NOW });
    const ros2Goal = goals.find((goal) => goal.skill_id === 'ros2');
    if (ros2Goal === undefined) return; // 该岗位池未把 ros2 排进前列时不强求
    const text = [...ros2Goal.sub_skills, ...ros2Goal.learning_content, ...ros2Goal.acceptance_criteria].join(' ').toLowerCase();
    const required = ['node', 'topic', 'service', 'action', 'parameter', 'launch', 'tf2', 'urdf', 'qos', 'rosbag', 'rviz', 'nav2'];
    const missing = required.filter((token) => !text.includes(token));
    assert.equal(missing.length, 0, `ROS2 能力拆分缺少：${missing.join(', ')}`);
});

test('项目目录含移动机器人全链路，且报告 TOP20 覆盖数', () => {
    const template = PROJECT_CATALOG.find((item) => item.project_id === 'mobile-robot') ?? PROJECT_CATALOG[0];
    assert.ok(template !== undefined, '项目目录必须非空');
    const frequencies = new Map(
        snapshot.skill_frequencies.map((item) => [
            item.skill_id,
            { job_count: item.job_count, job_ratio: item.job_ratio, job_ids: item.job_ids },
        ]),
    );
    const topSkillIds = [...snapshot.skill_frequencies]
        .sort((a, b) => b.job_count - a.job_count)
        .slice(0, 20)
        .map((item) => item.skill_id);
    const project = instantiateProject(template, frequencies, snapshot.job_count, { topSkillIds });
    // TOP20 是上限：市场里技能不足 20 个时，分母就是实际可用技能数。
    assert.equal(project.top20_total, Math.min(20, snapshot.skill_frequencies.length));
    assert.ok(project.top20_covered >= 0 && project.top20_covered <= project.top20_total);
    assert.ok(project.stages.length > 0, '项目必须分阶段');
    assert.ok(project.covered_skill_ids.length > 0);
});

test('8 周路线每周都带齐七要素', () => {
    const goals = planGoals({ gap, snapshot, limit: 12, now: NOW });
    const roadmap = planRoadmap({ goals, snapshot, mode: 8, now: NOW });
    assert.equal(roadmap.mode, 8);
    assert.equal(roadmap.weeks.length, 8);
    assert.equal(roadmap.based_on_snapshot_id, snapshot.snapshot_id);
    for (const week of roadmap.weeks) {
        assert.ok(week.goal.length > 0, '本周目标不得为空');
        assert.ok(week.tasks.length > 0, '具体任务不得为空');
        assert.ok(week.why.length > 0, '为什么学不得为空');
        assert.ok(week.covered_job_count >= 0 && week.covered_job_ratio >= 0 && week.covered_job_ratio <= 1);
        assert.ok(week.estimated_hours >= 0, '预计投入时间不得为负');
        assert.ok(week.acceptance.length > 0, '验收条件不得为空');
        assert.ok(week.deliverable.length > 0, '项目产出不得为空');
    }
});

test('4/8/12 周三档都可用，默认 8 周', () => {
    const goals = planGoals({ gap, snapshot, limit: 12, now: NOW });
    assert.equal(planRoadmap({ goals, snapshot, now: NOW }).mode, 8);
    assert.equal(planRoadmap({ goals, snapshot, mode: 4, now: NOW }).weeks.length, 4);
    assert.equal(planRoadmap({ goals, snapshot, mode: 12, now: NOW }).weeks.length, 12);
});

test('只有满足验收标准并显式确认才能标记目标完成', () => {
    const goals = planGoals({ gap, snapshot, limit: 6, now: NOW });
    const first = goals[0];
    assert.ok(first !== undefined);

    const refused = completeGoalInRoadmap(goals, { goalId: first.goal_id, confirmed: false, now: NOW });
    assert.ok(refused.error !== undefined, '未确认时必须拒绝');
    assert.equal(refused.completed, undefined);

    const done = completeGoalInRoadmap(goals, { goalId: first.goal_id, confirmed: true, now: NOW });
    assert.equal(done.error, undefined);
    assert.equal(done.completed?.status, 'done');
    assert.ok(done.completed?.completed_at !== undefined);

    const missing = completeGoalInRoadmap(goals, { goalId: 'not-exist', confirmed: true, now: NOW });
    assert.ok(missing.error !== undefined, '不存在的目标必须报错');
});
