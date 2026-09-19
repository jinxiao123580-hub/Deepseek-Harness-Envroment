#!/usr/bin/env node
// doctor.mjs — 本套件的**自证式巡检器**（即用即插 + 抗 dsh 升级的核心）
//
// ## 为什么需要它
//
// 本套件的每一个修复都依赖某个"当时成立的事实"：
//   · DSH 的用户全局指令文件是 `$DSH_HOME/AGENTS.md`
//   · shipped `standard` preset 长什么样、有几行
//   · 哪些插件真的接管了 `subagent` 这个工具名
//   · settings.yaml 里某个 section 是否**被插件接线**（不是"存在"就算数）
//   · 会话日志的目录形状与压缩后端
//
// **这些事实 dsh 一升级就可能变**，而它们失效的方式全都是**静默的**：
// 配置还在、文件还在、脚本不报错 —— 只是不再生效。这正是本仓库踩过的那个坑
// （文档让人写 `~/AGENTS.md`，DSH 从不读它，规则一条都没进上下文）。
//
// 所以本脚本的第一原则是：
//
//   **不写死"我记得的事实"，而是每次从"当前装的 dsh"重新推导，推导不出来就报 UNVERIFIABLE。**
//
// 报 UNVERIFIABLE 不是失败，是**诚实**：它明确告诉你"这条断言我无法再验证，
// 请去看某个文件/跑某条命令确认"，而不是给你一个虚假的 OK。
//
// ## 状态文件（升级漂移检测）
//
// `$DSH_HOME/.dsh-migration-kit.json` 记录**上一次巡检/安装时**的 dsh 版本与
// shipped preset 的 sha256。下次巡检时对比：
//   · dsh 版本变了 → WARN，并提示"所有指纹都需要重验"
//   · shipped preset 的 sha 变了 → 我们的副本**必然漂移**（regen-standard-leash --check 会 FAIL）
//
// ## 用法
//
//   node tools/doctor.mjs                    # 巡检，有人工可读输出
//   node tools/doctor.mjs --json             # 机器可读（CI 用）
//   node tools/doctor.mjs --strict           # WARN / INERT 也当失败（发布前用）
//   node tools/doctor.mjs --fix-safe         # 只做**幂等且安全**的自动修复
//   node tools/doctor.mjs --profile web-3    # 指定"活的" profile（默认自动猜，见 detectActiveProfile）
//
// ## 退出码
//   0 = 没有 FAIL（默认）/ 没有非 OK（--strict）
//   1 = 有 FAIL（或 --strict 下有 WARN/INERT）
//   2 = 参数错误 / 不在仓库里跑
//
// ## 状态语义
//   OK           已验证通过
//   WARN         能跑，但有已知风险或环境偏差，值得看一眼
//   FAIL         断言被推翻，**必须修**，通常会静默失效
//   INERT        配置在，但没有任何插件接线 → **存在但不生效**（本仓库最隐蔽的一类）
//   UNVERIFIABLE 无法再验证这条断言（dsh 内部实现变了等）→ 需要人工确认
//   SKIP         前置条件不满足，本次跳过

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import os from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DSH_HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh');
const STATE_FILE = join(DSH_HOME, '.dsh-migration-kit.json');
const BLOCK_MARKER = '## 成本与交接规程';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const strict = argv.includes('--strict');
const fixSafe = argv.includes('--fix-safe');
const pi = argv.indexOf('--profile');
const profileArg = pi >= 0 ? argv[pi + 1] : null;

const results = [];
function add(id, title, status, detail, repair = null) {
  results.push({ id, title, status, detail, repair });
}
const ok = (id, t, d) => add(id, t, 'OK', d);
const warn = (id, t, d, r) => add(id, t, 'WARN', d, r);
const fail = (id, t, d, r) => add(id, t, 'FAIL', d, r);
const inert = (id, t, d, r) => add(id, t, 'INERT', d, r);
const unver = (id, t, d, r) => add(id, t, 'UNVERIFIABLE', d, r);
const skip = (id, t, d) => add(id, t, 'SKIP', d);

// ---------------------------------------------------------------- 基础工具

/** 读文本，剥掉 UTF-8 BOM。
 *  【实测教训】Windows PowerShell 5.1 用不带 -Encoding 的 Get-Content 读 UTF-8 会乱码并
 *  给出**错误的行数**（当时报 146，真实 203），一度让人以为把用户配置截断了。
 *  Node 这边必须显式处理 BOM，否则 YAML 首个 key 会变成 "\uFEFFkey"。 */
