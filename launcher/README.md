# DeepSeek Harness 启动器 (Launcher)

一个双击即用的一键启动器：若 dsh 的 Web 端口未监听，则后台无窗口启动 `dsh web`，等服务就绪后自动打开浏览器。

> **Linux / macOS 用 [`dsh-web.sh`](dsh-web.sh)**，同一套逻辑的 bash 版。
> 装法是把它复制成 `~/.local/bin/dsh-web`（`install.sh` 会自动做）。

## 文件
| 文件 | 说明 |
|------|------|
| `HarnessLauncher.cs` | 源码（已参数化，跨用户名/跨机器） |
| `build.ps1` | 用 .NET Framework csc 编译（无需 SDK），输出 `dist\Launcher.exe` |
| `Launcher.exe` | 已编译好的可执行文件（可直接用） |
| `dsh-web.sh` | Linux/macOS 版启动脚本 |
| `logo.ico` / `logo.png` | 图标 |

## 可配置环境变量
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DSH_WEB_PORT` | `3080` | dsh Web 端口 |
| `DSH_WORKDIR` | 见下 | 启动 dsh 的工作目录 |
| `DSH_NODE` | 自动探测 → PATH | node.exe 路径 |
| `DSH_HTTP_PROXY` | 自动探测 7897 | 本地代理（连 Gemini/Google 需要） |

> **`DSH_WORKDIR` 的探测顺序（2026-09-19 修）**：
> 环境变量 → exe 同目录的 `dsh-workdir.txt` 边车文件 → `D:\Deepseek Harness`（若存在）
> → exe 目录（**桌面除外**）→ 用户主目录。
>
> 旧版顺序是 环境变量 → **exe 目录** → `D:\Deepseek Harness`，而下面"方式 A"又教人把 exe
> 复制到桌面 —— 两者一叠加，**桌面就成了 dsh 的工作目录**，用户的项目文件会被写到桌面上。
> 现在桌面被明确排除在候选之外。

## 在新电脑使用
### 方式 A：复制 Exe（**不推荐放桌面**）
```powershell
# 放到一个固定目录，别放桌面（否则旧版会把桌面当工作目录）
$dir = "$env:USERPROFILE\DSH-Launcher"
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item ".\launcher\Launcher.exe" "$dir\"
# 要固定工作目录就写边车文件（比复制 exe 更可靠）：
"$env:USERPROFILE\projects" | Set-Content "$dir\dsh-workdir.txt"
& "$dir\Launcher.exe"
```
然后在桌面/任务栏建**快捷方式**指向它（快捷方式不会有 exe 目录被误当工作目录的问题）。

> **本机已装 Electron 版 `DSH Launcher`**（`%LOCALAPPDATA%\Programs\DSH Launcher\`，桌面有快捷方式）。
> 再放一个 C# 启动器属于**同一台机器上两个启动器**，容易混。
> `install.ps1` 检测到已有的 Electron 启动器就会**拒绝**再装一个，除非显式 `-ForceLauncher`。

### 方式 B：自己重新编译（若改过源码或想换图标）
```powershell
powershell -ExecutionPolicy Bypass -File ".\launcher\build.ps1"
# 产物在 .\launcher\dist\Launcher.exe
```

### 端口不是 3080 时
```powershell
$env:DSH_WEB_PORT = "5180"
& ".\launcher\Launcher.exe"
```

## 说明
- 启动器默认打开 `http://127.0.0.1:<port>`。
- **服务没起来就不会开浏览器**：旧版无论 dsh 有没有拉起来都会打开浏览器，于是用户看到"连接被拒绝"。
  现在 `Main` 会跟踪就绪状态，起不来就报错退出（并且会打印探测到的 node 路径与工作目录）。
- `NODE_OPTIONS=--use-env-proxy` 只在 **Node ≥ 24** 时才设 —— 那是 Node 24 才有的旗标，
  低版本 node 会直接以 `bad option: --use-env-proxy` 死掉。
