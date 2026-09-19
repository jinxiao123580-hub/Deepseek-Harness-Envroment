#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""实测：**换个档位会不会打断前缀缓存**。

    export DEEPSEEK_API_KEY=sk-...      # 或从 ~/.dsh/.credentials.yaml 读取
    python3 scripts/cache_lineage.py --filler-repeats 430

做法：构造一个约 30k tokens 的固定前缀，然后按 [high, high, off, high, low, off, high, low, max, high, max]
的顺序反复请求同一个 prompt，只改 `thinking`/`reasoning_effort`，观察 `prompt_cache_hit_tokens`。

预期结论（2026-09-19 实测）：
  · 每个档位值是**独立的一条缓存谱系**（因为 effort 是 prompt 的第 0 个 block）
  · 某档位"首次出现" = 一次全冷（hit=0，且耗时可达 20 s+）
  · 之后来回切换仍然全命中（同一档位再次出现时 hit≈prompt−200）
成本：约 30 万输入 tokens（其中大部分命中），几分钱。
"""
import argparse, json, os, re, time, urllib.request

URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-flash"
PARA = ("The calibration procedure for the force-torque sensor requires the operator to mount the known mass, "
        "record the raw wrench, rotate the tool by ninety degrees, and repeat the measurement at four orientations. "
        "Each orientation must be logged with a timestamp, the ambient temperature, and the serial number of the "
        "adapter plate that was used, because thermal drift and adapter tolerance both shift the zero offset. ")
SEQ = [("high", "1 high 冷启动"), ("high", "2 high 再发"), ("off", "3 off 首次"), ("high", "4 切回 high"),
       ("low", "5 low 首次"), ("off", "6 再切 off"), ("high", "7 再切回 high"), ("low", "8 再切回 low"),
       ("max", "9 max 首次"), ("high", "10 再切回 high"), ("max", "11 再切回 max")]


def api_key():
    k = os.environ.get("DEEPSEEK_API_KEY")
    if k:
        return k
    for line in open(os.path.expanduser("~/.dsh/.credentials.yaml"), encoding="utf-8"):
        m = re.match(r"\s*DEEPSEEK_API_KEY\s*:\s*(\S+)", line)
        if m:
            return m.group(1).strip().strip("\"'")
    raise SystemExit("未找到 DEEPSEEK_API_KEY")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--filler-repeats", type=int, default=430, help="430 ≈ 30k tokens 的前缀")
    a = ap.parse_args()
    key = api_key()
    msgs = [{"role": "system", "content": "You are a terse assistant. Answer with a single number."},
            {"role": "user", "content": PARA * a.filler_repeats + "\n\nQuestion: reply with only the number 7."}]
    print("前缀字符数 %d（约 %dk tokens）\n" % (len(PARA) * a.filler_repeats, len(PARA) * a.filler_repeats // 3500))
    print("%-14s %-6s %9s %9s %9s %7s" % ("步骤", "档位", "prompt", "hit", "miss", "秒"))
    for effort, tag in SEQ:
        body = {"model": MODEL, "messages": msgs, "max_tokens": 16, "stream": False}
        body["thinking"] = {"type": "disabled"} if effort == "off" else {"type": "enabled", "reasoning_effort": effort}
        req = urllib.request.Request(URL, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
        t0 = time.time()
        try:
            r = json.load(urllib.request.urlopen(req, timeout=600))
            u = r.get("usage", {})
            print("%-14s %-6s %9s %9s %9s %7.1f" % (tag, effort, u.get("prompt_tokens"),
                                                    u.get("prompt_cache_hit_tokens"),
                                                    u.get("prompt_cache_miss_tokens"), time.time() - t0))
        except Exception as e:
            print("%-14s %-6s FAILED %s" % (tag, effort, str(e)[:60]))
        time.sleep(2)
    print("\n判读：某个档位第一次出现时 hit=0（全冷，且可能慢 20 倍）；再次出现即全命中。"
          "\n→ 换档只在会话边界做；要在会话内用两档，必须在上下文很小时各热一次。")


if __name__ == "__main__":
    main()
