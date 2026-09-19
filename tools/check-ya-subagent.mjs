#!/usr/bin/env node
// check-ya-subagent.mjs —— 验证子代理护栏是否落在【真正生效的那一层】
//
// 为什么需要它：
//   本机 web-3 profile 装了 @huanlin/dsh-plugin-yet-another-subagent，它把官方
//   `tool-subagent` 关掉（`disabled: true`）并接管了 `subagent` 工具名。
//   因此写在 `~/.dsh/.agent-presets/router-standard/agent.cordis.yml` 里
//   tool-subagent 那一行上的护栏【完全无效】—— 那个插件根本没被加载。
//   真正生效的位置是 settings.yaml 的 `ya-subagent` 段。
//
// 本脚本做三件事（都用插件自己的代码，不靠猜）：
//   1. 用插件导出的 SETTINGS_NAMESPACE 确认命名空间字符串
//   2. 用插件导出的 Config schema 校验 settings.yaml 里的 ya-subagent 段
//   3. 跑一个【负例反证】—— 故意给非法值，必须被拒；否则说明校验是空转的
//
// 用法:
//   node tools/check-ya-subagent.mjs
//   node tools/check-ya-subagent.mjs --profile web-3
//   node tools/check-ya-subagent.mjs --settings <path>   # 只换 settings，插件仍从 $DSH_HOME 找
//   node tools/check-ya-subagent.mjs --json
//
// 退出码: 0 = 护栏齐备且合法；1 = 缺护栏/非法；2 = 找不到插件或 settings.yaml

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const LOG = '[check-ya-subagent]';
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const pi = argv.indexOf('--profile');
const wantProfile = pi >= 0 ? argv[pi + 1] : null;
const si = argv.indexOf('--settings');

const home = process.env.USERPROFILE || process.env.HOME || '';
const dshHome = process.env.DSH_HOME || join(home, '.dsh');
// --settings 只换被校验的文件；插件仍按 $DSH_HOME 找。
// 之所以要分开：否则"用一份假 settings 做负例测试"会因为找不到插件而报 exit 2，
// 测的就不是 schema 校验逻辑了（这个坑本工具自己踩过一次）。
const settingsPath = si >= 0 ? resolve(argv[si + 1]) : join(dshHome, 'settings.yaml');
const PLUGIN = '@huanlin/dsh-plugin-yet-another-subagent';

function die(code, msg) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(`${LOG} ${msg}`);
  process.exit(code);
}

/** 插件所在的那个 profile 名（推导工具名时要用它跑 --dump-config）。 */
let foundProfile = wantProfile;

/** 在 profile 的 node_modules 里找插件（找不到就返回 null）。 */
function findPlugin() {
  // $DSH_HOME 可能被指向别处（例如临时目录做测试），此时插件仍在默认的 ~/.dsh 下，
  // 所以两个根都找一遍。
  const roots = [dshHome];
  const def = join(home, '.dsh');
  if (home && resolve(def) !== resolve(dshHome)) roots.push(def);

  for (const root of roots) {
    const profilesDir = join(root, 'profiles');
    if (!existsSync(profilesDir)) continue;
    for (const e of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'node_modules') continue;
      if (wantProfile && e.name !== wantProfile) continue;
      const c = join(profilesDir, e.name, 'node_modules', PLUGIN, 'lib', 'index.js');
      if (existsSync(c)) { foundProfile = e.name; return c; }
    }
    const shared = join(profilesDir, 'node_modules', PLUGIN, 'lib', 'index.js');
    if (existsSync(shared)) { foundProfile = null; return shared; }
  }
  return null;
}

