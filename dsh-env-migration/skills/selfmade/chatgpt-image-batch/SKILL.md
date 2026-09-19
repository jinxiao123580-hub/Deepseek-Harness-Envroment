---
name: chatgpt-image-batch
description: "批量使用 ChatGPT 网页生成图片并保存到本地。读取 D:\\DSH_GPT_IMAGES\\prompts.txt（格式：每段以 ---编号--- 开头，后续为图片 Prompt），通过 Playwright MCP（mcp__playwright__*）控制已登录的 ChatGPT 浏览器逐条生成，串行执行：每条 Prompt 发到新对话 → 等待图片真正生成完成（页面内轮询检测 alt 含\"已生成图片\"的 img，且 naturalWidth>0、无停止按钮，禁止用固定 sleep 假设完成）→ 用锚点下载原图 → 校验 PNG 魔数与尺寸后另存为 D:\\DSH_GPT_IMAGES\\output\\00N.png。失败最多自动重试 2 次（第一次重查页面状态、第二次重发 Prompt），仍失败则记录到 D:\\DSH_GPT_IMAGES\\failed_prompts.txt（编号/Prompt/失败原因/最后页面状态）并继续下一张，不让单张失败中断整个批次。Token 最小化：优先用 browser_evaluate 单次轮询、复用稳定 CSS 选择器（#prompt-textarea、button[data-testid=send-button]），避免整页 snapshot 与 DOM 大段回传。"
compatibility: 'Requires Playwright MCP 已配置（serverName: playwright）且浏览器 Profile 已登录 ChatGPT；prompts.txt 与输出目录 D:\DSH_GPT_IMAGES 可写。'
allowed-tools: Bash
---

# ChatGPT 批量图片生成（Playwright MCP）

用 ChatGPT 网页按 prompts.txt 批量生成图片。触发语示例："使用 ChatGPT 给 prompts.txt 中的所有 Prompt 生成图片。"

## 前置条件（已完成，无需重复配置）

- DSH 已通过 `@deepseek-ai/dsh-mcp-client` 挂载 Playwright MCP（serverName `playwright`，stdio，Chrome channel，持久化 Profile `D:\DSH_GPT_IMAGES\browser-profile`）。
- 浏览器工具名为 `mcp__playwright__browser_*`（实际以本会话注册为准，先用一个轻调用如 `browser_tabs {action:"list"}` 确认可用）。
- 持久化 Profile 已登录 ChatGPT。若快照出现"登录"按钮，暂停并请用户在该 Chrome 窗口中手动登录（不要读取/复制 Cookie，不要绕过验证码）。
- `D:\DSH_GPT_IMAGES\prompts.txt` 存在，格式：每段以 `---编号---` 开头，后续行（可多行）为该图片的 Prompt。

## 输入解析

用 read 工具读 `D:\DSH_GPT_IMAGES\prompts.txt`，按 `^---(\d+)---` 切分，得到有序列表 `[{num, prompt}]`。编号通常 001 起。

## 输出约定

- 图片保存到 `D:\DSH_GPT_IMAGES\output\<编号>.png`（目录不存在先创建）。
- 保存前必须校验：文件存在、非 0 字节、PNG 魔数 `89 50 4E 47 0D 0A 1A 0A`；并用 PNG 头（偏移 16/20 的 4 字节大端）读出宽高，与页面 `img.naturalWidth/naturalHeight` 一致才视为成功。绝不允许把网页截图/缩略图/loading 图当原图。
- 失败记录写 `D:\DSH_GPT_IMAGES\failed_prompts.txt`（UTF-8，追加），格式：
  ```
  编号
  Prompt 原文
  失败原因
  最后页面状态（关键文本/错误标记）
  ```

## 单张生成流程（每张都完整走一遍）

