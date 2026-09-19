# 下载的插件总表（来源 / 安装 / 用法）

> 快照 2026-09-19 · DSH `0.1.5-rc.2` · 活动 profile **web-3**
> 「版本」列是 `profiles/<profile>/package.json` 里钉住的版本；github 来源钉的是**分支跟踪**（每次 `pnpm install`/更新拉最新 main）。
> 「bundle」= 插件在 profile 的 `dsh.profile.bundles` 数组里声明挂载（没有进 bundle 的依赖只是装了、不加载）。

## 安装方法（DSH 插件的三种装法）

```powershell
# ① 市场插件（npm 包）：在 profile 目录里用 dsh 命令或直接 pnpm
cd $env:USERPROFILE\.dsh\profiles\web-3
dsh plugin --profile web-3 add <npm包名>          # 或 pnpm add <npm包名>

# ② GitHub 插件：github: 前缀
dsh plugin --profile web-3 add github:<owner>/<repo>

# ③ 本地自制插件：在 profile 的 package.json 写 link:/file: 依赖后 pnpm install
#    "dsh-whale-widget": "link:C:/Users/10905/dsh-whale-widget"
```

装完还要**挂 bundle**：把插件名加进 `profiles/<profile>/package.json` 的 `dsh.profile.bundles` 数组，
然后重启 dsh web（`dsh --profile web-3`）。本仓库 `profiles/` 目录存了每台该 profile 的四件套原文。

---

## web-3（活动 profile，15 个依赖、14 个进 bundle）

