# Deepseek-Harness-Envroment

本机 DeepSeek Harness（DSH）环境副本与运行笔记，两条线合并在一起：

1. **成本治理 + 上下文交接（handoff）体系** —— 所有数字都来自本机会话日志实测或本机源码，命令可复现。
2. **Windows 迁移套件** —— 一键安装脚本、启动器、RTK（Rust Token Killer）配置。

> **本 README 是 2026-09-19 的合并版。** 仓库此前有两条**互不相关**的历史
> （`master` = 迁移套件，`main` = 成本治理），现在合到 `unify` 分支。
> 合并过程中发现的问题、改进与 Windows/Ubuntu 差异，全部记在
> **[`docs/改进与问题记录.md`](docs/改进与问题记录.md)** —— 部署前请先读它。

---

## 一句话结论（2026-09-19 修正版）

> **DSH 的花费按钱算是三块均分：输出 36% / 未命中输入 32% / 缓存命中输入 32%**
> （本机全量 51 会话 3928 请求，¥68）。
> 旧版说"99.5% 是 cacheRead"是 **token 数量**占比 —— 单价差 50–200 倍，所以 **token 占比 ≠ 账单占比**。
> 真正可削减的是三件事：**推理输出**、**全冷重读**、**子代理扇出**。

---

## 平台支持

| 能力 | Windows | Ubuntu / macOS |
|---|---|---|
| 一键安装 | `install.ps1`（Windows PowerShell 5.1 **和** PowerShell 7 均可） | `install.sh`（bash） |
| 设置合并（不整份覆盖） | `node tools/merge-settings.mjs` | 同左 |
| RTK 配置目录 | `%APPDATA%\rtk\` | `~/.config/rtk/`（XDG） |
| RTK 可执行文件 | 仓库自带 `rtk/rtk.exe` | 需自行装 RTK（仓库不含 Linux 二进制） |
| 用户全局指令文件 | `%USERPROFILE%\.dsh\AGENTS.md` | `~/.dsh/AGENTS.md` |
| 启动器 | `launcher/Launcher.exe`（C#/.NET Framework） | `launcher/dsh-web.sh`（bash） |
| Python 调用 | `python scripts\x.py` | `python3 scripts/x.py` |
| 会话日志解压 | 需 `python-zstandard` 或 `zstd` | 同左（`zstdcat` 也可） |
| 换行/编码 | `.ps1` 必须带 **UTF-8 BOM**，否则中文被按 GBK 解释、直接语法报错 | `.sh` **绝不能**带 BOM（会 `bad interpreter`） |

> 编码这条是**实测踩出来的**：本机 ANSI 代码页 = 936，Windows PowerShell 5.1 会把无 BOM 的
> `.ps1` 当 ANSI 解码，中文串引号会破掉并报 `The string is missing the terminator`。
> 仓库用 `node tools/check-encoding.mjs` 强制这条规则（`--fix` 可自动修）。

---

## 目录

| 路径 | 说明 |
|---|---|
| [`docs/改进与问题记录.md`](docs/改进与问题记录.md) | **部署前优先读**：本次合并发现的问题、修复、残留风险与两平台差异 |
| [`docs/2026-09-19-实测与更正.md`](docs/2026-09-19-实测与更正.md) | 三条更正 + 档位真实值域 + 缓存谱系实测 + 扇出事故复盘 + 交接成本实测 + 成本解剖 |
| [`docs/交接体系.md`](docs/交接体系.md) | 交接体系全景：为什么不用 compaction、INDEX 规范、成本模型、继任者纪律、档位规则 |
| [`docs/DSH-成本与上下文治理.md`](docs/DSH-成本与上下文治理.md) | 2026-09-18 版：账目、四个放大器、spill/compaction 的**字段依据与验证方法**（文首有更正块） |
| [`handoff/`](handoff/) | 交接约定全文 + 术语表 + INDEX 模板 + ADR-0001 + `AGENTS.block.md`（可粘贴规则块） |
| [`examples/`](examples/) | 脱敏真实样例 + 它演示的 **9 类交接文档病症** |
| [`presets/standard-leash/`](presets/standard-leash/) | **禁递归 + 子代理降档 + persona** 的 preset（脚本生成，带来源指纹） |
| [`config/`](config/) | `settings.yaml` 可合并片段（成本治理 / 子代理专用路由 / preset 开关）+ 凭据助手 |
| [`scripts/`](scripts/) | 度量与验收脚本（成本解剖、周复盘、leash 验收、档位与缓存实测探针） |
| [`tools/`](tools/) | 运维脚本：设置合并（`merge-settings.mjs`）、编码校验（`check-encoding.mjs`）、preset 重新生成（`regen-standard-leash.mjs`）、**把护栏打进任意已有 preset**（`harden-preset.mjs`） |
| [`launcher/`](launcher/) | 启动器：C# 源码（Windows）+ `dsh-web.sh`（Linux/macOS） |
| [`rtk/`](rtk/) | RTK 可执行文件与配置（`config.toml` / `filters.toml`） |
| [`install.ps1`](install.ps1) / [`install.sh`](install.sh) | 一键安装（均支持 `--dry-run`） |

---

## 快速开始

### Windows

```powershell
# 先干跑，看清楚会改哪些文件（强烈建议）
powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun

