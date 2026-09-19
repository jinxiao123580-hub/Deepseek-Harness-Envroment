# standard-leash —— 让子代理不能再派子代理

`agent.cordis.yml` 是随 DSH 发布的 `standard` preset 的**逐字节副本**，唯一改动是
`tool-subagent` 与 `tool-subagent-fork` 两行加了三件事：

```yaml
        agentOptions:                  # ① 子代理改走"关思考"路由
          provider: deepseek-cheap
          model: deepseek-flash
        maxDepth: 1                    # ② 禁递归：depth 2 直接 SubagentDepthError
        toolFilter:                    # ③ 第二道锁：子代理连这些工具都看不见
          deny: [subagent, subagent_fork, workflow, ralph]
        persona: |-                    # ④ 子代理宪法（写在系统提示第一段 order:0）
          你是被派来执行具体任务的执行型子代理。硬规则：…
```

## 为什么

2026-09-19 实测事故：为做一次网络检索派了 2 个调查子代理，它们自行扇出成 **20 个**，
当日账单 **¥8.34**（主对话仅 ¥0.59），而此前五周总账才 ¥68。
根因是 DSH **没有 per-turn/session 的委派计数、没有 `maxSteps`**，continuable 子代理还绕过 job 并发计数。

## 四条改动各自的作用

| 改动 | 机制 | 证据 |
|---|---|---|
| `maxDepth: 1` | `resolveChildDepth`：`childDepth = parent + 1`，超过即抛 `SubagentDepthError` | `dsh-subagent/lib/index.js` |
| `toolFilter.deny` | `ctx.tools.restrict()` 过滤子代理**继承**的工具层；`workflow`（单次上限 1000 agent）与 `ralph` 也能被堵 | 同上 + `dsh-tools/lib/index.js` |
| `agentOptions` | 子代理默认吃适配器档位（`high`）——只能靠换路由降档 | `dsh-subagent/lib/index.js` `resolveChildAgentOptions` |
| `persona` | 作为 `systemPrompt.section({name:"deployment:persona", order:0})` 注入 —— 报告规则不靠上级每次叮嘱 | `dsh-subagent/lib/index.js` `applyChildComposition` |

## 兼容性核对（都声明了能力，所以不会挂载失败）

`spawn` 与 `fork` 两个后端均声明 `{outputSchema, depthLimit, toolFilter, persona}` ——
这两项能力是数值型 `maxDepth` 与 `toolFilter` 能用的前提（否则加载即 throw）。

## 安装

```bash
mkdir -p ~/.dsh/.agent-presets
cp -r presets/standard-leash ~/.dsh/.agent-presets/
# 再把 config/settings.preset.yaml 合并进 ~/.dsh/settings.yaml
```

## 验收

```bash
# 开一个新会话 → 派 1 个子代理做件只读小事 → 回来跑：
python3 scripts/verify_leash.py
```

四项检查：新会话 preset 是否 `standard-leash` / 子代理是否走 `deepseek-cheap` 且档位 `off` /
子代理系统提示是否含 persona / 是否出现 `delegationDepth ≥ 2`。

## 局限

- 只影响**新会话**；已在跑的会话不受影响。
- `persona` 只对经 `subagent`/`subagent_fork` 派出的子代理生效；`workflow` 派出的不算。
- 副本会随 DSH 升级滞后：升级后需重新对齐（见 `config/settings.preset.yaml` 里的命令）。
