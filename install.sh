#!/usr/bin/env bash
# install.sh — DeepSeek Harness 环境一键安装（Ubuntu / Debian / 其他 Linux）
#
# 用法（在包根目录）:
#   bash install.sh
#   bash install.sh --dry-run
#   bash install.sh --no-launcher --no-rtk
#
# 这是 install.ps1 的 Linux 对应物。Windows 请用 install.ps1。
#
# 与 Windows 的差异（都是实测/源码依据，不是拍脑袋）:
#   1. RTK 配置目录：Windows `%APPDATA%\rtk\`，Linux/XDG `~/.config/rtk/`
#      依据：rtk.exe 内字符串 "No custom filters found (.rtk/filters.toml or ~/.config/rtk/filters.toml)"
#            以及字面量 "rtk/config.toml"（<config_dir>/rtk/config.toml）。
#   2. 包里只有 rtk.exe（Windows PE），Linux 需要另取二进制。本脚本按序尝试：
#      已有 rtk → 包内 rtk-linux-<arch> → GitHub Releases 下载 → 放弃（只提示，不失败）。
#   3. dsh 的用户全局指令文件两边都是 `$DSH_HOME/AGENTS.md`（默认 `~/.dsh/AGENTS.md`），
#      **不是** `~/AGENTS.md`。依据 dsh-agent-instructions/lib/index.js:141/148。
#   4. 「启动器」是 Windows 专属（C# / csc）。Linux 用 `dsh web` 或本项目附带的
#      `launcher/dsh-web.sh`（后台起服务 + 等就绪 + 调 xdg-open）。
#
# 设计原则与 install.ps1 相同：**只增不删**、幂等、不静默吞错。
# 并且同样遵守「不擅自升级 / 不擅自装第三方 / 不擅自改别的工具」：
#   升 dsh 要 --upgrade-dsh，装余额插件要 --install-plugin，
#   跑 rtk init --global（会写 ~/.claude/CLAUDE.md）要 --rtk-init-global。
#   装提交前闸门（会写 .git/hooks/pre-commit）要 --install-git-hooks。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

NO_DSH=0; NO_PLUGIN=0; NO_RTK=0; NO_LAUNCHER=0; NO_SETTINGS=0
NO_PRESET=0; NO_HANDOFF=0; NO_SCRIPTS=0
FORCE_SETTINGS=0; FORCE_RTK_CONFIG=0; DRY_RUN=0
UPGRADE_DSH=0; INSTALL_PLUGIN=0; RTK_INIT_GLOBAL=0; HARDEN_DEFAULT_PRESET=0
INSTALL_GIT_HOOKS=0
PROFILE="web"

FAILURES=()
STEP_NO=0; STEP_TOTAL=7

while [ $# -gt 0 ]; do
  case "$1" in
    --no-dsh) NO_DSH=1 ;;
    --no-plugin) NO_PLUGIN=1 ;;
    --no-rtk) NO_RTK=1 ;;
    --no-launcher) NO_LAUNCHER=1 ;;
    --no-settings) NO_SETTINGS=1 ;;
    --no-preset) NO_PRESET=1 ;;
    --no-handoff) NO_HANDOFF=1 ;;
    --no-scripts) NO_SCRIPTS=1 ;;
    --force-settings) FORCE_SETTINGS=1 ;;
    --force-rtk-config) FORCE_RTK_CONFIG=1 ;;
    --upgrade-dsh) UPGRADE_DSH=1 ;;
    --install-plugin) INSTALL_PLUGIN=1 ;;
    --rtk-init-global) RTK_INIT_GLOBAL=1 ;;
    --harden-default-preset) HARDEN_DEFAULT_PRESET=1 ;;
    --install-git-hooks) INSTALL_GIT_HOOKS=1 ;;
    --profile) PROFILE="${2:-web}"; shift ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done

c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_cyan=$'\033[36m'
c_mag=$'\033[35m'; c_gray=$'\033[90m'; c_off=$'\033[0m'
[ -t 1 ] || { c_green=; c_yellow=; c_red=; c_cyan=; c_mag=; c_gray=; c_off=; }

