# RTK (Rust Token Killer)

## 它是什么
一个高性价比的 CLI 代理，在工具输出进入 LLM 上下文之前先做「过滤 / 压缩 / 摘要」，能省 60%–90% 甚至更多 token。你昨天的 15.76 花费里，RTK 的作用是「减少」消耗，不是「增加」——它把命令输出变短，LLM 看到的 token 更少、更便宜。

## 本目录内容
| 文件 | 说明 |
|------|------|
| `rtk.exe` | Windows 可执行文件（v0.45.0） |
| `config.toml` | 默认配置参考；`rtk config --create` 可自动生成同款 |
| `filters.toml` | 用户级过滤器模板（`%APPDATA%\rtk\filters.toml`） |
| `CLAUDE.md` | `rtk init` 写入的指令块（agent 照着用 `rtk xxx`） |

## 在新电脑安装（3 步）
```powershell
# 1. 把 rtk.exe 放进 PATH
New-Item -ItemType Directory -Force "$env:USERPROFILE\.local\bin" | Out-Null
Copy-Item ".\rtk\rtk.exe" "$env:USERPROFILE\.local\bin\rtk.exe" -Force

# 2. 让当前会话识别它（重开终端也可）
$env:Path += ";$env:USERPROFILE\.local\bin"

# 3. 生成配置文件 + 初始化指令
rtk config --create
rtk init --global      # 写进 ~/.claude/CLAUDE.md
# （对单个项目） rtk init 会写进当前目录 CLAUDE.md
```

## 验证
```powershell
rtk --version      # 应显示 rtk 0.45.0
rtk git status     # 输出应被压缩（比原生 git status 短）
```

## 常见问题
- 如果 `rtk gain` 报「拒绝访问 history.db」：是 `%LOCALAPPDATA%\rtk\history.db` 被占用/权限问题。关掉所有终端再运行，或把该文件删掉让它重建。
- 配置默认不写文件也没问题；`rtk` 仍会用内置默认值运行。
