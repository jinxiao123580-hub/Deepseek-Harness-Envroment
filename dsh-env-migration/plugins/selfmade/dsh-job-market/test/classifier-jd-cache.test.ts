/**
 * 岗位分类、JD 解析缓存与本地导入测试（需求 §五 / §十七 / §二十）。
 *
 * 重点验证：
 *  1. 所有岗位必经分类器，且方向差异大的岗位不会被混类
 *  2. JD 缓存键 = jd_hash + analysis_version + prompt_version：JD 未变不重算
 *  3. 解析规则或提示词升级时缓存整体失效
 *  4. 本地 JSON / CSV / Markdown 三条导入通道都能产出规范岗位输入
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyJob } from '../src/classify/job-category-classifier.js';
import { parseJdByRule } from '../src/jd/jd-parser.js';
import {
    JD_CACHE_PATH,
    cacheStats,
    cacheStatsByVersion,
    computeJdHash,
    computeJobHash,
    emptyJdCache,
    pruneJdCache,
    readCachedAnalysis,
    writeCachedAnalysis,
} from '../src/jd/jd-cache.js';
import { buildSkillIndex, createSkillDictionary, loadTaxonomy } from '../src/taxonomy/taxonomy.js';
import { canonicalSkillIds } from '../src/taxonomy/skill-normalizer.js';
import { createJob } from '../src/store/job-store.js';
import { parseCsvJobs, parseJsonJobs, parseMarkdownJobs, detectFormat } from '../src/jobs/local-import.js';
import type { JobInput } from '../src/shared/types.js';

const NOW = '2026-09-01T00:00:00.000Z';
const { taxonomy } = await loadTaxonomy();
const dictionary = createSkillDictionary(taxonomy);
const skillIndex = buildSkillIndex(taxonomy);
const normalizeSkills = (text: string): string[] => canonicalSkillIds(text, dictionary, skillIndex);

const job = (input: JobInput) => createJob(input, { now: NOW, normalizeSkills });

/* ============================================================================
 * 一、岗位分类
 * ==========================================================================*/

test('机器人软件岗位被分到机器人软件方向', () => {
    const result = classifyJob({
        title: '机器人软件工程师',
        description: '负责 ROS2 移动机器人应用层软件开发，熟悉 C++。',
        requirements: ['熟悉 ROS2'],
    });
    assert.notEqual(result.category, 'unknown', '不应落到未知方向');
    assert.ok(/robot|software/.test(result.category), `期望机器人软件方向，实际 ${result.category}`);
});

test('嵌入式岗位不会被混入机器人软件方向', () => {
    const result = classifyJob({
        title: '嵌入式软件工程师',
        description: 'STM32 单片机固件开发，熟悉 UART/I2C/SPI 与 FreeRTOS。',
        requirements: ['熟悉 C 语言'],
    });
    assert.equal(result.category, 'embedded');
});

test('SLAM 岗位与嵌入式岗位分属不同方向（需求 §八：不得跨方向给建议）', () => {
    const slam = classifyJob({
        title: 'SLAM 算法工程师',
        description: '激光 SLAM 建图与定位算法开发，熟悉 Ceres、g2o 与 C++。',
        requirements: ['精通 C++'],
    });
    const embedded = classifyJob({
        title: '嵌入式软件工程师',
        description: 'STM32 固件开发，熟悉 C 语言。',
        requirements: ['熟悉 C 语言'],
    });
    assert.equal(slam.category, 'slam');
    assert.equal(embedded.category, 'embedded');
    assert.notEqual(slam.category, embedded.category);
});

test('分类结果总是带一个合法 category，绝不返回空', () => {
    for (const title of ['销售代表', '行政专员', '市场运营', '???', '']) {
        const result = classifyJob({ title, requirements: [] });
        assert.ok(typeof result.category === 'string' && result.category.length > 0, `"${title}" 的分类不得为空`);
    }
});

/* ============================================================================
 * 二、JD 解析与缓存
 * ==========================================================================*/

const sample = job({
    source: 'boss',
    job_title: '机器人软件工程师',
    company: '甲',
    url: 'https://www.zhipin.com/x',
    description: 'ROS2 移动机器人开发。',
    requirements: ['熟练掌握 C++', '了解 Python 优先'],
    source_job_id: 'x',
});

