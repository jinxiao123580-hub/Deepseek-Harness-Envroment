# skills 快照（43 个，三分类）

> 来源目录：`$DSH_HOME/skills/`（`%USERPROFILE%\.dsh\skills`）。每个 skill 一个目录，核心是 `SKILL.md`（frontmatter：name / description / compatibility）。
> **恢复**：把目录整份拷回 `$DSH_HOME/skills/<name>/`，重启会话即被扫描加载。
> 判断依据写明在每组开头；`⚠️ 来源待考` 的项按「疑似自制」备份（它们体积小、且未在上游找到对应仓库）。

## ① selfmade/ —— 自制/定制（6 个）

判断依据：中文描述、绑定本机绝对路径或本机设备（下位机）、或与本仓库交接体系配套。

| skill | 用法 |
|---|---|
| `chatgpt-image-batch` | 批量 ChatGPT 网页生图。读 `D:\DSH_GPT_IMAGES\prompts.txt`（`---编号---` 分段），经 Playwright MCP 控制已登录的 ChatGPT 逐条生成→锚点下载→PNG 魔数校验→存 `output\00N.png`；失败重试 2 次后记 `failed_prompts.txt` |
| `slave-control` | SSH 远程控制局域网 Linux 下位机（DSH agent 机器）：远程命令、下位机 headless 任务、桌面浏览器、文件传输。触发词「下位机/远程 Linux/slave」 |
| `learn` | 陪练/考官型学习技能（中文）：先考旧账→布置真实任务→动手时不打扰→卡住喊「提示」→客观通道判分（真编译/真仿真/真波形）。附 `vm.ps1` |
| `webui` | 启动 Claude Paper 论文浏览器（配套 `study`/`summary` 使用）⚠️来源待考 |
| `claude-handoff` | 把当前会话交接给新的后台代理（写交接文档到系统临时目录，含 suggested skills 段）⚠️来源待考，英文通用版 |
| `handoff` | 把当前会话压缩成交接文档给下一个 agent ⚠️来源待考。注意：本仓库的**交接体系**（`../../handoff/`）是自制纪律/模板，与此 skill 配合使用 |

## ② dsh-official/ —— DSH 官方/随插件提供（8 个）

判断依据：描述与 DSH 会话机制深度绑定（ACP/交接/DeepSeek Harness 术语），或由插件随附。备份仅为快照，升级 DSH/插件后以上游新版本为准。

| skill | 说明 |
|---|---|
| `modlens` | 视觉桥硬规则：见图必先跑 modlens（禁止自制 OCR）。配套插件 `@liustack/modlens` |
| `pre-research` | 动手前先落地目标文档：先调 `grilling` 再检索 |
| `research` | 高信任一手来源调研，产出 Markdown 到仓库 |
| `study` / `summary` | 论文深读 / 快速摘要（PDF、arXiv） |
| `wizard` | 生成交互式 bash 向导（只能由人做的步骤：开通凭据、CI secret、控制台操作） |
| `context-memory` | 跨会话持久任务上下文/检查点/全局教训 |
| `learning-journal` | 任务过程中记录证据化中文学习日志 |

## ③ mattpocock/ —— 社区下载（29 个）

**来源：[github.com/mattpocock/skills](https://github.com/mattpocock/skills)**（"Skills for Real Engineers. Straight from my .agents directory"）。
**安装方法**：clone 该仓库后把 `skills/engineering/` 下需要的 skill 目录拷进 `$DSH_HOME/skills/`；
**恢复（本机）**：直接把 `mattpocock/<name>/` 拷回 `$DSH_HOME/skills/<name>/`（本仓库已含 2026-09-19 快照；上游更新后可重拷覆盖，注意各自 LICENSE）。

清单：`ask-matt, code-review, codebase-design, diagnosing-bugs, domain-modeling, grill-me, grill-with-docs, grilling, implement, implement-spec, improve-codebase-architecture, loop-me, prototype, resolving-merge-conflicts, retro, setup-matt-pocock-skills, setup-ts-deep-modules, tdd, teach, to-questionnaire, to-spec, to-tickets, triage, wait-what, wayfinder, writing-beats, writing-for-agents, writing-fragments, writing-shape`

常用几个：`grilling`（拷问计划）、`tdd`（红绿重构）、`diagnosing-bugs`（疑难 bug 诊断环）、`implement-spec`（按 spec 实现）、`writing-for-agents`（给 agent 写文档/skill）。

## 会话里的 skill 目录（补充说明）

DSH 会把 `$DSH_HOME/skills/` 里的 skill 与内置/插件 skill 合并成会话的 `<available_skills>` 目录；
`disable-model-invocation: true` 的 skill（如 `learn`）只能由用户显式调用。skill 数量多会占系统提示词预算——
不用的可以直接不拷回（每个 skill 的加载成本见 `context_audit` 工具的审计结果）。
