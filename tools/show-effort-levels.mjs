#!/usr/bin/env node
// show-effort-levels.mjs —— 查清某个模型到底能用哪些 reasoningEffort 档位。
//
// 为什么需要它：合法的档位是**按模型**算的，不是一套全局值。
// 依据是 pi-ai 目录里每个模型的 `thinkingLevelMap`，其中 **null = 该档位不可用**。
// 消费端证据（不是猜的）：
//   @earendil-works/pi-ai/dist/providers/azure-openai-responses.js:237
//     else if (model.thinkingLevelMap?.off !== null) { … }
//   anthropic-messages.js:872 / openai-codex-responses.js:418 同构
//
// 另外两个容易踩的点：
//   · dsh-llm-deepseek/lib/index.js:28 的适配器白名单是 off|low|high|max
//     （medium/minimal/xhigh 会被它拒绝）—— 但那只对走该适配器的模型成立。
//   · agent-default-model.reasoningEffort 的配置 schema 只是 z.string()
//     （dsh-agent-default-model/lib/index.js:16），ReasoningEffortId() 是 brandString()
//     且源码注释写明 "no validation is performed"（dsh-llm/lib/index.js:875）。
//     ⇒ 写错档位**启动不报错**，要到发请求时才抛 UNSUPPORTED_REASONING_EFFORT
//       （dsh-llm/lib/index.js:2120,2124）。所以只能靠这个脚本提前查。
//
// 用法：
//   node tools/show-effort-levels.mjs                     # 列出目录里全部可查模型
//   node tools/show-effort-levels.mjs zai glm-5.3         # 只看指定 provider + model
//   node tools/show-effort-levels.mjs --current           # 读 ~/.dsh/settings.yaml 判定当前配置
//   node tools/show-effort-levels.mjs --current --json

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const LOG = '[show-effort-levels]';

