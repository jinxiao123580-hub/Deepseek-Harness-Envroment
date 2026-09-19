# dsh 环境迁移（插件 / 技能 / 配置快照）

> **快照时间 2026-09-19** · 来源机器：Windows 11（ANSI 代码页 936）· DSH `0.1.5-rc.2`
> · 活动 profile：**web-3**（`dsh --profile web-3 --port 0 --no-open`）
> 本目录是 `$DSH_HOME`（`%USERPROFILE%\.dsh`）中**可迁移部分**的完整副本 + 恢复手册。
> 与上面「迁移套件」（install.ps1 / doctor）互补：那套装的是**治理骨架**，这里备份的是**插件与技能本体**。

## ⚠️ 没有备份的东西（故意的）

| 排除项 | 原因 |
|---|---|
| `.credentials.yaml` | **密钥**。用 `config/set-credentials.ps1` 重建，或手动恢复 |
| `sessions/` `cache/` `attachments/` `storages/` | 运行态数据（会话日志、投影缓存、用量数据），不属于环境 |
| `profiles/*/node_modules/` | 可由 `pnpm install` 重建（`pnpm-lock.yaml` 已备份，保证版本一致） |
| `settings.yaml.bak-*` | 历史备份，只保留当前生效版 |
| `.dshw-*.json` `.anonymous-user-id` `llm-deepseek/` `learn/` | 本机遥测/缓存/个人学习数据 |
| `lookatstudy-plugin/` | 个人学习产物（含 hello.exe），非环境组件 |
| `super-injector/` 运行态（`staging.json` `self-heal.log`） | 运行态；其源码 `selftest-runner` 在 `plugins/selfmade/` |

## 目录

| 路径 | 内容 |
|---|---|
| [`config/settings.yaml`](config/settings.yaml) | 主配置（**已核对不含密钥**，所有 apiKey 走 `apiKeyEnv` 环境变量） |
| [`config/AGENTS.md`](config/AGENTS.md) | `$DSH_HOME/AGENTS.md` 用户全局指令 |
| [`config/dsh-migration-kit.json`](config/dsh-migration-kit.json) | DSH 自带迁移套件状态（kit v2，含插件接线清单 wiringCache） |
| [`config/agent-presets/`](config/agent-presets/) | 5 个 agent preset：`router-standard`（当前默认）、`standard-leash`、`agent-web`、`qq-chat`、`qq-chat-v2` |
| [`profiles/`](profiles/) | 5 个 profile 的接线四件套：`package.json`（依赖+bundles）、`pnpm-workspace.yaml`、`cordis.patch.yml`、`cordis.yml`（+ web-3 的 `pnpm-lock.yaml`） |
| [`plugins/DOWNLOAD-PLUGINS.md`](plugins/DOWNLOAD-PLUGINS.md) | **下载的插件总表**：来源地址、安装方法、用法（按 profile 分组） |
| [`plugins/SELFMADE-PLUGINS.md`](plugins/SELFMADE-PLUGINS.md) | **自制插件说明** + 原路径映射表 |
| [`plugins/selfmade/`](plugins/selfmade/) | 自制插件源码/打包（7 项） |
| [`skills/README.md`](skills/README.md) | 43 个 skill 三分类：自制 6 / DSH 内置 8 / 社区(mattpocock) 29 |
| [`skills/selfmade/`](skills/selfmade/) 等 | 各分类快照，可直接拷回 `$DSH_HOME/skills/` |

## 恢复步骤（新机器）

前提：`npm install -g @deepseek-ai/dsh`（版本建议对齐 `0.1.5-rc.2` 或更新）。

1. **凭据**：恢复 `.credentials.yaml`（`config/set-credentials.ps1`）+ 各 `apiKeyEnv` 环境变量
   （`ZAI_API_KEY`、`DEEPSEEK_API_KEY`、`VOLCENGINE_*`、`DASHSCOPE_API_KEY`、`SILICONFLOW_API_KEY`、`GEMINI_API_KEY`、`DEEPSEEK_QQ_API_KEY`）。
2. **主配置**：把 `config/settings.yaml` **合并**进 `$DSH_HOME/settings.yaml`（不要整份覆盖——
   里面 `ya-subagent` / `compaction-acp` / `spill-policy` 三段的注释就是护栏依据）。
3. **全局指令**：`config/AGENTS.md` → `$DSH_HOME/AGENTS.md`（按需与迁移套件的 `handoff/AGENTS.block.md` 合并）。
4. **presets**：`config/agent-presets/*` → `$DSH_HOME/.agent-presets/`。
5. **自制插件**：按 [`plugins/SELFMADE-PLUGINS.md`](plugins/SELFMADE-PLUGINS.md) 的映射表放回原路径
   （profile 里写的是 `link:`/`file:` 绝对路径，**路径变了要同步改 profile 的 package.json**）。
6. **profile**：为每个要用的 profile 建 `$DSH_HOME/profiles/<name>/`，拷入对应四件套，
   在 profile 目录里跑 `pnpm install`（`pnpm-workspace.yaml` 已含 `nodeLinker: hoisted` 与构建白名单）。
   只用活动 profile 的话恢复 web-3 即可。
7. **skills**：`skills/<分类>/<name>/` → `$DSH_HOME/skills/<name>/`（整目录拷贝）。
8. **验证**：`dsh --profile web-3 --dump-config` 看 bundles 是否齐全；重启 dsh web；
   到插件市场点「一键检测」查插件冲突。

## 本次快照的插件接线事实（来自 `.dsh-migration-kit.json` wiringCache）

- `web-3` 上 subagent 由 **`@huanlin/dsh-plugin-yet-another-subagent`** 提供（官方 tool-subagent 被其 cordis 补丁禁用）；
  护栏在 `settings.yaml` 的 `ya-subagent` 段（maxDepth 1 / 降档 deepseek-cheap / toolFilter deny / 执行型 persona）。
- 压缩后端是 **`billion-context-dsh`**（ACP，settings 段 `compaction-acp`，modelContextLimit 250000）。
- `spill-policy` / `compaction-basic` 两段在 web-3 下是否生效取决于插件接线，改前先读
  [`docs/本地插件与治理融合.md`](../docs/本地插件与治理融合.md)。
