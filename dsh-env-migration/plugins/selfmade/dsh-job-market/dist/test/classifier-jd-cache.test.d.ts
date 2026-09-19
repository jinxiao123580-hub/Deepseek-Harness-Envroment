/**
 * 岗位分类、JD 解析缓存与本地导入测试（需求 §五 / §十七 / §二十）。
 *
 * 重点验证：
 *  1. 所有岗位必经分类器，且方向差异大的岗位不会被混类
 *  2. JD 缓存键 = jd_hash + analysis_version + prompt_version：JD 未变不重算
 *  3. 解析规则或提示词升级时缓存整体失效
 *  4. 本地 JSON / CSV / Markdown 三条导入通道都能产出规范岗位输入
 */
export {};
