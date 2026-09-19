# DSH 成本与上下文治理

记录本机 DeepSeek Harness 运行成本的真实账目、根因分析与已实施的配置修复。
所有数字均来自本机会话日志实测，命令可复现。

日期：2026-09-18 · 环境：Ubuntu 22.04，DSH `@deepseek-ai/dsh`，模型 `deepseek-v4-flash`

> **⚠️ 2026-09-19 更正（先读这段）**
> 1. **§5 的 `reasoningEffort: medium` 是非法值**：DeepSeek 适配器只接受 `off`/`high`/`max`，写 `medium` 会在请求时抛 `UNSUPPORTED_REASONING_EFFORT`；而 `high` 本来就是默认档（写它 = no-op）。降本应改用 `off`（执行型会话）或按会话边界换档。
> 2. **§3–§4 的"≈99.5%"是 token **数量**占比，不是账单占比**。按钱算三块几乎均分：缓存读 32% / 未命中输入 32% / 输出 36%（单价差 50–200 倍，所以 token 占比 ≠ 花费占比）。
> 3. §9 的"子代理只回 ≤30 行"已收紧为 **≤10 行 + 正文写 `.handoff/reports/`**，并已用 preset 的 `persona` 结构化。
>
> 详见 [`2026-09-19-实测与更正.md`](2026-09-19-实测与更正.md) 与 [`交接体系.md`](交接体系.md)。
> **本文其余部分仍然有效**：spill / compaction / tool-result-pruner 的字段依据、no-op 陷阱、以及 §6 的验证方法都经过复核。

---

## 1. 症状

一次以"检索 + 子代理调研"为主的会话，花费明显偏高，且**越到后面越贵** ——
不是单轮变贵，而是每一轮的单价都在涨。

## 2. 怎么算出真实账目（可复现）

DSH 把每个会话的完整记录写在：

```
~/.dsh/sessions/--home-jx--/<session-id>/session.jsonl.zstd
```

每条 LLM 请求都带一个 `usage` 字段，形如：

```json
{"inputTokens":327,"outputTokens":511,"cacheReadTokens":331264,"reasoningTokens":269}
```

### 2.1 汇总各字段

```bash
F=~/.dsh/sessions/--home-jx--/<session-id>/session.jsonl.zstd
zstdcat "$F" | grep -o '"usage":{[^}]*}' | python3 -c "
import sys, json, collections
tot = collections.Counter(); n = 0
for line in sys.stdin:
    try: d = json.loads(line.split('\"usage\":', 1)[1])
    except Exception: continue
    n += 1
    for k, v in d.items():
        if isinstance(v, (int, float)): tot[k] += v
print('记录数:', n)
for k, v in tot.most_common(): print('  %-24s %d' % (k, v))
"
```

### 2.2 看上下文增长曲线（这是关键）

```bash
zstdcat "$F" | grep -o '"cacheReadTokens":[0-9]*' | awk -F: 'NR%40==1 {printf "第%3d 请求: %6.0fK\n", NR, $2/1000}'
```

## 3. 实测结果

| 项目 | 数值 | 占比 |
|---|---:|---:|
| **cacheReadTokens** | **71.1 M** | **≈99.5%（token 数占比）** |
| inputTokens（未缓存） | 397 K | 0.6% |
| outputTokens | 332 K | — |
| 其中 reasoningTokens | 171 K | 占 output 52% |
| 请求数 | 402 | — |
| 平均每请求 cacheRead | 177 K | — |

上下文增长曲线：

```
请求   1 →      0K        请求 201 →  168K
请求  41 →     49K        请求 241 →  198K
请求  81 →     81K        请求 281 →  257K
请求 121 →    110K        请求 321 →  285K
请求 161 →    130K        请求 401 →  333K
```

## 4. 根因

**token 有 99.5% 是 cacheRead**（⚠️ 更正：按**钱**算只占约 1/3，见 2026-09-19 更正段）—— 即"每一步都把整个上下文重读一遍"。
所以成本 ≈ **上下文大小 × 请求数**，而不是工具调用次数。

把 402 个请求按上下文均值切两半：

| 区间 | 上下文均值 | cacheRead 花费 |
|---|---:|---:|
| 前 200 个请求 | ~90 K | 约 18 M |
| 后 202 个请求 | ~265 K | 约 **53 M** |

**同样多的请求，后半段贵了约 3 倍。** 这就是"越用越贵"的全部机制。

而 130 K → 333 K 这段暴涨发生在"子代理调研 + 网页抓取"区间：
每个大输出都**永久抬高**了"每请求基线"，之后每一轮都在为它重复付费。

### 四个放大器（按影响排序）

| # | 放大器的来源 | 说明 |
|---|---|---|
| 1 | **`spill-policy` 未配置 = true no-op** | 源码 `apply()` 首行 `if (config.maxInlineBytes === void 0) return;`。未配置时**超大工具输出整段进上下文**，之后每轮重复计费 |
| 2 | **`compaction-basic` 阈值 = 0.8 × contextWindow** | 模型 contextWindow = 1 024 000 → 要涨到 **819 200 token** 才触发压缩，太晚 |
| 3 | **`tool-result-pruner` 只在压缩阶段生效** | 阈值 8192 字符，但压缩不触发它就完全不干活 |
| 4 | **`agent-default-model.reasoningEffort = high`** | 实测 reasoning 占 output 的 52%，是纯粹的输出 token 放大 |

