/**
 * 端到端冒烟测试：不依赖 DSH 运行时，直接把插件当成真实插件激活一遍。
 *
 * 覆盖需求 §十九 的 MVP 验收链路：
 *   配置方向 → 导入岗位 → 去重 → 解析 JD → 标准化技能 → 市场统计
 *   → 个人技能等级 → Gap → TOP 学习优先级 → 8 周路线 → 数据回溯
 *
 * 用法：
 *   node scripts/smoke.mjs            # 用临时目录
 *   node scripts/smoke.mjs <工作区>    # 用指定目录，便于人工翻看产出
 *
 * 退出码 0 = 全链路通过；非 0 = 有断言失败。
 */

import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from '../dist/src/index.js';

let failures = 0;
const check = (label, condition, detail) => {
    if (condition) {
        console.log(`  ✔ ${label}`);
    } else {
        failures += 1;
        console.log(`  ✖ ${label}${detail === undefined ? '' : ` — ${detail}`}`);
    }
};

const section = (title) => console.log(`\n=== ${title} ===`);

/* ------------------------------------------------------------------ */
/* 搭一个最小的 DSH 宿主：工具/技能注册表 + 工作区注册表               */
/* ------------------------------------------------------------------ */

const workspaceRoot = process.argv[2] ?? (await mkdtemp(join(tmpdir(), 'job-market-smoke-')));
await mkdir(workspaceRoot, { recursive: true });

const SESSION_ID = 'smoke-session';
const registered = new Map();

const ctx = {
    tools: {
        register(tool) {
            registered.set(tool.name, tool);
            return () => registered.delete(tool.name);
        },
    },
    skills: {
        register() {
            return () => {};
        },
    },
    workspaceRegistry: {
        list: () => [{ id: 'ws-smoke', path: workspaceRoot, sessionIds: [SESSION_ID] }],
        get: (id) => (id === 'ws-smoke' ? { id, path: workspaceRoot, sessionIds: [SESSION_ID] } : undefined),
        resolveByPath: async (path) =>
            path === workspaceRoot ? { id: 'ws-smoke', path: workspaceRoot, sessionIds: [SESSION_ID] } : undefined,
    },
};

const exec = { agent: { id: SESSION_ID, session: { header: { cwd: workspaceRoot } } } };

const dispose = apply(ctx);
const call = async (name, args = {}) => {
    const tool = registered.get(name);
    if (tool === undefined) throw new Error(`工具未注册：${name}`);
    return await tool.execute(args, exec);
};

console.log(`工作区：${workspaceRoot}`);
console.log(`已注册工具数：${registered.size}`);

/* ------------------------------------------------------------------ */
section('0. 初始化工作区');
/* ------------------------------------------------------------------ */

const init = await call('job_market_init');
check('产出 taxonomy 文件路径', typeof init.taxonomyPath === 'string' && init.taxonomyPath.length > 0);
check('taxonomy 技能数 ≥ 150', init.taxonomySkillCount >= 150, `实际 ${init.taxonomySkillCount}`);

/* ------------------------------------------------------------------ */
section('1. 配置求职方向');
/* ------------------------------------------------------------------ */

await call('job_market_configure', {
    target_roles: ['机器人软件工程师', 'ROS2开发', '机器人控制算法', '机器人嵌入式工程师'],
    locations: ['上海', '杭州', '苏州', '南京'],
    experience_min: 0,
    experience_max: 3,
    salary_min_k: 15,
});

/* ------------------------------------------------------------------ */
section('2. 生成采集计划（只读 + 白名单）');
/* ------------------------------------------------------------------ */

const plan = await call('job_market_plan_collection', { max_targets: 40 });
check('生成了采集目标 URL', Array.isArray(plan.plan.targets) && plan.plan.targets.length > 0, `targets=${plan.plan.targets?.length}`);
check('全部 URL 为 https', plan.plan.targets.every((target) => target.url.startsWith('https://')));
check('BrowserSkill 可用性被如实上报', typeof plan.browserSkill.available === 'boolean');
console.log(`  · 展开关键词数：${plan.plan.keywords?.length ?? plan.plan.expanded_keywords?.length ?? 'n/a'}`);
console.log(`  · bsk 可用：${plan.browserSkill.available}${plan.browserSkill.available ? '' : '（将走本地导入兜底）'}`);

