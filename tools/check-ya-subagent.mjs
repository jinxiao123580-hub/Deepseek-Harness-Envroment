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

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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
      if (existsSync(c)) return c;
    }
    const shared = join(profilesDir, 'node_modules', PLUGIN, 'lib', 'index.js');
    if (existsSync(shared)) return shared;
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

if (parsed?.profiles) {
  const DENY_WANT = ['subagent', 'subagent_general', 'subagent_fork', 'workflow', 'ralph'];
  report.guards = parsed.profiles.map((p) => {
    const deny = p.toolFilter?.kind === 'deny' ? (p.toolFilter.tools ?? []) : [];
    const missingDeny = DENY_WANT.filter((t) => !deny.includes(t));
    const g = {
      id: p.id,
      maxDepth: p.maxDepth,
      maxDepthOk: p.maxDepth === 1,
      model: p.model?.kind === 'manual' ? `${p.model.provider}/${p.model.model}` : 'auto（不降档）',
      modelOk: p.model?.kind === 'manual' && p.model.provider === 'deepseek-cheap',
      toolFilter: p.toolFilter?.kind ?? 'none',
      denyMissing: missingDeny,
      toolFilterOk: p.toolFilter?.kind === 'deny' && missingDeny.length === 0,
      persona: p.persona?.kind ?? 'inherit',
      personaOk: p.persona?.kind === 'custom' && (p.persona.text ?? '').trim().length > 0,
    };
    if (!g.maxDepthOk) report.problems.push(`profile "${p.id}": maxDepth = ${p.maxDepth}，期望 1（子代理不能再派子代理）`);
    if (!g.modelOk) report.problems.push(`profile "${p.id}": model = ${g.model}，期望 manual deepseek-cheap/…（降档省钱）`);
    if (!g.toolFilterOk) report.problems.push(`profile "${p.id}": toolFilter = ${g.toolFilter}，缺 deny 项 ${missingDeny.join(', ') || '(kind 不是 deny)'}`);
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
if (report.guards.length) {
  console.log(`${LOG} 护栏:`);
  for (const g of report.guards) {
    const m = (v) => (v ? '✅' : '❌');
    console.log(`  - ${g.id}: maxDepth=${g.maxDepth}${m(g.maxDepthOk)}  model=${g.model}${m(g.modelOk)}  toolFilter=${g.toolFilter}${m(g.toolFilterOk)}  persona=${g.persona}${m(g.personaOk)}`);
    console.log(`    （子代理工具名：subagent / subagent_${g.id}；deny 缺项: ${g.denyMissing.join(', ') || '无'}）`);
  }
}
if (report.problems.length) {
  console.log(`${LOG} 问题 ${report.problems.length} 条：`);
  for (const p of report.problems) console.log(`  ✗ ${p}`);
  console.log(`${LOG} 提醒：改完需要【重载 profile / 重启 dsh web】才生效。`);
  process.exit(1);
}
console.log(`${LOG} ✅ 护栏齐备且合法（生效需重载 profile / 重启 dsh web）`);
