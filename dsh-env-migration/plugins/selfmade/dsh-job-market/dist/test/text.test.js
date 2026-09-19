import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompanyForDedupe, normalizeEducation, normalizeJobTitleForDedupe, normalizeUrl, normalizeWhitespace, parseExperience, parseLocation, parseSalary, uniquePreserveOrder, } from '../src/shared/text.js';
test('normalizeWhitespace 折叠空白并去首尾空格', () => {
    assert.equal(normalizeWhitespace('  a   b\n c\t'), 'a b c');
    assert.equal(normalizeWhitespace(undefined), '');
    assert.equal(normalizeWhitespace('　全角　空格　'), '全角 空格');
});
test('uniquePreserveOrder 保序去重', () => {
    assert.deepEqual(uniquePreserveOrder(['b', 'a', 'b', 'c', 'a']), ['b', 'a', 'c']);
});
test('parseSalary 解析 K/月 区间', () => {
    const result = parseSalary('15-25K');
    assert.equal(result.min, 15);
    assert.equal(result.max, 25);
    assert.equal(result.months, undefined);
});
test('parseSalary 解析 13 薪且不把薪数当作薪资', () => {
    const result = parseSalary('15-25K·13薪');
    assert.equal(result.min, 15);
    assert.equal(result.max, 25);
    assert.equal(result.months, 13);
});
test('parseSalary 解析「万」区间（第二个数字带单位时继承到第一个）', () => {
    const result = parseSalary('1.5-2.5万');
    assert.equal(result.min, 15);
    assert.equal(result.max, 25);
});
test('parseSalary 解析年薪并折算为月薪', () => {
    const result = parseSalary('25-45万/年');
    assert.equal(result.min, 20.8);
    assert.equal(result.max, 37.5);
});
test('parseSalary 解析混合单位「8千-1.2万」', () => {
    const result = parseSalary('8千-1.2万');
    assert.equal(result.min, 8);
    assert.equal(result.max, 12);
});
test('parseSalary 解析日薪并折算为月薪', () => {
    const result = parseSalary('600元/天');
    assert.equal(result.min, 13.1);
});
test('parseSalary 处理「面议」与开区间', () => {
    const negotiable = parseSalary('面议');
    assert.equal(negotiable.min, undefined);
    assert.equal(negotiable.max, undefined);
    assert.equal(negotiable.text, '面议');
    const openEnded = parseSalary('15K以上');
    assert.equal(openEnded.min, 15);
    assert.equal(openEnded.max, undefined);
});
test('parseSalary 始终保留原文便于回溯', () => {
    assert.equal(parseSalary('20-40K·14薪').text, '20-40K·14薪');
});
test('parseExperience 解析年数区间与开区间', () => {
    assert.deepEqual(pick(parseExperience('3-5年')), { min: 3, max: 5 });
    assert.deepEqual(pick(parseExperience('3年以上')), { min: 3, max: undefined });
    assert.deepEqual(pick(parseExperience('1年以内')), { min: 0, max: 1 });
    assert.deepEqual(pick(parseExperience('应届生')), { min: 0, max: 1 });
    assert.deepEqual(pick(parseExperience('经验不限')), { min: undefined, max: undefined });
    assert.deepEqual(pick(parseExperience('5年')), { min: 5, max: 5 });
});
test('parseLocation 拆分城市与区县', () => {
    assert.equal(parseLocation('上海·浦东新区').city, '上海');
    assert.equal(parseLocation('上海·浦东新区').district, '浦东新区');
    assert.equal(parseLocation('北京-海淀区').city, '北京');
    assert.equal(parseLocation('上海浦东新区').city, '上海');
    assert.equal(parseLocation('上海浦东新区').district, '浦东新区');
    assert.equal(parseLocation('杭州').city, '杭州');
    assert.equal(parseLocation('杭州市').city, '杭州');
});
test('normalizeEducation 取文中最高学历', () => {
    assert.equal(normalizeEducation('本科及以上'), '本科');
    assert.equal(normalizeEducation('硕士优先'), '硕士');
    assert.equal(normalizeEducation('大专以上'), '大专');
    assert.equal(normalizeEducation('博士'), '博士');
    assert.equal(normalizeEducation('学历不限'), '不限');
});
test('normalizeUrl 去 hash、去尾斜杠、排序查询参数', () => {
    assert.equal(normalizeUrl('https://x.com/a/b/?b=2&a=1#frag'), 'https://x.com/a/b?a=1&b=2');
    assert.equal(normalizeUrl('https://x.com/'), 'https://x.com/');
    assert.equal(normalizeUrl(''), '');
});
test('normalizeCompanyForDedupe 合并公司后缀差异', () => {
    const a = normalizeCompanyForDedupe('上海某某科技有限公司');
    const b = normalizeCompanyForDedupe('上海某某科技');
    const c = normalizeCompanyForDedupe('上海某某科技有限公司（北京分公司）');
    assert.equal(a, b);
    assert.equal(a, c);
});
test('normalizeJobTitleForDedupe 去掉职级与括号后缀', () => {
    const a = normalizeJobTitleForDedupe('高级机器人软件工程师（ROS2）');
    const b = normalizeJobTitleForDedupe('机器人软件工程师');
    assert.equal(a, b);
});
const pick = (value) => ({
    min: value.min,
    max: value.max,
});
//# sourceMappingURL=text.test.js.map