/* ------------------------------------------------------------------ */
section('3. 导入岗位（本地通道，含跨平台重复项）');
/* ------------------------------------------------------------------ */

// 同一岗位在 BOSS 与猎聘各出现一次，用于验证跨平台去重。
const duplicateAcrossPlatforms = {
    job_title: '机器人软件工程师',
    company: '上海某某智能科技有限公司',
    city: '上海',
    salary_text: '25-40K',
    experience_text: '3-5年',
    education: '本科及以上',
    description: '负责 ROS2 移动机器人软件开发，熟练掌握 C++ 与 Linux，使用 TF2 与 Nav2 完成导航。',
    requirements: ['熟练掌握 C++', '熟悉 ROS2', '熟悉 Linux'],
};

const seed = [
    { ...duplicateAcrossPlatforms, source: 'boss', url: 'https://www.zhipin.com/job/1001', source_job_id: '1001' },
    { ...duplicateAcrossPlatforms, company: '上海某某智能科技股份有限公司', source: 'liepin', url: 'https://www.liepin.com/job/2001', source_job_id: '2001' },
    { source: 'liepin', job_title: 'ROS2 开发工程师', company: '杭州某某机器人有限公司', city: '杭州', salary_text: '20-35K', experience_text: '1-3年', education: '本科', description: 'ROS2 机器人应用开发，熟悉 C++，了解 Python 优先，熟悉 rosbag 与 RViz 调试。', requirements: ['熟悉 C++', '了解 Python 优先'], url: 'https://www.liepin.com/job/2002', source_job_id: '2002' },
    { source: 'zhaopin', job_title: '机器人控制算法工程师', company: '苏州某某自动化有限公司', city: '苏州', salary_text: '22-38K', experience_text: '3-5年', education: '硕士', description: '运动控制算法开发，熟悉 PID、MPC 与动力学建模，用 C++ 实现，熟悉 Linux 与 ROS2。', requirements: ['精通 C++', '熟悉运动控制'], url: 'https://www.zhaopin.com/job/3001', source_job_id: '3001' },
    { source: 'zhaopin', job_title: '嵌入式软件工程师', company: '南京某某电子有限公司', city: '南京', salary_text: '15-25K', experience_text: '1-3年', education: '本科', description: 'STM32 单片机固件开发，熟悉 C 语言与 UART/I2C/SPI 通信协议，了解 FreeRTOS。', requirements: ['熟悉 C 语言', '熟悉 STM32'], url: 'https://www.zhaopin.com/job/3002', source_job_id: '3002' },
    { source: 'boss', job_title: 'SLAM 算法工程师', company: '上海某某导航有限公司', city: '上海', salary_text: '30-50K', experience_text: '3-5年', education: '硕士', description: '激光 SLAM 建图与定位算法开发，精通 C++ 与 Ceres、g2o 后端优化，熟悉 Linux 与 ROS2。', requirements: ['精通 C++', '熟悉 SLAM'], url: 'https://www.zhipin.com/job/1002', source_job_id: '1002' },
    { source: 'boss', job_title: '运动规划算法工程师', company: '杭州某某智能有限公司', city: '杭州', salary_text: '28-45K', experience_text: '3-5年', education: '硕士', description: '机器人路径规划与避障算法开发，熟悉 A*、RRT、TEB，用 C++ 实现，熟悉 ROS2 与 costmap。', requirements: ['精通 C++', '熟悉路径规划'], url: 'https://www.zhipin.com/job/1003', source_job_id: '1003' },
    { source: 'liepin', job_title: '机器人感知算法工程师', company: '上海某某视觉有限公司', city: '上海', salary_text: '25-45K', experience_text: '1-3年', education: '硕士', description: '机器人视觉感知算法开发，熟悉 OpenCV、点云处理与相机标定，用 C++ 与 Python。', requirements: ['熟悉 OpenCV', '熟悉 C++'], url: 'https://www.liepin.com/job/2003', source_job_id: '2003' },
    { source: 'zhaopin', job_title: '强化学习算法工程师', company: '苏州某某具身智能有限公司', city: '苏州', salary_text: '35-60K', experience_text: '1-3年', education: '博士', description: '具身智能强化学习算法研发，熟悉 PPO、SAC 与 sim2real，使用 Python 与 Isaac。', requirements: ['熟悉强化学习', '熟悉 Python'], url: 'https://www.zhaopin.com/job/3003', source_job_id: '3003' },
    { source: 'boss', job_title: '嵌入式驱动工程师', company: '南京某某驱动有限公司', city: '南京', salary_text: '16-26K', experience_text: '1-3年', education: '本科', description: '电机驱动固件开发，熟悉 STM32、CAN 总线与 PID 闭环控制。', requirements: ['熟悉 STM32', '熟悉电机控制'], url: 'https://www.zhipin.com/job/1004', source_job_id: '1004' },
    { source: 'liepin', job_title: 'ROS2 机器人软件工程师', company: '南京某某机器人有限公司', city: '南京', salary_text: '22-36K', experience_text: '3-5年', education: '本科', description: 'ROS2 机器人软件栈开发，熟悉 Nav2、MoveIt 与 micro-ROS，熟悉 C++ 与 Linux。', requirements: ['熟练掌握 C++', '熟悉 ROS2', '熟悉 Nav2'], url: 'https://www.liepin.com/job/2004', source_job_id: '2004' },
    { source: 'zhaopin', job_title: '机器人嵌入式工程师', company: '杭州某某控制有限公司', city: '杭州', salary_text: '18-30K', experience_text: '1-3年', education: '本科', description: '机器人嵌入式开发，STM32 与 micro-ROS 结合，熟悉 C 语言、CAN 总线与 FreeRTOS。', requirements: ['熟悉 C 语言', '熟悉 STM32', '了解 micro-ROS 优先'], url: 'https://www.zhaopin.com/job/3004', source_job_id: '3004' },
    { source: 'boss', job_title: '机器人系统工程师', company: '苏州某某系统有限公司', city: '苏州', salary_text: '24-40K', experience_text: '3-5年', education: '硕士', description: '机器人系统集成，熟悉 ROS2、TF2、URDF 与 Gazebo 仿真，熟悉 Linux 与 C++。', requirements: ['熟悉 ROS2', '熟练掌握 C++'], url: 'https://www.zhipin.com/job/1005', source_job_id: '1005' },
];