function readText(p) {
  let t = readFileSync(p, 'utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t;
}

/** npm 全局 node_modules 根目录。
 *  Windows 上 npm 是 npm.cmd，Node 20+ 不允许不带 shell 执行 .cmd；
 *  用 `cmd /c npm root -g` 而不是 shell:true（后者在 Node 24 上抛 DEP0190）。 */
function npmGlobalRoot() {
  try {
    const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
    const out = (process.platform === 'win32'
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm root -g'], opts)
      : execFileSync('npm', ['root', '-g'], opts)).trim();
    if (out) return out;
  } catch { /* 落到候选 */ }
  const home = os.homedir();
  for (const c of (process.platform === 'win32'
    ? [join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', 'node_modules')]
    : ['/usr/local/lib/node_modules', '/usr/lib/node_modules', join(home, '.npm-global', 'lib', 'node_modules')])) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** 在多个候选目录里找某个包目录（dsh 自带 node_modules 优先，然后 profile）。 */
function findPackage(name, roots) {
  for (const r of roots) {
    if (!r) continue;
    const p = join(r, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** 有界递归找文件（跳过 node_modules/.git/dist 的内部层级），最多 cap 个。
 *  用来在插件包里找它是否引用了某个 settings section 名。 */
function walkFiles(dir, cap = 4000) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < cap) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        stack.push(p);
      } else if (e.isFile() && /\.(js|mjs|cjs|json|ts)$/.test(e.name)) {
        out.push(p);
      }
      if (out.length >= cap) break;
    }
  }
  return out;
}

/** 某个包目录里有没有出现这个字面量（用于判定 settings section 是否被接线）。 */
function packageMentions(pkgDir, needle) {
  for (const f of walkFiles(join(pkgDir, 'lib')).concat(
    existsSync(join(pkgDir, 'dist')) ? walkFiles(join(pkgDir, 'dist')) : [])) {
    try { if (readFileSync(f, 'utf8').includes(needle)) return true; } catch { /* 忽略 */ }
  }
  return false;
}

/** 跑本仓库里的另一个巡检工具，只要退出码。 */
function runTool(rel, args = []) {
  const p = join(REPO, rel);
  if (!existsSync(p)) return { code: 2, out: `找不到 ${rel}` };
  const r = spawnSync(process.execPath, [p, ...args], {
    encoding: 'utf8', cwd: REPO, windowsHide: true,
  });
  return { code: r.status ?? 2, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

/** 极简 YAML：取顶层 key 的起始行与它的 section 文本。
 *  不引 yaml 依赖 —— settings.yaml 的形状足够规整，而且**我们只读不写**。 */
function topLevelSections(text) {
  const lines = text.split(/\r?\n/);
  const map = new Map();
  lines.forEach((l, i) => {
    const m = /^([A-Za-z0-9_.-]+):/.exec(l);
    if (m) map.set(m[1], i);
  });
  const out = new Map();
  const keys = [...map.keys()];
  for (const k of keys) {
    const start = map.get(k);
    const next = keys
      .map((x) => map.get(x))
      .filter((n) => n > start)
      .sort((a, b) => a - b)[0];
    out.set(k, lines.slice(start, next ?? lines.length).join('\n'));
  }
  return out;
}

/** 在一段 YAML 里取某个缩进层级的标量。 */
function scalar(section, key) {
  const m = new RegExp(`^[ \\t]+${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(section);
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

// ---------------------------------------------------------------- 状态文件

function loadState() {
  try { return JSON.parse(readText(STATE_FILE)); } catch { return null; }
}
function saveState(patch) {
  const prev = loadState() || {};
  const next = { ...prev, ...patch, lastCheckedAt: new Date().toISOString() };
  const hist = Array.isArray(prev.history) ? prev.history.slice(-19) : [];
  if (prev.dshVersion && patch.dshVersion && prev.dshVersion !== patch.dshVersion) {
    hist.push({ at: next.lastCheckedAt, from: prev.dshVersion, to: patch.dshVersion });
    next.history = hist;
  }
  try {
    mkdirSync(DSH_HOME, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  } catch { /* 写不了就算了，巡检本身不该因此失败 */ }
  return next;
}

// ---------------------------------------------------------------- profile 探测

/** 猜"活的" profile。
 *  **这是启发式**，因为 dsh 没有留下"上次用哪个 profile"的显式标记。
 *  策略：取 node_modules 目录 mtime 最新的那个；拿不准就全部列出来让人工确认。
 *  可用 --profile 覆盖。 */
function detectActiveProfile() {
  const dir = join(DSH_HOME, 'profiles');
  if (!existsSync(dir)) return { name: null, all: [], why: '没有 profiles 目录' };
  const all = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'node_modules')
    .map((e) => {
      const nm = join(dir, e.name, 'node_modules');
      let mtime = 0;
      try { mtime = statSync(nm).mtimeMs; } catch { try { mtime = statSync(join(dir, e.name)).mtimeMs; } catch { /* 0 */ } }
      return { name: e.name, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!all.length) return { name: null, all: [], why: 'profiles 目录为空' };
  return {
    name: all[0].name,
    all: all.map((x) => x.name),
    why: '按 node_modules 的 mtime 猜（启发式，不是权威）',
  };
}

// ================================================================ 巡检开始

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
const npmRoot = npmGlobalRoot();
const dshRoot = npmRoot ? join(npmRoot, '@deepseek-ai', 'dsh') : null;
const profile = profileArg
  ? { name: profileArg, all: [], why: '--profile 显式指定' }
  : detectActiveProfile();
const pkgRoots = [
  dshRoot ? join(dshRoot, 'node_modules') : null,
  profile.name ? join(DSH_HOME, 'profiles', profile.name, 'node_modules') : null,
  join(DSH_HOME, 'profiles', 'node_modules'),
].filter(Boolean);

// ---- env
if (!existsSync(DSH_HOME)) {
  fail('env.dsh-home', 'DSH_HOME 可解析', `${DSH_HOME} 不存在（用 DSH_HOME 环境变量覆盖）`);
} else {
  ok('env.dsh-home', 'DSH_HOME 可解析', `${DSH_HOME}`);
}
if (!dshRoot || !existsSync(dshRoot)) {
  fail('env.dsh-root', '找到已安装的 dsh', `在 ${npmRoot || '(未知 npm root)'} 下没找到 @deepseek-ai/dsh`);
} else {
  ok('env.dsh-root', '找到已安装的 dsh', dshRoot);
}
if (NODE_MAJOR < 20) {
  warn('env.node', 'Node 版本',
    `Node ${process.versions.node} —— 本套件假定 Node 20+（dsh 自身也是）。低版本上 `+
    `tools/regen-standard-leash.mjs 的 npm 探测与 spawnSync 行为可能不同`);
} else {
  ok('env.node', 'Node 版本', `Node ${process.versions.node}`);
}
if (profile.name) {
  ok('env.profile', '活的 profile', `${profile.name} —— ${profile.why}${profile.all.length > 1 ? `；候选: ${profile.all.join(', ')}` : ''}`);
} else {
  unver('env.profile', '活的 profile', `探测不出来（${profile.why}）；涉及插件的检查会退化，请显式传 --profile <name>`);
}

// ---- dsh 版本 + 漂移检测
let dshVersion = null;
if (dshRoot && existsSync(join(dshRoot, 'package.json'))) {
  try { dshVersion = JSON.parse(readText(join(dshRoot, 'package.json'))).version; } catch { /* 忽略 */ }
}
if (!dshVersion) {
  unver('dsh.version', 'dsh 版本', `读不到 ${dshRoot}\\package.json 的 version`);
} else {
  ok('dsh.version', 'dsh 版本', dshVersion);
}

const shippedPresetsDir = dshRoot
  ? join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets')
  : null;
let shippedStandardSha = null;
if (shippedPresetsDir && existsSync(join(shippedPresetsDir, 'standard', 'agent.cordis.yml'))) {
  const { createHash } = await import('node:crypto');
  shippedStandardSha = createHash('sha256')
    .update(readFileSync(join(shippedPresetsDir, 'standard', 'agent.cordis.yml')))
    .digest('hex');
}

const prevState = loadState();
if (prevState && dshVersion && prevState.dshVersion && prevState.dshVersion !== dshVersion) {
  warn('dsh.drift', 'dsh 升级漂移检测',
    `dsh 从 ${prevState.dshVersion} 变成 ${dshVersion} —— **所有基于旧版本的指纹都可能已失效**，请逐条看下面的结果`,
    'node tools/doctor.mjs --fix-safe   # 然后人工确认 UNVERIFIABLE 项');
} else if (prevState && shippedStandardSha && prevState.shippedStandardSha256 &&
           prevState.shippedStandardSha256 !== shippedStandardSha) {
  // dsh 版本号没变但 preset 内容变了（重新发布同版本号、或本地改过包）—— 同样要报
  warn('dsh.drift', 'dsh 升级漂移检测',
    `dsh 版本号仍是 ${dshVersion}，但 shipped standard preset 的 sha256 变了（${prevState.shippedStandardSha256.slice(0, 12)}… → ${shippedStandardSha.slice(0, 12)}…）`,
    'node tools/doctor.mjs --fix-safe');
} else if (!prevState) {
  warn('dsh.drift', 'dsh 升级漂移检测',
    `还没有状态文件 ${basename(STATE_FILE)}（首次运行）。本次会把当前版本与指纹记为基线`,
    'node tools/doctor.mjs   # 再跑一次即可开始对比');
} else {
  ok('dsh.drift', 'dsh 升级漂移检测', `与上次记录一致（${prevState.dshVersion}，preset sha ${String(prevState.shippedStandardSha256).slice(0, 12)}…）`);
}

// ---- 全局指令文件：**从已安装的 dsh 源码现推**，不写死路径
const instrMod = findPackage('@deepseek-ai/dsh-agent-instructions', pkgRoots);
let globalFileName = null;
let globalFileWhy = '';
if (!instrMod) {
  unver('instruction.global-path', '全局指令文件路径',
    `找不到 @deepseek-ai/dsh-agent-instructions；无法推导 DSH 的用户全局指令文件叫什么`);
} else {
  const idx = join(instrMod, 'lib', 'index.js');
  let src = null;
  try { src = readText(idx); } catch { /* 忽略 */ }
  if (!src) {
    unver('instruction.global-path', '全局指令文件路径', `读不到 ${idx}`);
  } else {
    // 推导 1：常量名（dsh 0.1.5-rc.2 是 USER_GLOBAL_FILE = "AGENTS.md"）
    const m1 = /USER_GLOBAL_FILE\s*=\s*["']([^"']+)["']/.exec(src);
    // 推导 2：候选文件名数组（["AGENTS.md","CLAUDE.md"]）
    const m2 = /\[\s*["'](AGENTS\.md)["']\s*,\s*["'](CLAUDE\.md)["']\s*\]/.exec(src);
    if (m1) { globalFileName = m1[1]; globalFileWhy = 'USER_GLOBAL_FILE 常量'; }
    else if (m2) { globalFileName = m2[1]; globalFileWhy = '候选文件名数组的第一项'; }
    else {
      unver('instruction.global-path', '全局指令文件路径',
        `无法从 ${idx} 推导出全局指令文件名（dsh 内部实现可能已变）。**这条是全局规则能否生效的前提**，请人工看一眼这个文件里"用户全局指令文件"叫什么`,
        `读 ${idx}，找 USER_GLOBAL_FILE / 候选文件名数组`);
    }
  }
}

let globalFile = null;
if (globalFileName) {
  globalFile = join(DSH_HOME, globalFileName);
  const legacy = join(os.homedir(), globalFileName); // 曾经的错误位置
  if (existsSync(globalFile)) {
    ok('instruction.global-path', '全局指令文件路径',
      `${globalFile}（依据: ${globalFileWhy}）`);
  } else {
    warn('instruction.global-path', '全局指令文件路径',
      `推导出应为 ${globalFile}（依据: ${globalFileWhy}），但**文件不存在** → 本套件的 6 条规则当前完全没有生效`,
      'node tools/doctor.mjs --fix-safe   # 用 handoff/AGENTS.block.md 幂等追加');
  }
  // 这是一个真实踩过的坑：文档曾让人写 ~/AGENTS.md，而 DSH 从不读它
  if (legacy !== globalFile && existsSync(legacy)) {
    warn('instruction.stale-twin', '存在"影子"指令文件',
      `${legacy} 存在，但 DSH 读的是 ${globalFile} —— 这个影子文件里的规则**不会生效**（历史文档的错误引导留下的）`,
      `人工确认后删除或合并：${legacy}`);
  }
}

// ---- 规则块是否真的在
if (globalFile && existsSync(globalFile)) {
  const t = readText(globalFile);
  if (t.includes(BLOCK_MARKER)) {
    ok('instruction.block', '成本与交接规程已就位', `在 ${basename(globalFile)} 里找到标记 "${BLOCK_MARKER}"`);
  } else {
    fail('instruction.block', '成本与交接规程已就位',
      `${globalFile} 存在但没有标记 "${BLOCK_MARKER}" → 规则未安装`,
      'node tools/doctor.mjs --fix-safe');
  }
} else if (globalFile) {
  fail('instruction.block', '成本与交接规程已就位', `目标文件不存在，规则未安装`,
    'node tools/doctor.mjs --fix-safe');
}

// ---- shipped preset 指纹（副本必然随 dsh 升级漂移）
{
  const r = runTool('tools/regen-standard-leash.mjs', ['--check']);
  if (r.code === 0) {
    ok('preset.source-fingerprint', 'standard-leash 副本与已装 dsh 同步', r.out.split('\n')[0]);
  } else if (r.code === 1) {
    fail('preset.source-fingerprint', 'standard-leash 副本与已装 dsh 同步',
      '副本已漂移（dsh 升级后**必然**发生）。用它当默认 preset 会静默增删 agent 的工具',
      'node tools/doctor.mjs --fix-safe   # 或 node tools/regen-standard-leash.mjs');
  } else {
    unver('preset.source-fingerprint', 'standard-leash 副本与已装 dsh 同步',
      `巡检工具本身跑不动（exit ${r.code}）：${r.out.slice(0, 300)}`);
  }
}

// ---- 活的默认 preset 与它的护栏
let defaultPreset = null;
let settingsPath = join(DSH_HOME, 'settings.yaml');
if (existsSync(settingsPath)) {
  let sections;
  try { sections = topLevelSections(readText(settingsPath)); } catch { sections = new Map(); }
  const ap = sections.get('agent-presets');
  if (ap) {
    defaultPreset = scalar(ap, 'default');
    if (defaultPreset) {
      const dir = join(DSH_HOME, '.agent-presets', defaultPreset);
      if (existsSync(join(dir, 'agent.cordis.yml'))) {
        ok('preset.default', '活的默认 preset 可解析',
          `${defaultPreset} → ${join(dir, 'agent.cordis.yml')}`);
        const r = runTool('tools/harden-preset.mjs', [dir, '--check']);
        if (r.code === 0) {
          ok('preset.leash', '默认 preset 带子代理护栏', r.out.split('\n').filter(Boolean).pop());
        } else if (r.code === 1) {
          fail('preset.leash', '默认 preset 带子代理护栏',
            `${defaultPreset} 里 tool-subagent / tool-subagent-fork **缺少护栏**（maxDepth / agentOptions / toolFilter / persona）→ 子代理可无限递归（本仓库记录过 ¥8.34 的扇出事故）`,
            `node tools/harden-preset.mjs "${dir}"   # 自动备份原文件`);
        } else {
          unver('preset.leash', '默认 preset 带子代理护栏', `巡检工具 exit ${r.code}: ${r.out.slice(0, 300)}`);
        }
      } else {
        fail('preset.default', '活的默认 preset 可解析',
          `agent-presets.default = ${defaultPreset}，但 ${dir}\\agent.cordis.yml 不存在 → 会话可能起不来或用回落默认`,
          `检查 ${dir}，或把 agent-presets.default 改成实际存在的 preset`);
      }
    } else {
      unver('preset.default', '活的默认 preset 可解析', 'agent-presets 段里没有 default 键');
    }
  } else {
    warn('preset.default', '活的默认 preset 可解析', 'settings.yaml 里没有 agent-presets 段 → 用 dsh 内置默认');
  }
} else {
  warn('preset.default', '活的默认 preset 可解析', `${settingsPath} 不存在`);
}

