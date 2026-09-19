#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""实测：**前缀缓存能活多久**（决定"隔夜续聊"要不要付一次全冷）。

    export DEEPSEEK_API_KEY=sk-...      # 或从 ~/.dsh/.credentials.yaml 读取
    python3 scripts/cache_ttl.py --waits 15,45,120     # Ubuntu / macOS
    python scripts\\cache_ttl.py --waits 15,45,120     # Windows

等待时间较长（默认 +15/+45/+120 分钟），推荐后台跑。各平台写法：

    # Ubuntu / macOS
    nohup python3 scripts/cache_ttl.py > /tmp/ttl.log 2>&1 &
    tail -f /tmp/ttl.log

    # Windows PowerShell（没有 nohup）
    python scripts\\cache_ttl.py        # 开一个窗口挂着即可；或
    Start-Job { python scripts\\cache_ttl.py } | Receive-Job -Wait

先热一次 30k 前缀，然后在 +15 / +45 / +120 分钟各打一次同一个 prompt，
观察 `prompt_cache_hit_tokens` 是否衰减。全程几乎只花命中价。
"""
import argparse, datetime, json, os, re, time, urllib.request

import _console  # noqa: E402

URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-flash"
PARA = ("The calibration procedure for the force-torque sensor requires the operator to mount the known mass, "
        "record the raw wrench, rotate the tool by ninety degrees, and repeat the measurement at four orientations. "
        "Each orientation must be logged with a timestamp, the ambient temperature, and the serial number of the "
        "adapter plate that was used, because thermal drift and adapter tolerance both shift the zero offset. ")


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
    _console.setup()
    ap = argparse.ArgumentParser()
    ap.add_argument("--waits", default="15,45,120", help="分钟，逗号分隔")
    a = ap.parse_args()
    key = api_key()
    msgs = [{"role": "system", "content": "You are a terse assistant. Answer with a single number."},
            {"role": "user", "content": PARA * 430 + "\n\nQuestion: reply with only the number 7."}]

    def probe(tag):
        body = {"model": MODEL, "messages": msgs, "max_tokens": 16, "stream": False,
                "thinking": {"type": "enabled"}, "reasoning_effort": "high"}
        req = urllib.request.Request(URL, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
        try:
            u = json.load(urllib.request.urlopen(req, timeout=600)).get("usage", {})
            print("%s %-10s hit=%-8s miss=%-8s" % (datetime.datetime.now().strftime("%H:%M:%S"), tag,
                                                   u.get("prompt_cache_hit_tokens"), u.get("prompt_cache_miss_tokens")),
                  flush=True)
        except Exception as e:
            print("%s %-10s FAILED %s" % (datetime.datetime.now().strftime("%H:%M:%S"), tag, str(e)[:60]), flush=True)

    probe("T0 预热")
    prev = 0
    for m in [int(x) for x in a.waits.split(",")]:
        time.sleep((m - prev) * 60)
        prev = m
        probe("T+%dmin" % m)


if __name__ == "__main__":
    main()
