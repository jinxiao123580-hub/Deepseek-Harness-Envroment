#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_session_io.py —— 跨平台读取 DSH 会话日志（Windows / Ubuntu 通用）。

存在理由（2026-09-19 实测）:
    原脚本都写死 `subprocess.run(["zstdcat", f], ...)`。zstdcat 来自 zstd 命令行工具：
      · Windows：**默认不存在**，`subprocess.run` 直接抛 FileNotFoundError（不是 returncode!=0，
        所以原来的 `if p.returncode: continue` 根本兜不住），脚本一上来就崩。
      · Ubuntu：装了 `zstd` 包才有；最小化容器/精简镜像里常常没有。
    本模块按优先级挑后端：python-zstandard 模块 → zstdcat → zstd -dc，
    都没有时给出**可执行的**安装提示，而不是抛 FileNotFoundError。

另外统一了会话日志路径：`~/.dsh/sessions/<项目 slug>/<session-id>/session.jsonl.zstd`。
Windows 上 `~` 用 os.path.expanduser 会展开成 `C:\\Users\\<你>`，与 DSH 自身一致；
若设置了 DSH_HOME 则优先用它（DSH 支持该环境变量，Windows/Ubuntu 都一样）。
"""

import glob
import os
import shutil
import subprocess
import sys

# 允许用环境变量覆盖（自定义 --zstd 也可，见 pick_backend 的参数）
CLI_OVERRIDE_ENV = "DSH_ZSTD"


class ZstdUnavailable(RuntimeError):
    """没有任何可用的 zstd 解压后端。"""


def dsh_home():
    """DSH 的 home 目录：优先 $DSH_HOME，否则 ~/.dsh。"""
    env = os.environ.get("DSH_HOME")
    if env:
        return os.path.expanduser(env)
    return os.path.join(os.path.expanduser("~"), ".dsh")


def session_glob():
    """返回会话日志的 glob。路径分隔符交给 os.path.join，避免写死 '/'。"""
    return os.path.join(dsh_home(), "sessions", "*", "*", "session.jsonl.zstd")


def iter_session_files():
    """所有会话日志，按路径排序（稳定输出，便于 diff）。"""
    return sorted(glob.glob(session_glob()))


def _has_module_zstandard():
    try:
        import zstandard  # noqa: F401
        return True
    except Exception:
        return False


def available_backends(cli=None):
    """返回可用后端名列表，按优先级。cli 是用户显式给的解压命令（可选）。"""
    out = []
    if cli:
        out.append("cli:" + cli)
        return out
    env = os.environ.get(CLI_OVERRIDE_ENV)
    if env:
        out.append("cli:" + env)
        return out
    if _has_module_zstandard():
        out.append("zstandard")
    for exe in ("zstdcat", "zstd"):
        p = shutil.which(exe)
        if p:
            out.append("exe:" + p)
    return out


def pick_backend(cli=None):
    b = available_backends(cli)
    if not b:
        raise ZstdUnavailable(_install_hint())
    return b[0]


def _install_hint():
    return (
        "未找到任何 zstd 解压后端，无法读取 ~/.dsh/sessions/*.jsonl.zstd。\n"
        "任选其一即可：\n"
        "  · Ubuntu/Debian : sudo apt install -y zstd\n"
        "  · macOS         : brew install zstd\n"
        "  · Windows       : winget install --id Facebook.Zstandard    （或 choco install zstd）\n"
        "  · 任意平台(推荐) : 装 Python 模块，不需要命令行工具 —— python -m pip install zstandard\n"
        "  · 已有别的解压器 : 设环境变量 DSH_ZSTD=<命令>（会用 `<命令> <文件> > 标准输出` 调用）"
    )


def _decompress_via_module(path):
    import zstandard
    with open(path, "rb") as fh:
        dctx = zstandard.ZstdDecompressor()
        with dctx.stream_reader(fh) as reader:
            return reader.read().decode("utf-8", "replace")


def _decompress_via_cli(path, backend):
    cmd = backend.split(":", 1)[1]
    if backend.startswith("exe:"):
        # zstdcat 直接吃文件；zstd 需要 -dc
        if os.path.basename(cmd).lower().startswith("zstdcat"):
            argv = [cmd, path]
        else:
            argv = [cmd, "-dc", path]
    else:
        argv = cmd.split() + [path]
    proc = subprocess.run(argv, capture_output=True)
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError("解压失败 (%s): %s" % (" ".join(argv), err[:200]))
    return proc.stdout.decode("utf-8", "replace")


def read_text(path, backend=None):
    """把 .jsonl.zstd 解成一整段文本。找不到后端时抛 ZstdUnavailable。"""
    backend = backend or pick_backend()
    if backend == "zstandard":
        try:
            return _decompress_via_module(path)
        except ImportError:
            # 模块在检测与使用之间消失/不可用 → 退到 CLI
            fallback = [b for b in available_backends() if b != "zstandard"]
            if not fallback:
                raise ZstdUnavailable(_install_hint())
            return _decompress_via_cli(path, fallback[0])
    return _decompress_via_cli(path, backend)


def load_events(path, backend=None, json_mod=None):
    """读出并 json.loads 每一行；坏行静默跳过（与旧脚本一致）。返回 list。"""
    import json as _json
    json_mod = json_mod or _json
    text = read_text(path, backend)
    events = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json_mod.loads(line))
        except Exception:
            pass
    return events


def preflight(argv_prog=None):
    """在 main() 开头调用：后端不可用时打印提示并以退出码 1 结束（而不是抛异常崩栈）。

    返回后端名；不可用时**不返回**（sys.exit(1)）。
    """
    try:
        backend = pick_backend()
    except ZstdUnavailable as exc:
        prog = argv_prog or os.path.basename(sys.argv[0])
        sys.stderr.write("[%s] %s\n" % (prog, exc))
        sys.exit(1)
    return backend


PYTHON_HINT = (
    "Python 调用方式（Windows / Ubuntu 不同）:\n"
    "  · Ubuntu/macOS : python3 scripts/xxx.py\n"
    "  · Windows      : python scripts\\xxx.py   （或 py -3 scripts\\xxx.py）\n"
    "  · 若 Windows 上 python 打开的是 Microsoft Store 提示页，说明只有占位别名：\n"
    "    装真 Python（winget install Python.Python.3.12）或 `uv python install` 后用 uv run。"
)