await mkdir(join(workspaceRoot, 'input'), { recursive: true });
await writeFile(join(workspaceRoot, 'input', 'jobs-seed.json'), JSON.stringify(seed, null, 2), 'utf8');

const imported = await call('job_market_import_jobs', { path: 'input/jobs-seed.json', format: 'json' });
check('解析出全部种子岗位', imported.parsed === seed.length, `parsed=${imported.parsed} seed=${seed.length}`);
check(
    '跨平台同一岗位被合并（12 条种子 → 11 个岗位）',
    imported.totalJobs === seed.length - 1,
    `totalJobs=${imported.totalJobs}`,
);
console.log(`  · 新增 ${imported.newJobs}，刷新 ${imported.updatedJobs}，池内合计 ${imported.totalJobs}`);

// 再导入一次同样内容：应当 0 新增、全部刷新 last_seen_at
const reimported = await call('job_market_import_jobs', { path: 'input/jobs-seed.json', format: 'json' });
check('重复导入不新增岗位', reimported.newJobs === 0, `newJobs=${reimported.newJobs}`);
check('重复导入全部记为刷新', reimported.updatedJobs === imported.totalJobs, `updatedJobs=${reimported.updatedJobs}`);
check('池内总数不变', reimported.totalJobs === imported.totalJobs);

/* ------------------------------------------------------------------ */
section('4. 录入个人技能等级');
/* ------------------------------------------------------------------ */

for (const [skill, current, target] of [
    ['C++', 3, 5],
    ['Linux', 2, 4],
    ['ROS2', 1, 4],
    ['Python', 3, 4],
    ['STM32', 2, 3],
]) {
    await call('job_market_set_skill', {
        skill,
        current_level: current,
        target_level: target,
        confirmed: true,
        evidence: [{ kind: 'project', title: `${skill} 相关课程项目`, detail: '课程设计' }],
    });
}
const profile = await call('job_market_get_skill_profile');
check('个人技能画像已记录 5 项', Object.keys(profile.profile.skills).length === 5);
check('全部为用户自评来源', Object.values(profile.profile.skills).every((item) => item.source === 'user'));

