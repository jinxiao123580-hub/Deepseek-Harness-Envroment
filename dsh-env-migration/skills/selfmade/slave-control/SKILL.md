---
name: slave-control
description: 通过 SSH 远程控制局域网 Linux 下位机（DSH agent 机器）执行各类操作，包括远程命令、下位机 DSH headless 任务、桌面浏览器操作、文件传输。触发词：下位机、远程 Linux、slave。
---
# 下位机控制（Linux Slave）

本机通过 SSH 免密控制局域网内 Linux 下位机（Ubuntu 22.04，装有 DSH 0.1.0-rc.6，模型 deepseek-v4-flash）。

## 连接信息
- 目标：`jx@10.87.223.78`（内网，端口 22）
- 私钥：`C:\Users\10905\.ssh\linux_slave`（无口令）
- 标准 SSH 前缀（PowerShell 中执行）：

```powershell
ssh -i "C:\Users\10905\.ssh\linux_slave" -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=10 jx@10.87.223.78 '<远程命令>'
```

## 下位机环境（已装好，勿重复安装）
- Ubuntu 22.04.5 LTS x86_64；用户 jx；桌面会话 DISPLAY=:0
- Node v22.23.2（用户目录 `~/.local/node`，**无需 sudo**；sudo 需要密码不可用）
- DSH v0.1.0-rc.6（`~/.local/node/bin/dsh`）
- API Key：`~/.dsh-key.env`（权限 600，内容 `export DEEPSEEK_API_KEY=...`）
- 浏览器：Google Chrome（默认）/ Firefox

## 关键执行模式

### 1. 含引号/特殊字符的命令一律用 base64 脚本（Windows→ssh 引号会被吞）
在远程执行前先把整段 bash 脚本 base64 编码：`echo <b64> | base64 -d > /tmp/t.sh && bash /tmp/t.sh`

### 2. 派发下位机 DSH headless 任务（下位机 AI 独立完成并打印结果）
```bash
export PATH="$HOME/.local/node/bin:$PATH"
. ~/.dsh-key.env
dsh --profile headless "任务描述"
```
长任务：nohup 后台 + 轮询日志文件。注意非交互 SSH 不加载 ~/.bashrc，PATH 和 key 必须显式设置。

### 3. 桌面浏览器（用户会话在 :0）
```bash
DISPLAY=:0 nohup xdg-open <URL> >/dev/null 2>&1 &
```

### 4. 文件传输
```powershell
scp -i "私钥" 本地文件 jx@10.87.223.78:/home/jx/
scp -i "私钥" jx@10.87.223.78:/home/jx/文件 本地路径
```

### 5. 本机还有现成包装脚本 `D:\Deepseek Harness\slave.ps1`（exec/dsh/open/up/down/status 五个动作）

## 注意事项（踩过的坑）
- Windows→ssh 传参：双引号会被剥掉、单引号会截断 PowerShell 字符串 → **一律 base64**
- 本机文件沙箱：写 `~/.dsh` 等家目录需升级权限；ssh-keygen 写 .pub 会失败，用 `ssh-keygen -y -f 私钥` 导出公钥
- 下位机 `~/.bashrc` 曾被误写坏 PATH，已修复；新终端生效
- 验证状态：2026-08-15 全链路（SSH→headless→桌面浏览器）实测通过

## 常见错误记录（2026-08 实战，务必避免）

### PowerShell 侧的坑（都是静默失败，最危险）
1. **`$var:` 被解析成盘符**：`"$slave:/home/..."`、`"$a: 缺"` 直接 ParserError。
   → 必须写 `${var}:`。
2. **选项字符串带内嵌引号传给原生命令**：`$opts = '-i "key" -o ...'` 再 `scp $opts ...`，
   PowerShell 把它当一个参数传，scp/ssh 直接失败。
   → 用数组 splat：`$opt = @("-i",$key,...); scp @opt ...`，或全部内联。
3. **本地路径以 `\` 结尾紧贴引号**：`"D:\x\01_anim\"` 末尾 `\"` 被转义成字面引号，
   scp 报 `local mkdir "...anim"": Invalid argument`。
   → 本地路径不要以反斜杠结尾（去尾 `\` 或用正斜杠 `/`）。
4. **本地路径含中文传给 scp**：中文被转成八进制转义（`\347\264\240...`），报
   `No such file or directory`。
   → scp 的**本地目标路径一律用 ASCII**；中文标签放 HTML/展示层，不放文件路径。
5. **scp/ssh 后不检查 `$LASTEXITCODE`**：失败也继续打印"已发送/完成"，日志假成功。
   → 每个 scp/ssh 之后必须查退出码；stderr 用 `2>&1` 保留而不是 `2>$null` 吞掉。
6. **.ps1 脚本必须带 UTF-8 BOM**（PS 5.1 无 BOM 按 ANSI 读，中文乱码/解析错）。
   → 写完后 `[System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding $true))`。
7. **远程管道退出码丢失**：`python3 x.py 2>&1 | tail -4` 的退出码是 tail 的（恒 0）。
   → 加 `set -o pipefail;` 前缀，或用 `tee -a 日志 | tail` 同时落盘与截断。

### 工作流/任务侧的坑
8. **长任务别用前台等**：视频生成/训练几十分钟级，一律 `run_in_background` 或 slave 上
   `nohup`，用日志文件轮询；前台等会撞工具超时且占用会话。
9. **远程脚本路径与本地不一致**：Windows 版脚本（`D:\...` 路径）直接传 slave 跑不了，
   → 生成 Linux 版（路径替换为 `/home/jx/...`）再传，本地编译检查 `py_compile` 后再用。
10. **产物要回传 + 清理**：slave 生成的成品 scp 回本机对应目录后，`rm -rf` 远端暂存
    （checkpoints/输出副本/临时脚本），避免垃圾堆积。

### 网页 ChatGPT 看图通道（详见 D:\DSH_GPT_IMAGES\README-看图流程.md）
11. `browser_run_code_unsafe` 运行在受限 VM：无 `require`/`fs`/动态 import，只有 `page`；
    读本地文件只能走工具 `filename` 参数，且文件必须在允许根内（`D:\DSH_GPT_IMAGES\downloads`、`D:\Deepseek Harness`）。
12. 页面内 `fetch('http://127.0.0.1:端口')` 会被 Chrome Private Network Access 拦截（Failed to fetch），
    → 用"开第二个标签页导航到本地桥"读参数，别用页面 fetch。
13. MCP 工具 30s 超时但操作在后台继续：超时后先用 `browser_tabs` 确认，别立刻重试同操作。
14. 上传文件用 `page.locator('input[type=file]').setInputFiles([...])`，别依赖 `browser_file_upload`（要求 modal 状态）。