// ---- 插件是否接管了子代理面（护栏分层的陷阱）
{
  const r = runTool('tools/check-ya-subagent.mjs');
  const hasYa = /yet-another-subagent/.test(r.out);
  if (r.code === 0 && hasYa) {
    ok('plugin.subagent-guard', '第三方子代理插件的护栏', 'yet-another-subagent 的护栏齐备且通过它自己的 schema 校验');
  } else if (r.code === 0 && !hasYa) {
    ok('plugin.subagent-guard', '第三方子代理插件的护栏', '未安装 yet-another-subagent（无需额外护栏）');
  } else if (r.code === 1) {
    fail('plugin.subagent-guard', '第三方子代理插件的护栏',
      'yet-another-subagent **接管的 `subagent` 工具名没有护栏** → 本仓库记的扇出风险在该 profile 上仍然活的（写进 cordis preset 的 toolFilter 对它无效！）',
      'node tools/check-ya-subagent.mjs   # 或按 docs/本地插件与治理融合.md §1 写进插件自己的设置命名空间');
  } else {
    unver('plugin.subagent-guard', '第三方子代理插件的护栏', `巡检工具 exit ${r.code}: ${r.out.slice(0, 300)}`);
  }

  // 泛化：任何名字里带 subagent/ralph/workflow 的本地插件都可能再开一条我们没覆盖的委派路径
  const suspicious = [];
  for (const nm of profile.all) {
    const pj = join(DSH_HOME, 'profiles', nm, 'package.json');
    if (!existsSync(pj)) continue;
    try {
      const deps = { ...(JSON.parse(readText(pj)).dependencies || {}), ...(JSON.parse(readText(pj)).devDependencies || {}) };
      for (const d of Object.keys(deps)) if (/subagent|ralph|workflow/i.test(d)) suspicious.push(`${nm}:${d}`);
    } catch { /* 忽略 */ }
  }
  if (suspicious.length) {
    warn('plugin.delegation-surface', '可能新增委派路径的本地插件',
      `${suspicious.join('、')} —— 名字暗示会再开委派面。**cordis preset 里的 toolFilter.deny 管不到插件自己注册的工具名**，请确认它们的工具名也在 deny 里（本仓库踩过一次）`,
      `dsh --profile ${profile.name || '<profile>'} --dump-config   # 看合成后真正加载了哪些工具`);
  } else {
    ok('plugin.delegation-surface', '可能新增委派路径的本地插件', '没有名字暗示委派面的插件');
  }
}