step() { STEP_NO=$((STEP_NO+1)); printf '\n%s[%d/%d] %s%s\n' "$c_green" "$STEP_NO" "$STEP_TOTAL" "$1" "$c_off"; }
skipstep() { STEP_NO=$((STEP_NO+1)); printf '\n%s[%d/%d] 跳过 %s (%s)%s\n' "$c_yellow" "$STEP_NO" "$STEP_TOTAL" "$1" "$2" "$c_off"; }
say() { printf '  %s\n' "$1"; }
sayc() { printf '  %s%s%s\n' "$c_cyan" "$1" "$c_off"; }
fail() { FAILURES+=("$1 : $2"); printf '  %s[!] %s 失败 — %s%s\n' "$c_red" "$1" "$2" "$c_off"; }
run() {  # run <描述> <命令...>
  local desc="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then printf '  %s[dry-run] %s%s\n' "$c_gray" "$desc" "$c_off"; return 0; fi
  "$@"
}
runsh() { # runsh <描述> <shell 串>  —— 需要管道/重定向时用
  local desc="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then printf '  %s[dry-run] %s%s\n' "$c_gray" "$desc" "$c_off"; return 0; fi
  bash -c "$*"
}

printf '%s== DeepSeek Harness 迁移包一键安装（Linux） ==%s\n' "$c_cyan" "$c_off"
say "包目录: $ROOT"
say "DSH_HOME: $DSH_HOME"
[ "$DRY_RUN" = 1 ] && printf '%s*** DRY RUN：不会改动任何文件 ***%s\n' "$c_mag" "$c_off"

# ---------------- 1. Node & npm ---------------- #
step "检查 Node.js / npm"
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  NV="$(node --version 2>/dev/null)"; NPMV="$(npm --version 2>/dev/null)"
  say "node $NV / npm $NPMV"
  MAJOR="${NV#v}"; MAJOR="${MAJOR%%.*}"
  if [ "${MAJOR:-0}" -lt 20 ] 2>/dev/null; then fail "Node 版本" "建议 LTS 20+，当前 $NV"; fi
  if [ "${MAJOR:-0}" -lt 24 ] 2>/dev/null; then
    say "[i] node < 24：--use-env-proxy 不可用（本脚本不用它；启动器只在 Windows 侧注入该参数）"
  fi
else
  fail "Node.js/npm" "未检测到。Ubuntu: sudo apt install -y nodejs npm   或改用 nvm（推荐，能拿到新版）"
  printf '\n没有 Node，后续步骤无法进行。装好 Node 后重新运行本脚本。\n'
  exit 1
fi

# ---------------- 2. dsh 本体 ---------------- #
if [ "$NO_DSH" = 0 ]; then
  step "安装/更新 dsh 本体 (@deepseek-ai/dsh)"
  if command -v dsh >/dev/null 2>&1 && [ "$UPGRADE_DSH" = 0 ]; then
    # 默认不升级：presets/*.cordis.yml 与 presets/standard-leash/agent.cordis.yml 都是按
    # **当前**版本的 shipped preset 对齐的（见 SOURCE.txt 里的 dsh version 与 sha256），
    # 升级会让副本悄悄漂移，所以升级必须是用户的显式决定。
    say "已装 dsh $(dsh --version 2>/dev/null) —— 默认不升级（升级会改动 presets 对齐）"
    say "    要升到最新请显式加 --upgrade-dsh"
    say "    升级后务必跑: node tools/regen-standard-leash.mjs --check"
  else
    run "npm install -g @deepseek-ai/dsh" npm install -g @deepseek-ai/dsh \
      && say "dsh 版本: $(dsh --version 2>/dev/null)" \
      || fail "dsh 安装" "npm install -g 失败"
  fi
else skipstep "dsh 安装" "--no-dsh"; fi

# ---------------- 3. 余额插件（默认不装） ---------------- #
if [ "$NO_PLUGIN" = 0 ]; then
  if [ "$INSTALL_PLUGIN" = 0 ]; then
    step "余额插件 dsh-whale-widget"
    say "默认**不装**：它来自第三方仓库 github:MeteorNOX/DeepSeek-Balance-Whale-Widget，"
    say "    属于供应链决定，不该由安装脚本替你做。要装请显式加 --install-plugin。"
  else
    step "安装余额插件 dsh-whale-widget (profile: $PROFILE)"
    if [ ! -d "$DSH_HOME/profiles/$PROFILE" ]; then
      say "[i] profile '$PROFILE' 还不存在。dsh 的 plugin 子命令要求 profile 已存在，"
      say "    先跑一次 \`dsh web\`（然后关掉），或改用 --profile <已有 profile>。"
    fi
    run "dsh plugin --profile $PROFILE add github:MeteorNOX/DeepSeek-Balance-Whale-Widget" \
      dsh plugin --profile "$PROFILE" add github:MeteorNOX/DeepSeek-Balance-Whale-Widget \
      && say "完成。插件会出现在 Web 界面右下角（小鲸鱼）。" \
      || fail "余额插件" "若需代理，先 export https_proxy=http://127.0.0.1:7897"
  fi
