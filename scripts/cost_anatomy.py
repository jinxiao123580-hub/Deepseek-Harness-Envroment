#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DSH 花费解剖：把 ~/.dsh/sessions 的 usage 事件折算成人民币，并按类别/会话/日期拆解。

    python3 scripts/cost_anatomy.py [--days 30] [--top 10]     # Ubuntu / macOS
    python scripts\\cost_anatomy.py [--days 30] [--top 10]     # Windows

会话日志解压统一走 _session_io（python-zstandard → zstdcat → zstd -dc），
不再硬依赖 zstd 命令行工具 —— Windows 上默认没有它，旧版 subprocess.run(["zstdcat",...])
会直接抛 FileNotFoundError（不是 returncode != 0，所以旧代码兜不住）把脚本崩掉。

关键点：单价差 50–200 倍（缓存命中 ¥0.02–0.04/M，未命中 ¥1–2/M，输出 ¥4–8/M），
所以 **token 占比 ≠ 账单占比** —— 本脚本按钱算。

定价（DeepSeek 官方 deepseek-flash = V4.1-Flash）：
  空闲：缓存命中 ¥0.02 / 未命中输入 ¥1 / 输出 ¥4（每百万 tokens）
  高峰：×2（高峰 = 周一至五 01:00–04:00 与 06:00–10:00 UTC，即北京 09–12、14–18 点）
走包月套餐（provider 以 ark- 开头）的请求边际成本记 0，单独列出。
"""
import argparse, collections, datetime, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _session_io as S  # noqa: E402
import _console  # noqa: E402


def is_peak(ts_ms):
    u = datetime.datetime.fromtimestamp(ts_ms / 1000).astimezone(datetime.timezone.utc)
    return u.weekday() < 5 and (1 <= u.hour < 4 or 6 <= u.hour < 10)


def rates(ts_ms):
    return (0.04, 2.0, 8.0) if is_peak(ts_ms) else (0.02, 1.0, 4.0)


def main():
    _console.setup()
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3650)
    ap.add_argument("--top", type=int, default=10)
    a = ap.parse_args()
    since = (datetime.datetime.now() - datetime.timedelta(days=a.days)).timestamp() * 1000

    klass = collections.Counter()
    req_total = 0
    prov = collections.Counter()
    byday = collections.defaultdict(float)
    sess_rows = []
    depth = collections.Counter()
    cold = collections.Counter()
    reason_chars = text_chars = 0
    total = 0.0

    backend = S.preflight()
    if backend is None:
        return

    for f in S.iter_session_files():
        try:
            ev = S.load_events(f, backend)
        except Exception as exc:
            print("跳过 %s: %s" % (f, exc), file=sys.stderr)
            continue
        if not ev:
            continue
        depth[ev[0].get("delegationDepth") or 0] += 1
        title = None
        for o in ev:
            if o.get("type") == "session/title":
                title = (o.get("data") or {}).get("title")
        prov_cur = None
        s_cost = 0.0
        reqs = []
        for o in ev:
            t, d = o.get("type"), (o.get("data") or {})
            if t == "request/header":
                prov_cur = ((d.get("header") or {}).get("config") or {}).get("provider")
            elif t == "assistant/chunk":
                ch = d.get("chunk") or {}
                if ch.get("type") == "usage" and (o.get("time") or 0) >= since:
                    reqs.append((o["time"], ch["usage"], prov_cur))
            elif t == "reasoning-chunks":
                reason_chars += sum(len(x) for x in (d.get("texts") or []))
            elif t == "text-chunks":
                text_chars += sum(len(x) for x in (d.get("texts") or []))
        for i, (ts, u, pv) in enumerate(reqs):
            req_total += 1
            cin, cmiss, cout = rates(ts)
            inp, cr, out = u.get("inputTokens", 0), u.get("cacheReadTokens", 0), u.get("outputTokens", 0)
            c = (cr * cin + inp * cmiss + out * cout) / 1e6
            klass["缓存命中输入"] += cr * cin / 1e6
            klass["未命中输入"] += inp * cmiss / 1e6
            klass["输出"] += out * cout / 1e6
            if (pv or "").startswith("ark-"):
                prov[pv] += c
                c = 0.0
            else:
                prov[pv or "?"] += c
            s_cost += c
            total += c
            byday[datetime.datetime.fromtimestamp(ts / 1000).strftime("%m-%d")] += c
            if cr == 0 and inp >= 50000 and i > 0:
                cold["n"] += 1
                cold["cost"] += (inp * cmiss + out * cout) / 1e6
        if reqs:
            sess_rows.append((s_cost, len(reqs), title or os.path.basename(os.path.dirname(f)),
                              sum(u.get("cacheReadTokens", 0) + u.get("inputTokens", 0) for _, u, _ in reqs) // len(reqs),
                              reqs[-1][1].get("cacheReadTokens", 0) + reqs[-1][1].get("inputTokens", 0)))

    print("请求 %d ｜ 合计 ¥%.2f" % (req_total, total))
    for k, v in klass.most_common():
        print("  %-8s ¥%7.2f  %4.0f%%" % (k, v, 100 * v / max(1e-9, total)))
    print("  按 provider：" + "，".join("%s ¥%.2f" % (k, v) for k, v in prov.most_common()))
    print("  按天：" + "，".join("%s ¥%.2f" % (d, byday[d]) for d in sorted(byday)))
    print("  子代理 depth 分布 %s" % dict(sorted(depth.items())))
    print("  会话中途冷读（cr=0 且未命中≥50k）：%d 次 ¥%.2f" % (cold["n"], cold["cost"]))
    if reason_chars + text_chars:
        print("  推理字符 %.2fM vs 文本字符 %.2fM → 推理占输出 %.0f%%"
              % (reason_chars / 1e6, text_chars / 1e6, 100 * reason_chars / (reason_chars + text_chars)))
    print("\n  Top %d 会话（按花费 / 请求数 / 平均上下文 / 终态上下文）：" % a.top)
    for c, n, t, avg, lastctx in sorted(sess_rows, reverse=True)[:a.top]:
        print("   ¥%6.2f  %4d 请求  avg %7d  end %7d  %s" % (c, n, avg, lastctx, str(t)[:40]))


if __name__ == "__main__":
    main()