// ---- settings.yaml 的 section 是否**真被接线**（存在 ≠ 生效）
//
// 这里刻意**不维护"section → 属主包名"的映射表**。
// 原因：初版我写了一张（`ui-theme` → `@deepseek-ai/dsh-ui-theme`），实测**是错的** ——
// 真正的属主是 `dsh-client-ui-theme`，而 `ui-onboarding` 的属主是
// `dsh-client-ui-settings-general` / `dsh-client-ui-settings-models`。
// 也就是说**那张表本身就是一条会过期的记忆**，正是本脚本要消灭的东西。
//
// 改成：扫一遍所有已安装的包，看谁的代码里出现了这个 key 字面量。
// 一次遍历、每个文件只读一遍、同时判定所有 key（否则 N 个 key 就是 N 遍 IO）。
//
// ⚠️ **证据强度是不对称的，输出里必须说清楚**：
//   · 没有任何包提到这个 key  → **强证据**：该段极可能完全没生效（INERT）
//   · 有包提到这个 key        → **弱证据**：只能证明"有人提到过"，
//     不代表它就是那个把段接进 dsh 的包（实测 `llm-pi-ai` 会命中 `dsh-authorization`，
//     `spill-policy` 会命中客户端 UI —— 它们只是提到了这个名字）
// 所以下面用"引用了该键的包"而不是"属主"，并且只在**全无引用**时才判 INERT。
//
// 扫描结果按 (dsh 版本 + profile + key 集合) 缓存进状态文件 —— 13201 个文件不值得每次巡检重扫。
// 换 dsh 版本或改 settings 段都会自动失效；要强制重扫用 --rescan。
let wiringCacheOut = null;
if (!existsSync(settingsPath)) {
  skip('settings.wiring', 'settings 段是否被插件接线', `${settingsPath} 不存在`);
} else {
  const sections = topLevelSections(readText(settingsPath));
  const keys = [...sections.keys()].filter((k) => k !== 'version');
  const cacheKey = `${dshVersion}|${profile.name}|${keys.join(',')}`;
  const cachedOwners = (!argv.includes('--rescan') &&
    prevState && prevState.wiringCache && prevState.wiringCache.key === cacheKey)
    ? prevState.wiringCache.owners : null;

  let owners = new Map();
  let scannedPkgs = 0;
  let scannedFiles = 0;
  let scanCapped = false;
  let fromCache = false;

  if (cachedOwners) {
    for (const k of keys) owners.set(k, new Set(cachedOwners[k] || []));
    fromCache = true;
  } else {
    // 枚举所有已安装的包目录（支持 @scope/pkg 与裸名两种）
    const pkgDirs = [];
    for (const r of pkgRoots) {
      let entries;
      try { entries = readdirSync(r, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('@')) {
          const scope = join(r, e.name);
          try {
            for (const s of readdirSync(scope, { withFileTypes: true })) {
              if (s.isDirectory()) pkgDirs.push({ name: `${e.name}/${s.name}`, dir: join(scope, s.name) });
            }
          } catch { /* 忽略 */ }
        } else {
          pkgDirs.push({ name: e.name, dir: join(r, e.name) });
        }
      }
    }
    owners = new Map(keys.map((k) => [k, new Set()]));
    const PER_PKG_CAP = 1200;
    const TOTAL_CAP = 60000;
    for (const pkg of pkgDirs) {
      if (scannedFiles >= TOTAL_CAP) break;
      let files = [];
      for (const sub of ['lib', 'dist', 'src']) {
        const d = join(pkg.dir, sub);
        if (existsSync(d)) files = files.concat(walkFiles(d, PER_PKG_CAP));
      }
      if (!files.length) continue;
      scannedPkgs++;
      for (const f of files) {
        if (scannedFiles >= TOTAL_CAP) break;
        scannedFiles++;
        let txt;
        try {
          const st = statSync(f);
          if (st.size > 512 * 1024) continue;
          txt = readFileSync(f, 'utf8');
        } catch { continue; }
        for (const k of keys) {
          if (!owners.get(k).size && txt.includes(k)) owners.get(k).add(pkg.name);
        }
      }
    }
    scanCapped = scannedFiles >= TOTAL_CAP;
    wiringCacheOut = {
      key: cacheKey,
      owners: Object.fromEntries([...owners].map(([k, v]) => [k, [...v]])),
    };
  }

  const dead = [];
  const live = [];
  for (const k of keys) {
    const o = [...owners.get(k)];
    if (o.length) live.push(`${k}  ← 引用者: ${o.slice(0, 3).join(' / ')}${o.length > 3 ? ` 等 ${o.length} 个` : ''}`);
    else dead.push(k);
  }
  const scanNote = fromCache
    ? '（引用关系来自缓存；--rescan 可强制重扫）'
    : `（扫描 ${scannedPkgs} 个包 / ${scannedFiles} 个文件${scanCapped ? '，已达上限，可能有漏判' : ''}）`;

  if (dead.length) {
    inert('settings.wiring', 'settings 段是否被插件接线',
      `**存在但不生效**：${dead.join(', ')} —— 扫遍所有已安装的包，**没有任何一个提到这些键**。` +
      `缺席是强证据；反过来"有包提到"只是弱证据，不等于它就是那个把段接进 dsh 的包。` +
      `这类失效完全静默（配置在、不报错、只是不起作用）${scanNote}`,
      '确认这些段该由哪个插件加载；若插件没装在**当前 profile** 下，段就是死的（见 docs/本地插件与治理融合.md §2）');
  } else {
    ok('settings.wiring', 'settings 段是否被插件接线',
      `每个段至少被一个包引用（**这是弱证据**：能证明"有人提到过"，不能证明"它负责接线"）${scanNote}\n        ${live.join('\n        ')}`);
  }
}

