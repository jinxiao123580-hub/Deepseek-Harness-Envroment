#!/usr/bin/env bash
# dsh-web.sh — Linux/macOS 对应物：Windows 的 launcher/HarnessLauncher.cs 在 Linux 上不可用
#（那个是 .NET Framework / csc 编译的 PE 二进制）。
#
# 行为与 C# 启动器一致：
#   1. 探测端口是否真的在监听（C# 版曾因不调用 EndConnect 而把"连接被拒"误判为"在监听"，
#      结果永远不启动 dsh —— 这里用 bash 的 /dev/tcp 真连一次）
#   2. 没在监听 → 后台无窗口启动 `dsh web --no-open`
#   3. 等就绪（最多 $WAIT_SEC 秒），然后调用 xdg-open / open 打开浏览器
#
# 用法:  dsh-web [port]
# 环境变量: DSH_WEB_PORT / DSH_WORKDIR / DSH_HTTP_PROXY / DSH_WAIT_SEC / DSH_NO_OPEN
set -uo pipefail

PORT="${1:-${DSH_WEB_PORT:-3080}}"
WORKDIR="${DSH_WORKDIR:-$PWD}"
WAIT_SEC="${DSH_WAIT_SEC:-90}"
URL="http://127.0.0.1:${PORT}"
LOG="${TMPDIR:-/tmp}/dsh-web-${PORT}.log"

# 真连一次：/dev/tcp 连接失败会立刻返回非 0，不会把"被拒"当"在监听"
is_listening() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

if is_listening "$PORT"; then
  echo "[dsh-web] $URL 已在监听，直接打开浏览器"
else
  if ! command -v dsh >/dev/null 2>&1; then
    echo "[dsh-web] 找不到 dsh 命令。先 npm install -g @deepseek-ai/dsh，或重开终端刷新 PATH" >&2
    exit 1
  fi
  echo "[dsh-web] 启动 dsh web（workdir=$WORKDIR, 日志=$LOG）"
  (
    cd "$WORKDIR" 2>/dev/null || cd "$HOME"
    if [ -n "${DSH_HTTP_PROXY:-}" ]; then
      export HTTPS_PROXY="$DSH_HTTP_PROXY" HTTP_PROXY="$DSH_HTTP_PROXY"
      # Node 24+ 才认这个参数；老版本会直接 bad option，所以按版本门控（与 C# 版同一规则）
      NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
      if [ "${NODE_MAJOR:-0}" -ge 24 ] 2>/dev/null; then export NODE_OPTIONS="--use-env-proxy"; fi
    fi
    nohup dsh web --no-open >"$LOG" 2>&1 &
  )
  i=0; LIMIT=$((WAIT_SEC * 2))
  while [ "$i" -lt "$LIMIT" ]; do
    is_listening "$PORT" && break
    sleep 0.5; i=$((i+1))
  done
  if ! is_listening "$PORT"; then
    echo "[dsh-web] 等了 ${WAIT_SEC}s 端口仍未监听。看日志: $LOG" >&2
    tail -n 20 "$LOG" 2>/dev/null >&2
    exit 1
  fi
  echo "[dsh-web] 已就绪"
fi

if [ "${DSH_NO_OPEN:-0}" = "1" ]; then exit 0; fi
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 &
else echo "[dsh-web] 打开 $URL （没找到 xdg-open/open）"; fi
exit 0