/** 尽量拿到一个 YAML 解析器：优先 dsh 自带的那份。 */
function loadYamlParser() {
  const shrines = [
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    join(process.env.USERPROFILE || '', '.dsh-runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  ];
  for (const anchor of shrines) {
    if (!existsSync(anchor)) continue;
    try {
      const req = createRequire(pathToFileURL(anchor).href);
      return req('yaml');
    } catch { /* 换下一个 */ }
  }
  return null;
}

if (!existsSync(settingsPath)) die(2, `找不到 ${settingsPath}（用 $DSH_HOME 指定别处）`);
const pluginEntry = findPlugin();
if (!pluginEntry) {
  die(2, `在 ${join(dshHome, 'profiles')} 下找不到 ${PLUGIN}。\n` +
    `  · 若该 profile 没装这个插件，说明它的 subagent 工具是官方 dsh-tool-subagent，\n` +
    `    那么护栏应该写在 agent-presets 的那一行上，本脚本不适用。\n` +
    `  · 用 --profile <name> 指定具体 profile。`);
}

const mod = await import(pathToFileURL(pluginEntry).href);
if (!mod.Config) die(2, `插件 ${PLUGIN} 没有导出 Config，无法校验（版本变了？）`);

let text = readFileSync(settingsPath, 'utf8');
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 带 BOM 会让解析失效
const YAML = loadYamlParser();
if (!YAML) die(2, '找不到可用的 yaml 解析器（试过 dsh 自带的那份）。请在该 dsh 环境里运行。');
const doc = YAML.parse(text);

const NS = mod.SETTINGS_NAMESPACE;
const section = doc[NS];

const report = {
  settingsPath,
  pluginEntry,
  pluginName: mod.name,
  namespace: NS,
  namespaceOk: NS === 'ya-subagent',
  missingSection: section === undefined,
  schemaOk: false,
  negativeControlOk: false,
  guards: {},
  problems: [],
};

if (section === undefined) {
  report.problems.push(`settings.yaml 里没有 \`${NS}:\` 段 → 子代理跑的是插件的 cordis 种子配置`);
  report.problems.push(`  插件默认值是 maxDepth 3 / model auto（不降档）/ toolFilter none / persona inherit`);
}

let parsed = null;
if (section !== undefined) {
  try {
    parsed = mod.Config(section);
    report.schemaOk = true;
  } catch (e) {
    report.problems.push(`\`${NS}\` 段不符合插件自己的 schema（dsh-settings 会因此让注册失败）：${e.message}`);
  }
}

// 负例反证：校验器必须真的会拒绝非法输入，否则上面的"通过"是空转的
try {
  mod.Config({ profiles: [{ id: 'x', label: 'X', model: { kind: 'auto' }, persona: { kind: 'inherit' }, toolFilter: { kind: 'none' }, maxDepth: -1, backgroundMode: 'continuable', builtin: false }], generalFixed: false });
  report.negativeControlOk = false;
  report.problems.push('负例没被拒（maxDepth: -1 通过了）→ 该 schema 校验不可信，上面的"合法"结论不成立');
} catch {
  report.negativeControlOk = true;
}

// ------------------------------------------------------- 真值推导（别写死！）
//
// 【为什么这里必须推导，而不是写死一张表】
// 初版写死了 `DENY_WANT = ['subagent', 'subagent_general', 'subagent_fork', 'workflow', 'ralph']`。
// 其中 `subagent_general` 是**根本不存在的工具名**（按 "subagent_<profileId>" 的臆想编的）。
// 后果是两件事同时发生：
//   ① 它被当成"期望的 deny 项"，于是配置里也被迫写上它；
//   ② 输出行把这个常量回显成"子代理工具名：subagent / subagent_general"——
//      **看起来像在报事实，实际是在念我自己的假设**。
// 真实代价（2026-09-19 验收实测）：插件把 deny 原样交给 DSH 核心的 tools.restrict()
// （`dsh-tools/lib/index.js:2803`），它要求每个名字都在全局工具注册表里，于是：
//   Error: tools.restrict() names unknown global tool "subagent_general";
//          known global tools: acp_status, …, subagent, subagent_fork, …
// → **子代理彻底派不出去**，比"没护栏"更糟。而且这个错误只在真正派子代理时才出现，
//   静态看一眼配置文件是看不出来的。
//
// 所以工具名必须每次从"当前装的 dsh"重新推导：
//   ① 合成配置里的 `toolName:` 字段（cordis 行自己声明的工具名）
//   ② `dsh-tool-*` / `dsh-command-*` 包名（DSH 自带工具的命名约定）
// 推导不出来就报 UNVERIFIABLE —— 宁可说"我验证不了"，也不给一个虚假的 OK。

/** npm 全局 node_modules 根目录（跨平台；拿不到返回 null）。 */
function npmGlobalRoot() {
  const home2 = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = process.platform === 'win32'
    ? [join(process.env.APPDATA || join(home2, 'AppData', 'Roaming'), 'npm', 'node_modules')]
    : ['/usr/local/lib/node_modules', '/usr/lib/node_modules', join(home2, '.npm-global', 'lib', 'node_modules')];
  for (const c of candidates) { try { if (c && statSync(c).isDirectory()) return c; } catch { /* 下一个 */ } }
  return null;
}

// 真实工具名的两个**权威**来源（都不是"我记得的表"）：
//   ① 合成配置里的 `toolName:` 字段 —— cordis 行自己声明的
//   ② `tools.restrict()` 抛错时回显的 `known global tools: …` —— 运行时注册表
//      （`dsh-tools/lib/index.js:2801` 的 `restrictableNames`）。它拿不到静态表，只能从
//      报错里读；所以捕获一次后连 dsh 版本一起记下来，**版本一变即失效重取**。
//
// **包名不是工具名**（本仓库踩过两次，第二次是自找的）：
//   `dsh-tool-subagent-control` 的真实工具是 send_message / interrupt_agent / list_agents，
//   `dsh-tool-subagent-list-agents` 对应 list_agents。
//   把包名当工具名写进 deny → tools.restrict() 抛 unknown global tool →
//   **子代理彻底派不出去**，比"没护栏"更糟。所以包名只能进 advisory，永远不进 mustDeny。
const KNOWN_TOOLS_FILE = join(dshHome, '.dsh-ya-known-tools.json');

/** 当前安装的 dsh 版本（用来让"已知工具名"这份观测随版本失效）。 */
function installedDshVersion() {
  const root = npmGlobalRoot();
  if (!root) return null;
  try {
    return JSON.parse(readFileSync(join(root, '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version;
  } catch { return null; }
}

/** 读回上次捕获的运行时工具表；dsh 版本不符则视为失效。 */
function loadKnownTools(ver) {
  try {
    const j = JSON.parse(readFileSync(KNOWN_TOOLS_FILE, 'utf8'));
    if (!ver || j.dshVersion !== ver) return { known: [], stale: j.dshVersion ?? '未知', from: j.capturedFrom };
    return { known: j.known ?? [], stale: null, from: j.capturedFrom };
  } catch { return { known: [], stale: null, from: null }; }
}

/** 推导当前 dsh 的全局工具名。confirmed = 可安全写进 deny；advisory = 仅线索。 */
function deriveToolNames(profile) {
  const confirmed = new Set();
  const advisory = new Set();
  const sources = [];
  const ver = installedDshVersion();

  // ① 运行时注册表（观测，带版本与出处）
  const kt = loadKnownTools(ver);
  for (const n of kt.known) confirmed.add(n);
  if (kt.known.length) sources.push(`restrict() 报错捕获的运行时工具表（dsh ${ver}，${kt.known.length} 个）`);

  const root = npmGlobalRoot();
  if (!root) return { confirmed, advisory, sources, ver, staleKnown: kt.stale, why: '找不到 npm 全局 node_modules' };

  // ② cordis 行自己声明的 toolName
  const dshBin = join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (existsSync(dshBin) && profile) {
    try {
      const out = execFileSync(process.execPath, [dshBin, '--profile', profile, '--dump-config'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 90000,
      });
      let n = 0;
      for (const m of out.matchAll(/toolName:\s*([A-Za-z0-9_-]+)/g)) { if (!confirmed.has(m[1])) n++; confirmed.add(m[1]); }
      if (n) sources.push(`--dump-config(profile=${profile}) 的 toolName 字段（${n} 个）`);
    } catch { /* 落到 ③ */ }
  }

  // ③ 包名 —— **只当线索**
  const pkgRoot = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai');
  try {
    for (const e of readdirSync(pkgRoot, { withFileTypes: true })) {
      const m = /^dsh-(?:tool|command)-(.+)$/.exec(e.name);
      if (m && !confirmed.has(m[1])) advisory.add(m[1]);
    }
    if (advisory.size) sources.push(`dsh-tool-* 包名（仅线索，${advisory.size} 个）`);
  } catch { /* 忽略 */ }

  return { confirmed, advisory, sources, ver, staleKnown: kt.stale, why: null };
}

const derived = deriveToolNames(foundProfile || wantProfile);
report.derivedToolNames = [...derived.confirmed].sort();
report.derivedFrom = derived.sources;
report.advisoryNames = [...derived.advisory].sort();
report.dshVersion = derived.ver;

const advisoryDelegation = [...derived.advisory].filter((n) => /subagent|workflow|ralph/i.test(n)).sort();
report.advisoryNote = advisoryDelegation.length
  ? `包名暗示可能还有别的委派面（${advisoryDelegation.join(', ')}），但**它们不是工具名**，`
    + '不能直接写进 deny —— 本仓库因此把子代理彻底锁死过一次。要加就得先从 --dump-config 的 '
    + '`toolName:` 或 restrict() 报错里的 `known global tools:` 拿到真名。'
  : null;

if (derived.staleKnown) {
  report.problems.push(
    `UNVERIFIABLE：上次捕获的运行时工具表来自 dsh ${derived.staleKnown}，当前装的是 ${derived.ver ?? '未知'} → `
    + '不能拿旧表判断 deny 里的名字是否真实存在。重取方法：故意在 deny 里放一个不存在的名字并派一次子代理，'
    + `报错里的 \`known global tools:\` 就是真值（已记录在 ${KNOWN_TOOLS_FILE}）。`);
}

if (parsed?.profiles) {
  // "意图"也是推导出来的：名字里带 subagent / workflow / ralph 的**已确认**全局工具，
  // 都是"能再开一条委派面"的，必须 deny。注意这里只用 confirmed，绝不用包名。
  const mustDeny = [...derived.confirmed].filter((n) => /subagent|workflow|ralph/i.test(n)).sort();

  if (derived.confirmed.size === 0) {
    report.problems.push(
      'UNVERIFIABLE：拿不到当前 dsh 的全局工具名（--dump-config 的 toolName 与 restrict() 捕获都没有）→ '
      + '无法判断 deny 列表里的名字是否真实存在。请手工确认，别当通过。'
      + (derived.why ? `（${derived.why}）` : ''));
  }

  report.guards = parsed.profiles.map((p) => {
    const deny = p.toolFilter?.kind === 'deny' ? (p.toolFilter.tools ?? []) : [];
    // ① 硬错误：deny 里出现**未确认**的名字 → tools.restrict() 会抛，子代理完全派不出去
    const unknownDeny = derived.confirmed.size ? deny.filter((t) => !derived.confirmed.has(t)) : [];
    // ② 漏项：已确认能再开委派面的工具没被 deny（**不含包名线索**）
    const missingDeny = mustDeny.filter((t) => !deny.includes(t));
    const g = {
      id: p.id,
      maxDepth: p.maxDepth,
      maxDepthOk: p.maxDepth === 1,
      model: p.model?.kind === 'manual' ? `${p.model.provider}/${p.model.model}` : 'auto（不降档）',
      modelOk: p.model?.kind === 'manual' && p.model.provider === 'deepseek-cheap',
      toolFilter: p.toolFilter?.kind ?? 'none',
      deny,
      denyUnknown: unknownDeny,
      denyMissing: missingDeny,
      toolFilterOk: p.toolFilter?.kind === 'deny' && missingDeny.length === 0 && unknownDeny.length === 0,
      persona: p.persona?.kind ?? 'inherit',
      personaOk: p.persona?.kind === 'custom' && (p.persona.text ?? '').trim().length > 0,
    };
    if (!g.maxDepthOk) report.problems.push(`profile "${p.id}": maxDepth = ${p.maxDepth}，期望 1（子代理不能再派子代理）`);
    if (!g.modelOk) report.problems.push(`profile "${p.id}": model = ${g.model}，期望 manual deepseek-cheap/…（降档省钱）`);
    if (unknownDeny.length) {
      report.problems.push(
        `profile "${p.id}": toolFilter.deny 里的 ${unknownDeny.map((t) => `"${t}"`).join(', ')} `
        + `**不在当前 dsh 的全局工具表里** → tools.restrict() 会抛 `
        + `unknown global tool，结果是【子代理完全派不出去】（比没护栏更糟）。删掉这些名字。`);
    }
    if (missingDeny.length) {
      report.problems.push(`profile "${p.id}": toolFilter = ${g.toolFilter}，漏 deny ${missingDeny.join(', ')}（这些是**已确认**能再开委派面的全局工具）`);
    }
    if (!g.personaOk) report.problems.push(`profile "${p.id}": persona = ${g.persona}，期望 custom 且非空`);
    return g;
  });
  if (!report.guards.some((g) => g.id === 'general')) {
    report.problems.push('profiles 里没有 id = "general" 的条目 —— 插件的默认 profile 就是它，缺了会回落到种子配置');
  }
}

const ok = report.namespaceOk && report.schemaOk && report.negativeControlOk &&
  report.guards.length > 0 && report.problems.length === 0;

if (asJson) {
  console.log(JSON.stringify({ ok, ...report }, null, 2));
  process.exit(ok ? 0 : 1);
}

console.log(`${LOG} settings : ${settingsPath}`);
console.log(`${LOG} 插件     : ${report.pluginName}  (${pluginEntry})`);
console.log(`${LOG} 命名空间 : ${NS}${report.namespaceOk ? '' : '  *** 与预期的 ya-subagent 不符 ***'}`);
console.log(`${LOG} schema   : ${report.schemaOk ? '校验通过' : '未通过'}  负例反证: ${report.negativeControlOk ? '有效（非法值被拒）' : '失效'}`);
console.log(`${LOG} 工具名真值来源: ${report.derivedFrom?.join(' + ') || '(无)'}  → 已确认 ${report.derivedToolNames?.length ?? 0} 个全局工具名`);
if (report.guards.length) {
  console.log(`${LOG} 护栏:`);
  for (const g of report.guards) {
    const m = (v) => (v ? '✅' : '❌');
    console.log(`  - ${g.id}: maxDepth=${g.maxDepth}${m(g.maxDepthOk)}  model=${g.model}${m(g.modelOk)}  toolFilter=${g.toolFilter}${m(g.toolFilterOk)}  persona=${g.persona}${m(g.personaOk)}`);
    console.log(`    deny 实填: ${g.deny.join(', ') || '(空)'}${g.denyUnknown.length ? `   *** 未在全局工具表里: ${g.denyUnknown.join(', ')} ***` : ''}`);
    console.log(`    漏 deny: ${g.denyMissing.join(', ') || '无'}`);
  }
}
if (report.advisoryNote) console.log(`${LOG} 线索（非结论）: ${report.advisoryNote}`);
if (report.problems.length) {
  console.log(`${LOG} 问题 ${report.problems.length} 条：`);
  for (const p of report.problems) console.log(`  ✗ ${p}`);
  console.log(`${LOG} 提醒：改完需要【重载 profile / 重启 dsh web】才生效。`);
  process.exit(1);
}
console.log(`${LOG} ✅ 护栏齐备且合法（生效需重载 profile / 重启 dsh web）`);