else skipstep "余额插件" "--no-plugin"; fi

# ---------------- 4. RTK ---------------- #
if [ "$NO_RTK" = 0 ]; then
  step "安装 RTK (Rust Token Killer)"
  RTK_BIN=""
  if command -v rtk >/dev/null 2>&1; then
    RTK_BIN="$(command -v rtk)"; say "PATH 上已有 rtk: $RTK_BIN ($(rtk --version 2>/dev/null))"
  else
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64|amd64) RTK_ASSET="rtk-linux-x86_64" ;;
      aarch64|arm64) RTK_ASSET="rtk-linux-aarch64" ;;
      *) RTK_ASSET="" ;;
    esac
    if [ -n "$RTK_ASSET" ] && [ -f "$ROOT/rtk/$RTK_ASSET" ]; then
      mkdir -p "$HOME/.local/bin"
      run "复制 rtk/$RTK_ASSET -> ~/.local/bin/rtk" cp "$ROOT/rtk/$RTK_ASSET" "$HOME/.local/bin/rtk"
      chmod +x "$HOME/.local/bin/rtk" 2>/dev/null
      RTK_BIN="$HOME/.local/bin/rtk"; say "已从包内安装 $RTK_ASSET"
    else
      say "[i] 包里没有 Linux 版 rtk（仓库只带了 rtk.exe / Windows PE）。"
      say "    请二选一后重跑："
      say "      · 从 https://github.com/rtk-ai/rtk/releases 下载 rtk-linux-${ARCH} 放到 rtk/$RTK_ASSET"
      say "      · 或 cargo install rtk-cli（需要 Rust 工具链）"
      say "    其余步骤不受影响，继续。"
    fi
  fi

  if [ -n "$RTK_BIN" ] || [ "$DRY_RUN" = 1 ]; then
    # PATH 持久化：优先 ~/.local/bin 已在 PATH 时不动；否则追加到 shell rc（幂等）
    BIN_DIR="$HOME/.local/bin"
    case ":$PATH:" in
      *":$BIN_DIR:"*) say "$BIN_DIR 已在 PATH 中" ;;
      *)
        RC=""
        [ -n "${BASH_VERSION:-}" ] && RC="$HOME/.bashrc"
        [ -n "${ZSH_VERSION:-}" ] && RC="$HOME/.zshrc"
        [ -z "$RC" ] && [ -f "$HOME/.bashrc" ] && RC="$HOME/.bashrc"
        [ -z "$RC" ] && RC="$HOME/.profile"
        if [ "$DRY_RUN" = 1 ]; then
          say "[dry-run] 向 $RC 追加 PATH 片段"
        elif ! grep -q 'dsh-migration-kit: path' "$RC" 2>/dev/null; then
          printf '\n# dsh-migration-kit: path\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"
          say "已把 $BIN_DIR 写入 $RC（重开终端或 source 生效）"
        else
          say "$RC 已有 PATH 片段，跳过"
        fi
        ;;
    esac

    # Linux/XDG 配置目录（见文件头依据 1）
    RTK_CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/rtk"
    run "mkdir -p $RTK_CFG_DIR" mkdir -p "$RTK_CFG_DIR"
    for pair in "config.toml:rtk/config.toml" "filters.toml:rtk/filters.toml"; do
      name="${pair%%:*}"; rel="${pair##*:}"
      if [ ! -f "$ROOT/$rel" ]; then continue; fi
      if [ -f "$RTK_CFG_DIR/$name" ] && [ "$FORCE_RTK_CONFIG" = 0 ]; then
        say "保留已有 $RTK_CFG_DIR/$name（要覆盖加 --force-rtk-config）"
      else
        run "复制 $rel -> $RTK_CFG_DIR/$name" cp "$ROOT/$rel" "$RTK_CFG_DIR/$name"
        say "已写 $RTK_CFG_DIR/$name"
      fi
    done
    # `rtk init --global` 会往 ~/.claude/CLAUDE.md 里写全局指令块 —— 那是**另一个工具**的
    # 用户级配置，不该被本脚本悄悄改。默认不跑。
    if [ "$RTK_INIT_GLOBAL" = 1 ]; then
      run "rtk init --global" bash -c 'rtk init --global >/dev/null 2>&1 || true'
    else
      say "[i] 未跑 rtk init --global：它会改 ~/.claude/CLAUDE.md（另一个工具的全局配置）。"
      say "    需要就用 --rtk-init-global。"
    fi
    say "RTK 版本: $("$RTK_BIN" --version 2>/dev/null || echo '?')"
  fi