| 插件 | 版本/来源 | 用途与用法 |
|---|---|---|
| `@deepseek-ai/dsh-web-search-exa` | `0.1.0-rc.6` · npm 官方 | Exa 联网搜索 provider。设置页填 EXA key 后 web_search 可走 Exa |
| `@deepseek-ai/dsh-web-search-perplexity` | `0.1.0-rc.6` · npm 官方 | Perplexity 联网搜索 provider，同上 |
| `@huanlin/dsh-plugin-yet-another-subagent` | [github:HuanLinOTO/dsh-plugin-yet-another-subagent](https://github.com/HuanLinOTO/dsh-plugin-yet-another-subagent) | **第三方 subagent 工具**（接管 `subagent` 工具名，官方 tool-subagent 被它的 cordis 补丁 disabled）。支持多 profile / 指定模型 / persona / toolFilter / maxDepth。本机护栏配置在 `settings.yaml` 的 `ya-subagent` 段：`maxDepth: 1`、模型降档 `deepseek-cheap`、deny `workflow/ralph/subagent*`、执行型 persona。注意：在它的 Web 设置页增删 profile 会整体重写该段 |
| `@liustack/modlens` | `^3.21.1` · npm · [github:liustack/modlens](https://github.com/liustack/modlens) | **视觉桥**：给纯文本模型提供读图（`modlens_read_image` 工具 + `modlens` skill）。体检命令 `npx @liustack/modlens doctor`。provider 可换 Gemini / OpenAI 兼容 / Claude |
| `billion-context-dsh` | `^0.2.23` · npm | **ACP 主动上下文裁剪**（本机压缩的真正后端）。settings 段 `compaction-acp`：`modelContextLimit: 250000`、`autoModelContextLimit: false`。机制是 nudge 提醒 + 模型调 `compress` 工具，顾问式、非强制 |
| `dsh-extension-hub` | `^0.2.18` · npm | 插件市场 UI：Web 界面里浏览/安装社区插件。新机器恢复插件优先用它点装 |
| `zat-dsh-engine` | [github:mishibeikejie/zat-dsh-engine](https://github.com/mishibeikejie/zat-dsh-engine) | 可视化插件市场引擎（browse / search / install community plugins），与 extension-hub 同类 |
| `dsh-better-sidebar` | [github:omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | Web UI 侧边栏增强。pnpm 构建白名单里钉了它的 codeload tarball 哈希 |
| `dsh-checkpoint-diff` | `^0.5.1` · npm | 会话检查点 + 文件 diff 回溯 |
| `dsh-context-doctor` | [github:Zhenyu98/dsh-context-doctor](https://github.com/Zhenyu98/dsh-context-doctor) | 上下文体检（诊断上下文占用/健康度） |
| `@baihejiangnan/dsh-session-context-menu` | [github:baihejiangnan/dsh-session-context-menu](https://github.com/baihejiangnan/dsh-session-context-menu) | 会话列表右键菜单增强（归档/删除等快捷操作） |
| `dsh-plugin-duwg` | [github:Yolotd/dsh-plugin-duwg](https://github.com/Yolotd/dsh-plugin-duwg) | **每日用量统计**：输入框下方显示当天 Token 用量（万/亿简化）与缓存命中率。运行数据在 `~/.dsh/storages/duwg/`。⚠️ 上游代码有占位域名 warn，不影响统计功能 |
| `dsh-usage-stats` | [github:Make0209/dsh-usage-stats](https://github.com/Make0209/dsh-usage-stats) | 用量统计面板（历史请求/费用维度） |
| `dsh-session-archiver` | **自制** `file:~/.dsh/plugins/dsh-session-archiver-0.1.0.tgz` | 会话归档。自制，见 [SELFMADE-PLUGINS.md](SELFMADE-PLUGINS.md) |
| `dsh-whale-widget` | **自制** `link:C:/Users/10905/dsh-whale-widget` | 鲸鱼挂件。自制，见 [SELFMADE-PLUGINS.md](SELFMADE-PLUGINS.md) |

## web（旧主力 profile，现闲置，含最多自制件）

| 插件 | 来源 | 说明 |
|---|---|---|
| `@deepseek-ai/dsh-web-fetch-http` | `0.1.0-rc.6` · npm 官方 | HTTP 抓取 provider（web_fetch 后端之一） |
| `@dsh-external/dsh-super-injector` | `link:C:/Users/10905/dsh-super-injector-0.3.3` | **自制**，见 SELFMADE |
| `@dsh-external/dsh-client-ui-skin-maid-atelier` | `link:C:/Users/10905/dsh-deep-whale/maid-atelier` | **自制** UI 皮肤，见 SELFMADE |
| `dsh-job-market` | `link:D:/Deepseek Harness/dsh-job-market` | **自制**，见 SELFMADE |
| `dsh-whale-widget` / `qq-mode-console` | link 本地 | **自制** |
| `@liustack/modlens` | `link:` 全局 npm 模块 | 同 web-3 的 modlens，但指向全局安装 |

## web-2（实验 profile，12 个全为社区件，未进活跃使用）

| 插件 | 来源 |
|---|---|
| `@anionex/dsh-vision-toolkit` | [github:Anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) |
| `@liustack/modlens` | [github:liustack/modlens](https://github.com/liustack/modlens) |
| `@omdsh-dev/dsh-annotation` / `dsh-genui` / `dsh-at-file` / `dsh-notification` | [github:omdsh-dev](https://github.com/omdsh-dev)（标注 / 生成式 UI / @文件引用 / 通知） |
| `@vectorize-io/hindsight-coding-agents` | `^0.3.4` · npm |
| `dsh-balance-tide` | [github:huanyuLv/dsh-balance-tide](https://github.com/huanyuLv/dsh-balance-tide) |
| `dsh-chat-import` | [github:Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import)（外部聊天记录导入） |
| `dsh-status-rotator` | [github:01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator)（状态栏轮换） |
| `dsh-better-sidebar` / `dsh-whale-widget`(link) | 同 web-3 |

## qq / headless

- `qq`：只有自制 `qq-mode-console`（link）。
- `headless`：无第三方依赖。

## 事件流（如何确认这些表没过时）

1. `node tools/doctor.mjs`（仓库根）——它会核对 settings 段有没有被插件接线（wiring）、preset 指纹等；
2. 看 `$DSH_HOME/.dsh-migration-kit.json` 的 `wiringCache`（DSH 自带迁移套件每次体检后更新）；
3. 看 `profiles/<profile>/package.json` 的 `dependencies` + `dsh.profile.bundles`。
