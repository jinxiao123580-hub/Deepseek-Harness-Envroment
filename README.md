# Deepseek-Harness-Envroment

本机 DeepSeek Harness（DSH）环境副本与运行笔记，两条线合并在一起：

1. **成本治理 + 上下文交接（handoff）体系** —— 所有数字都来自本机会话日志实测或本机源码，命令可复现。
2. **Windows 迁移套件** —— 一键安装脚本、启动器、RTK（Rust Token Killer）配置。

> **本 README 是 2026-09-19 的合并版。** 仓库此前有两条**互不相关**的历史
> （`master` = 迁移套件，`main` = 成本治理），现在合到 `unify` 分支。
> 合并过程中发现的问题、改进与 Windows/Ubuntu 差异，全部记在
> **[`docs/改进与问题记录.md`](docs/改进与问题记录.md)** —— 部署前请先读它。

## 🚀 即用即插：装完必自证

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\install.ps1 -NonInteractive
```

```bash
# Ubuntu / Debian
bash install.sh
```

两个安装脚本都是**只增不删**、可重复跑（幂等），并且**最后一步会自动跑自证巡检**。

```bash
node tools/doctor.mjs          # 装完自己再跑一次确认
```

`doctor` 是这套东西的核心。它**不信任任何写死的路径**，全部从"当前装的 dsh"现推：
dsh 版本漂移、全局指令文件到底叫什么、规则块在不在、preset 副本指纹、
默认 preset 的护栏、第三方子代理插件的护栏、settings 段有没有被插件接线、
档位是否合法、分析脚本前置条件、编码与换行。

| 状态 | 含义 | 要做什么 |
|---|---|---|
| ✅ `OK` | 已验证 | 不用管 |
| ⚠️ `WARN` | 有风险或环境偏差 | 看一眼 |
| ❌ `FAIL` | 断言被推翻，**会静默失效** | **必修** |
| 🕳️ `INERT` | 配置在，但没有任何插件接线 → **存在但不生效** | 确认该由谁加载 |
| ❓ `UNVERIFIABLE` | 无法再验证这条断言 | **人工确认，别当通过** |

## 🔧 升级 dsh 之后怎么办

> **本套件不记录"事实"，只记录"如何重新推导事实"。**
> 所以升级不会让你撞上"配置悄悄失效、而且没有任何机制提醒你"。

```bash
npm install -g @deepseek-ai/dsh        # 升级
node tools/doctor.mjs                  # 报 dsh.drift，提醒所有指纹可能已失效
node tools/doctor.mjs --fix-safe       # 自动修可安全修的两条（带备份）
# 重启 dsh web（preset / 插件类改动需要重载 profile）
node tools/doctor.mjs                  # **再跑一次确认** —— 修复本身也要被验证
```

出问题先查 **[`docs/升级与冲突处理.md`](docs/升级与冲突处理.md)**：
「症状 → 检查项 → 根因 → 修法」一张表，外加五类真实冲突的详解。

## 🪝 建议装上提交前闸门

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallGitHooks   # Windows
```

```bash
bash install.sh --install-git-hooks                                       # Ubuntu
```

它只拦**与机器无关**的两个跨平台真故障：

- `.ps1` 丢 UTF-8 BOM → Windows PowerShell 5.1 在代码页 936 下按 GBK 解码中文，
  引号字节被凑坏 → 报 `"missing the terminator"`。**看起来像代码写错了，其实是编码。**
- `.sh` 变 CRLF → Ubuntu 上 shebang 变成 `/usr/bin/env bash^M: bad interpreter`。

**这两个在本次开发里真的反复发生过**（`.ps1` 的 BOM 被弄丢过三次），所以不是形式主义。
机器相关的检查**不进**提交门 —— 别人 clone 下来还没装 kit 时那些必然失败，
那类检查用 `node tools/doctor.mjs --strict`（发布前）。

## ⚠️ 本仓库的验证基准（读任何结论前先看这里）