// ---- 分析脚本的前置条件（会话日志形状 + 压缩后端）
{
  // 手写遍历而不是 fs.glob —— fs.glob 是 Node 22+ 才有的，
  // 把它当依赖会让本巡检在 Node 20 上**静默报 0 个日志**，那正是本脚本最该避免的失效模式。
  const count = (() => {
    const root = join(DSH_HOME, 'sessions');
    if (!existsSync(root)) return 0;
    let n = 0;
    try {
      for (const slug of readdirSync(root)) {
        const slugDir = join(root, slug);
        let subs;
        try { subs = readdirSync(slugDir); } catch { continue; }
        for (const sub of subs) {
          if (existsSync(join(slugDir, sub, 'session.jsonl.zstd'))) n++;
        }
      }
    } catch { /* 忽略 */ }
    return n;
  })();

  // 解压后端：优先"裸 python 就能 import"，其次 zstd CLI，最后看 uv 能不能兜底。
  // 本机 python/python3 都是 Microsoft Store 占位器，所以"裸 python 不行"是常态，
  // 不该直接判 FAIL —— 那会让一台其实健康的机器一直红着，久了就没人看了。
  const probe = (cmd, args) => {
    const r = spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true });
    return !r.error && r.status === 0;
  };
  let backend = null;
  if (probe('python', ['-c', 'import zstandard'])) backend = 'python -c "import zstandard"';
  else if (probe('python3', ['-c', 'import zstandard'])) backend = 'python3 -c "import zstandard"';
  else if (probe('zstdcat', ['--version'])) backend = 'zstdcat CLI';
  else if (probe('zstd', ['--version'])) backend = 'zstd CLI';
  const hasUv = probe('uv', ['--version']);
  const UV_CMD = 'uv run --no-project --python 3.12 --with zstandard python scripts/weekly_review.py';

  if (count > 0 && backend) {
    ok('scripts.preflight', '分析脚本前置条件',
      `${count} 个会话日志匹配 $DSH_HOME/sessions/*/*/session.jsonl.zstd；压缩后端 = ${backend}`);
  } else if (count > 0 && hasUv) {
    warn('scripts.preflight', '分析脚本前置条件',
      `有 ${count} 个日志，但**裸 python / zstd CLI 都不可用**（本机 python 是 Microsoft Store 占位器，Windows 也没有 zstdcat）。` +
      `日志形状没问题，是解释器问题 → 用 uv 兜底即可`,
      UV_CMD);
  } else if (count === 0) {
    warn('scripts.preflight', '分析脚本前置条件',
      `没有会话日志匹配 $DSH_HOME/sessions/*/*/session.jsonl.zstd —— dsh 可能改了日志目录形状，**所有分析脚本会静默报 0**`,
      '对一下 dsh 的会话存储实现，更新 scripts/_session_io.py 的 session_glob()');
  } else {
    fail('scripts.preflight', '分析脚本前置条件',
      `有 ${count} 个日志，但**没有任何可用的解压后端**（裸 python 不行、无 zstd CLI、也没有 uv）→ cost_anatomy / weekly_review / verify_leash 全部跑不了`,
      '装 uv（推荐）：https://docs.astral.sh/uv/  然后 ' + UV_CMD + '  # 或装 zstd CLI');
  }
}
// ---- 档位合法性
{
  const r = runTool('tools/show-effort-levels.mjs', ['--current']);
  if (r.code === 0) ok('effort.legality', 'agent-default-model 档位合法', r.out.split('\n').slice(-3).join(' / '));
  else if (r.code === 1) fail('effort.legality', 'agent-default-model 档位合法',
    `当前默认模型的 reasoningEffort 不被该模型支持 → 写错启动**不报错**，要到发请求才炸`,
    'node tools/show-effort-levels.mjs --current');
  else unver('effort.legality', 'agent-default-model 档位合法', `巡检工具 exit ${r.code}: ${r.out.slice(0, 200)}`);
}