/* ------------------------------------------------------------------ */
section('5. 市场分析');
/* ------------------------------------------------------------------ */

const analysis = await call('job_market_analyze', {});
const snapshot = analysis.snapshot;
check('快照岗位数 = 池内岗位数', snapshot.job_count === imported.totalJobs, `job_count=${snapshot.job_count}`);
check('技能频次非空', snapshot.skill_frequencies.length > 0, `skills=${snapshot.skill_frequencies.length}`);
check('岗位方向数 ≥ 5', snapshot.categories.length >= 5, `categories=${snapshot.categories.length}`);
check('共现对非空', snapshot.cooccurrence.length > 0, `pairs=${snapshot.cooccurrence.length}`);
check(
    '三档强度是划分（required+preferred+bonus == job_count）',
    snapshot.skill_frequencies.every((f) => f.required_count + f.preferred_count + f.bonus_count === f.job_count),
);
check(
    '每个技能都可回溯到岗位 ID',
    snapshot.skill_frequencies.every((f) => f.job_ids.length === f.job_count),
);
check('本轮 JD 解析未调用模型', analysis.jdParsing.llmCalls === 0);

console.log('\n  技能需求排行（TOP 12）：');
console.log('  技能            岗位数  出现率  Required  Preferred  加权需求');
for (const skill of snapshot.skill_frequencies.slice(0, 12)) {
    const pct = (v) => `${(v * 100).toFixed(1)}%`.padStart(7);
    console.log(
        `  ${skill.skill.padEnd(16)}${String(skill.job_count).padStart(4)}${pct(skill.job_ratio)}${pct(
            skill.required_ratio,
        )}${pct(skill.preferred_ratio)}${skill.weighted_demand.toFixed(3).padStart(10)}`,
    );
}

console.log('\n  岗位方向分布：');
for (const category of snapshot.categories) {
    console.log(`  ${category.label.padEnd(14)}${String(category.job_count).padStart(3)} 个岗位  (${(category.job_ratio * 100).toFixed(1)}%)`);
}

/* ------------------------------------------------------------------ */
section('6. 数据回溯（点 68% 能看到是哪些岗位）');
/* ------------------------------------------------------------------ */

const trace = await call('job_market_trace_skill', { skill: 'ROS2' });
check('回溯到 ros2 技能', trace.skill_id === 'ros2');
check('回溯岗位数 = 统计岗位数', trace.jobs.length === trace.job_count, `jobs=${trace.jobs.length} count=${trace.job_count}`);
check('每个岗位都带原始 URL', trace.jobs.every((job) => job.url.startsWith('https://')));
console.log(`  · ROS2 出现 ${trace.job_count} 次，要求它的真实岗位：`);
for (const job of trace.jobs.slice(0, 5)) console.log(`      ${job.company} — ${job.job_title} (${job.source})`);

/* ------------------------------------------------------------------ */
section('7. Gap 与 8 周学习计划');
/* ------------------------------------------------------------------ */

const planned = await call('job_market_plan_learning', { weeks: 8 });
check('产出 Gap 条目', planned.gap.entries.length > 0, `entries=${planned.gap.entries.length}`);
check('每个 Gap 条目都有解释', planned.gap.entries.every((entry) => typeof entry.explanation === 'string' && entry.explanation.length > 0));
check('优先级降序', planned.gap.entries.every((entry, index) => index === 0 || planned.gap.entries[index - 1].priority >= entry.priority));
check('路线为 8 周', planned.roadmap.weeks.length === 8);
check(
    '每周都有验收条件与项目产出',
    planned.roadmap.weeks.every((week) => week.acceptance.length > 0 && week.deliverable.length > 0),
);
check('每个目标都有验收标准', planned.goals.every((goal) => goal.acceptance_criteria.length > 0));
check('目标标题不是「学习 X」式', planned.goals.every((goal) => !/^学习/.test(goal.title)));
check('路线绑定了快照 ID', planned.roadmap.based_on_snapshot_id === snapshot.snapshot_id);

