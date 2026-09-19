#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_console.py —— 让脚本在 Windows 上也能打印 ¥ / 中文（Ubuntu 上本来就没问题）。

问题（2026-09-19 实测）:
    在 Windows 上把脚本输出**重定向或管道**出去时，Python 的 stdout 用的是
    本地 ANSI 代码页编码（本机 936/GBK），于是：
        UnicodeEncodeError: 'gbk' codec can't encode character '\\xa5' in position 14
    脚本在打印"合计 ¥xx"那一行直接崩。Ubuntu/macOS 的 stdout 默认 UTF-8，不会遇到。

    注意：直接开一个真正的 Windows 控制台窗口时，CPython 会走 _WindowsConsoleIO，
    stdout 编码本来就是 utf-8，所以那时又是好的 —— 也就是说这个坑**只在重定向时出现**，
    很容易在开发机上漏掉，却在 `python x.py > report.md` 或从别的程序调用时炸掉。

修法：把 stdout/stderr 显式 reconfigure 成 UTF-8 + errors="replace"。
    · 控制台场景：本来就是 utf-8，reconfigure 是 no-op；
    · 重定向场景：输出变成 UTF-8 文件（正确），且永不因编码抛异常。

替代做法（不改脚本）：设环境变量 PYTHONIOENCODING=utf-8。
"""

import sys


def setup():
    """在 main() 最开始调用一次。任何失败都静默忽略（老 Python / 非常规流）。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def safe_print(*args, **kwargs):
    """需要更保险时用这个（例如把异常信息写进日志）。"""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        text = " ".join(str(a) for a in args)
        sys.stdout.write(text.encode(enc, "replace").decode(enc, "replace") + "\n")
