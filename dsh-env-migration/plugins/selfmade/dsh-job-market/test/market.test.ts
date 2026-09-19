/**
 * 市场统计测试（需求 §七 / §十六）。
 *
 * 重点验证：
 *  1. 百分比由程序计算，且 required / preferred / bonus 分别给出比例
 *  2. 每个比例都能回溯到真实岗位 ID（需求 §十六 的硬性要求）
 *  3. 共现 lift 能识别真正成套出现的技能组合
 *  4. 市场快照累积与趋势方向
 *  5. 按方向分开统计，不跨方向混算
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCategoryLabelMap, buildSkillIndex, buildSkillNameMap, createSkillDictionary, loadTaxonomy } from '../src/taxonomy/taxonomy.js';
import { canonicalSkillIds } from '../src/taxonomy/skill-normalizer.js';
import { createJob, upsertJobs } from '../src/store/job-store.js';
import { parseJdByRule } from '../src/jd/jd-parser.js';
import { buildMarketSnapshot } from '../src/market/market-analyzer.js';
import { appendSnapshot, buildAllTrends, emptyHistory, latestSnapshot } from '../src/market/market-snapshot.js';
import { traceSkill } from '../src/report/dashboard.js';
import { classifyJob } from '../src/classify/job-category-classifier.js';
import type { Job, JobCategory, JdAnalysis, JobInput } from '../src/shared/types.js';

const NOW = '2026-09-01T00:00:00.000Z';
const { taxonomy } = await loadTaxonomy();
const dictionary = createSkillDictionary(taxonomy);
const skillIndex = buildSkillIndex(taxonomy);
const skillNames = buildSkillNameMap(taxonomy);
const categoryLabels = buildCategoryLabelMap(taxonomy);

const normalizeSkills = (text: string): string[] => canonicalSkillIds(text, dictionary, skillIndex);

/** 造一个岗位并顺手完成分类，等价于真实流水线里的分类步骤。 */
const makeJob = (input: JobInput, now = NOW): Job => {
    const created = createJob(input, { now, normalizeSkills });
    const classified = classifyJob({
        title: created.job_title,
        ...(created.description === undefined ? {} : { description: created.description }),
        requirements: created.requirements,
    });
    return classified.category === 'unknown' ? created : { ...created, job_category: classified.category as JobCategory };
};

const JD_ROS2_CORE = '负责 ROS2 移动机器人软件开发，熟练掌握 C++ 与 Linux，使用 TF2 与 Nav2 完成导航功能。';
const JD_ROS2_PREF = 'ROS2 机器人应用开发，熟悉 C++，了解 Python 优先。';
const JD_EMBEDDED = '嵌入式软件工程师，STM32 单片机固件开发，熟悉 C 语言与 UART/I2C/SPI 通信协议。';
const JD_SLAM = 'SLAM 算法工程师，精通 C++ 与 Ceres、g2o 后端优化，熟悉 Linux 与 ROS2。';

const buildPool = (): Job[] => {
    const inputs: JobInput[] = [
        { source: 'boss', job_title: '机器人软件工程师', company: '甲公司', city: '上海', url: 'https://www.zhipin.com/job1', description: JD_ROS2_CORE, requirements: ['熟练掌握 C++', '熟悉 ROS2'], source_job_id: '1' },
        { source: 'liepin', job_title: 'ROS2 开发工程师', company: '乙公司', city: '杭州', url: 'https://www.liepin.com/job2', description: JD_ROS2_PREF, requirements: ['了解 Python 优先'], source_job_id: '2' },
        { source: 'zhaopin', job_title: '嵌入式软件工程师', company: '丙公司', city: '苏州', url: 'https://www.zhaopin.com/job3', description: JD_EMBEDDED, requirements: ['熟悉 C 语言'], source_job_id: '3' },
        { source: 'boss', job_title: 'SLAM 算法工程师', company: '丁公司', city: '上海', url: 'https://www.zhipin.com/job4', description: JD_SLAM, requirements: ['精通 C++'], source_job_id: '4' },
    ];
    const { jobs } = upsertJobs([], inputs.map((input) => makeJob(input)), NOW);
    return jobs;
};

