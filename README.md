# Deepseek-Harness-Envroment

本机 DeepSeek Harness（DSH）环境副本与运行笔记。

## 内容

| 文件 | 说明 |
|---|---|
| [`docs/DSH-成本与上下文治理.md`](docs/DSH-成本与上下文治理.md) | **运行成本的真实账目、根因分析与配置修复**（含可复现的统计命令） |
| [`config/settings.cost.yaml`](config/settings.cost.yaml) | 成本治理用的 `~/.dsh/settings.yaml` 片段，可直接合并 |

## 一句话结论

DSH 会话的花费 **≈ 99.5% 是 `cacheReadTokens`** —— 每一步都把整个上下文重读一遍。
因此 **总花费 ≈ 上下文大小 × 请求数**，近似平方增长。

**控制成本的第一优先级是限制上下文增长，而不是减少调用次数。**

## 三条立即生效的设置

写入 `~/.dsh/settings.yaml`（用户设置层即时生效，无需重启）：

```yaml
agent-default-model:
  reasoningEffort: medium      # high -> medium（reasoning 实测占输出 52%）

spill-policy:
  maxInlineBytes: 8192         # 未配置 = true no-op，大输出会整段进上下文

compaction-basic:
  thresholdRatio: 0.35         # 默认 0.8；本模型 contextWindow=1024000 → 触发点 358K
```

详见 [`docs/DSH-成本与上下文治理.md`](docs/DSH-成本与上下文治理.md)。
