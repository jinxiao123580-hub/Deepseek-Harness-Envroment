#!/usr/bin/env node
// regen-standard-leash.mjs — 从**当前安装的** DSH 的 standard preset 重新生成 standard-leash
//
// 为什么需要脚本（2026-09-19 实测）:
//   仓库里 presets/standard-leash/README.md 声称 "agent.cordis.yml 是随 DSH 发布的 standard
//   preset 的**逐字节副本**，唯一改动是 tool-subagent / tool-subagent-fork 两行加了三件事"。
//   实际比对（dsh 0.1.5-rc.2）发现它是一份**过期副本**，还额外缺了：
//     · - id: command-goal / @deepseek-ai/dsh-command-goal
//     · - id: present      / @deepseek-ai/dsh-tool-present
//     · modelSelectionSettings: true
//     · fetch: true（副本写的是 fetch: false）
//     · system prompt 用合并的 text: 而不是 standard 的 prefix:/suffix:
//   把它当默认 preset 部署，会**静默减少 agent 的工具**。
//
//   而 config/settings.preset.yaml 里给的"升级后重新对齐"办法是手工
//   `cp <checkout>/.../standard/agent.cordis.yml ...` **然后再手动补回那两行 config** ——
//   手工步骤正是漂移的来源（它已经漂移过一次）。所以改成可重复执行的脚本。
//
// 用法:
//   node tools/regen-standard-leash.mjs                       # 自动定位已安装的 dsh
//   node tools/regen-standard-leash.mjs --standard <path>     # 显式指定 standard preset
//   node tools/regen-standard-leash.mjs --check               # 只校验现有副本是否同步（CI 用）
//
// 退出码: 0 成功/已同步；1 --check 发现漂移；2 参数或找不到源文件

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// 护栏文本与注入逻辑与 tools/harden-preset.mjs **共用同一份**，避免两个脚本漂移。
import { LEASH, injectLeash as inject } from './lib/leash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

function parseArgs(argv) {
  const out = { standard: null, check: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--standard') out.standard = argv[++i];
    else if (argv[i] === '--check') out.check = true;
    else if (argv[i] === '--quiet') out.quiet = true;
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

/**
 * npm 全局 node_modules 根目录。
 * Windows：npm 是 npm.cmd（批处理），Node 20+ 出于安全考虑不允许不带 shell 执行 .cmd。
 *   用 `cmd /c npm root -g` 而不是 execFileSync(..., {shell:true}) —— 后者在 Node 24 上会抛
 *   DEP0190 弃用警告（"Passing args to a child process with shell option true"）。
 * 拿不到时退回到各平台常见路径。
 */
function npmGlobalRoot() {
  try {
    const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
    const out = (process.platform === 'win32'
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm root -g'], opts)
      : execFileSync('npm', ['root', '-g'], opts)).trim();
    if (out) return out;
  } catch { /* 落到下面的候选 */ }
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = process.platform === 'win32'
    ? [join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', 'node_modules')]
    : ['/usr/local/lib/node_modules', '/usr/lib/node_modules', join(home, '.npm-global', 'lib', 'node_modules')];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

function locateStandard() {
  const root = npmGlobalRoot();
  if (!root) return null;
  const p = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai',
                 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml');
  return existsSync(p) ? p : null;
}

/**
 * dsh 版本。**不用** `dsh --version`：Windows 上 dsh 是 .ps1/.cmd shim，
 * execFileSync 不带 shell 跑不起来（实测返回 unknown）。直接读安装包的 package.json 更可靠。
 */
function dshVersion() {
  const root = npmGlobalRoot();
  if (root) {
    const pkg = join(root, '@deepseek-ai', 'dsh', 'package.json');
    try {
      if (existsSync(pkg)) return JSON.parse(readFileSync(pkg, 'utf8')).version || 'unknown';
    } catch { /* 落到下面 */ }
  }
  return 'unknown';
}

/** 往某个 `- id: <rowId>` 这一行的 config 块末尾注入 leash 文本。 */
function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node tools/regen-standard-leash.mjs [--standard <path>] [--check]');
    return;
  }

  const standard = args.standard ? resolve(args.standard) : locateStandard();
  if (!standard || !existsSync(standard)) {
    console.error('[regen-standard-leash] 找不到 standard preset。');
    console.error('  先确认已安装 dsh（npm install -g @deepseek-ai/dsh），或用 --standard <path> 指定。');
    process.exit(2);
  }

  const src = readFileSync(standard, 'utf8').replace(/\n*$/, '\n');
  let generated = src;
  generated = inject(generated, 'tool-subagent');
  generated = inject(generated, 'tool-subagent-fork');

  const outFile = join(REPO, 'presets', 'standard-leash', 'agent.cordis.yml');
  const sourceFile = join(REPO, 'presets', 'standard-leash', 'SOURCE.txt');
  const ver = dshVersion();

  if (args.check) {
    const cur = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
    if (cur === generated) {
      if (!args.quiet) console.log(`[regen-standard-leash] 已同步（源: ${standard}, dsh ${ver}）`);
      return;
    }
    console.error('[regen-standard-leash] **漂移**：presets/standard-leash/agent.cordis.yml 与当前 dsh 的 standard preset 不一致。');
    console.error('  跑 `node tools/regen-standard-leash.mjs` 重新生成（并复核 presets/standard-leash/README.md 的差异表）。');
    process.exit(1);
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, generated, 'utf8');
  writeFileSync(sourceFile,
    `# 本副本的来源（由 tools/regen-standard-leash.mjs 写入，勿手改）\n` +
    `dsh version : ${ver}\n` +
    `source      : ${standard}\n` +
    `source sha256: ${sha256(src)}\n` +
    `result sha256: ${sha256(generated)}\n` +
    `generated by : node tools/regen-standard-leash.mjs\n`,
    'utf8');

  const srcLines = src.split('\n').length;
  const outLines = generated.split('\n').length;
  console.log(`[regen-standard-leash] 源: ${standard}`);
  console.log(`  dsh: ${ver}`);
  console.log(`  行数: ${srcLines} -> ${outLines}（+${outLines - srcLines}，两处注入共 ${LEASH.split('\n').length} 行 ×2）`);
  console.log(`  已写: ${outFile.split(sep).join('/')}`);
  console.log(`  已写: ${sourceFile.split(sep).join('/')}`);
}

main();
