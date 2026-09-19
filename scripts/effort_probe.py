#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""实测 DeepSeek 三档（off / low / high / max）的真实输出量与正确性差异。

    export DEEPSEEK_API_KEY=sk-...      # 或从 ~/.dsh/.credentials.yaml 读取
    python3 scripts/effort_probe.py

成本：约 1.2 万输入 + 1.2 万输出 tokens（几分钱）。
注意：`low` 在 DSH 的原生适配器里被拒绝（只放行 off/high/max），但 **API 本身接受 low**，
所以本探针直接打 API，用来验证"档位差异到底有多大"。
"""
import json, os, re, time, urllib.request

import _console  # noqa: E402

URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-flash"
PUZZLE = [{"role": "user", "content":
           "A farmer has 17 sheep. All but 9 run away. Then he buys 3 more, and half of his flock "
           "is sold. He then splits the remaining flock evenly into 4 pens. How many sheep are in "
           "each pen? Explain step by step."}]


def api_key():
    k = os.environ.get("DEEPSEEK_API_KEY")
    if k:
        return k
    path = os.path.expanduser("~/.dsh/.credentials.yaml")
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\s*DEEPSEEK_API_KEY\s*:\s*(\S+)", line)
        if m:
            return m.group(1).strip().strip("\"'")
    raise SystemExit("未找到 DEEPSEEK_API_KEY（环境变量或 ~/.dsh/.credentials.yaml）")


def call(key, effort, max_tokens=4000):
    body = {"model": MODEL, "messages": PUZZLE, "max_tokens": max_tokens, "stream": False}
    if effort == "off":
        body["thinking"] = {"type": "disabled"}
    else:
        body["thinking"] = {"type": "enabled"}
        body["reasoning_effort"] = effort
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + key})
    t0 = time.time()
    r = json.load(urllib.request.urlopen(req, timeout=600))
    u = r.get("usage", {})
    det = u.get("completion_tokens_details") or {}
    msg = r["choices"][0]["message"]
    return dict(effort=effort, secs=round(time.time() - t0, 1),
                prompt=u.get("prompt_tokens"), completion=u.get("completion_tokens"),
                reasoning=det.get("reasoning_tokens"),
                text=(msg.get("content") or "").strip().replace("\n", " ")[:120])


def main():
    _console.setup()
    key = api_key()
    print("%-6s %6s %11s %10s %7s  %s" % ("档位", "秒", "completion", "reasoning", "文本", "答案摘录"))
    for eff in ("off", "low", "high", "max"):
        r = call(key, eff)
        print("%-6s %6s %11s %10s %7d  %s" % (r["effort"], r["secs"], r["completion"],
                                              r["reasoning"], len(r["text"]), r["text"][:70]))
        time.sleep(1)
    print("\n判读：completion 触顶 4000 且文本为空 = 推理把预算烧光、没给出答案；"
          "off 档最快最省但可能答错多步推理题。")


if __name__ == "__main__":
    main()
