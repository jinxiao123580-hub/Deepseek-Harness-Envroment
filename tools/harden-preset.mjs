#!/usr/bin/env node
// harden-preset.mjs — 把「子代理护栏」打进**任意已有的** agent preset
//
// 为什么需要它（2026-09-19 实测）:
//   本机默认 preset 是用户自定义的 `router-standard`，**不是** `standard`。
//   而 presets/standard-leash 只影响"新会话且选了该 preset"的会话 ——
//   所以把 standard-leash 装上去，**本机的扇出风险依然存在**。
//   实测 router-standard/agent.cordis.yml 的 delegation 段里，`- id: tool-subagent` 与
//   `- id: tool-subagent-fork` 既没有 maxDepth、也没有 toolFilter、也没有 agentOptions
//   → 子代理可以无限递归再派子代理（仓库记录的 ¥8.34 扇出事故就是这条路）。
//
//   而"手工移植"正是 standard-leash 副本漂移的成因，所以也用脚本做，并带备份 + --check。
//
// 用法:
//   node tools/harden-preset.mjs <preset 目录 或 agent.cordis.yml 路径>
//   node tools/harden-preset.mjs ~/.dsh/.agent-presets/router-standard --dry-run
//   node tools/harden-preset.mjs ~/.dsh/.agent-presets/router-standard --check   # CI / 巡检
//
// 退出码: 0 成功或已加固；1 --check 发现未加固；2 参数错误

import { readFileSync, writeFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { harden, ROWS } from './lib/leash.mjs';

function parseArgs(argv) {
  const out = { target: null, dryRun: false, check: false, noBackup: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--check') out.check = true;
    else if (a === '--no-backup') out.noBackup = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-')) out.target = a;
  }
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target) {
    console.log('用法: node tools/harden-preset.mjs <preset 目录 | agent.cordis.yml> [--dry-run] [--check] [--no-backup]');
    console.log('');
    console.log('给 preset 里的 tool-subagent / tool-subagent-fork 注入 4 项护栏：');
    console.log('  agentOptions(deepseek-cheap) + maxDepth:1 + toolFilter.deny + persona');
    console.log('已加固的行会原样保留（幂等）。写入前会备份成 <file>.bak-harden-<时间戳>。');
    process.exit(args.help ? 0 : 2);
  }

  let file = resolve(args.target.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || '~'));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'agent.cordis.yml');
  if (!existsSync(file)) {
    console.error(`[harden-preset] 找不到文件: ${file}`);
    process.exit(2);
  }

  const src = readFileSync(file, 'utf8');
  const { text, changed, skipped, missing } = harden(src);

  if (missing.length) {
    console.error(`[harden-preset] 这些行在 preset 里找不到: ${missing.join(', ')}`);
    console.error('  可能是 DSH 版本改了结构，或者这份 preset 本来就不含子代理工具行。');
    if (missing.length === ROWS.length) process.exit(2);
  }

  if (args.check) {
    if (changed.length === 0) {
      console.log(`[harden-preset] 已加固（${basename(file)}；已带护栏的行: ${skipped.join(', ') || '无'}）`);
      if (missing.length) console.log(`  未找到（可能不存在于本 preset）: ${missing.join(', ')}`);
      return;
    }
    console.error(`[harden-preset] **未加固**：${changed.join(', ')} 缺 maxDepth/toolFilter/agentOptions。`);
    console.error(`  跑 \`node tools/harden-preset.mjs "${args.target}"\` 修（会自动备份）。`);
    process.exit(1);
  }

  if (changed.length === 0) {
    console.log(`[harden-preset] 无需改动（${basename(file)} 已加固）`);
    if (missing.length) console.log(`  未找到: ${missing.join(', ')}`);
    return;
  }

  if (args.dryRun) {
    console.log(`[harden-preset] [dry-run] 会给 ${changed.join(', ')} 注入 4 项护栏 -> ${file}`);
    if (skipped.length) console.log(`  已加固、保持不变: ${skipped.join(', ')}`);
    return;
  }

  if (!args.noBackup) {
    const bak = `${file}.bak-harden-${stamp()}`;
    copyFileSync(file, bak);
    console.log(`[harden-preset] 备份: ${bak}`);
  }
  writeFileSync(file, text, 'utf8');
  const before = src.split('\n').length;
  const after = text.split('\n').length;
  console.log(`[harden-preset] 已加固 ${basename(file)}`);
  console.log(`  注入: ${changed.join(', ')}`);
  if (skipped.length) console.log(`  已存在、保持不变: ${skipped.join(', ')}`);
  console.log(`  行数: ${before} -> ${after}`);
  console.log('  注意：护栏里的 agentOptions 指向 provider `deepseek-cheap`，');
  console.log('        必须先把 config/settings.deepseek-cheap.yaml 合并进 settings.yaml，');
  console.log('        否则子代理会因为找不到 provider 而失败（用 tools/merge-settings.mjs）。');
}

main();