| 项 | 值 |
|---|---|
| DSH | **`0.1.5-rc.2`**（= `npm dist-tags` 的 `latest` 与 `next`） |
| pi-ai（模型目录） | **`0.85.1`** |
| 核查日期 | 2026-09-19 |
| 平台 | Windows 11，ANSI 代码页 **936**，Node `v24.18.0`，npm `11.16.0` |

**为什么必须写这一栏**：DSH 走的是 `-rc` / `-alpha` 流水线
（当日 `alpha` 已是 `0.1.6-alpha.2`），而本仓库大量结论是从**源码行**读出来的。
源码会变，**一句"适配器只接受 X/Y/Z"过几个版本就可能变成假话，且没有任何机制提醒你**。
`docs/改进与问题记录.md` §9 记录了这个坑的完整实例：档位集合其实**按模型**而定，
旧文档把某个模型的档位写成了全局事实，结果与本机实际运行值直接矛盾。

**核对方法**（任一结论失效时先跑这几条）：

```powershell
# ① 本机 dsh 版本（下面这条实测可用）
npm ls -g @deepseek-ai/dsh --depth=0
# ② 是否已有新版
npm view @deepseek-ai/dsh dist-tags --json
# ③ 【最有用的一条】当前配的档位到底合不合法
node tools/show-effort-levels.mjs --current
# ④ 查任意模型能用哪些档位
node tools/show-effort-levels.mjs zai glm-5.3
node tools/show-effort-levels.mjs zai glm-5.2
```

> ⚠️ **不要用 `node -e "require('$env:APPDATA/...')"` 这种写法**（本 README 早先版本真的这么写过，
> 实测是坏的）：PowerShell 把 `$env:APPDATA` 里的反斜杠喂给原生程序时会吞掉，
> node 收到 `C:Users905AppDataRoaming` → `MODULE_NOT_FOUND`。
> 所以上面用 `tools/show-effort-levels.mjs` 这个**跨平台、无第三方依赖**的脚本代替，
> 它自己会定位 npm 全局根目录与 pi-ai 模型目录。
>
> 该脚本的实测输出（本机）：
> ```
> node tools/show-effort-levels.mjs --current
>   provider  : zai
>   model     : glm-5.3
>   effort    : low
>   可用档位  : low / high / max
>   thinkingLevelMap = {"off":null,"minimal":null,"low":"low","medium":null,"high":"high","xhigh":null,"max":"max"}
>   ✅ 合法：low 在该模型的能力表里
> ```
> 把 effort 改成 `off` 或 `medium` 会得到 `❌ 非法 … UNSUPPORTED_REASONING_EFFORT` 且退出码 1
> （这是**反例测试**，已实测；两者都在 `glm-5.3` 上不可用）。

从"当前安装的 dsh"派生的产物都带版本指纹（`presets/standard-leash/SOURCE.txt`），
升级后跑 `node tools/regen-standard-leash.mjs --check` 即可发现漂移。

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
| [`docs/本地插件与治理融合.md`](docs/本地插件与治理融合.md) | **2026-09-19 必读**：本机已装插件如何接管/绕过本套配置。含"护栏落在没加载的那一层""settings.yaml 只有插件主动接线才生效""`context_audit` 的盲区"三件事，以及活的 profile 判定与操作手册 |
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

## 三个调优项 —— ⚠️ 其中**两个不在这一层生效**（2026-09-19 实查）

