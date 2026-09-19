/**
 * dsh-job-market 运行时 Skill。
 *
 * 与上游 `dsh-job-hunting/dist/src/skill/job-hunting.skill.js` 相同的注册形状：
 * `{ name, description, whenToUse, source: 'runtime', content }`。
 *
 * 这个 content 是给宿主 agent 读的「作业指导书」：它规定了统计数字只能来自工具、
 * 采集必须只读、以及三个典型请求应当如何拆解成工具调用。
 */
export declare const jobMarketSkill: {
    name: string;
    description: string;
    whenToUse: string;
    source: 'runtime';
    content: string;
};
export type JobMarketSkillRegistration = typeof jobMarketSkill;