# 真装
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Ubuntu / macOS

```bash
# 先干跑
bash install.sh --dry-run

# 真装
bash install.sh
```

安装脚本做 7 件事：① 检查 dsh/node；② 装 RTK 配置（**只补缺失项**）；③ 把
`~/.local/bin` 写进用户 PATH（幂等）；④ **合并**（不覆盖）`settings.yaml`；
⑤ 装 `standard-leash` preset；⑥ 追加 `$DSH_HOME/AGENTS.md` 规则块（幂等）；
⑦ 可选装启动器（**检测到已有的 Electron 启动器就拒绝**，除非 `-ForceLauncher`）。

---

## 三条立即生效的配置

```yaml
# ① 超大工具输出落盘（未配置 = true no-op，大输出整段进上下文，之后每轮重复付费）
spill-policy:
  maxInlineBytes: 8192

# ② 压缩阈值：必须和 ACP 的 modelContextLimit 一起看，不能只抄一个数
#    触发点 = floor(有效上下文窗口 × thresholdRatio)
#    实测好的一对：modelContextLimit = 250000 且 thresholdRatio = 0.45（触发点 ≈ 112K）
compaction-basic:
  thresholdRatio: 0.45
compaction-acp:
  modelContextLimit: 250000
  autoModelContextLimit: false

# ③ ⚠️ 不要写 reasoningEffort: medium —— 适配器只接受 off/high/max，
#    medium 会抛 UNSUPPORTED_REASONING_EFFORT，而 high 本来就是默认档（写它 = no-op）
```

> **【2026-09-19 更正】** 本 README 旧版写的是 `thresholdRatio: 0.35`，理由是
> "contextWindow 1024000 → 触发点 358K 而非 819K"。**那个前提值是错的**：本机实测真实
> contextWindow = **1,000,000**，而且 ACP 的 `modelContextLimit` 一旦显式设成 250000，
> 有效窗口就是 25 万而不是 100 万 —— 在这种配置下 `0.35` 与 `0.45` 的触发点分别是
> 87.5K 与 112.5K，**两个数都不是 358K**。所以旧版那个"358K"是**基于错误窗口尺寸算出来的**，
> 照抄会得到一个和预期完全不同的压缩频率。
> **结论：阈值不能脱离窗口尺寸单独抄。** 先确认有效窗口，再定 ratio。
> 详见 [`config/settings.cost.yaml`](config/settings.cost.yaml)。

另见 `config/settings.deepseek-cheap.yaml`（子代理专用"关思考"路由，实测 output=1 token）与
`config/settings.preset.yaml`（让禁递归的 preset 成为默认）。

---

## 三条最容易踩的坑（都踩过）

1. **`reasoningEffort: medium` 是非法的** —— DeepSeek 适配器只放行 `off`/`high`/`max`（源码白名单），
   `medium` 只是 API 侧的 `high` 别名。想"降智省钱"只有 `off` 这一个真实选项。
2. **换档会打断前缀缓存** —— effort 被注入为 prompt 的**第 0 个 system block**，
   所以每个档位是独立缓存谱系：某档位在会话里**首次出现 = 一次全冷**（实测 hit=0、耗时 23.4 s vs 命中 0.6 s）。
   **换档只在会话边界做。**
3. **子代理会扇出** —— 实测 2 个调查子代理自行扇出成 20 个，当天 ¥8.34（主对话仅 ¥0.59）。
   DSH 没有委派计数、没有 `maxSteps`，只能靠 preset 的 `maxDepth` + `toolFilter` 封死。

---

## 脚本

```bash
# 成本解剖（按钱拆：输出 / 未命中 / 缓存命中；冷读；子代理深度分布）
python3 scripts/cost_anatomy.py --days 30      # Ubuntu / macOS
python  scripts\cost_anatomy.py --days 30      # Windows

# 周复盘（六项指标，输出到 ~/.handoff/review/<日期>.md）
python3 scripts/weekly_review.py --days 7

# 验收禁递归 preset（先在新会话里派一次 subagent）
python3 scripts/verify_leash.py

# 复现"切档打断缓存"与"三档输出量差异"（需要 DEEPSEEK_API_KEY，花费几分钱）
python3 scripts/cache_lineage.py
python3 scripts/effort_probe.py
```

