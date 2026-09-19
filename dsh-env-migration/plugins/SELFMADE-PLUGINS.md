# 自制插件（源码 + 原路径映射）

> 7 项全部在 [`selfmade/`](selfmade/) 里。恢复 = 拷回原路径（下表）→ 检查引用该路径的 profile `package.json` → `pnpm install` → 重启 dsh。
> 所有自制插件都是 DSH 标准 ESM 插件形状：`package.json` + `lib/`（或 src 构建）+ 可选 `cordis.patch.yml`（`dsh.bundle.patch` 声明）。

## 原路径映射表（恢复时按此放回）

| 仓库内路径 | 原绝对路径（profile 依赖里写的就是它） | 被谁引用 |
|---|---|---|
| `selfmade/qq-mode-console/` | `%USERPROFILE%\.dsh\plugins\qq-mode-console` | qq、web profile（`link:`） |
| `selfmade/dsh-session-archiver-0.1.0.tgz` | `%USERPROFILE%\.dsh\plugins\dsh-session-archiver-0.1.0.tgz` | web-3（`file:` 安装） |
| `selfmade/dsh-whale-widget/` | `C:\Users\10905\dsh-whale-widget` | web、web-2、web-3（`link:`） |
| `selfmade/dsh-super-injector/` | `C:\Users\10905\dsh-super-injector-0.3.3` | web（`link:`，npm scope `@dsh-external/dsh-super-injector`） |
| `selfmade/maid-atelier/` | `C:\Users\10905\dsh-deep-whale\maid-atelier` | web（`link:`，`@dsh-external/dsh-client-ui-skin-maid-atelier`） |
| `selfmade/dsh-job-market/` | `D:\Deepseek Harness\dsh-job-market` | web（`link:`） |
| `selfmade/selftest-runner/` | `%USERPROFILE%\.dsh\super-injector\selftest-runner` | super-injector 的配套自测 runner（`@dsh-external/selftest-runner`，private） |

> ⚠️ 新机器用户名/盘符不同时：要么把插件放到同名路径，要么改 profile 的 `package.json` 里的 `link:`/`file:` 值，二选一，必须一致。

## 各插件说明

### qq-mode-console（v0.1.0，MIT）
QQ 桥接模式控制台：DSH 设置 UI 里的 QQ 模式面板（chat / closed-agent / reserved×2 四个模式）。
- 形状：`lib/index.js` + `cordis.patch.yml`（`dsh.bundle.patch` 挂载），依赖 `@deepseek-ai/schemastery`。
- 用法：在 qq 或 web profile 挂 bundle 后，Web 设置页出现 QQ 模式控制台；QQ 侧配置走 `llm-pi-ai.providers.deepseek-qq`（见 `config/settings.yaml`）。

### dsh-session-archiver（v0.1.0，tgz 打包）
会话归档插件。web-3 以 `file:` 方式安装这个 tgz（**安装命令**：在 profile 目录 `pnpm add "dsh-session-archiver:file:<tgz绝对路径>"`，或直接保留 package.json 里的 `file:` 依赖后 `pnpm install`）。
- 重新打包：`npm pack`（在插件源码目录）。

### dsh-whale-widget
鲸鱼挂件 UI 插件（Web 界面挂件）。三个 profile（web/web-2/web-3）都挂了它，是自制件里被引用最多的。
- 恢复后无需配置，bundle 挂载即生效。

### dsh-super-injector（v0.3.3）
「超级注入器」：往会话/预设里注入自定义内容块的插件（npm scope `@dsh-external`）。
- 配套运行目录 `$DSH_HOME\super-injector\`（`staging.json` = 注入暂存；`self-heal.log` = 自愈日志）——运行态未备份，首跑自动生成。
- `selftest-runner/` 是它的自测 runner（`@dsh-external/selftest-runner` v0.0.1 private，BSD-3，peerDep `@deepseek-ai/dsh-tools` + `cordis`），构建 `bash scripts/build.sh`。

### maid-atelier（@dsh-external/dsh-client-ui-skin-maid-atelier）
Web UI 皮肤「女仆工坊」主题。bundle 挂载后在设置 → 主题里选。
- 体积 7.6 MB（含皮肤资源），已原样入库。

### dsh-job-market
任务市场插件（源码在 `D:\Deepseek Harness\dsh-job-market`，与训练环境同工作区）。
- ⚠️ 备份时排除了其 `node_modules/`，恢复后在源码目录 `pnpm install`。

## 与下载插件的区别标记

- 自制插件的 npm scope 是 **`@dsh-external/*`**（外部本地插件专用命名空间），下载的要么是 `@deepseek-ai/*`（官方）、要么是社区作者 scope、要么无 scope。
- 在 `profiles/*/package.json` 里：自制 = `link:` / `file:` 协议；下载 = 版本号 / `github:` 协议。