else skipstep "RTK" "--no-rtk"; fi

# ---------------- 5. settings.yaml（合并，不覆盖） ---------------- #
if [ "$NO_SETTINGS" = 0 ]; then
  step "合并 API/provider 与成本治理设置 -> $DSH_HOME/settings.yaml"
  MERGER="$ROOT/tools/merge-settings.mjs"
  if [ ! -f "$MERGER" ]; then
    fail "settings 合并" "缺少 tools/merge-settings.mjs"
  else
    ARGS=()
    for t in config/settings.yaml config/settings.cost.yaml config/settings.deepseek-cheap.yaml config/settings.preset.yaml; do
      if [ -f "$ROOT/$t" ]; then ARGS+=(--template "$ROOT/$t"); else say "[i] 跳过不存在的模板 $t"; fi
    done
    ARGS+=(--target "$DSH_HOME/settings.yaml")
    [ "$FORCE_SETTINGS" = 1 ] && ARGS+=(--force)
    [ "$DRY_RUN" = 1 ] && ARGS+=(--dry-run)
    if [ "${#ARGS[@]}" -gt 1 ]; then
      node "$MERGER" "${ARGS[@]}" || fail "settings 合并" "merge-settings.mjs 退出非 0"
      [ "$DRY_RUN" = 0 ] && say "（合并器只增不删；本机已有的 spill-policy/compaction-* 原样保留）"
    else
      fail "settings 合并" "一个模板都没找到"
    fi
  fi
  say "密钥：仓库不含真实 Key。手动填写 $DSH_HOME/.credentials.yaml（参照 config/.credentials.example.yaml）；"
  say "      注意保留文件里已有的 records: 段，别整份覆盖。"
else skipstep "settings 合并" "--no-settings"; fi

# ---------------- 6. preset / handoff / AGENTS.md / 脚本 ---------------- #
if [ "$NO_PRESET" = 0 ]; then
  if [ -d "$ROOT/presets/standard-leash" ]; then
    DST="$DSH_HOME/.agent-presets/standard-leash"
    run "复制 standard-leash preset -> $DST" bash -c "mkdir -p '$DSH_HOME/.agent-presets' && cp -r '$ROOT/presets/standard-leash' '$DST'"
    say "已装 preset: standard-leash（禁递归 + 子代理降档 + persona）"
  fi
fi

