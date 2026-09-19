/**
 * 技能标准化测试（需求 §六 —— 系统核心，禁止按字符串统计）。
 *
 * 重点验证：
 *  1. 同一技能的各种写法归一到同一个 ID
 *  2. 上位技能（implies）会被自动补齐，例如 Nav2 → ROS2
 *  3. ASCII 别名遵守词边界，不会把 "ROS" 误当成 "ROS2" 的前缀命中
 *  4. 最长优先匹配，不重叠消费
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSkillIndex, createSkillDictionary, loadTaxonomy } from '../src/taxonomy/taxonomy.js';
import { canonicalSkillIds, normalizeAlias, normalizeWithReport } from '../src/taxonomy/skill-normalizer.js';

const { taxonomy } = await loadTaxonomy();
const dictionary = createSkillDictionary(taxonomy);
const skillIndex = buildSkillIndex(taxonomy);

const normalize = (text: string): string[] => canonicalSkillIds(text, dictionary, skillIndex);

test('C++ 的多种写法统一归一到 cpp', () => {
    for (const raw of ['C++', 'c++', 'CPP', 'C/C++', 'C++语言']) {
        assert.ok(normalize(raw).includes('cpp'), `${raw} 应归一到 cpp`);
    }
});

test('C++11/14/17 同时命中 cpp 与 modern-cpp', () => {
    const ids = normalize('熟练掌握 C++11/14/17 新特性');
    assert.ok(ids.includes('cpp'), '应包含 cpp');
    assert.ok(ids.includes('modern-cpp'), '应包含 modern-cpp');
});

test('ROS2 的全部写法统一归一到 ros2', () => {
    for (const raw of ['ROS 2', 'ROS2', 'ros2.0', 'Robot Operating System 2', 'ROS2 Humble']) {
        assert.ok(normalize(raw).includes('ros2'), `${raw} 应归一到 ros2`);
    }
});

test('Ubuntu 归入 Linux 且保留 Ubuntu 子标签', () => {
    const ids = normalize('在 Ubuntu 22.04 下开发');
    assert.ok(ids.includes('ubuntu'), '应保留 ubuntu 子标签');
    assert.ok(ids.includes('linux'), '应通过 implies 补齐上位技能 linux');
});

test('内嵌技能自动补齐上位技能：Nav2 → ROS2', () => {
    const ids = normalize('熟悉 Nav2 导航栈');
    assert.ok(ids.includes('nav2'));
    assert.ok(ids.includes('ros2'), 'nav2 的 implies 应带出 ros2');
});

test('TF2 自动带出 ROS2', () => {
    const ids = normalize('掌握 TF2 坐标变换');
    assert.ok(ids.includes('tf2'));
    assert.ok(ids.includes('ros2'));
});

test('STM32 自动带出 MCU 上位技能', () => {
    assert.ok(normalize('STM32F407 驱动开发').includes('mcu'));
});

test('ASCII 别名遵守词边界，不会误命中', () => {
    // "g2o" 出现在 "g2o" 独立词里应命中；出现在更长标识符里不应命中
    assert.ok(normalize('使用 g2o 做后端优化').includes('g2o'));
    assert.ok(!normalize('ag2ox').includes('g2o'), '不应在更长的 ASCII 词内部命中');
});

test('最长优先匹配：ros2 优先于 ros1 之类的短别名，且不重叠消费', () => {
    const ids = normalize('ROS2 与 navigation2');
    assert.ok(ids.includes('ros2'));
    assert.ok(ids.includes('nav2'));
    // 只应出现一次 ros2（去重）
    assert.equal(ids.filter((id) => id === 'ros2').length, 1);
});

test('不相关岗位文本不会产生跨方向技能污染', () => {
    const embedded = normalize('嵌入式 C 语言单片机开发，熟悉 UART/I2C/SPI');
    assert.ok(!embedded.includes('ceres'), '嵌入式文本不应带出 SLAM 专属技能 ceres');
    assert.ok(!embedded.includes('g2o'));
});

test('normalizeAlias 做大小写与空白归一', () => {
    assert.equal(normalizeAlias('  ROS 2 '), 'ros 2');
    assert.equal(normalizeAlias('C++'), 'c++');
});

test('normalizeWithReport 逐条报告命中与未命中，未命中带原因', () => {
    const report = normalizeWithReport(['ROS2', '完全不存在的技能XYZ'], dictionary, skillIndex);
    assert.equal(report.missed.length, 1, '未命中项应进入 missed');
    assert.equal(report.missed[0]?.raw, '完全不存在的技能XYZ');
    assert.ok(report.missed[0]?.reason !== undefined, '未命中必须给出原因');
    // 注意：normalizeSkillToken 期望「单个技能别名」，因此这里传的是裸别名而非整句 JD。
    const ros2 = report.normalized.find((item) => item.skill_id === 'ros2');
    assert.ok(ros2 !== undefined, 'ros2 应被归一化');
});