/** npm 全局 node_modules 根目录（与 regen-standard-leash.mjs 同一套做法）。 */
function npmGlobalRoot() {
  try {
    const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
    const out = (process.platform === 'win32'
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm root -g'], opts)
      : execFileSync('npm', ['root', '-g'], opts)).trim();
    if (out) return out;
  } catch { /* 落到候选路径 */ }
  const home = process.env.USERPROFILE || homedir();
  const candidates = process.platform === 'win32'
    ? [join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', 'node_modules')]
    : ['/usr/local/lib/node_modules', '/usr/lib/node_modules', join(home, '.npm-global', 'lib', 'node_modules')];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

/** 定位 pi-ai 的模型目录 data 目录。 */
function findCatalogData() {
  const roots = [];
  const g = npmGlobalRoot();
  if (g) roots.push(join(g, '@deepseek-ai', 'dsh', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'));
  // 兼容：直接从本脚本所在位置往上找
  let d = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  for (let i = 0; i < 6 && d; i++) {
    roots.push(join(d, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'));
    d = dirname(d);
  }
  for (const r of roots) if (r && existsSync(r)) return r;
  return null;
}

/** 读 $DSH_HOME/settings.yaml 里的 agent-default-model（不引第三方 YAML，手工扫缩进块）。 */
function readCurrentSelection() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const file = join(dshHome, 'settings.yaml');
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^agent-default-model:\s*$/.test(l));
  if (start < 0) return null;
  const out = {};
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;                       // 回到顶层，段结束
    const m = /^\s+(provider|model|reasoningEffort):\s*(.+?)\s*$/.exec(l);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { dshHome, file, ...out };
}

/**
 * 原生（不走 pi-ai 目录）路由的档位知识。
 *
 * `deepseek-official` 由 `dsh-llm-deepseek` 自己注册
 * （`lib/index.js:1840` `const PROVIDER = "deepseek-official";`），
 * 它的档位**不来自 pi-ai 目录**，而是写死在库里的 `REASONING_EFFORTS`
 * （`lib/index.js:1417`）= `off` / `low` / `high` / `max`，
 * `defaultEffort` 按配置回落到 `high`（`lib/index.js:1595`）。
 * 例外：该 provider 的配置里若写了 `reasoning: "off"`（部署级关思考），
 * 则退化成只有 `off`（`lib/index.js:1592` `efforts: OFF_ONLY_REASONING_EFFORTS`）。
 *
 * 注意这与目录里的 provider `deepseek`（`data/deepseek.json`）**不是一回事**：
 * 那个是 pi-ai 路由，`deepseek-v4-flash` 只声明 low/high/max，没有 off。
 */
const NATIVE_ROUTES = {
  'deepseek-official': {
    source: 'dsh-llm-deepseek/lib/index.js:1417 REASONING_EFFORTS',
    levels: ['off', 'low', 'high', 'max'],
  },
};

/** 从一张模型条目里推出可用档位。 */
function availableLevels(entry) {
  const map = entry.thinkingLevelMap;
  if (map && typeof map === 'object') {
    return Object.keys(map).filter((k) => map[k] !== null);
  }
  // 没声明 thinkingLevelMap：看 compat 是否声明支持 effort
  const supports = entry.compat?.supportsReasoningEffort;
  if (supports === true) return ['(未声明 thinkingLevelMap，档位由 API 侧决定)'];
  return [];
}

function loadCatalog(dir) {
  const rows = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    let j;
    try {
      // 注意：文件是 **两层** 结构 {"<api>": {"<modelId>": {…}}}，
      // provider 是条目里的一个**字段**，不是字典键。
      j = JSON.parse(readFileSync(join(dir, f), 'utf8').replace(/^\uFEFF/, ''));
    } catch { continue; }
    for (const api of Object.keys(j)) {
      const models = j[api];
      if (!models || typeof models !== 'object') continue;
      for (const key of Object.keys(models)) {
        const entry = models[key];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        rows.push({ file: f, api, provider: entry.provider ?? key, id: entry.id ?? key, entry });
      }
    }
  }
  return rows;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const currentOnly = argv.includes('--current');
  const pos = argv.filter((a) => !a.startsWith('--'));

  const dir = findCatalogData();
  if (!dir) {
    console.error(`${LOG} 找不到 pi-ai 模型目录。请确认 dsh 已全局安装（npm root -g）。`);
    process.exit(1);
  }
  const rows = loadCatalog(dir);

  if (currentOnly) {
    const cur = readCurrentSelection();
    if (!cur) { console.error(`${LOG} 读不到 agent-default-model（检查 $DSH_HOME/settings.yaml）`); process.exit(1); }
    const hit = rows.find((r) => r.provider === cur.provider && r.id === cur.model);
    const native = NATIVE_ROUTES[cur.provider];
    let levels = null;
    let detail = '';
    if (hit) {
      levels = availableLevels(hit.entry);
      detail = `thinkingLevelMap = ${JSON.stringify(hit.entry.thinkingLevelMap ?? null)}`;
    } else if (native) {
      levels = native.levels;
      detail = `原生路由（不来自 pi-ai 目录）: ${native.levels.join(' / ')}   [${native.source}]`;
    }
    const want = cur.reasoningEffort;
    const verdict = levels === null ? 'unknown'
      : levels.length === 0 ? 'model-declares-no-effort'
        : (want === undefined ? 'default' : (levels.includes(want) ? 'LEGAL' : 'ILLEGAL'));

    if (asJson) {
      console.log(JSON.stringify({ selection: cur, levels, verdict, source: hit ? 'pi-ai-catalog' : (native ? 'native-route' : null), detail }, null, 2));
      process.exit(verdict === 'ILLEGAL' ? 1 : 0);
    }
    console.log(`${LOG} 目录: ${dir}`);
    console.log(`  当前配置  : ${cur.file}`);
    console.log(`  provider  : ${cur.provider}`);
    console.log(`  model     : ${cur.model}`);
    console.log(`  effort    : ${want ?? '(未设置 → 用模型默认档)'}`);
    if (levels === null) {
      console.log(`  ⚠️ 目录里找不到 ${cur.provider}/${cur.model}，且该 provider 不是已知原生路由 → 无法判定`);
      console.log(`     （原生路由目前只登记了: ${Object.keys(NATIVE_ROUTES).join(', ')}）`);
      process.exit(2);
    }
    console.log(`  可用档位  : ${levels.length ? levels.join(' / ') : '(该模型不声明任何档位)'}`);
    console.log(`  依据      : ${detail}`);
    if (verdict === 'LEGAL') console.log(`  ✅ 合法：${want} 在该模型的能力表里`);
    else if (verdict === 'ILLEGAL') {
      console.log(`  ❌ 非法：${want} 不在可用档位里 —— 请求时会抛 UNSUPPORTED_REASONING_EFFORT`);
      console.log(`     配置层不校验（schema 是 z.string()），所以启动不会报错，只在那一轮对话里炸。`);
      process.exit(1);
    } else if (verdict === 'model-declares-no-effort') {
      console.log(`  ⚠️ 该模型不支持选档（compat.supportsReasoningEffort 不是 true）`);
    } else console.log(`  未显式设置 effort，使用模型默认档`);
    return;
  }

  let list = rows.filter((r) => r.entry.thinkingLevelMap || r.entry.compat?.supportsReasoningEffort);
  if (pos.length === 1) list = list.filter((r) => r.provider === pos[0] || r.id === pos[0]);
  if (pos.length >= 2) list = list.filter((r) => r.provider === pos[0] && r.id === pos[1]);

  // 原生路由不在 pi-ai 目录里，必须单独并进来 ——
  // 否则刚说完"deepseek-official 支持 off/low/high/max"，
  // 用户跑 `show-effort-levels.mjs deepseek-official` 却得到"没有匹配的模型"。
  const nativeWanted = pos.length === 0 || NATIVE_ROUTES[pos[0]] !== undefined;
  const nativeList = nativeWanted
    ? Object.entries(NATIVE_ROUTES).filter(([p]) => pos.length < 2 || p === pos[0])
    : [];

  if (!list.length && !nativeList.length) {
    console.error(`${LOG} 没有匹配的模型（试试不带参数列出全部）`);
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify({
      catalog: list.map((r) => ({ source: 'pi-ai-catalog', provider: r.provider, model: r.id, map: r.entry.thinkingLevelMap, levels: availableLevels(r.entry) })),
      native: nativeList.map(([provider, nr]) => ({ source: 'native-route', provider, model: '(该路由下各模型一致)', levels: nr.levels, evidence: nr.source })),
    }, null, 2));
    return;
  }

  console.log(`${LOG} 目录: ${dir}`);
  console.log(`${LOG} pi-ai 目录命中 ${list.length} 个模型（null = 该档位不可用）\n`);
  for (const r of list) {
    const lv = availableLevels(r.entry);
    console.log(`  ${r.provider} / ${r.id}`);
    console.log(`    可用: ${lv.length ? lv.join(' / ') : '(无)'}`);
    if (r.entry.thinkingLevelMap) console.log(`    map : ${JSON.stringify(r.entry.thinkingLevelMap)}`);
    if (r.entry.contextWindow) console.log(`    窗口: ${r.entry.contextWindow}  maxTokens: ${r.entry.maxTokens ?? '?'}`);
  }
  if (nativeList.length) {
    console.log(`\n${LOG} 原生路由（**不在** pi-ai 目录里，档位写死在库中）\n`);
    for (const [provider, nr] of nativeList) {
      console.log(`  ${provider}`);
      console.log(`    可用: ${nr.levels.join(' / ')}`);
      console.log(`    依据: ${nr.source}`);
    }
  }
}

main();