console.log('\n  TOP 10 学习优先级：');
console.log('  #   技能            市场占比  当前→目标  Gap    优先级   理由');
for (const entry of planned.gap.entries.slice(0, 10)) {
    console.log(
        `  ${String(entry.rank).padEnd(4)}${entry.skill.padEnd(16)}${(entry.market_demand * 100)
            .toFixed(1)
            .padStart(6)}%   ${entry.current_level}→${entry.target_level}      ${entry.skill_gap.toFixed(2)}  ${entry.priority
            .toFixed(3)
            .padStart(7)}  ${entry.explanation.slice(0, 42)}`,
    );
}

console.log('\n  8 周路线：');
for (const week of planned.roadmap.weeks) {
    console.log(
        `  第 ${String(week.week).padStart(2)} 周 | ${week.goal.slice(0, 46).padEnd(48)} | ${String(
            week.covered_job_count,
        ).padStart(2)} 岗位 | ${week.estimated_hours}h`,
    );
}

/* ------------------------------------------------------------------ */
section('8. 增量更新与动态调整');
/* ------------------------------------------------------------------ */

const updated = await call('job_market_update');
check('快照数量 ≥ 2', updated.snapshotCount >= 2, `count=${updated.snapshotCount}`);
check('调整策略为增量', updated.policy.includes('增量'));
if (updated.adjustment !== null) {
    check('调整声明 policy = incremental', updated.adjustment.policy === 'incremental');
    check('每条调整都有原因', updated.adjustment.changes.every((change) => change.reason.length > 0));
    console.log(`  · 调整建议 ${updated.adjustment.changes.length} 条：${updated.adjustment.summary}`);
} else {
    console.log('  · 本轮无调整建议（首轮或无变化）');
}

const trends = await call('job_market_trends', { limit: 10 });
check('趋势接口可用（累计两次快照）', Array.isArray(trends.trends));
console.log(`  · 趋势条数：${trends.trends.length}`);

/* ------------------------------------------------------------------ */
section('9. 状态汇总');
/* ------------------------------------------------------------------ */

const status = await call('job_market_status');
check('状态含岗位数', status.jobCount === imported.totalJobs);
check('状态声明只读采集', status.policy.readOnlyCollection === true);
check('状态声明不自动投递', status.policy.autoApply === false);
console.log(`  · 工作区：${status.workspaceRoot}`);
console.log(`  · 岗位 ${status.jobCount} / 方向 ${status.categoryCount} / 城市 ${status.cityCount} / 快照 ${status.snapshotCount}`);
console.log(`  · 个人技能 ${status.personalSkillCount}（已确认 ${status.confirmedSkillCount}）/ 目标 ${status.goalCount}`);
console.log(`  · 已缓存 JD 分析 ${status.llm.cachedAnalyses} 条，模型调用 0 次`);

/* ------------------------------------------------------------------ */
section('10. 产出文件');
/* ------------------------------------------------------------------ */

for (const relative of [
    'data/jobs.json',
    'data/jd-cache.json',
    'data/market-snapshots.json',
    'data/learning-goals.json',
    'data/learning-roadmap.json',
    'profile/personal-skills.json',
    'config/job-search.json',
    'taxonomy/skill-taxonomy.json',
]) {
    try {
        const content = await readFile(join(workspaceRoot, relative), 'utf8');
        const parsed = JSON.parse(content);
        const size = Array.isArray(parsed) ? `${parsed.length} 项` : `${Object.keys(parsed).length} 键`;
        console.log(`  ✔ ${relative.padEnd(34)} ${(content.length / 1024).toFixed(1)} KB (${size})`);
    } catch (error) {
        failures += 1;
        console.log(`  ✖ ${relative} — ${error.message}`);
    }
}

dispose();

console.log(`\n${'='.repeat(64)}`);
if (failures === 0) {
    console.log('全链路通过：0 个失败。');
} else {
    console.log(`存在 ${failures} 个失败项。`);
}
process.exitCode = failures === 0 ? 0 : 1;
