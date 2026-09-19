# 新设备恢复用 Prompt（复制即用）

> 在新设备的 DSH 会话里把下面整段发给 agent。尖括号处按实际情况改。

```text
请把这台新机器的 DSH 环境从我的 GitHub 仓库恢复到与旧机一致：

1. git clone https://github.com/jinxiao123580-hub/Deepseek-Harness-Envroment.git 到本地工作目录，
   通读 dsh-env-migration/README.md，严格按其「恢复步骤」执行，不要跳步、不要自由发挥。

2. 前提检查：node 与 dsh 已安装（npm install -g @deepseek-ai/dsh）；没有就先装并告诉我版本。

3. 按以下顺序恢复（细节以仓库文档为准）：
   ① 凭据：仓库里【没有】.credentials.yaml（故意排除）。用仓库 config/set-credentials.ps1 写入，
      并设置环境变量：ZAI_API_KEY、DEEPSEEK_API_KEY、VOLCENGINE_CODING_PLAN_API_KEY、
      VOLCENGINE_AGENT_PLAN_API_KEY、DASHSCOPE_API_KEY、SILICONFLOW_API_KEY、GEMINI_API_KEY、
      DEEPSEEK_QQ_API_KEY。缺哪个问我，禁止编造。
   ② 主配置：把 dsh-env-migration/config/settings.yaml【合并】进 $DSH_HOME/settings.yaml，
      禁止整份覆盖；ya-subagent / compaction-acp / spill-policy 三段连同注释原样保留。
   ③ config/AGENTS.md → $DSH_HOME/AGENTS.md；config/agent-presets/* → $DSH_HOME/.agent-presets/。
   ④ 自制插件：按 dsh-env-migration/plugins/SELFMADE-PLUGINS.md 的映射表放回源码；
      本机用户名/盘符不同时，先跟我确认统一放置路径，再同步改 profile package.json 里的 link:/file: 值。
   ⑤ profile：只恢复活动 profile web-3 —— 建 $DSH_HOME/profiles/web-3/，拷入四件套 + pnpm-lock.yaml，
      在该目录跑 pnpm install（其余 profile 先不装，要时问我）。
   ⑥ skills：把 dsh-env-migration/skills/ 下三类共 43 个目录拷回 $DSH_HOME/skills/<name>/；
      skill 数量占系统提示词预算，拷之前先列出清单让我勾选要哪些。

4. 完成后自证：dsh --profile web-3 --dump-config 确认 bundles 齐全 → 重启 dsh web →
   node tools/doctor.mjs（若装了迁移套件）→ 把结果摘要回报给我。

5. 纪律：全程不把任何密钥写进仓库/日志/输出；遇到与本机路径或 dsh 版本不一致时停下来问我；
   不要顺手"优化"配置值。

6. 本机平台：<Windows 11 / Ubuntu ...>。（若 Linux：仓库 README 声明 install.sh 与 Linux 路径未经真机验证，
   settings 路径按 $DSH_HOME/XDG 推导，需先核对再动手。）
```

## 故障排查速查

| 症状 | 处理 |
|---|---|
| `git: schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS` | Windows schannel 损坏：`git config --global http.sslBackend openssl` |
| push 要密钥 | 用凭据管理器里的 GitHub 条目（GCM），或 `gh auth login` / PAT |
| `dsh --dump-config` 缺 bundle | profile 的 `package.json` → `dsh.profile.bundles` 数组漏了插件名，补上后重启 dsh |
| 插件装了但设置段不生效 | settings 段只有插件主动接线才生效，见仓库 `docs/本地插件与治理融合.md` §2 |
| 仓库后续有更新 | 在旧机更新备份后，新设备 `git pull` + 重跑对应恢复步骤（脚本幂等） |
