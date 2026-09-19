# Deepseek-Harness-Envroment

本机 DeepSeek Harness（DSH）环境副本与运行笔记：**成本治理 + 上下文交接（handoff）体系**。
所有数字都来自本机会话日志实测或本机源码，命令可复现。

---

## 一句话结论（2026-09-19 修正版）

> **DSH 的花费按钱算是三块均分：输出 36% / 未命中输入 32% / 缓存命中输入 32%**
> （本机全量 51 会话 3928 请求，¥68）。
> 旧版说"99.5% 是 cacheRead"是 **token 数量**占比 —— 单价差 50–200 倍，所以 **token 占比 ≠ 账单占比**。
> 真正可削减的是三件事：**推理输出**、**全冷重读**、**子代理扇出**。

---

## 目录

| 路径 | 说明 |
|---|---|
| [`docs/2026-09-19-实测与更正.md`](docs/2026-09-19-实测与更正.md) | **优先读**：三条更正 + 档位真实值域 + 缓存谱系实测 + 扇出事故复盘 + 交接成本实测 + 成本解剖 |
| [`docs/交接体系.md`](docs/交接体系.md) | 交接体系全景：为什么不用 compaction、INDEX 规范、成本模型、继任者纪律、档位规则 |
| [`docs/DSH-成本与上下文治理.md`](docs/DSH-成本与上下文治理.md) | 2026-09-18 版：账目、四个放大器、spill/compaction 的**字段依据与验证方法**（文首有更正块） |
| [`handoff/`](handoff/) | 交接约定全文 + 术语表 + INDEX 模板 + ADR-0001 |
| [`examples/`](examples/) | 脱敏真实样例 + 它演示的 **9 类交接文档病症** |
| [`presets/standard-leash/`](presets/standard-leash/) | **禁递归 + 子代理降档 + persona** 的 preset 副本 |
| [`config/`](config/) | 三段可合并的 `settings.yaml` 片段（成本治理 / 子代理专用路由 / preset 开关） |
| [`scripts/`](scripts/) | 度量与验收脚本（成本解剖、周复盘、leash 验收、档位与缓存实测探针） |

---

## 三条立即生效的配置

```yaml
# ① 超大工具输出落盘（未配置 = true no-op，大输出整段进上下文，之后每轮重复付费）
spill-policy:
  maxInlineBytes: 8192

# ② 压缩阈值 0.8 → 0.35（contextWindow 1024000 → 触发点 358K 而非 819K）
compaction-basic:
  thresholdRatio: 0.35

# ③ ⚠️ 不要写 reasoningEffort: medium —— 适配器只接受 off/high/max，
#    medium 会抛 UNSUPPORTED_REASONING_EFFORT，而 high 本来就是默认档（写它 = no-op）
```

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

## 快速开始

```bash
# 成本解剖（按钱拆：输出 / 未命中 / 缓存命中；冷读；子代理深度分布）
python3 scripts/cost_anatomy.py --days 30

# 周复盘（六项指标，输出到 ~/.handoff/review/<日期>.md）
python3 scripts/weekly_review.py --days 7

# 验收禁递归 preset（先在新会话里派一次 subagent）
python3 scripts/verify_leash.py

# 复现"切档打断缓存"与"三档输出量差异"（需要 DEEPSEEK_API_KEY，花费几分钱）
python3 scripts/cache_lineage.py
python3 scripts/effort_probe.py
```

## 采用交接体系

```bash
cp -r handoff ~/.handoff                                    # 约定、术语表、模板、ADR
mkdir -p ~/.dsh/.agent-presets && cp -r presets/standard-leash ~/.dsh/.agent-presets/
# 把 config/*.yaml 三段合并进 ~/.dsh/settings.yaml，并把 AGENTS.md 那 6 条规则放进你的 AGENTS.md
```

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

---

## 说明

- 仓库里**不含任何凭据**：脚本从环境变量 `DEEPSEEK_API_KEY` 或 `~/.dsh/.credentials.yaml` 读取。
- 内容来自个人环境实测，路径以 `~/` 表示，采用时请按自己的环境调整。
- 尚未指定开源许可证（默认保留所有权利）；如需开源请补 `LICENSE`。
