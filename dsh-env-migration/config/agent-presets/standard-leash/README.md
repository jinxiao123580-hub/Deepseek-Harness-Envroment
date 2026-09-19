# standard-leash —— 让子代理不能再派子代理

> **【2026-09-19 更正】** 旧版这里声称 `agent.cordis.yml` 是随 DSH 发布的 `standard` preset 的
> **逐字节副本**，"唯一改动是 tool-subagent / tool-subagent-fork 两行加了三件事"。
> **这个说法是错的。** 与 dsh 0.1.5-rc.2 的 standard preset 实际比对发现：那是一份**过期副本**，
> 除 leash 改动之外还额外缺了 standard 本来就有的东西 ——
> `- id: command-goal`、`- id: present`、`modelSelectionSettings: true`、
> `fetch: true`（副本写的是 `fetch: false`），且 system prompt 用的是合并 `text:`
> 而不是 standard 的 `prefix:`/`suffix:`。
> **把它当默认 preset 部署会静默减少 agent 的工具。** 现在副本改为脚本生成 + 来源指纹。

`presets/standard-leash/agent.cordis.yml` = **当前安装的 DSH** 的 `standard` preset
**逐字节副本**，唯一改动是在 `tool-subagent` 与 `tool-subagent-fork` 两行各注入同样 27 行
（文本与注入逻辑都在 [`tools/lib/leash.mjs`](../../tools/lib/leash.mjs)，与
`tools/harden-preset.mjs` **共用同一份**，避免两个脚本漂移）：

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
# Ubuntu / macOS
mkdir -p ~/.dsh/.agent-presets && cp -r presets/standard-leash ~/.dsh/.agent-presets/
```
```powershell
# Windows
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\.agent-presets" | Out-Null
Copy-Item .\presets\standard-leash "$env:USERPROFILE\.dsh\.agent-presets\" -Recurse -Force
```
再把 `config/settings.preset.yaml` **合并**进 `~/.dsh/settings.yaml`
（`install.ps1` / `install.sh` 会自动做；手工做时注意别整份覆盖，本机已有的
`agent-presets.default` 会被合并器保留）。

## 重新生成（DSH 升级后必做）

**不要**再手工 `cp` + 手贴那两行 —— 那个手工步骤已经漂移过一次（见文首更正）。用脚本：

```bash
node tools/regen-standard-leash.mjs            # 自动定位 npm 全局的 dsh 并重新生成
node tools/regen-standard-leash.mjs --check     # 只校验是否同步；漂移则退出码 1（可放 CI）
```

脚本会重写 `agent.cordis.yml` 并写入 `SOURCE.txt`（记录 dsh 版本、源文件路径与两边的 sha256）。
重新生成后请复核下面这张差异表是否仍然成立。

## 把护栏打进**你自己**的 preset（默认不是 standard 的话必做）

**这是最容易漏掉的一步。** `standard-leash` 是个**新 preset**，它只影响"新会话且选了它"的会话。
如果 `~/.dsh/settings.yaml` 里的 `agent-presets.default` 是别的东西（本机就是用户自定义的
`router-standard`），那么**装完 standard-leash 一点防护都没有** —— 默认会话仍然可以无限递归派子代理。

真正的做法是把同样 4 项护栏移植进你**实际在用**的那份 preset：

```bash
# 先看差在哪（未加固则退出码 1，可以放进巡检）
node tools/harden-preset.mjs ~/.dsh/.agent-presets/router-standard --check

# 干跑
node tools/harden-preset.mjs ~/.dsh/.agent-presets/router-standard --dry-run

# 真打（自动备份成 agent.cordis.yml.bak-harden-<时间戳>，幂等）
node tools/harden-preset.mjs ~/.dsh/.agent-presets/router-standard
```

```powershell
# Windows
node tools/harden-preset.mjs "$env:USERPROFILE\.dsh\.agent-presets\router-standard" --check
node tools/harden-preset.mjs "$env:USERPROFILE\.dsh\.agent-presets\router-standard"
```

前提：护栏里的 `agentOptions` 指向 provider **`deepseek-cheap`**，所以必须先把
`config/settings.deepseek-cheap.yaml` 合并进 `settings.yaml`
（`node tools/merge-settings.mjs --template config/settings.deepseek-cheap.yaml --target <你的 settings.yaml>`），
否则子代理会因为找不到 provider 而失败。

> 注意：护栏只锁**子代理侧**。上级自己仍能用 `tool-workflow`（单次可起上千 agent）与
> `tool-ralph`（本机 `maxRounds: 64`）——这两个的用量上限是**用户自己的取舍**，
> 脚本不会替你改。要一并收紧就自己调 `router-standard` 里那两行的 config。

## 验收

```bash
python3 scripts/verify_leash.py      # Ubuntu / macOS
python scripts\verify_leash.py       # Windows
```

四项检查：新会话 preset 是否 `standard-leash` / 子代理是否走 `deepseek-cheap` 且档位 `off` /
子代理系统提示是否含 persona / 是否出现 `delegationDepth ≥ 2`。

## 局限

- 只影响**新会话**；已在跑的会话不受影响。
- `persona` 只对经 `subagent`/`subagent_fork` 派出的子代理生效；`workflow` 派出的不算。
- 副本会随 DSH 升级滞后：升级后用上面的 `regen-standard-leash.mjs` 重新对齐，
  并用 `--check` 验证；`SOURCE.txt` 里的 sha256 能立刻看出漂移。