# 关键补漏：standard-leash 只影响"选了它的会话"。若 agent-presets.default 是别人
# （本机 Windows 那台实测是用户自定义的 router-standard），装 standard-leash 一点防护都没有。
# 所以要检查**实际在用的**那份 preset 有没有护栏。
HARDEN="$ROOT/tools/harden-preset.mjs"
SETTINGS="$DSH_HOME/settings.yaml"
if [ -f "$HARDEN" ]; then
  printf '\n  %s— 检查**实际在用**的默认 preset 是否已加护栏%s\n' "$c_green" "$c_off"
  DEFAULT_NAME="$(awk '
    /^agent-presets:[[:space:]]*$/ { inap=1; next }
    inap && /^[^[:space:]]/ { inap=0 }
    inap && /^[[:space:]]+default:[[:space:]]*/ {
      sub(/^[[:space:]]+default:[[:space:]]*/, ""); gsub(/"/, ""); print; exit
    }' "$SETTINGS" 2>/dev/null)"
  if [ -z "$DEFAULT_NAME" ]; then
    say "[i] settings.yaml 里没有 agent-presets.default —— DSH 会用内置 standard（无护栏）"
  elif [ "$DEFAULT_NAME" = "standard-leash" ]; then
    say "默认 preset = standard-leash（已含护栏）"
  else
    TARGET="$DSH_HOME/.agent-presets/$DEFAULT_NAME"
    say "默认 preset = $DEFAULT_NAME（**不是** standard-leash）"
    if [ -f "$TARGET/agent.cordis.yml" ]; then
      if [ "$DRY_RUN" = 1 ]; then
        say "[dry-run] node tools/harden-preset.mjs \"$TARGET\" --check"
      elif node "$HARDEN" "$TARGET" --check >/dev/null 2>&1; then
        say "该 preset 已加固"
      else
        if [ "$HARDEN_DEFAULT_PRESET" = 1 ]; then
          node "$HARDEN" "$TARGET" || fail "加固默认 preset" "harden-preset.mjs 退出非 0"
          say "已加固 $DEFAULT_NAME（原文件已备份为 *.bak-harden-<时间戳>）"
        else
          say "  [!] 该 preset 里 tool-subagent / tool-subagent-fork 没有 maxDepth/toolFilter ——"
          say "      子代理可以无限递归再派子代理（仓库记录的 ¥8.34 扇出事故就是这条路）。"
          say "      要修就加 --harden-default-preset 重跑，或手工执行:"
          say "        node tools/harden-preset.mjs \"$TARGET\""
        fi
      fi
    else
      say "[i] 找不到 $TARGET/agent.cordis.yml，跳过"
    fi
  fi
fi

if [ "$NO_HANDOFF" = 0 ]; then
  step "安装交接体系 (handoff) 与全局规则"
  if [ -d "$ROOT/handoff" ]; then
    run "复制 handoff -> ~/.handoff" bash -c \
      "mkdir -p \"\$HOME/.handoff\" && cp -r '$ROOT/handoff/.' \"\$HOME/.handoff/\" && mkdir -p \"\$HOME/.handoff/reports\" \"\$HOME/.handoff/review\" \"\$HOME/.handoff/research\""
    say "已装交接体系: $HOME/.handoff"
  fi
  BLOCK="$ROOT/handoff/AGENTS.block.md"
  AGENTS="$DSH_HOME/AGENTS.md"
  if [ -f "$BLOCK" ]; then
    if [ -f "$AGENTS" ] && grep -q '## 成本与交接规程' "$AGENTS" 2>/dev/null; then
      say "保留已有 $AGENTS（已含成本与交接规程，不重复追加）"
    else
      run "写入 $AGENTS" bash -c "mkdir -p '$DSH_HOME' && { [ -f '$AGENTS' ] && printf '\n' >> '$AGENTS'; cat '$BLOCK' >> '$AGENTS'; }"
      say "已把 6 条成本/交接规则写进 $AGENTS"
      say "[i] DSH 的用户全局指令文件是 \$DSH_HOME/AGENTS.md，不是 ~/AGENTS.md"
    fi
  fi
else skipstep "handoff/规则" "--no-handoff"; fi

if [ "$NO_SCRIPTS" = 0 ]; then
  [ "$NO_HANDOFF" = 1 ] && step "安装度量脚本 -> ~/.dsh-analysis" || printf '\n  %s— 度量脚本 -> ~/.dsh-analysis%s\n' "$c_green" "$c_off"
  if [ -d "$ROOT/scripts" ]; then
    DST="$HOME/.dsh-analysis"
    run "复制 scripts -> $DST" bash -c "mkdir -p '$DST' && cp '$ROOT'/scripts/*.py '$DST'/"
    say "已装: $DST（跨平台版本，不再依赖 zstdcat）"
  fi
fi

# ---------------- 7. Launcher ---------------- #
if [ "$NO_LAUNCHER" = 0 ]; then
  step "放置 Linux 启动脚本"
  SRC="$ROOT/launcher/dsh-web.sh"
  if [ -f "$SRC" ]; then
    DST="$HOME/.local/bin/dsh-web"
    run "复制 launcher/dsh-web.sh -> $DST" bash -c "mkdir -p \"\$HOME/.local/bin\" && cp '$SRC' '$DST' && chmod +x '$DST'"
    say "已装: $DST（等价于 Windows 启动器；用法 dsh-web [port]）"
  else
    say "[i] 没有 launcher/dsh-web.sh，跳过（直接跑 \`dsh web\` 也可）"
  fi
  say "[i] Windows 的 C# Launcher.exe 在 Linux 上不可用（csc / PE 二进制）。"
else skipstep "Linux 启动脚本" "--no-launcher"; fi

# ---------------- 8. 提交前闸门（可选） ---------------- #
# 只装**与机器无关**的检查（编码 + 换行）。机器相关的检查绝不能进提交门：
# 别人 clone 下来还没装 kit 时必然失败，那会把闸门变成绊脚石而不是护栏。
if [ "$INSTALL_GIT_HOOKS" = 1 ]; then
  STEP_TOTAL=$((STEP_TOTAL+1))
  step "安装提交前闸门 (.git/hooks/pre-commit)"
  HOOK_SRC="$ROOT/tools/git-hooks/pre-commit"
  HOOK_DST="$ROOT/.git/hooks/pre-commit"
  if [ ! -d "$ROOT/.git/hooks" ]; then
    say "[i] 这里不是 git 仓库（没有 .git/hooks），跳过"
  elif [ ! -f "$HOOK_SRC" ]; then
    say "[i] 找不到 $HOOK_SRC，跳过"
  else
    run "复制 tools/git-hooks/pre-commit -> .git/hooks/pre-commit" \
      bash -c "cp '$HOOK_SRC' '$HOOK_DST' && chmod +x '$HOOK_DST'"
    say "已装: .git/hooks/pre-commit（提交前跑 node tools/check-encoding.mjs）"
    say "[i] 紧急绕过：git commit --no-verify"
  fi
else
  # 注意：这里**故意不调 step**，否则会与上面已有的编号错位。
  say "提交前闸门未安装（要装：--install-git-hooks）"
fi

# ---------------- 9. 自证：跑一遍巡检 ---------------- #
# 装完不算完 —— **必须自证**。doctor 会重新推导 dsh 的当前事实（全局指令文件叫什么、
# shipped preset 的 sha、谁的代码里引用了哪个 settings 段），而不是相信本脚本"我以为装对了"。
STEP_TOTAL=$((STEP_TOTAL+1))
step "自证巡检（tools/doctor.mjs）"
if [ "$DRY_RUN" = 1 ]; then
  # doctor 只读机器状态，但它会写状态文件（$DSH_HOME/.dsh-migration-kit.json）——
  # 干跑的承诺是"不会改动任何文件"，所以这里只报告不执行。
  say "[dry-run] node tools/doctor.mjs（自证巡检；会写状态文件，故干跑不执行）"
elif [ -f "$ROOT/tools/doctor.mjs" ]; then
  node "$ROOT/tools/doctor.mjs"
  doctor_rc=$?
  if [ "$doctor_rc" -ne 0 ]; then
    fail "自证巡检" "doctor 报出 FAIL（退出码 $doctor_rc）—— 逐条看上面的 ❌，修法就写在每一项下面"
    say "可安全自动修的两条：node tools/doctor.mjs --fix-safe   然后**再跑一次**确认"
  else
    say "巡检通过：dsh 版本 / 全局指令文件路径 / 规则块 / preset 指纹 / 默认 preset 护栏"
    say "          / 第三方子代理护栏 / settings 接线 / 档位合法性 / 脚本前置 / 编码换行"
  fi
else
  say "跳过：找不到 tools/doctor.mjs"
fi

# ---------------- 收尾 ---------------- #
printf '\n%s=== 完成 ===%s\n' "$c_cyan" "$c_off"
if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf '%s以下步骤失败（其余已尽力完成）：%s\n' "$c_red" "$c_off"
  for f in "${FAILURES[@]}"; do printf '  %s- %s%s\n' "$c_red" "$f" "$c_off"; done
else
  printf '%s所有步骤成功。%s\n' "$c_green" "$c_off"
fi
cat <<'EOF'

下一步:
  0. **先跑巡检确认全部落地**：node tools/doctor.mjs
     （升级 dsh、改 preset、改 settings 之后都要再跑一次；出问题看 docs/升级与冲突处理.md）
  1. 若没填 Key：编辑 ~/.dsh/.credentials.yaml（参照 config/.credentials.example.yaml，保留已有 records: 段）。
  2. 启动：`dsh web` 或 `dsh-web`（默认 http://127.0.0.1:3080）。
  3. 验收禁递归：开一个新会话派一次子代理，然后 `python3 ~/.dsh-analysis/verify_leash.py`。
  4. 成本/交接体系的细节见 handoff/README.md；配置文件见 config/。
  5. 本次**默认没做**的三件事（要就显式加开关）:
       --upgrade-dsh        把 dsh 升到最新（会让 presets 对齐漂移，升完跑 node tools/regen-standard-leash.mjs --check）
       --install-plugin     装 GitHub 上的余额插件 dsh-whale-widget
       --rtk-init-global    跑 rtk init --global（会改 ~/.claude/CLAUDE.md）
       --harden-default-preset  把护栏打进你**实际在用**的那个 preset（会备份）
       --install-git-hooks  装 .git/hooks/pre-commit（提交前跑编码/换行闸门）
  6. 本机默认 preset 是 router-standard 的话，standard-leash **不会**自动成为默认
     （合并器只增不删，会保留你已有的 agent-presets.default）。
     要真正堵住子代理扇出，需要把 4 项护栏移植进 router-standard —— 见
     docs/改进与问题记录.md 第七节。
EOF
exit 0
