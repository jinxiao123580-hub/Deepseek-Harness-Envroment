# DeepSeek Harness 启动器 (Launcher)

一个双击即用的一键启动器：若 dsh 的 Web 端口未监听，则后台无窗口启动 `dsh web`，等服务就绪后自动打开浏览器。

## 文件
| 文件 | 说明 |
|------|------|
| `HarnessLauncher.cs` | 源码（已参数化，跨用户名/跨机器） |
| `build.ps1` | 用 .NET Framework csc 编译（无需 SDK），输出 `dist\Launcher.exe` |
| `Launcher.exe` | 已编译好的可执行文件（可直接用） |
| `logo.ico` / `logo.png` | 图标 |

## 可配置环境变量
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DSH_WEB_PORT` | `3080` | dsh Web 端口 |
| `DSH_WORKDIR` | 脚本目录 → `D:\Deepseek Harness` | 启动 dsh 的工作目录 |
| `DSH_NODE` | 自动探测 → PATH | node.exe 路径 |
| `DSH_HTTP_PROXY` | 自动探测 7897 | 本地代理（连 Gemini/Google 需要） |

## 在新电脑使用
### 方式 A（推荐）：直接用预编译的
```powershell
# 复制 Exe 到桌面或任何位置，双击即可。默认端口 3080。
Copy-Item ".\launcher\Launcher.exe" "$env:USERPROFILE\Desktop\启动 DeepSeek Harness.exe"
# 双击运行，或:
& "$env:USERPROFILE\Desktop\启动 DeepSeek Harness.exe"
```

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
启动器默认打开 `http://127.0.0.1:<port>`。桌面/任务栏快捷方式可直接指向 `Launcher.exe`。