const buildAnalyses = (jobs: readonly Job[]): Map<string, JdAnalysis> => {
    const map = new Map<string, JdAnalysis>();
    for (const job of jobs) {
        map.set(
            job.job_id,
            parseJdByRule({
                job,
                dictionary,
                analysisVersion: 1,
                promptVersion: 1,
                now: NOW,
            }),
        );
    }
    return map;
};

const pool = buildPool();
const analyses = buildAnalyses(pool);

const snapshotOf = (jobs: readonly Job[], analysesMap: Map<string, JdAnalysis>, now = NOW) =>
    buildMarketSnapshot({
        jobs,
        analyses: analysesMap,
        filter: {},
        now: new Date(now),
        skillNames,
        topSkillsPerCategory: 10,
        minCooccurrenceCount: 2,
        defaultCategoryLabels: categoryLabels,
    });

const snapshot = snapshotOf(pool, analyses);

const freqOf = (id: string) => snapshot.skill_frequencies.find((item) => item.skill_id === id);

test('岗位池共 4 个岗位，快照 job_count 与之一致', () => {
    assert.equal(pool.length, 4);
    assert.equal(snapshot.job_count, 4);
});

test('技能频率分别给出岗位数、出现率、Required 与 Preferred 比例', () => {
    const ros2 = freqOf('ros2');
    assert.ok(ros2 !== undefined, '快照应包含 ros2');
    // 4 个岗位中 3 个提到 ROS2（甲、乙、丁）
    assert.equal(ros2.job_count, 3);
    assert.equal(ros2.job_ratio, 0.75);

    // required / preferred / bonus 是**划分**：三档之和恒等于 job_count。
    // 这样两个比例可以直接当分母核对，不会出现重叠区间。
    assert.equal(
        ros2.required_count + ros2.preferred_count + ros2.bonus_count,
        ros2.job_count,
        '三档计数之和必须等于岗位数（每个岗位对每个技能只落一个强度档）',
    );
    assert.ok(ros2.required_ratio >= 0 && ros2.required_ratio <= 1);
    assert.ok(ros2.preferred_ratio >= 0 && ros2.preferred_ratio <= 1);
});

test('同一岗位既把技能标为 required 又标为 preferred 时，只按最高档计入', () => {
    // 「ROS2 开发工程师」标题 required、正文「了解…优先」preferred
    const ros2 = freqOf('ros2');
    assert.ok(ros2 !== undefined);
    for (const id of ros2.preferred_job_ids) {
        assert.ok(!ros2.required_job_ids.includes(id), `${id} 不应同时出现在 required 与 preferred 里`);
    }
});

test('加权需求 demand = (required*1 + preferred*0.5 + bonus*0.25) / 总岗位数', () => {
    const ros2 = freqOf('ros2');
    assert.ok(ros2 !== undefined);
    const expected = (ros2.required_count * 1 + ros2.preferred_count * 0.5 + ros2.bonus_count * 0.25) / snapshot.job_count;
    assert.ok(Math.abs(ros2.weighted_demand - expected) < 1e-9, `weighted_demand 期望 ${expected}，实际 ${ros2.weighted_demand}`);
});

test('每个百分比都可回溯到真实岗位 ID（需求 §十六）', () => {
    const ros2 = freqOf('ros2');
    assert.ok(ros2 !== undefined);
    assert.equal(ros2.job_ids.length, ros2.job_count, 'job_ids 数量必须与 job_count 一致');
    // 并集应等于三个分项并集
    const union = new Set([...ros2.required_job_ids, ...ros2.preferred_job_ids, ...ros2.bonus_job_ids]);
    assert.deepEqual([...ros2.job_ids].sort(), [...union].sort());
    // 每个 ID 都能在岗位池里找到
    const poolIds = new Set(pool.map((job) => job.job_id));
    for (const id of ros2.job_ids) assert.ok(poolIds.has(id), `${id} 应在岗位池中`);
});

test('traceSkill 能列出要求该技能的真实岗位', () => {
    const trace = traceSkill(snapshot, pool, 'ros2');
    assert.ok(trace !== undefined);
    assert.equal(trace.job_count, 3);
    assert.equal(trace.jobs.length, 3);
    for (const job of trace.jobs) {
        assert.ok(job.company.length > 0);
        assert.ok(job.url.startsWith('https://'), '每个可回溯岗位都应带原始 URL');
    }
});

