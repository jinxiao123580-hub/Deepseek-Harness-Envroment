/**
 * dsh-job-market 运行时 Skill。
 *
 * 与上游 `dsh-job-hunting/dist/src/skill/job-hunting.skill.js` 相同的注册形状：
 * `{ name, description, whenToUse, source: 'runtime', content }`。
 *
 * 这个 content 是给宿主 agent 读的「作业指导书」：它规定了统计数字只能来自工具、
 * 采集必须只读、以及三个典型请求应当如何拆解成工具调用。
 */
export const jobMarketSkill = {
    name: 'job-market',
    description:
        '基于真实招聘岗位的市场需求分析与学习路线规划：自动采集岗位、跨平台去重、结构化解析 JD、技能标准化、统计市场需求与共现、维护个人技能画像、计算能力差距与学习优先级，并生成 4/8/12 周学习路线。只做市场分析与学习规划，不做自动投递。',
    whenToUse:
        '当用户想了解某类岗位的真实市场需求、想知道自己与市场的能力差距、想生成或调整学习计划、想更新求职市场数据时使用。例如「分析一下现在机器人软件岗位需要什么」「根据目前岗位市场给我生成未来8周学习计划」「更新一下求职市场」。',
    source: 'runtime' as const,
    content: `
使用 job_market_* 工具完成「市场需求分析 + 学习规划」闭环。

【绝对禁止的能力边界】
不做自动投递、不自动打招呼、不自动聊天、不自动填写申请、不简历海投。
招聘网站采集必须保持只读。不得绕过验证码、绕过登录限制、规避平台风控。
遇到 CAPTCHA、登录过期、限制页面或结构未知时，立即停止该平台并提示人工处理。

【最重要的一条规则：数字必须来自工具，不能来自你的常识】
所有岗位数量、技能出现率、Required/Preferred 比例、薪资中位数、趋势变化，
必须由 job_market_* 工具基于真实采集到的岗位数据计算。
你（模型）只允许做：解析、分类、归一化、解释。
严禁凭印象编造「ROS2 大约占 70%」这类比例。如果工具没有数据，就如实说明缺少数据，
并引导用户先执行一次采集。

【典型请求的处理流程】

1) 用户说「分析一下现在机器人软件岗位需要什么」
   a. 先调用 job_market_status 查看岗位库现状（岗位数、解析覆盖率、上次采集时间）。
   b. 若岗位数为 0 或明显不足（低于配置的 min_jobs_for_stats），
      调用 job_market_plan_collection 生成采集计划（它会按目标岗位自动扩展搜索词），
      向用户展示将要访问的白名单 URL，取得明确确认后再调用 job_market_collect_jobs。
   c. 调用 job_market_analyze_market 生成市场快照（技能频率 / 共现 / 分方向统计）。
   d. 调用 job_market_dashboard 取回 Dashboard 数据，据此用中文向用户解释市场，
      并在解释中引用工具返回的真实百分比与岗位数。
   e. 若用户追问「ROS2 68% 是哪些岗位」，用快照中该技能的 job_ids 回溯真实岗位列表。

2) 用户说「根据目前岗位市场给我生成未来8周学习计划」
   a. 确认已有最新的市场快照（没有就先走上面第 1 步）。
   b. 调用 job_market_get_skill_profile 读取用户当前技能等级；
      若为空或过旧，先引导用户用 job_market_set_skill 录入 0-5 级与证据。
      绝不可自行假定用户已掌握某项技能。
   c. 调用 job_market_analyze_gap 得到带可解释因子的学习优先级 TOP N。
   d. 调用 job_market_plan_roadmap（默认 8 周，可选 4/12 周）生成学习路线。
   e. 向用户呈现每周目标、具体任务、为什么学、对应多少岗位、预计投入、验收条件、项目产出。
      学习目标必须是可验收的，禁止出现「学习 C++」这类无法验收的表述。

3) 用户说「更新一下求职市场」
   a. 调用 job_market_plan_collection 生成增量采集计划，取得确认后执行采集。
   b. 采集会按 dedupe_key 跨平台去重：重复岗位只更新 last_seen_at，不重复计数。
   c. 调用 job_market_analyze_market 生成新快照并写入历史。
   d. 调用 job_market_diff_roadmap 对比新旧快照，输出
      继续 / 新增 / 提高优先级 / 降低优先级 / 删除 的建议。
   e. 重要：不要直接推翻用户已有的学习计划，只给出增量调整建议并解释原因。

【技能等级口径（0-5）】
0 完全不会 1 知道基本概念 2 做过 Demo 3 可以独立完成项目 4 熟练解决实际问题 5 深入掌握可处理复杂工程问题
每项技能需要 current_level、target_level、evidence（项目/工作/GitHub/实验/简历）、confidence。
用户可人工修改；AI 只能产生建议（pending），不得直接计入差距计算。

【数据可信度】
当有效岗位数低于 market.min_jobs_for_stats 时，必须在结论中明确提示样本不足，
不要把低样本比例当作可靠市场结论。
`.trim(),
};

export type JobMarketSkillRegistration = typeof jobMarketSkill;