```yaml
# ① 超大工具输出落盘。
#    ⚠️ 下面这种写法【不生效】：spill-policy 只读 cordis config，**从不读 settings 层**
#    （源码里 installSection / settings.register / ctx.settings 零命中）。
#    真正生效的值来自 dsh-base/cordis.patch.yml:383 → maxInlineBytes: 50000。
#    要改必须改 profile 的 cordis 层：~/.dsh/profiles/<profile>/cordis.patch.yml
spill-policy:
  maxInlineBytes: 8192        # ← 死配置（留着仅作意图记录）

# ② 压缩阈值。⚠️ compaction-basic 在 web profile 下被 @deepseek-ai/dsh-web-app 关掉
#    （dsh --profile web-3 --dump-config 里该条 disabled: true），所以下面这行也不生效。
#    真正生效的是 ACP —— billion-context-dsh 自己把 settings 接线进了它的 config。
compaction-basic:
  thresholdRatio: 0.45        # ← 在 web profile 下是死配置
compaction-acp:
  modelContextLimit: 250000   # ✅ 三个里唯一真正生效的
  autoModelContextLimit: false

# ③ ⚠️ reasoningEffort 的合法档位是【按模型】声明的，没有全局档位表。
#    medium 在所有已知模型上都不合法（抛 UNSUPPORTED_REASONING_EFFORT），
#    但"能选哪几档"取决于模型目录里的 thinkingLevelMap（null = 不可用）：
#       glm-5.2 → off / high / max        glm-5.3 → low / high / max（**没有 off**）
#    deepseek-official（原生路由，档位不在目录里）→ off / low / high / max
#    详见 config/settings.cost.yaml §③ 与 docs/改进与问题记录.md §9。
```

> **【2026-09-19 更正 · 比阈值更根本的一条】**
> `settings.yaml` 的 section **只有插件主动调用
> `settingsCtx.settings.installSection(ctx, NAMESPACE, SCHEMA, entry, …)` 才会进插件 config。**
> 没有接线的插件，同名 section 会被**静静忽略**（不报错）—— 这是最坏的一种失败方式。
> 本机实测：三个调优项里只有 `compaction-acp` 真生效。
> 完整证据、机制与修法见 [`docs/本地插件与治理融合.md`](docs/本地插件与治理融合.md) §2。
>
> **【2026-09-19 更正 · 阈值 0.35】** 本 README 旧版写的是 `thresholdRatio: 0.35`，理由是
> "contextWindow 1024000 → 触发点 358K 而非 819K"。**那个前提值是错的**：本机实测真实
> contextWindow = **1,000,000**，而且 ACP 的 `modelContextLimit` 一旦显式设成 250000，
> 有效窗口就是 25 万而不是 100 万 —— 在这种配置下 `0.35` 与 `0.45` 的触发点分别是
> 87.5K 与 112.5K，**两个数都不是 358K**。
> **结论：阈值不能脱离窗口尺寸单独抄**；而且更根本的是——这个插件在 web profile 下压根没开。
> 详见 [`config/settings.cost.yaml`](config/settings.cost.yaml) 与
> [`docs/本地插件与治理融合.md`](docs/本地插件与治理融合.md)。

另见 `config/settings.deepseek-cheap.yaml`（子代理专用"关思考"路由，实测 output=1 token）与
`config/settings.preset.yaml`（让禁递归的 preset 成为默认）。

---

## 三条最容易踩的坑（都踩过）

1. **`reasoningEffort` 的合法档位是【按模型】算的 —— 别把某个模型的档位当成适配器事实。**
   `medium` 在所有已知模型上都不合法（API 侧它只是 `high` 的别名）。
   但"这模型能用哪几档"来自模型目录里的 `thinkingLevelMap`，其中 **`null` = 该档位不可用**。
   实测（pi-ai 0.85.1，随 dsh 0.1.5-rc.2 安装）：
   `glm-5.2` → `off`/`high`/`max`；**`glm-5.3` → `low`/`high`/`max`，没有 `off`**。
   ⇒ 下一条"执行型会话用 `off`"**在 glm-5.3 上根本做不到**，最低只能到 `low`；
   想要 `off` 得换 glm-5.2 或 DeepSeek 线。DeepSeek 原生适配器自己的白名单是
   `off`/`low`/`high`/`max`（不是旧版文档写的 `off`/`high`/`max`）。
   详见 [`docs/改进与问题记录.md`](docs/改进与问题记录.md) §9 与
   [`config/settings.cost.yaml`](config/settings.cost.yaml) §③。
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