test('规则解析能区分 required 与 preferred，且带权重差异', () => {
    const analysis = parseJdByRule({ job: sample, dictionary, analysisVersion: 1, promptVersion: 1, now: NOW });
    assert.equal(analysis.via, 'rule');
    assert.equal(analysis.llm_calls, 0, '规则路径不得产生模型调用');
    assert.ok(analysis.mentions.length > 0);

    const required = analysis.mentions.filter((mention) => mention.requirement === 'required');
    const preferred = analysis.mentions.filter((mention) => mention.requirement === 'preferred');
    assert.ok(required.length > 0, '「熟练掌握」应被识别为 required');
    assert.ok(preferred.length > 0, '「了解…优先」应被识别为 preferred');
});

test('缓存路径常量与上游工作区约定一致', () => {
    assert.equal(JD_CACHE_PATH, 'data/jd-cache.json');
});

test('JD 未变时命中缓存，不重复分析', () => {
    const analysis = parseJdByRule({ job: sample, dictionary, analysisVersion: 1, promptVersion: 1, now: NOW });
    const cache = writeCachedAnalysis(emptyJdCache(), { job: sample, analysis, now: NOW });
    const hit = readCachedAnalysis(cache, { job: sample, analysisVersion: 1, promptVersion: 1 });
    assert.ok(hit !== undefined, '同版本同 JD 应命中缓存');
    assert.equal(hit.analysis_version, 1);
});

test('同一岗位内容变化后缓存失效（jd_hash 变化）', () => {
    const analysis = parseJdByRule({ job: sample, dictionary, analysisVersion: 1, promptVersion: 1, now: NOW });
    const cache = writeCachedAnalysis(emptyJdCache(), { job: sample, analysis, now: NOW });
    const changed = { ...sample, description: 'ROS2 移动机器人开发，另外需要熟悉 Nav2 与 TF2。' };
    assert.notEqual(computeJdHash(changed), computeJdHash(sample), 'JD 文本变化后哈希必须变化');
    assert.equal(readCachedAnalysis(cache, { job: changed, analysisVersion: 1, promptVersion: 1 }), undefined);
});

test('analysis_version 升级导致缓存整体失效', () => {
    const analysis = parseJdByRule({ job: sample, dictionary, analysisVersion: 1, promptVersion: 1, now: NOW });
    const cache = writeCachedAnalysis(emptyJdCache(), { job: sample, analysis, now: NOW });
    assert.ok(readCachedAnalysis(cache, { job: sample, analysisVersion: 1, promptVersion: 1 }) !== undefined);
    assert.equal(readCachedAnalysis(cache, { job: sample, analysisVersion: 2, promptVersion: 1 }), undefined);
});

test('prompt_version 升级导致缓存整体失效', () => {
    const analysis = parseJdByRule({ job: sample, dictionary, analysisVersion: 1, promptVersion: 1, now: NOW });
    const cache = writeCachedAnalysis(emptyJdCache(), { job: sample, analysis, now: NOW });
    assert.equal(readCachedAnalysis(cache, { job: sample, analysisVersion: 1, promptVersion: 2 }), undefined);
});

test('pruneJdCache 丢弃旧版本条目并遵守条目上限', () => {
    let cache = emptyJdCache();
    const analysisV1 = parseJdByRule({ job: sample, dictionary, analysisVersion: 1, promptVersion: 1, now: NOW });
    cache = writeCachedAnalysis(cache, { job: sample, analysis: analysisV1, now: NOW });
    const analysisV2 = parseJdByRule({ job: sample, dictionary, analysisVersion: 2, promptVersion: 1, now: NOW });
    cache = writeCachedAnalysis(cache, { job: sample, analysis: analysisV2, now: NOW });

    const pruned = pruneJdCache(cache, { analysisVersion: 2, promptVersion: 1 });
    assert.equal(Object.keys(pruned.entries).length, 1, '只应保留当前版本条目');
    const stats = cacheStatsByVersion(pruned, { analysisVersion: 2, promptVersion: 1 });
    assert.equal(stats.eligible, 1);
    assert.equal(stats.stale, 0);
});

test('cacheStats 统计条目数与模型调用次数', () => {
    const analysis = parseJdByRule({ job: sample, dictionary, analysisVersion: 1, promptVersion: 1, now: NOW });
    const cache = writeCachedAnalysis(emptyJdCache(), { job: sample, analysis, now: NOW });
    const stats = cacheStats(cache);
    assert.equal(stats.total, 1);
    assert.equal(stats.llmCallsTotal, 0, '规则解析的模型调用数应为 0');
});

test('computeJobHash 区分不同岗位身份', () => {
    const other = job({ source: 'liepin', job_title: 'ROS2 开发', company: '乙', description: 'ROS2', source_job_id: 'y' });
    assert.notEqual(computeJobHash(sample), computeJobHash(other));
});

