# AGENTS.md 规则块

> **规则块的正文在 [`handoff/AGENTS.block.md`](handoff/AGENTS.block.md)**（install 脚本直接用它），
> 本文件解释为什么是这 6 条。
>
> ## ⚠️ 放哪个文件（2026-09-19 更正）
>
> 旧版这里写的是"粘贴到你自己的 `~/AGENTS.md`"。**在 DSH 上这是错的。**
>
> DSH 的**用户全局**指令文件是 **`$DSH_HOME/AGENTS.md`**，默认即 **`~/.dsh/AGENTS.md`**，
> 不是 `~/AGENTS.md`。依据是本机安装的源码
> `@deepseek-ai/dsh-agent-instructions/lib/index.js`：
> ```js
> line 141:  const USER_GLOBAL_FILE = "AGENTS.md";      // 位于 $DSH_HOME 下
> line 148:  if (displayPath === "~/.dsh/AGENTS.md" || displayPath === "$DSH_HOME/AGENTS.md") return USER_GLOBAL_DIRECTORY;
> line 756:  return `${dshHomeDisplay(dshHome)}/AGENTS.md`;
> ```
> 实测旁证：本机 `~/.dsh/AGENTS.md` **不存在**，而 `~/AGENTS.md` 存在、内容只有一行
> `@RTK.md`，且 `~/RTK.md` 也不存在（真文件在 `~/.claude/RTK.md`）—— 也就是说
> `~/AGENTS.md` 不仅 DSH 不读，里面那个引用本身还是断的。
>
> | 平台 | 用户全局指令文件 |
> |---|---|
> | Windows | `%USERPROFILE%\.dsh\AGENTS.md`（或 `$env:DSH_HOME\AGENTS.md`） |
> | Ubuntu / macOS | `~/.dsh/AGENTS.md`（或 `$DSH_HOME/AGENTS.md`） |
>
> 项目级指令仍然是工作区里的 `AGENTS.md` / `CLAUDE.md`（外加 `.local.md` 覆盖层），
> 这一条两平台一致。
>
> 细则在 `~/.handoff/README.md`（**按需读，不要每次加载**）。
> 这 6 条会随每次请求生效，所以刻意压到 15 行以内 —— 每一行都在付 context 租。

```markdown
## 成本与交接规程

1. **用户说「交接」** → 读 `$DSH_HOME/handoff/README.md`，按 §2 写 `~/.handoff/<MMDD-HHMM>-<slug>/INDEX.md`
   （≤70 行、六字段、每条结论标 [有效]/[存疑]/[已否证]，[有效] 必须附**证据**路径而非脚本路径），
   并明确告诉用户"新会话该选哪个档位"。写完即冻结旧会话。
2. **上下文到 ~150k 或步数到 ~120** → 只**提醒一句**"建议交接"，判断权交给用户，**绝不自动交接**。
3. **子代理**：不委派"需要它再派人"的活；子代理回给我的只能是 ≤10 行摘要 + 报告文件绝对路径。
   详细结果由它写进 `~/.handoff/reports/`，我**禁止把长文读进上下文**，取用完删正文。
4. **档位**：执行型会话用 `off`、决策型用 `high`；换档只在上下文 <30k 时做一次；
   **绝不按轮次切档**；`max` 不常设，用则显式压 `max_tokens`。
5. **默认省钱动作**：本地检索优先（grep/read → 项目文档 → .handoff 旧件），网页兜底且一轮 ≤2 次；
   **一轮工具调用总数 ≤15**（交接自检同理，超了就停下问）；同一事实不重复查；大输出落盘只留指针。
6. **产物归类（硬规则）**：交接件/报告/周复盘/研究证据/ADR 一律进 `~/.handoff/` 对应子目录，
   度量与验收脚本进 `~/.dsh-analysis/`，项目产物进项目目录；**禁止在 `$HOME` 顶层新建目录**
   （`~/.dsh`、`~/.handoff`、`~/.dsh-analysis` 是三个已授权的例外）。
```

## 每条规则背后的实测依据

| 规则 | 依据 |
|---|---|
| 1（交接流程） | 交接成本实测 **¥0.068**（继任者冷启动→可开工）；而长会话每步 ¥0.02–0.04 → 剩 5–15 步就该换人 |
| 1（[有效] 要附证据路径） | 真实样例里一条 `[有效]` 附的是**脚本**路径，而数字实际属于**另一个工具**（现场 7/7 vs 离线 6/6） |
| 2（只提醒不自动） | 自动交接一旦误判会打断正在推进的任务；阈值本身是拍的，需要用户用"还剩多少活"来判断 |
| 3（≤10 行 + 落盘） | 实测一份 **47,405 字符**的子代理报告整段驻留主上下文；且 `spill-policy` **不覆盖**子代理报告（它只作用于工具结果） |
| 4（档位/换档时机） | 实测切档会打断前缀缓存（effort 是 prompt 第 0 个 block）：首次启用新档位 hit=0、耗时 23.4 s vs 命中 0.6 s |
| 5（≤15 次工具调用） | 交接自检实测做了 **23 次**，超预算 53%——因为预算原本只写在 README 里，而继任者只读 INDEX |
| 6（产物归类） | 本机 `$HOME` 顶层曾散落 1.4 GB 旧研究目录 + 我这次调查的 514 MB 原始抓取 |

## 怎么装

`install.ps1` / `install.sh` 会把 `handoff/AGENTS.block.md` 追加到
`$DSH_HOME/AGENTS.md`（幂等：已含 `## 成本与交接规程` 就跳过，不会重复追加）。
手工装就是把上面 ```markdown 代码块的内容贴进 `~/.dsh/AGENTS.md`。