> 结论：**DSH 该有的插件本来就都装了**（`spill-policy` / `compaction-basic` /
> `tool-result-pruner` / `token-meter` / `command-compact`），问题纯粹是**没配置**。不需要新插件。

## 5. 配置修复

写入 `~/.dsh/settings.yaml`（用户设置层即时生效，**无需重启**）：

```yaml
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
  reasoningEffort: high         # ⚠️ 2026-09-19 更正：medium 非法；high 是默认档，写它=no-op。
                                #    要降本：执行型会话改 off（会抛错吗？不会——off 在允许列表内）

spill-policy:
  maxInlineBytes: 8192         # 此前未配置 = true no-op

compaction-basic:
  thresholdRatio: 0.35         # 默认 0.8
```

### 5.1 字段依据（从插件源码读出，非猜测）

| 字段 | 出处 | 约束 |
|---|---|---|
| `spill-policy.maxInlineBytes` | `dsh-spill-policy/lib/index.js` `Config = z.object({ maxInlineBytes: z.number() })` | 未定义 ⇒ 插件不注册（no-op）；须为非负整数 |
| `compaction-basic.thresholdRatio` | `dsh-compaction-basic/lib/index.js` `thresholdRatioSchema = z.number()` | 触发点 `thresholdTokens = floor(contextWindow × thresholdRatio)` |
| `compaction-basic.retainRatio` | 同上，默认 `0.16` | 校验规则：**`retainRatio < thresholdRatio`**，否则 throw |
| `compaction-basic.auto` | 同上 | 默认 `true`（自动压缩本就启用） |

### 5.2 触发点变化

| | 修复前 | 修复后 |
|---|---|---|
| 压缩触发 | 1 024 000 × 0.8 = **819 200** token | 1 024 000 × 0.35 = **358 400** token |
| 单个工具输出上限 | 无限制 | **8 192 字节** |

## 6. 验证

### 6.1 spill 是否生效

造一个明显超限的输出，看末尾是否出现落盘提示：

```bash
python3 -c "
for i in range(1, 2001):
    print('LINE %04d | pad | %s' % (i, 'A'*40))
"
```

期望在结果末尾看到（格式来自 `spillNotice()`）：

```
(Omitted 14297 bytes. Full formatted result stored at: /tmp/dsh-spill-<id>/session-<id>/<call>.txt.
 Use read with offset/limit, or grep this path to search within it.)
```

**未配置时此提示不会出现** —— 所以"提示出现"本身就是配置生效的证明。

实测：22 489 字节的输出，进上下文的只有 **8 192 字节**，单次省 **14.3 KB**，
且此后每轮都不再重复计费。

### 6.2 落盘文件是否可读回（很重要）

spill 必须是"移到磁盘、按需取回"，**不能是"直接丢信息"**。
用 `read` 工具按 offset/limit 取该路径，实测 755 行完整可取。

> ⚠️ 注意：spill 目录在**宿主** `/tmp` 下。本机 bash 工具运行在私有 tmpfs 沙箱里，
> `ls /tmp/dsh-spill-*` 看不到它 —— 这不代表落盘失败，用 `read`/`grep` 工具是能读到的。

### 6.3 compaction 配置被接受

非法值（如 `retainRatio >= thresholdRatio`）会让插件在配置解析阶段 `throw`。
harness 持续正常运行 ⇒ 校验通过。

## 7. 日常运维

| 操作 | 命令 / 方式 |
|---|---|
| 手动压缩当前会话（**最立竿见影**） | 敲 `/compact` |
| 看当前花费 | Web GUI，或按 §2 的脚本统计 |
| 需要深度分析时提高推理强度 | ⚠️ 更正：`high` 是默认档；`low`/`medium` 会被适配器拒绝。要**更强**用 `max`（并显式压 `max_tokens`，该档默认抬到 128 K），要**更省**用 `off` —— 且换档只在会话边界做（见 `交接体系.md` §6） |

## 8. 三个必须知道的限制

1. **`read` 工具被刻意排除在 spill 之外。** 源码注释说明这是为了避免
   `read → spill → read again` 死循环。所以读大文件仍会整段进上下文 ——
   **必须靠调用方自觉用 `offset`/`limit`/`grep` 控制**。
2. **compaction 阈值 358 K 仍偏保守。** 想更激进可降到 `0.2`（≈205 K）。
3. **`reasoningEffort` 是唯一可能影响质量的改动**（且只接受 `off`/`high`/`max`）。其余两项是纯收益。

## 9. 给未来的自己：写子代理/调研的习惯

- 子代理一律**就地写文件**（`.handoff/reports/`）、**只回 ≤10 行摘要 + 文件路径**，不要让完整报告回到父上下文（已用 preset `persona` 结构化）
- 不要开宽泛调研（"请调研 X 并给出方案与来源"会让代理翻几十页文档、吐几千字）
- 先在本地找答案：本仓库这次的成本根因就是**读插件源码**找到的，零网络开销
- 大输出先落盘，再按需取片段

---

## 附：成本公式

```
总花费 ≈ Σ_每轮 ( 上下文大小(token) × 缓存读单价 + 新增输入 × 单价 + 输出 × 单价 )

其中"上下文大小"随轮次单调增长 ⇒ 总花费近似 平方增长
⇒ 控制成本的第一优先级是【限制上下文增长】，不是【减少调用次数】
```