/* ============================================================================
 * 三、本地导入
 * ==========================================================================*/

test('按扩展名识别导入格式', () => {
    assert.equal(detectFormat('a/b.json'), 'json');
    assert.equal(detectFormat('a/b.CSV'), 'csv');
    assert.equal(detectFormat('a/b.md'), 'markdown');
});

test('JSON 导入：数组、{jobs:[]} 与单个对象都支持', () => {
    const single = parseJsonJobs(JSON.stringify([{ 岗位: 'ROS2 工程师', 公司: '甲', 城市: '上海', 薪资: '20-35K' }]));
    assert.equal(single.length, 1);
    assert.equal(single[0]?.job_title, 'ROS2 工程师');
    assert.equal(single[0]?.city, '上海');
    assert.equal(single[0]?.salary_text, '20-35K');
    assert.equal(single[0]?.source, 'local', '未指定来源时默认 local');

    const wrapped = parseJsonJobs(JSON.stringify({ jobs: [{ title: 'A', company: 'B' }] }));
    assert.equal(wrapped.length, 1);

    const bare = parseJsonJobs(JSON.stringify({ title: 'A', company: 'B' }));
    assert.equal(bare.length, 1);
});

test('JSON 导入：结构化数值字段会被合成为可读原文', () => {
    const [result] = parseJsonJobs(JSON.stringify([{ title: 'A', company: 'B', salary_min: 15, salary_max: 25 }]));
    assert.ok(result !== undefined);
    assert.equal(result.salary_text, '15-25K');
});

test('JSON 导入：缺岗位名或公司名的条目被跳过而不是抛错', () => {
    const results = parseJsonJobs(JSON.stringify([{ title: 'A' }, { company: 'B' }, { title: 'C', company: 'D' }]));
    assert.equal(results.length, 1);
    assert.equal(results[0]?.job_title, 'C');
});

test('CSV 导入：中英文表头、引号包裹与字段内逗号', () => {
    const csv = [
        '岗位,公司,城市,薪资,链接',
        'ROS2工程师,甲公司,上海,20-35K,https://www.zhipin.com/1',
        '"嵌入式,固件工程师",乙公司,杭州,18-30K,https://www.liepin.com/2',
    ].join('\n');
    const results = parseCsvJobs(csv);
    assert.equal(results.length, 2);
    assert.equal(results[1]?.job_title, '嵌入式,固件工程师');
    assert.equal(results[1]?.city, '杭州');
});

test('Markdown 导入：## 分块 + 键值行 + 正文归入描述', () => {
    const md = [
        '## ROS2 开发工程师',
        '- 公司：甲公司',
        '- 城市：上海',
        '- 薪资：20-35K',
        '- 链接：https://www.zhipin.com/1',
        '',
        '负责 ROS2 移动机器人开发。',
        '',
        '## 嵌入式软件工程师',
        '- 公司：乙公司',
        '- 城市：杭州',
    ].join('\n');
    const results = parseMarkdownJobs(md);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.job_title, 'ROS2 开发工程师');
    assert.equal(results[0]?.company, '甲公司');
    assert.ok(results[0]?.description?.includes('ROS2 移动机器人'));
});

test('导入的岗位经过 JobStore 后与采集路径产出完全相同的字段', () => {
    const [input] = parseJsonJobs(JSON.stringify([{ 岗位: 'ROS2 工程师', 公司: '甲', 城市: '上海', 薪资: '20-35K', 经验: '3-5年', 学历: '本科及以上' }]));
    assert.ok(input !== undefined);
    const created = job(input);
    assert.equal(created.job_title, 'ROS2 工程师');
    assert.equal(created.city, '上海');
    assert.equal(created.salary_min, 20);
    assert.equal(created.salary_max, 35);
    assert.equal(created.experience_min, 3);
    assert.equal(created.experience_max, 5);
    assert.equal(created.education, '本科');
    assert.ok(created.skills_normalized.includes('ros2'), '导入岗位同样要过技能标准化');
    assert.equal(created.seen_count, 1);
});

test('来源别名的中英文写法都能识别', () => {
    const [boss] = parseJsonJobs(JSON.stringify([{ title: 'A', company: 'B', 来源: 'BOSS直聘' }]));
    const [liepin] = parseJsonJobs(JSON.stringify([{ title: 'A', company: 'B', 来源: '猎聘' }]));
    assert.equal(boss?.source, 'boss');
    assert.equal(liepin?.source, 'liepin');
});
