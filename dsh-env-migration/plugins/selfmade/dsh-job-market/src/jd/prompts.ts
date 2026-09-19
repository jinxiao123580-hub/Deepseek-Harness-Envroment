/**
 * jd/prompts —— JD 解析相关的共享提示词片段。
 *
 * 本插件 **自己不发任何模型调用**：DSH 宿主 Agent 负责推理。
 * 因此这里的字符串是「交给宿主 Agent 的严格 JSON 请求」的公共部分，
 * 由 `buildJdAnalysisPrompt` 组装后交给宿主。
 *
 * 红线（需求 §十六）：
 *  - 模型只允许 解析 / 分类 / 归一化 / 解释；
 *  - 模型 **不得** 编造数量、比例、薪资、岗位数、趋势；
 *  - 模型只能输出严格 JSON。
 */

/** 系统提示词：划定模型权限边界，并强制 JSON 输出。 */
export const JD_SYSTEM_PROMPT: string = [
    '你是招聘 JD 结构化解析器，只做四件事：解析、分类、归一化、解释。',
    '绝对禁止：编造或推断任何数量、比例、薪资、岗位数、增长趋势、排名。',
    '上述统计一律由程序基于真实岗位记录计算，你不得给出任何数字型结论。',
    '绝对禁止：臆造 JD 中未出现的技能、学历、经验要求。没写就留空字符串或空数组。',
    '技能名必须归一化为业内通行的规范写法（如 ROS 2 → ROS2，c++17 → C++）。',
    '只输出严格 JSON：不加 Markdown 代码块标记，不加解释文字，不加注释，不输出多余字段。',
].join('\n');

/** `ParsedJd` 的精确 JSON 骨架（17 个键，全部为空），作为输出契约。 */
export const JD_JSON_SKELETON: string = JSON.stringify(
    {
        category: '',
        core_skills: [],
        optional_skills: [],
        programming_languages: [],
        frameworks: [],
        robotics_skills: [],
        embedded_skills: [],
        algorithm_skills: [],
        tools: [],
        os_platforms: [],
        hardware: [],
        communication_protocols: [],
        degree_requirement: '',
        experience_requirement: '',
        domain_knowledge: [],
        responsibilities: [],
        keywords: [],
    },
    null,
    2,
);

/** 输出规则清单（中文），用于约束模型行为。 */
export const JD_OUTPUT_RULES: string[] = [
    '字段必须与给定 JSON 骨架完全一致：键名、类型、层级都不得增删改；不想填的字段用空字符串或空数组。',
    '技能必须按强度拆开：core_skills 只放硬性要求，optional_skills 放「优先/加分」类要求。',
    'required（硬性）判断示例：「熟练掌握 C++」「精通 C++」「精通/熟悉 ROS2 并具备独立开发能力」。',
    'preferred（优先）判断示例：「了解 Python 优先」「有 ROS2 经验者优先」「熟悉 Gazebo 更佳」。',
    'bonus（加分）判断示例：「有 Isaac Sim 经验者加分」「有顶会论文是加分项」「了解 Rust 更好」。',
    '同一技能同时出现在硬性要求与加分项时，按硬性要求放入 core_skills，不得重复计数。',
    'category 只能取以下之一：robotics-software、robotics-control、ros2、embedded、motion-planning、slam、perception、rl-embodied、unknown。',
    'degree_requirement 只允许填：不限 / 高中 / 中专/中技 / 大专 / 本科 / 硕士 / 博士 之一，或原始文本片段；JD 未写则填空字符串。',
    'experience_requirement 填经验原文片段（如「3-5年」「应届生」「经验不限」），JD 未写则填空字符串。',
    'domain_knowledge 填行业/领域类名词短语（如「自动驾驶」「工业机器人」「具身智能」），不要放具体技能。',
    'responsibilities 逐条保留 JD 原文的职责描述，可轻微合并同类项，但不得新增原文没有的职责。',
    'keywords 填 5-15 个检索关键词，优先 JD 中真实出现的词，不得编造。',
    '数组元素必须是字符串，不得嵌套对象或数组，不得出现 null。',
    '不要输出任何统计、比例、薪资、岗位数量或趋势判断。',
];

/** 职责一句话总结的提示词（唯一允许的解释类用法，且不得引入数字）。 */
export const RESPONSIBILITY_SUMMARY_PROMPT: string = [
    '请把下列岗位职责压缩成一句中文总结（不超过 60 字）。',
    '要求：只做归纳，不得新增原文没有的职责；不得出现任何数字、比例或薪资；',
    '不得评价岗位好坏；直接输出这一句话，不要 JSON，不要前后缀。',
].join('\n');

/** 方向分类澄清提示词：仅在规则打分置信度过低时使用。 */
export const CATEGORY_DISAMBIGUATION_PROMPT: string = [
    '下面是一条机器人/嵌入式岗位的职位名与关键描述，规则分类结果置信度很低。',
    '请只做分类澄清，从下列选项中选出一个最贴近的：',
    'robotics-software（机器人软件）、robotics-control（机器人控制）、ros2（ROS2）、embedded（嵌入式）、',
    'motion-planning（运动规划）、slam（SLAM）、perception（机器人感知）、rl-embodied（强化学习/具身智能）、unknown（未分类）。',
    '只输出严格 JSON：{"category":"<选项之一>","reason":"<不超过 40 字的中文理由>"}。',
    '禁止输出任何数量、比例、薪资或趋势判断。',
].join('\n');
