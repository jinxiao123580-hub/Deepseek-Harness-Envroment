#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验收 standard-leash + deepseek-cheap 是否真的生效（只需在**新会话**里跑过一次委派之后执行）。

    python3 scripts/verify_leash.py [--since-min 120]

检查四项（这是"未验证项"的唯一验收标准）：
  1. 新会话是否挂上了 standard-leash（session 头里的 agentPreset）
  2. 子代理是否走了 deepseek-cheap 路由（request/header 的 provider）且档位为 off
  3. 子代理的系统提示里是否有那段 persona（含"执行型子代理"）
  4. 是否还出现 delegationDepth>=2（应为 0；出现即禁递归失效）

任一项不过 → 打印对应修法。全部通过 → 打印 PASS。
"""
import argparse, collections, datetime, glob, json, os, subprocess

SESSIONS = os.path.expanduser("~/.dsh/sessions/*/*/session.jsonl.zstd")
PERSONA_MARK = "执行型子代理"
SUB_ROUTE = "deepseek-cheap"


def load(f):
    p = subprocess.run(["zstdcat", f], capture_output=True)
    if p.returncode:
        return None
    ev = []
    for line in p.stdout.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if line:
            try:
                ev.append(json.loads(line))
            except Exception:
                pass
    return ev or None


def cutoff_ms(since_min):
    """默认只统计「leash 装好之后」**新建**的会话，否则旧的扇出历史永远把它判成 FAIL。"""
    if since_min is not None:
        return (datetime.datetime.now() - datetime.timedelta(minutes=since_min)).timestamp() * 1000
    marker = os.path.expanduser("~/.dsh/.agent-presets/standard-leash/preset.yml")
    if os.path.exists(marker):
        return os.path.getmtime(marker) * 1000
    return (datetime.datetime.now() - datetime.timedelta(hours=6)).timestamp() * 1000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-min", type=int, default=None,
                    help="只看最近 N 分钟内**新建**的会话；省略则用 standard-leash 的安装时间做分界")
    a = ap.parse_args()
    cut = cutoff_ms(a.since_min)
    print("分界时间：%s（只统计此后新建的会话）\n" % datetime.datetime.fromtimestamp(cut / 1000).strftime("%Y-%m-%d %H:%M:%S"))

    presets = collections.Counter()
    depths = collections.Counter()
    child_providers = collections.Counter()
    persona_seen = 0
    main_sessions = 0
    fresh = 0

    for f in glob.glob(SESSIONS):
        ev = load(f)
        if not ev:
            continue
        times = [o["time"] for o in ev if o.get("time")]
        if not times or min(times) < cut:
            continue
        fresh += 1
        preset = ev[0].get("agentPreset")
        depth = ev[0].get("delegationDepth") or 0
        depths[depth] += 1
        if depth == 0:
            main_sessions += 1
            presets[preset] += 1
        prov = None
        for o in ev:
            t, d = o.get("type"), (o.get("data") or {})
            if t == "request/header":
                hdr = d.get("header") or {}
                cfg = hdr.get("config") or {}
                prov = cfg.get("provider")
                if depth > 0 and prov:
                    child_providers[(prov, cfg.get("reasoningEffort"))] += 1
                if depth > 0 and PERSONA_MARK in str(hdr.get("system") or ""):
                    persona_seen += 1

    print("范围内会话 %d 个（主会话 %d）" % (fresh, main_sessions))
    ok = True
    pending = []

    if not fresh:
        print("⏳ 分界之后还没有新建会话 → 这属于**预期状态**：")
        print("   `standard-leash` / `deepseek-cheap` / persona 全部只对**新会话**生效。")
        print("   验收方法：开一个新会话 → 派 1 个子代理 → 回到这里重跑本脚本，期望 PASS。")
        return

    good_preset = [p for p in presets if p == "standard-leash"]
    print("\n1) agentPreset：%s" % dict(presets))
    if not main_sessions:
        pending.append("主会话 preset")
        print("   ⏳ 分界后还没新建**主会话** → 无法判定（子代理会话不算）")
    elif good_preset:
        print("   ✅ 新会话已挂 standard-leash")
    else:
        ok = False
        print("   ❌ 仍是旧的（或别的）preset → 检查 ~/.dsh/settings.yaml 里 agent-presets.default，")
        print("      以及 YAML 是否合法：preset 目录 ~/.dsh/.agent-presets/standard-leash/")

    print("\n2) 子代理路由/档位：%s" % dict(child_providers))
    if any(p == SUB_ROUTE for (p, _) in child_providers):
        offs = [e for (p, e) in child_providers if p == SUB_ROUTE]
        if all(str(e) == "off" for e in offs):
            print("   ✅ 子代理走 deepseek-cheap 且档位 off")
        else:
            ok = False
            print("   ❌ 路由对了但档位不是 off → 检查 settings.yaml 里 deepseek-cheap 的 reasoning: \"off\"")
    elif child_providers:
        ok = False
        print("   ❌ 子代理没走 deepseek-cheap → 检查 preset 两行的 agentOptions.provider")
    else:
        pending.append("子代理路由")
        print("   ⏳ 本次范围内没有子代理调用，无法判定（跑一次委派再看）")

    print("\n3) 子代理 persona：%s" % ("✅ 命中" if persona_seen else "⏳ 未见"))
    if not persona_seen:
        pending.append("persona")
        print("   （软检查：只有经 `subagent`/`subagent_fork` 派出的子代理才会带上 persona；")
        print("     workflow 派出的不算。若确实派过 subagent 仍未见，检查 persona 缩进是否在 config 下）")

    print("\n4) delegationDepth 分布：%s" % dict(sorted(depths.items())))
    if depths.get(2) or depths.get(3) or any(d >= 2 for d in depths):
        ok = False
        print("   ❌ 出现 depth>=2 → 禁递归失效。检查 maxDepth: 1 是否写在 config 下、以及 toolFilter.deny 是否含 subagent/workflow/ralph")
    else:
        print("   ✅ 无 depth>=2")

    if not ok:
        print("\nFAIL —— 见上面 ❌ 项")
    elif pending:
        print("\nPENDING（%s 未验证）—— 目前没有失败项；开新会话 + 派一次 subagent 后重跑即为 PASS" % "、".join(pending))
    else:
        print("\nPASS —— standard-leash 全链路生效")


if __name__ == "__main__":
    main()
