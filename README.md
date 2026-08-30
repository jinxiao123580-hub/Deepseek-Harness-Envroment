# DeepSeek Harness 迁移包 (Migration Kit)

一套「克隆环境」即插即用的迁移包，让你在一台全新 Windows 机器上一次装好：

- **dsh** — DeepSeek Harness CLI（Web 前端/agent runner）
- **余额插件** — `dsh-whale-widget`（在 Web 界面显示 DeepSeek 余额的小鲸鱼）
- **RTK (Rust Token Killer)** — 过滤/压缩 LLM 工具输出，省 60-90% token
- **启动器** — 双击即启动 dsh web 并自动打开浏览器，跨用户名/跨机器可用

> 仓库地址：https://github.com/jinxiao123580-hub/Deepseek-Harness-Envroment.git

---

## 目录结构

```
Deepseek-Harness-Envroment/
├── install.ps1            ← 一键安装（推荐）
├── README.md
├── rtk/
│   ├── rtk.exe            ← RTK 二进制 (v0.45.0)
│   ├── config.toml        ← 默认配置
│   ├── filters.toml       ← 过滤规则
│   ├── CLAUDE.md          ← rtk 指令块（可给任意项目 init 用）
│   └── README.md
└── launcher/
    ├── HarnessLauncher.cs ← 参数化启动器源码
    ├── build.ps1          ← csc 编译脚本（无需 .NET SDK）
    ├── Launcher.exe       ← 预编译好的可执行文件
    ├── logo.ico / logo.png
    └── README.md
```

---

## 快速开始（新 Windows 机器）

### 前置要求
- Windows 10/11
- **Node.js LTS**（含 npm）— 若没有，先装：<https://nodejs.org/>
- 网络可访问 npm registry / GitHub。（国内若需代理，见下方「代理」）

### 步骤

1. 把整个仓库文件夹拷贝到新电脑（或用 git clone）。
2. 在仓库根目录打开终端，运行：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
3. 脚本会依次：
   - `npm install -g @deepseek-ai/dsh` 安装 dsh
   - `dsh plugin --profile web add github:MeteorNOX/DeepSeek-Balance-Whale-Widget` 装余额插件
   - 把 `rtk\rtk.exe` 复制到 `%USERPROFILE%\.local\bin\` 并生成配置、写入全局指令
   - 编译启动器并放到桌面 `DeepSeek Harness 启动器.exe`
4. 配置 DeepSeek API Key（dsh 设置里填 `DEEPSEEK_API_KEY`，或设同名环境变量）。
5. 双击桌面 `DeepSeek Harness 启动器.exe` 即可使用（默认 http://127.0.0.1:3080）。

### 可选参数
```powershell
.\install.ps1 -NoDsh -NoPlugin -NoRtk -NoLauncher   # 跳过对应组件
```

---

## 各组件说明

### 余额插件（dsh-whale-widget）
来源：<https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget>（v0.2.10）
官方安装命令即 `dsh plugin --profile web add github:MeteorNOX/DeepSeek-Balance-Whale-Widget`。
装好后在 Web 界面右下角出现小鲸鱼，实时显示 DeepSeek 账户余额/用量。

> 提示：dsh 的 `plugin` 子命令需带 `--profile`。若本机 `dsh` 不在 PATH，先重开终端或把 npm 全局 bin 加进 PATH。

### RTK（Rust Token Killer）
过滤并压缩命令输出后再交给 LLM，常见操作省 60-90% token。
安装后：
- `rtk` 会在 `%USERPROFILE%\.local\bin`（重开终端后生效）
- `rtk init` 在某项目目录写入 CLAUDE.md 指令块
- 想看看省了多少：`rtk gain`

> 已知问题：`rtk gain` 在部分系统会报
> `Failed to pre-create private DB file: ...\rtk\history.db: access denied`
> 这是 RTK 创建历史库的权限问题，不影响主要功能。

### 启动器
双击 `Launcher.exe`：若 3080 端口未监听则后台启动 `dsh web --no-open`，等服务就绪后自动开浏览器。
环境变量可覆盖（见 `launcher\README.md`）：
- `DSH_WEB_PORT`（默认 3080）
- `DSH_WORKDIR`（默认脚本目录或 `D:\Deepseek Harness`）
- `DSH_NODE`（默认自动探测 node）
- `DSH_HTTP_PROXY`（默认自动探测本机 7897 代理口）

---

## 代理（国内/需要走代理时）

访问 npm/GitHub 或 Google/Gemini 时，先设置代理再执行：
```powershell
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
# 然后运行安装脚本或启动器；启动器可用 DSH_HTTP_PROXY 指定
```

---

## 常见问题

**Q: `dsh` 命令找不到？**
重开终端，或确认 npm 全局目录在 PATH（`npm config get prefix`，一般是 `%APPDATA%\npm`）。

**Q: 余额插件没出现？**
重启 dsh（完全退出再重新打开 Web）。仍无则手动重跑：
`dsh plugin --profile web add github:MeteorNOX/DeepSeek-Balance-Whale-Widget`

**Q: 想把启动器放别的位置？**
直接用 `launcher\Launcher.exe`，或按 `launcher\README.md` 重新编译。

---

## 关于费用
本机默认模型为 `deepseek-official / deepseek-v4-flash / reasoningEffort: low`（便宜）。
若加过 Volcano Coding Plan（`volcengine-coding-plan` 等 provider）但它们不是默认模型，Agent 实际仍走 DeepSeek 官方计费；
DeepSeek 峰谷计费自 2026-08-17 起，缓存命中最高约 11 倍价差。省钱选谷时段、多用缓存即可。
