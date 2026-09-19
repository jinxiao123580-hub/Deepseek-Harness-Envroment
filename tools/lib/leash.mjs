// tools/lib/leash.mjs — 共享的「子代理护栏」注入逻辑
//
// 被两个脚本共用：
//   · regen-standard-leash.mjs —— 从**当前安装的** DSH 的 standard preset 重新生成副本
//   · harden-preset.mjs        —— 把同样 4 项护栏打进**任意已有** preset（如用户自己的 router-standard）
//
// 为什么要有 harden-preset（2026-09-19 实测）:
//   本机的默认 preset 不是 standard，而是用户自定义的 `router-standard`。
//   `standard-leash` 只影响"新会话且选了该 preset"的会话，所以**把 standard-leash 装上去
//   并不能堵住本机的扇出风险**。真正要做的是把护栏移植进用户实际在用的那份 preset。
//   而"手工移植"正是 standard-leash 副本漂移的成因，所以同样用脚本做。

/** 子代理宪法（persona）。5 条硬规则，注入为 order:0 的 system prompt section。 */
export const PERSONA = `你是被派来执行具体任务的执行型子代理。硬规则：
1. 只做被指派的事，不扩大范围；不要再派子代理（工具已禁用）。
2. 需要外部事实时先本地查（grep/read），本地没有再联网；一次任务最多 2 次网页检索。
3. 详细结果写进 <cwd>/.handoff/reports/<YYYYMMDD>-<slug>.md，文件第一段必须是 <=10 行的结论摘要（重要在前）。
4. 你回给上级的那段话只允许：<=10 行摘要 + 报告文件绝对路径 + 你没确定的事。禁止把长文或原始材料贴回上级。
5. 不复述任务背景，不解释你的过程。`;

/** config 下各项的缩进（8 空格）—— dsh 的 agent.cordis.yml 各处结构一致。 */
export const IND = '        ';

/** 需要加护栏的两行（spawn 与 fork 两个后端）。 */
export const ROWS = ['tool-subagent', 'tool-subagent-fork'];

/** 注入的 25 行文本。 */
export const LEASH = [
  `${IND}# ── 子代理护栏（standard-leash 相对 standard 的**全部**改动；由 tools/lib/leash.mjs 注入）──`,
  `${IND}# ① 子代理改走 deepseek-cheap 路由（thinking: disabled）——`,
  `${IND}#    reasoningEffort 是唯一没有 per-agent 配置路径的旋钮（AgentOptions 只有 provider/model/maxTokens），`,
  `${IND}#    所以"让子代理不思考"只能靠换一条默认档位为 off 的路由。`,
  `${IND}#    注意：目标 preset 里若没有 deepseek-cheap 这个 provider，请先合并`,
  `${IND}#    config/settings.deepseek-cheap.yaml，否则子代理会因为找不到 provider 而失败。`,
  `${IND}agentOptions:`,
  `${IND}  provider: deepseek-cheap`,
  `${IND}  model: deepseek-flash`,
  `${IND}# ② 禁递归：resolveChildDepth 里 childDepth = parent + 1，depth 2 直接抛 SubagentDepthError`,
  `${IND}maxDepth: 1`,
  `${IND}# ③ 第二道锁：子代理连这些工具都看不见（同时掐掉用 workflow/ralph 变相扇出的路径）`,
  `${IND}toolFilter:`,
  `${IND}  deny:`,
  `${IND}    - subagent`,
  `${IND}    - subagent_fork`,
  `${IND}    - workflow`,
  `${IND}    - ralph`,
  `${IND}# ④ 子代理宪法：注入为 systemPrompt.section({name:"deployment:persona", order:0})，`,
  `${IND}#    所以报告纪律不靠上级每次在 prompt 里叮嘱。`,
  `${IND}persona: |-`,
  ...PERSONA.split('\n').map((l) => `${IND}  ${l}`),
].join('\n');

/** 行首缩进宽度（无缩进返回 0）。 */
function indentOf(line) { return line.search(/\S/); }

/**
 * 定位 `- id: <rowId>` 这一行及其 config: 子块的范围。
 * @returns {{start:number, configIdx:number, end:number}}
 */
export function locateRow(lines, rowId) {
  const start = lines.findIndex((l) => l.trim() === `- id: ${rowId}`);
  if (start < 0) return null;
  const idIndent = indentOf(lines[start]);
  let configIdx = -1;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (indentOf(line) <= idIndent) { end = i; break; }
    if (line.trim() === 'config:') configIdx = i;
  }
  return { start, configIdx, end };
}

/** 该行是否**已经**加了护栏（以 maxDepth: 作为标记）。 */
export function hasLeash(text, rowId) {
  const lines = text.split(/\r?\n/);
  const row = locateRow(lines, rowId);
  if (!row) return false;
  for (let i = row.start + 1; i < row.end; i++) {
    if (/^\s+maxDepth\s*:/.test(lines[i])) return true;
  }
  return false;
}

/** 往某个 `- id: <rowId>` 这一行的 config 块末尾注入 leash 文本。 */
export function injectLeash(text, rowId) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const row = locateRow(lines, rowId);
  if (!row) throw new Error(`preset 里找不到 '- id: ${rowId}'（DSH 版本可能变了结构）`);
  const { configIdx, end } = row;
  if (configIdx < 0) throw new Error(`'- id: ${rowId}' 没有 config: 子块`);
  // 在 config 块末尾插入（end 之前，去掉尾部空行）
  let insertAt = end;
  while (insertAt > configIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--;
  const out = [...lines.slice(0, insertAt), ...LEASH.split('\n'), ...lines.slice(insertAt)];
  return out.join(eol);
}

/**
 * 给所有目标行加护栏。已加过的行原样保留（幂等）。
 * @returns {{text:string, changed:string[], skipped:string[], missing:string[]}}
 */
export function harden(text, rows = ROWS) {
  let out = text;
  const changed = [];
  const skipped = [];
  const missing = [];
  for (const rowId of rows) {
    const lines = out.split(/\r?\n/);
    if (!locateRow(lines, rowId)) { missing.push(rowId); continue; }
    if (hasLeash(out, rowId)) { skipped.push(rowId); continue; }
    out = injectLeash(out, rowId);
    changed.push(rowId);
  }
  return { text: out, changed, skipped, missing };
}