// ---- 仓库自身的编码/换行闸门
{
  const r = runTool('tools/check-encoding.mjs');
  if (r.code === 0) ok('repo.encoding', '仓库编码与换行', r.out.trim());
  else fail('repo.encoding', '仓库编码与换行',
    `${r.out.trim().split('\n').slice(0, 3).join(' | ')} —— .ps1 必须带 BOM（否则 PS 5.1 在代码页 936 下语法报错）；.sh 必须是 LF（否则 Ubuntu 上 bad interpreter）`,
    'node tools/check-encoding.mjs --fix');
}

// ================================================================ 安全自动修复

const SAFE_REPAIRS = {
  'instruction.block': () => {
    const block = join(REPO, 'handoff', 'AGENTS.block.md');
    if (!existsSync(block)) return '找不到 handoff/AGENTS.block.md';
    const body = readFileSync(block, 'utf8');
    const target = globalFile;
    let cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (cur.includes(BLOCK_MARKER)) return '已有标记，跳过';
    const bak = existsSync(target) ? `${target}.bak-doctor-${Date.now()}` : null;
    if (bak) writeFileSync(bak, cur, 'utf8');
    const sep = cur && !cur.endsWith('\n') ? '\n\n' : (cur ? '\n' : '');
    writeFileSync(target, cur + sep + body.replace(/\r?\n/g, '\n'), 'utf8');
    return `已追加到 ${target}${bak ? `（备份 ${basename(bak)}）` : ''}`;
  },
  'preset.source-fingerprint': () => {
    const r = runTool('tools/regen-standard-leash.mjs');
    return r.code === 0 ? r.out.split('\n').slice(0, 2).join(' / ') : `失败: ${r.out.slice(0, 200)}`;
  },
};