1. **新对话**：`browser_navigate` 到 `https://chatgpt.com/`（每次新开，避免与上一张混淆）。
2. **输入**：`browser_type` 到 `#prompt-textarea`（ChatGPT 可见输入框是 contenteditable div；不要用隐藏的 `textarea.wcDTda_fallbackTextarea`），`slowly: true` 逐字符输入以触发 ProseMirror 更新。可用 `browser_evaluate` 校验 `#prompt-textarea.innerText` 与发送按钮 `button[data-testid="send-button"]` 的 `disabled` 状态。
3. **提交**：`browser_click` 在 `button[data-testid="send-button"]`。提交后 URL 变为 `/c/...`。
4. **等待完成（关键）**：一次 `browser_evaluate` 内做轮询（约每 4s 一次，总限时 ≤240s），判定完成的条件（同时满足）：
   - `main` 内存在 `img[alt^="已生成图片"]`（或 src 含 `estuary`/`oaiusercontent`）且 `complete===true` 且 `naturalWidth>0`；
   - 页面无停止按钮（`button[data-testid="stop-button"]` / 文本"停止生成"）；
   - 无失败标记（文本含"生成失败"/"出现问题"/"出错了" 或图片卡片出现"重试"按钮）。
   超时或出现失败标记 → 返回 `{done:false, reason, state}` 触发重试逻辑。禁止用固定 sleep 代替状态检测。
5. **取原图（可靠方式，已实测）**：用 `browser_run_code_unsafe` 一次性完成"触发下载 + 落盘"（勿依赖 downloads 目录自动落盘，实测第 2、3 张会因自动下载被拦/竞态而丢文件）：
   ```js
   async (page) => {
     const dlPromise = page.waitForEvent('download', { timeout: 20000 }).catch(e => ({ err: String(e) }));
     await page.evaluate(() => {
       const imgs = [...document.querySelectorAll('main img')].filter(i => i.src.includes('estuary') && i.complete && i.naturalWidth > 0);
       const img = imgs[imgs.length - 1]; if (!img) return 'NO_IMG';
       const a = document.createElement('a'); a.href = img.src; a.download = 'img.png';
       document.body.appendChild(a); a.click(); a.remove(); return 'clicked';
     });
     const dl = await dlPromise;
     if (dl.err) return 'NO_DOWNLOAD_EVENT: ' + dl.err;
     await dl.saveAs('D:\\DSH_GPT_IMAGES\\output\\<编号>.png');
     return 'SAVED';
   }
   ```
6. **落盘校验**：校验 `output\<编号>.png` 存在、非 0 字节、PNG 魔数 `89 50 4E 47 0D 0A 1A 0A`，并从 PNG 头（偏移 16/20 大端 4 字节）读出宽高与页面 `naturalWidth/naturalHeight`（通常 1672x941）一致。任一不符按失败处理。

## 失败处理（第七步）

单张失败（超时/失败标记/校验不过）按序重试，最多 2 次：

1. 第 1 次：不重发，先 `browser_evaluate` 重查当前页面状态（也许只是没检测到，实际已完成）。
2. 第 2 次：重发该 Prompt（重开新对话，重新走单张流程）。
3. 仍失败：写入 `failed_prompts.txt`（含原因与最后页面状态），继续下一张，不中断批次。

## Token 最小化（第八步）

- 等待与检测全部收敛到单次 `browser_evaluate` 轮询，返回精简 JSON，绝不回传整页 DOM/快照。
- 复用稳定 CSS 选择器与元素引用；非必要不 `browser_snapshot`（整页 snapshot 只用于首次确认登录态或异常排查）。
- 下载走浏览器上下文（原图字节不进对话，零 Token）。

## 浏览器后端失联时的恢复

若 `browser_*` 调用持续超时（进程仍在但 CDP 无响应），通常发生在登录/弹窗后：杀掉 Playwright MCP 的 server 进程树（`taskkill /PID <playwright-mcp node pid> /T /F`），DSH 的 mcp-client 会自动按退避重连并重新拉起，持久化 Profile 登录态保留；随后重新 `browser_navigate` 继续即可。

## 收尾报告

批次结束后报告：成功 N 张（路径列表）、失败列表（failed_prompts.txt 内容）、每张耗时；如全部失败给出原因。
