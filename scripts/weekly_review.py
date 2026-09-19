#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每周成本/质量复盘 —— 从 ~/.dsh/sessions 的会话日志里算六项指标。

用法:
    python3 scripts/weekly_review.py            # 最近 7 天（Ubuntu / macOS）
    python3 scripts/weekly_review.py --days 14
    python scripts\\weekly_review.py --days 14  # Windows

输出: ~/.handoff/review/<YYYY-MM-DD>.md （同时往 stdout 打 ≤8 行摘要）

会话日志解压走 _session_io（python-zstandard → zstdcat → zstd -dc），不再硬依赖 zstd CLI。

定价: DeepSeek 官方 deepseek-flash（=V4.1-Flash）空闲 ¥1/¥0.02/¥4、高峰 ×2；
      高峰 = 周一至五 01:00–04:00 与 06:00–10:00 UTC（= 北京 09–12、14–18 点）。
      走包月套餐（ark-*）的请求单独列出，边际成本≈0。
      非 DeepSeek 路由（zai-* 等）按同价估算，仅供横向比较——不是真实账单。
"""
import argparse, collections, datetime, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _session_io as S  # noqa: E402
import _console  # noqa: E402

HANDOFF = os.path.expanduser("~/.handoff")
OUTDIR = os.path.join(HANDOFF, "review")
BASELINE = 68.0          # 2026-09-09 ~ 09-19 实测总账（¥）
BASELINE_DAYS = 11
COLD_MID_MIN = 20000     # 会话中途"冷读"的判定下限（未命中 tokens）

# 【2026-09-19 修】这里原来写死 `d.get("name") == "bash"`，于是第 5 节"步骤重复"
# **恒为 0** —— 因为本机根本没有 bash 工具。实测 123 个会话的 tool/call 名称分布：
#   pwsh 7151 / edit 2042 / read 2038 / write 1143 / grep 722 / job_output 374 / ...
# 即 Windows 上的 shell 工具叫 `pwsh`。这个指标是文档里点名的"头号失败模式"，
# 长期恒 0 等于完全没在观测。现在按"shell 类工具"整组统计。
SHELL_TOOLS = frozenset({"bash", "sh", "shell", "zsh", "pwsh", "powershell", "cmd", "cmd.exe", "terminal"})


def is_peak(ts_ms):
    u = datetime.datetime.fromtimestamp(ts_ms / 1000).astimezone(datetime.timezone.utc)
    return u.weekday() < 5 and (1 <= u.hour < 4 or 6 <= u.hour < 10)


def rates(ts_ms):
    return (0.04, 2.0, 8.0) if is_peak(ts_ms) else (0.02, 1.0, 4.0)


def cost_of(inp, cr, out, ts_ms):
    cin, cmiss, cout = rates(ts_ms)
    return (cr * cin + inp * cmiss + out * cout) / 1e6


def load_sessions(backend=None):
    out = []
    for f in S.iter_session_files():
        try:
            ev = S.load_events(f, backend)
        except Exception as exc:
            print("跳过 %s: %s" % (f, exc), file=sys.stderr)
            continue
        if not ev:
            continue
        ev.sort(key=lambda o: o.get("time") or 0)
        times = [o["time"] for o in ev if o.get("time")]
        out.append(dict(sid=os.path.basename(os.path.dirname(f)),
                        depth=ev[0].get("delegationDepth") or 0,
                        start=min(times) if times else 0, events=ev))
    return out


def scan(sess, since_ms):
    prov = None
    reqs, cmds = [], collections.Counter()
    for o in sess["events"]:
        t, d = o.get("type"), (o.get("data") or {})
        if t == "request/header":
            prov = ((d.get("header") or {}).get("config") or {}).get("provider")
        elif t == "assistant/chunk":
            ch = d.get("chunk") or {}
            if ch.get("type") == "usage" and (o.get("time") or 0) >= since_ms:
                u = ch["usage"]
                reqs.append(dict(ts=o["time"], prov=prov,
                                 inp=u.get("inputTokens", 0), cr=u.get("cacheReadTokens", 0),
                                 out=u.get("outputTokens", 0), rt=u.get("reasoningTokens", 0)))
        elif t == "tool/call" and d.get("name") in SHELL_TOOLS and (o.get("time") or 0) >= since_ms:
            try:
                cmd = json.loads(d.get("arguments") or "{}").get("command", "")
            except Exception:
                cmd = ""
            if cmd:
                cmds[" ".join(cmd.split())[:120]] += 1
    return reqs, cmds


def handoff_dirs():
    out = []
    for d in glob.glob(os.path.join(HANDOFF, "*")):
        name = os.path.basename(d)
        m = re.match(r"^(\d{2})(\d{2})-(\d{2})(\d{2})-", name)
        if os.path.isdir(d) and m:
            try:
                when = datetime.datetime(datetime.date.today().year, int(m.group(1)), int(m.group(2)),
                                         int(m.group(3)), int(m.group(4)))
            except ValueError:
                continue
            out.append((when, name, d))
    return sorted(out)


def main():
    _console.setup()
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    now = datetime.datetime.now()
    since = (now - datetime.timedelta(days=a.days)).timestamp() * 1000

    total = collections.Counter()
    by_class = collections.Counter()
    by_prov = collections.Counter()
    depth = collections.Counter()
    cold_mid = collections.Counter()
    cold_first = collections.Counter()
    per_day = collections.defaultdict(float)
    main_cost_by_time = []          # (ts, cost) 仅 depth==0，用于交接后 24h 统计
    sub_cost = sub_tasks = 0.0
    main_sessions = max_ctx = repeats = repeat_sessions = 0

    backend = S.preflight()
    if backend is None:
        return

    for s in load_sessions(backend):
        reqs, cmds = scan(s, since)
        if not reqs:
            continue
        depth[s["depth"]] += 1
        s_cost = 0.0
        for i, r in enumerate(reqs):
            raw = cost_of(r["inp"], r["cr"], r["out"], r["ts"])
            billable = 0.0 if (r["prov"] or "").startswith("ark-") else raw
            by_prov[r["prov"] or "?"] += billable
            s_cost += billable
            total["cost"] += billable
            total["req"] += 1
            total["inp"] += r["inp"]; total["cr"] += r["cr"]
            total["out"] += r["out"]; total["rt"] += r["rt"]
            max_ctx = max(max_ctx, r["cr"] + r["inp"])
            d = datetime.datetime.fromtimestamp(r["ts"] / 1000).strftime("%m-%d")
            per_day[d] += billable
            cin, cmiss, cout = rates(r["ts"])
            by_class["缓存命中输入"] += r["cr"] * cin / 1e6
            by_class["未命中输入"] += r["inp"] * cmiss / 1e6
            by_class["输出"] += r["out"] * cout / 1e6
            if r["cr"] == 0 and r["inp"] >= 50000:
                if i == 0:
                    cold_first["n"] += 1; cold_first["cost"] += (r["inp"] * cmiss + r["out"] * cout) / 1e6
                elif r["inp"] >= COLD_MID_MIN:
                    cold_mid["n"] += 1; cold_mid["cost"] += (r["inp"] * cmiss + r["out"] * cout) / 1e6
        if s["depth"] > 0:
            sub_cost += s_cost; sub_tasks += 1
        else:
            main_sessions += 1
            main_cost_by_time.append((s["start"], s_cost))
        rep = sum(1 for _, n in cmds.items() if n >= 3)
        if rep:
            repeats += rep; repeat_sessions += 1

    lines = ["# 周复盘 %s（最近 %d 天）\n" % (now.strftime("%Y-%m-%d"), a.days)]
    lines.append("## 1. 花费\n")
    lines.append("- 总花费 **¥%.2f**（%d 次请求，均 ¥%.4f/请求）" % (
        total["cost"], total["req"], total["cost"] / max(1, total["req"])))
    lines.append("- 基线：2026-09-09~09-19 共 ¥%.0f / %d 天 = ¥%.1f/天；本窗口 ¥%.1f/天" % (
        BASELINE, BASELINE_DAYS, BASELINE / BASELINE_DAYS, total["cost"] / max(1, a.days)))
    for k, v in by_class.most_common():
        lines.append("  - %s ¥%.2f（%.0f%%）" % (k, v, 100 * v / max(1e-9, total["cost"])))
    lines.append("- 按天：" + "，".join("%s ¥%.2f" % (d, per_day[d]) for d in sorted(per_day)))
    lines.append("- provider：" + "，".join("%s ¥%.2f" % (k, v) for k, v in by_prov.most_common()))
    lines.append("\n## 2. 冷读\n")
    lines.append("- **会话中途冷读**（cr=0 且未命中≥%dk）：**%d 次，¥%.2f**（占本窗口 %.1f%%）" % (
        COLD_MID_MIN // 1000, cold_mid["n"], cold_mid["cost"], 100 * cold_mid["cost"] / max(1e-9, total["cost"])))
    lines.append("- 会话首个请求（预期内，冷启动）：%d 次，¥%.2f" % (cold_first["n"], cold_first["cost"]))
    lines.append("\n## 3. 子代理\n")
    lines.append("- %d 个会话，共 ¥%.2f，单任务均 ¥%.2f" % (
        int(sub_tasks), sub_cost, sub_cost / max(1, sub_tasks)))
    lines.append("- delegationDepth 分布：%s（**depth≥2 应为 0**；出现即 `standard-leash` 未生效）" % dict(sorted(depth.items())))
    lines.append("\n## 4. 交接\n")
    hs = handoff_dirs()
    lines.append("- `.handoff/` 下交接目录 %d 个；主会话 %d 个；最大上下文 %d tokens" % (
        len(hs), main_sessions, max_ctx))
    for when, name, _ in hs[-6:]:
        lo, hi = when.timestamp() * 1000, (when + datetime.timedelta(hours=24)).timestamp() * 1000
        c = sum(v for ts, v in main_cost_by_time if lo <= ts <= hi)
        lines.append("  - `%s` 之后 24h 主会话花费 ¥%.2f" % (name, c))
    lines.append("\n## 5. 步骤重复（同一会话内同一条 shell 命令 ≥3 次）\n")
    lines.append("- %d 处，涉及 %d 个会话（MAST 测得的头号失败模式，占 15.7%%）" % (repeats, repeat_sessions))
    lines.append("\n## 6. 建议\n")
    tips = []
    if cold_mid["n"]:
        tips.append("有 %d 次中途冷读（¥%.2f）：检查是否在长上下文里首次启用新档位、或长会话闲置后续聊。" % (cold_mid["n"], cold_mid["cost"]))
    if depth.get(2) or depth.get(3):
        tips.append("出现 depth≥2 的委派 → `standard-leash` 未生效，检查 `agent-presets.default`。")
    if by_class["输出"] > total["cost"] * 0.45:
        tips.append("输出占成本 >45%：推理 token 是主因，执行型会话考虑改用 `off` 档。")
    if sub_cost > total["cost"] * 0.35:
        # 【2026-09-19 修】旧版写的是 ">35%%"：这是普通字符串（不是格式串），
        # %% 不会被折叠成 %，于是文案里真的多出一个百分号。同段其它 tips 都用单个 %。
        tips.append("子代理占成本 >35%：检查是否又有扇出、或委派任务粒度太粗。")
    if repeats:
        tips.append("存在步骤重复：多半是重试循环、或没落盘指针导致重复摸索。")
    lines.extend(["- " + t for t in tips] or ["- 无明显异常。"])

    os.makedirs(OUTDIR, exist_ok=True)
    path = os.path.join(OUTDIR, "%s.md" % now.strftime("%Y-%m-%d"))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    if not a.quiet:
        print("周复盘 → %s" % path)
        print("  花费 ¥%.2f / %d 请求（基线 %.1f/天 → 本窗口 %.1f/天）" % (
            total["cost"], total["req"], BASELINE / BASELINE_DAYS, total["cost"] / max(1, a.days)))
        print("  中途冷读 %d 次 ¥%.2f | 子代理 %d 个 ¥%.2f | depth %s" % (
            cold_mid["n"], cold_mid["cost"], int(sub_tasks), sub_cost, dict(sorted(depth.items()))))
        print("  交接 %d 次 | 步骤重复 %d 处 / %d 会话" % (len(hs), repeats, repeat_sessions))


if __name__ == "__main__":
    main()