// ================================================================ 输出

const failed = results.filter((r) => r.status === 'FAIL');
const warnInert = results.filter((r) => r.status === 'WARN' || r.status === 'INERT');
const unvers = results.filter((r) => r.status === 'UNVERIFIABLE');

if (fixSafe) {
  const applicable = Object.keys(SAFE_REPAIRS).filter((id) =>
    results.some((r) => r.id === id && (r.status === 'FAIL' || r.status === 'WARN')));
  if (!applicable.length) console.log('[doctor] --fix-safe：没有可安全自动修复的项');
  for (const id of applicable) {
    const msg = SAFE_REPAIRS[id]();
    console.log(`[doctor] --fix-safe ${id}: ${msg}`);
    const r = results.find((x) => x.id === id);
    if (r) r.repaired = msg;
  }
  console.log('[doctor] 修完请**再跑一次不带 --fix-safe 的巡检**确认（修复本身也要被验证）\n');
}

if (asJson) {
  console.log(JSON.stringify({
    dshHome: DSH_HOME, dshRoot, dshVersion, activeProfile: profile.name,
    profileDetection: profile.why,
    shippedStandardSha256: shippedStandardSha,
    summary: {
      total: results.length,
      ok: results.filter((r) => r.status === 'OK').length,
      warn: results.filter((r) => r.status === 'WARN').length,
      fail: failed.length,
      inert: results.filter((r) => r.status === 'INERT').length,
      unverifiable: unvers.length,
    },
    checks: results,
  }, null, 2));
} else {
  const ICON = { OK: '✅', WARN: '⚠️ ', FAIL: '❌', INERT: '🕳️ ', UNVERIFIABLE: '❓', SKIP: '⏭️ ' };
  console.log(`\n[doctor] DSH_HOME = ${DSH_HOME}`);
  console.log(`[doctor] dsh      = ${dshVersion || '(未知)'}  @ ${dshRoot || '(未找到)'}`);
  console.log(`[doctor] profile  = ${profile.name || '(未探测到)'}  (${profile.why})\n`);
  for (const r of results) {
    console.log(`${ICON[r.status]} ${r.id.padEnd(26)} ${r.title}`);
    if (r.detail) console.log(`      ${r.detail}`);
    if (r.repair && r.status !== 'OK' && r.status !== 'SKIP') console.log(`      ↳ 修法: ${r.repair}`);
    if (r.repaired) console.log(`      ↳ 已修: ${r.repaired}`);
  }
  console.log(`\n[doctor] ${results.length} 项检查：` +
    `OK ${results.filter((r) => r.status === 'OK').length} / ` +
    `WARN ${results.filter((r) => r.status === 'WARN').length} / ` +
    `FAIL ${failed.length} / INERT ${results.filter((r) => r.status === 'INERT').length} / ` +
    `UNVERIFIABLE ${unvers.length}`);
  if (failed.length) console.log('[doctor] ❌ 有 FAIL —— 这些项会**静默失效**，别放过');
  else if (warnInert.length) console.log('[doctor] 没有 FAIL，但有 WARN/INERT —— 建议逐条看一眼上面的说明');
  else if (unvers.length) console.log('[doctor] 全部 OK，但有 UNVERIFIABLE —— 那是"我无法再验证"，请人工确认');
  else console.log('[doctor] 全部通过');
  console.log(`[doctor] 状态文件: ${STATE_FILE}（记录 dsh 版本与 preset 指纹，用于下次检测升级漂移）\n`);
}

saveState({
  kitVersion: 2,
  dshVersion,
  shippedStandardSha256: shippedStandardSha,
  activeProfile: profile.name,
  // 上次扫出来的"谁引用了哪个 settings 段"。key 里含 dsh 版本 + profile + 段名集合，
  // 任一项变化都会自动失效 —— 这样缓存不会变成一条新的"会过期的记忆"。
  wiringCache: wiringCacheOut || (prevState && prevState.wiringCache) || null,
  lastSummary: {
    ok: results.filter((r) => r.status === 'OK').length,
    warn: results.filter((r) => r.status === 'WARN').length,
    fail: failed.length,
    inert: results.filter((r) => r.status === 'INERT').length,
    unverifiable: unvers.length,
  },
});

process.exit(failed.length || (strict && warnInert.length) ? 1 : 0);
