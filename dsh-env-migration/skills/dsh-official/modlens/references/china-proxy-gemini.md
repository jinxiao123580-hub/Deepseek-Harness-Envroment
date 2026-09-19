# This Machine: Gemini via Clash Proxy (China) — Known-Good Setup & Fixes

Read this BEFORE debugging modlens on this machine when the error is
`Gemini API error 400: "User location is not supported for the API use."`
or when an image read fails on the `gemini-api` provider.

Last verified: 2026-08-19 (worked, ~20s/image, model gemini-3.6-flash).

## The setup that IS correct (do not "fix" these)

- modlens config `~/.modlens/config.json` already sets
  `"proxy": "http://127.0.0.1:7897"` and `"provider": "gemini-api"` with a key.
  modlens DOES use this explicit proxy for the gemini-api request.
- Clash Verge runs on this machine: mixed port 7897, system proxy ON, TUN OFF,
  mode = Rule. `generativelanguage.googleapis.com` falls to the final
  `MATCH, 🐟 漏网之鱼` group, so its exit = whatever node is selected there.
- Do NOT change the proxy config or expect system-proxy / HTTPS_PROXY / TUN to
  matter for modlens: the config proxy is already the right mechanism.

## The one failure mode you will actually hit here

`User location is not supported for the API use` (400 FAILED_PRECONDITION)
means the **Clash node's egress IP region is rejected by the Gemini API**.
It is NOT a modlens bug and NOT a proxy config bug.

Two traps that LOOK like the same bug but are different:

1. Node exit in a Gemini-unsupported region (e.g. Taiwan TW, or a datacenter IP
   Google flags — OVH US e.g. "美国 A09 Gemini 移动优化" was rejected even
   though plain Google `www.google.com/generate_204` returned 204 through it).
2. `ANTHROPIC_BASE_URL` is set on this machine to
   `https://api.deepseek.com/anthropic` (a text-only gateway). modlens inherits
   it as the `anthropic` provider's baseUrl, so `-p anthropic` / the claude-cli
   fallback silently hit a blind text gateway and fail. Remember to unset it
   or pin a real endpoint if you ever use the anthropic path.

## Correct fix procedure (in order)

1. **Do not touch modlens config.** Verify the proxy path is the issue by
   probing the Gemini API through the proxy from Node (real network; the
   sandboxed PowerShell cannot see listening ports — every
   `Get-NetTCPConnection` call returned 0):

   ```bash
   node "D:\Deepseek Harness\_tmp_gemini_probe.cjs"   # CONNECT 127.0.0.1:7897 -> generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_KEY
   ```
   - HTTP 200 + model list  -> exit accepted, just retry `modlens -i <img>`.
   - HTTP 400 region error -> egress rejected -> step 2.

2. **Ask the user to switch the Clash node** (Clash Verge tray -> 漏网之鱼
   group / node selection) to another "Gemini 优化" node. On this machine the
   node **「美国 A01 IPv6双栈 Gemini」** is a known-working one (2026-08-19);
   others in the subscription (A02/A03 ... A15) may also work; A09's OVH exit
   was rejected.

3. Re-run the probe (step 1). Only when it returns 200, retry `modlens -i`.
   (Do not waste Gemini quota on a read while the exit is still rejected —
   it fails fast but costs nothing extra; still, probe first.)

4. If several nodes are all rejected, the durable fix is a China-native
   multimodal provider instead of Gemini (volcano ark doubao-vision / qwen-vl /
   GLM-4V) configured as modlens `openai` provider — no proxy involved.

## The one-line decision rule

Gemini 400 "User location is not supported" + Clash on this machine
= switch the Clash node to a Gemini-supported egress, verify with the probe,
then retry. Nothing else.
