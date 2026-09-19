import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fnv1a32, hashValue, stableStringify } from '../src/shared/hash.js';
import {
    buildDedupeKey,
    buildPlatformKey,
    createJob,
    mergeJob,
    makeJobId,
    upsertJobs,
} from '../src/store/job-store.js';
import type { Job, JobInput } from '../src/shared/types.js';

const DAY1 = '2026-09-01T08:00:00.000Z';
const DAY2 = '2026-09-15T08:00:00.000Z';

const baseInput = (overrides: Partial<JobInput> = {}): JobInput => ({
    source: 'boss',
    url: 'https://www.zhipin.com/job_detail/abc123.html',
    job_title: '机器人软件工程师',
    company: '上海某某科技有限公司',
    location: '上海·浦东新区',
    salary_text: '20-35K·14薪',
    experience_text: '3-5年',
    education: '本科及以上',
    description: '负责 ROS2 机器人软件开发，熟悉 C++17 与 Linux。',
    requirements: ['熟练掌握 C++', '熟悉 ROS2 与 Linux', '了解 Python 优先'],
    collected_at: DAY1,
    ...overrides,
});

test('fnv1a32 与上游 job-ledger.hashString 算法一致', () => {
    const upstream = (value: string): string => {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    };
    for (const sample of ['', 'a', 'url:https://x.com/1', '上海某某科技|机器人软件工程师|上海']) {
        assert.equal(fnv1a32(sample), upstream(sample));
    }
});

test('stableStringify 键序无关', () => {
    assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
    assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test('hashValue 命名空间隔离', () => {
    assert.notEqual(hashValue('jd', 'x'), hashValue('job', 'x'));
});

test('createJob 解析薪资/经验/学历/地点', () => {
    const job = createJob(baseInput());
    assert.equal(job.salary_min, 20);
    assert.equal(job.salary_max, 35);
    assert.equal(job.salary_months, 14);
    assert.equal(job.experience_min, 3);
    assert.equal(job.experience_max, 5);
    assert.equal(job.education, '本科');
    assert.equal(job.city, '上海');
    assert.equal(job.district, '浦东新区');
    assert.equal(job.sources.length, 1);
    assert.equal(job.seen_count, 1);
    assert.equal(job.collected_at, DAY1);
    assert.equal(job.first_seen_at, DAY1);
    assert.equal(job.last_seen_at, DAY1);
});

test('buildDedupeKey 不含来源平台，因此可跨平台', () => {
    const a = buildDedupeKey({ company: '上海某某科技有限公司', job_title: '机器人软件工程师', city: '上海' });
    const b = buildDedupeKey({ company: '上海某某科技', job_title: '高级机器人软件工程师（ROS2）', city: '上海' });
    assert.equal(a, b);
});

test('buildPlatformKey 优先 URL', () => {
    const key = buildPlatformKey({
        source: 'boss',
        url: 'https://www.zhipin.com/job_detail/abc123.html#x',
        company: 'A',
        job_title: 'B',
    });
    assert.ok(key.startsWith('url:'));
    assert.ok(!key.includes('#'));
});

test('makeJobId 稳定且带 job- 前缀', () => {
    const key = buildDedupeKey({ company: 'A科技有限公司', job_title: '软件工程师', city: '上海' });
    assert.equal(makeJobId(key), makeJobId(key));
    assert.ok(makeJobId(key).startsWith('job-'));
});

test('upsertJobs：同一岗位重复采集不新增计数，只刷新 last_seen_at', () => {
    const first = createJob(baseInput({ collected_at: DAY1 }));
    const again = createJob(baseInput({ collected_at: DAY2 }));

    const result = upsertJobs([first], [again], DAY2);

    assert.equal(result.jobs.length, 1, '重复岗位不应新增');
    assert.deepEqual(result.newJobIds, []);
    assert.deepEqual(result.updatedJobIds, [first.job_id]);

    const merged = result.jobs[0] as Job;
    assert.equal(merged.job_id, first.job_id, '应保留首次采集的 job_id');
    assert.equal(merged.seen_count, 2);
    assert.equal(merged.first_seen_at, DAY1);
    assert.equal(merged.last_seen_at, DAY2, 'last_seen_at 应刷新到最近一次');
});

test('upsertJobs：跨平台同一岗位合并为一个岗位并记录两个来源', () => {
    const onBoss = createJob(baseInput({ source: 'boss' }));
    const onLiepin = createJob(
        baseInput({
            source: 'liepin',
            url: 'https://www.liepin.com/job/999888.shtml',
        }),
    );

    assert.notEqual(onBoss.platform_key, onLiepin.platform_key, '不同平台 platform_key 应不同');
    assert.equal(onBoss.dedupe_key, onLiepin.dedupe_key, '不同平台 dedupe_key 应相同');

    const result = upsertJobs([onBoss], [onLiepin], DAY2);

    assert.equal(result.jobs.length, 1, '跨平台同一岗位只应计一次');
    assert.deepEqual(result.newJobIds, []);
    const merged = result.jobs[0] as Job;
    assert.deepEqual([...merged.sources].sort(), ['boss', 'liepin']);
});

test('upsertJobs：不同岗位正常新增', () => {
    const a = createJob(baseInput());
    const b = createJob(
        baseInput({
            job_title: '嵌入式软件工程师',
            company: '杭州另一家公司',
            url: 'https://www.zhipin.com/job_detail/zzz.html',
        }),
    );
    const result = upsertJobs([a], [b], DAY1);
    assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.newJobIds, [b.job_id]);
    assert.deepEqual(result.updatedJobIds, []);
});

test('upsertJobs：跨日期增量只更新已存在岗位', () => {
    const first = createJob(baseInput({ collected_at: DAY1 }));
    const second = createJob(
        baseInput({
            job_title: 'SLAM算法工程师',
            company: '北京某公司',
            url: 'https://www.zhipin.com/job_detail/slam.html',
            collected_at: DAY1,
        }),
    );
    const run1 = upsertJobs([], [first, second], DAY1);
    assert.equal(run1.newJobIds.length, 2);

    const revisitFirst = createJob(baseInput({ collected_at: DAY2 }));
    const run2 = upsertJobs(run1.jobs, [revisitFirst], DAY2);

    assert.equal(run2.jobs.length, 2, '第二轮不应新增岗位');
    assert.deepEqual(run2.newJobIds, []);
    assert.deepEqual(run2.updatedJobIds, [first.job_id]);
});

test('mergeJob 补齐缺失字段但不覆盖已有值', () => {
    const sparse = createJob(
        baseInput({ url: 'https://www.zhipin.com/job_detail/a.html', salary_text: undefined, description: undefined }),
    );
    const rich = createJob(
        baseInput({ url: 'https://www.zhipin.com/job_detail/b.html', salary_text: '30-50K' }),
    );
    const merged = mergeJob(sparse, rich, DAY2);
    assert.equal(merged.salary_min, 30, '缺失字段应被补齐');
    assert.equal(merged.job_id, sparse.job_id, 'job_id 保持首次采集');
    assert.ok(merged.description !== undefined);
});

test('mergeJob 合并技能并按需去重', () => {
    const a = createJob(baseInput());
    a.skills_normalized = ['cpp', 'ros2'];
    const b = createJob(baseInput());
    b.skills_normalized = ['ros2', 'linux'];
    const merged = mergeJob(a, b, DAY2);
    assert.deepEqual(merged.skills_normalized, ['cpp', 'ros2', 'linux']);
});