`scripts/` 里所有脚本共用一个跨平台底座：

- `scripts/_session_io.py` —— 会话日志解压后端按 `python-zstandard` → `zstdcat` → `zstd -dc` 依次尝试，
  尊重 `$DSH_HOME`，全都没有时打印**可照做的安装提示**并退出 1（而不是抛 `FileNotFoundError` 堆栈）。
  Windows 默认没有 zstd CLI，所以 `pip install zstandard` 是首选。
- `scripts/_console.py` —— 把 stdout/stderr 切到 UTF-8。**这是 Windows 专属坑**：
  重定向/管道输出时 Python 用 locale 代码页（本机 936），打印 `¥` 会直接
  `UnicodeEncodeError: 'gbk' codec can't encode character '\xa5'`；而真实控制台走
  `_WindowsConsoleIO`（utf-8），所以这个 bug **只在重定向时出现**，交互式跑看不见。

---

## 采用交接体系

```bash
# Ubuntu / macOS
cp -r handoff ~/.handoff                                    # 约定、术语表、模板、ADR
mkdir -p ~/.dsh/.agent-presets && cp -r presets/standard-leash ~/.dsh/.agent-presets/
```

```powershell
# Windows
Copy-Item .\handoff "$env:USERPROFILE\.handoff" -Recurse
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\.agent-presets" | Out-Null
Copy-Item .\presets\standard-leash "$env:USERPROFILE\.dsh\.agent-presets\" -Recurse -Force
```

再把 `config/*.yaml` 三段**合并**进 `~/.dsh/settings.yaml`（用 `tools/merge-settings.mjs`，
**不要整份覆盖**），并把 `handoff/AGENTS.block.md` 那 6 条规则追加进
**`$DSH_HOME/AGENTS.md`**（= `~/.dsh/AGENTS.md`）。

> **【2026-09-19 更正】** 旧版说的是 `~/AGENTS.md`。**DSH 从不读那个路径。**
> 用户全局指令文件是 `$DSH_HOME/AGENTS.md`，依据 `@deepseek-ai/dsh-agent-instructions/lib/index.js:141/148/756`。
> 本机实测旁证：`~/.dsh/AGENTS.md` 不存在，而 `~/AGENTS.md` 存在但只有一行 `@RTK.md`，
> 且 `~/RTK.md` 也不存在 —— 那个引用本身就是断的。

---

## 关键实测数字（详见 docs/）

| 指标 | 值 |
|---|---|
| 全量账单（8/15–9/19，3928 请求） | **¥68** |
| 三块占比（按钱） | 输出 36% / 未命中 32% / 缓存命中 32% |
| 输出里推理 token 占比 | **83–84%** |
| 会话中途"全冷重读" | 13 次 **¥7.30**（占全账 11%），最贵单次 ¥1.02 |
| 子代理花费占比 | 30%（¥20.3）；事故当天 ¥7.7 是主对话的 13 倍 |
| 交接成本（继任者冷启动→可开工） | **¥0.068**（17 请求 / 23 工具调用 / 终态 30k） |
| 长会话每步单价 | ¥0.02–0.04（250k 上下文时） |
| 切档首次启用新档位 | 命中 0；30k 前缀 ≈ ¥0.06，250k ≈ ¥0.5 且多等 ~20 s |

> 三块占比会随窗口变化：以"长文档 + 大量输出"为主的短窗口里，输出可占 47%（见 `scripts/cost_anatomy.py`）。
>
> **【2026-09-19 未对账的差异】** 合并时用修好的 `cost_anatomy.py` 跑本机**全量**日志得到的是
> `--days 40 → 15380 请求 / ¥189.46`、`--days 30 → 11077 请求 / ¥132.34`，与上表那个
> "¥68 / 3928 请求"差得很远。上表的窗口比它自己给的 `--days` 默认值窄得多，
> **两组数不是同一口径，尚未对账**。引用时请自己跑一遍并写明 `--days`。

---

## 说明

- 仓库里**不含任何凭据**：脚本从环境变量 `DEEPSEEK_API_KEY` 或 `~/.dsh/.credentials.yaml` 读取。
  `config/set-credentials.ps1` 是**改**凭据文件而不是**重建**它 —— 它会保留 `records:` 秘密块和
  它不认识的 ref（本机就有个 `ZAI_API_KEY` 不在任何列表里）。
- 内容来自个人环境实测，路径以 `~/` 表示，采用时请按自己的环境调整。
- 尚未指定开源许可证（默认保留所有权利）；如需开源请补 `LICENSE`。