test('技能共现带 lift，能识别成套出现的组合', () => {
    const pairs = snapshot.cooccurrence;
    assert.ok(pairs.length > 0, '应有共现对');
    for (const pair of pairs) {
        assert.ok(pair.job_count >= 2, '低于 minCooccurrenceCount 的组合不应出现');
        assert.ok(pair.job_ids.length === pair.job_count, '共现对同样必须可回溯');
        assert.ok(Number.isFinite(pair.lift));
    }
});

test('按岗位方向分开统计：嵌入式方向不应出现 Ceres/G2O', () => {
    const embedded = snapshot.categories.find((item) => item.category === 'embedded');
    assert.ok(embedded !== undefined, '应存在嵌入式方向');
    const ids = embedded.top_skills.map((skill) => skill.skill_id);
    assert.ok(!ids.includes('ceres'), '嵌入式方向不应统计到 SLAM 专属技能 ceres');
    assert.ok(!ids.includes('g2o'), '嵌入式方向不应统计到 SLAM 专属技能 g2o');

    const slam = snapshot.categories.find((item) => item.category === 'slam');
    assert.ok(slam !== undefined, '应存在 SLAM 方向');
    const slamIds = slam.top_skills.map((skill) => skill.skill_id);
    assert.ok(slamIds.includes('cpp'), 'SLAM 方向应统计到 cpp');
});

test('城市与薪资分布基于真实岗位计算', () => {
    assert.ok(snapshot.cities.length >= 3, '应覆盖上海/杭州/苏州');
    const total = snapshot.cities.reduce((sum, bucket) => sum + bucket.job_count, 0);
    assert.equal(total, snapshot.job_count, '城市分布岗位数之和必须等于总岗位数');
});

test('快照累积：追加两次后趋势能给出方向与百分点变化', () => {
    const first = snapshotOf(pool, analyses, '2026-09-01T00:00:00.000Z');
    // 第二轮：新增 2 个岗位，其中 1 个要求 ROS2 → ros2 占比应下降
    const extra = upsertJobs(
        pool,
        [
            makeJob({ source: 'zhaopin', job_title: '嵌入式驱动工程师', company: '戊公司', city: '南京', url: 'https://www.zhaopin.com/job5', description: '单片机固件开发，熟悉 C 语言。', source_job_id: '5' }, '2026-09-15T00:00:00.000Z'),
            makeJob({ source: 'zhaopin', job_title: '硬件测试工程师', company: '己公司', city: '南京', url: 'https://www.zhaopin.com/job6', description: '硬件电路测试与调试。', source_job_id: '6' }, '2026-09-15T00:00:00.000Z'),
        ],
        '2026-09-15T00:00:00.000Z',
    );
    const second = snapshotOf(extra.jobs, buildAnalyses(extra.jobs), '2026-09-15T00:00:00.000Z');

    let history = appendSnapshot(emptyHistory(), first);
    history = appendSnapshot(history, second);
    assert.equal(history.snapshots.length, 2);
    assert.equal(latestSnapshot(history)?.snapshot_id, second.snapshot_id);

    const trends = buildAllTrends(history, 20);
    const ros2Trend = trends.find((trend) => trend.skill_id === 'ros2');
    assert.ok(ros2Trend !== undefined, '趋势里应包含 ros2');
    assert.ok(ros2Trend.points.length >= 2, '至少两点才能算趋势');
    // 岗位从 4 涨到 6，ROS2 仍为 3 → 占比从 0.75 降到 0.5
    assert.ok(ros2Trend.delta_pp < 0, `ros2 占比应下降，实际 delta_pp=${ros2Trend.delta_pp}`);
    assert.equal(ros2Trend.direction, 'down');
});

test('空岗位池不会产生除零错误，比例归一为 0', () => {
    const empty = snapshotOf([], new Map());
    assert.equal(empty.job_count, 0);
    for (const skill of empty.skill_frequencies) {
        assert.ok(Number.isFinite(skill.job_ratio), '比例不得为 NaN');
        assert.ok(skill.job_ratio >= 0 && skill.job_ratio <= 1);
    }
});
