#!/usr/bin/env node
// merge-settings.mjs — 把若干 settings 片段「保守合并」进 ~/.dsh/settings.yaml
//
// 存在理由：老版 install.ps1 用 Copy-Item 整份覆盖 settings.yaml，会连同本机已调好的
// spill-policy / compaction-basic / compaction-acp / agent-default-model 一起抹掉
// （实测：本机 183 行的 settings.yaml 被 77 行的模板覆盖，成本治理配置全丢）。
// 本脚本的契约是 **只增不删**：本机已有的东西一律原样保留。
//
// 用法:
//   node tools/merge-settings.mjs \
//       --template config/settings.yaml \
//       --template config/settings.cost.yaml \
//       [--template config/settings.deepseek-cheap.yaml] \
//       [--template config/settings.preset.yaml] \
//       --target ~/.dsh/settings.yaml [--dry-run] [--force] [--json]
//
// 合并规则（逐条，不做通用 YAML 解析——刻意只认顶两层，避免引进依赖）:
//   1. 顶层 section 名在 target 里不存在  → 整段追加（含其注释）
//   2. 顶层 section 名已存在：
//        · llm-pi-ai  → 只按 provider 粒度补缺（providers 下没有的 provider 才追加）
//        · 其它        → 整段跳过，target 原样保留
//   3. 永远不删除、不重排 target 的任何一行
//   4. --force：真的整份覆盖（仍会备份）
//
// 退出码: 0 成功（含"无改动"）；2 参数/IO 错误

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const TOP_KEY = /^([A-Za-z0-9_.-]+):/;          // 顶层 section（缩进 0）
const NESTED_KEY = /^(\s+)([A-Za-z0-9_.-]+):/;   // 缩进后的 key

function expand(p) {
  if (!p) return p;
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

function parseArgs(argv) {
  const out = { templates: [], target: null, dryRun: false, force: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--template' || a === '-t') out.templates.push(argv[++i]);
    else if (a === '--target' || a === '-o') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`未知参数: ${a}`);
  }
  return out;
}

/** 把文件切成顶层 section：{ key, lines[] }，外加 preamble（第一个 section 之前的行）。 */
function parseSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let preamble = [];
  let cur = null;
  for (const line of lines) {
    const m = TOP_KEY.exec(line);
    // 只在缩进为 0 时才是顶层 key；'#...' 不会匹配 TOP_KEY
    if (m && !/^\s/.test(line)) {
      cur = { key: m[1], lines: [line] };
      sections.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  // 去掉尾部空行，避免每次运行都往文件尾堆空行
  for (const s of sections) {
    while (s.lines.length > 1 && s.lines[s.lines.length - 1].trim() === '') s.lines.pop();
  }
  while (preamble.length && preamble[preamble.length - 1].trim() === '') preamble.pop();
  return { preamble, sections };
}

/** 在 llm-pi-ai section 里按 provider（缩进 4）切块。返回 {name, lines[], startIdx} */
function parseProviders(sectionLines, sectionKey) {
  const providersIdx = sectionLines.findIndex((l) => /^\s+providers:\s*$/.test(l));
  if (providersIdx < 0) return { providersIdx: -1, blocks: [] };
  const providerIndent = (/^(\s*)/.exec(sectionLines[providersIdx])[1]).length + 2;
  const blocks = [];
  let cur = null;
  for (let i = providersIdx + 1; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) { if (cur) cur.lines.push(line); continue; }
    const indent = (/^(\s*)/.exec(line)[1]).length;
    if (indent < providerIndent) break;                    // 离开 providers 块
    const m = NESTED_KEY.exec(line);
    if (indent === providerIndent && m) {
      cur = { name: m[2], lines: [line], startIdx: i };
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  for (const b of blocks) {
    while (b.lines.length > 1 && b.lines[b.lines.length - 1].trim() === '') b.lines.pop();
  }
  return { providersIdx, blocks };
}

function sectionMap(sections) {
  const m = new Map();
  for (const s of sections) m.set(s.key, s);
  return m;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target || args.templates.length === 0) {
    console.log('用法: node tools/merge-settings.mjs --template <t.yaml> [--template <t2.yaml>...] --target <settings.yaml> [--dry-run] [--force] [--json]');
    process.exit(args.help ? 0 : 2);
  }

  const targetPath = expand(args.target);
  const templates = args.templates.map((t) => {
    const p = expand(t);
    if (!existsSync(p)) {
      console.error(`[merge-settings] 模板不存在: ${p}`);
      process.exit(2);
    }
    return { path: p, text: readFileSync(p, 'utf8') };
  });

  const addedSections = [];
  const addedProviders = [];
  const skipped = [];
  let out;

  if (!existsSync(targetPath) || args.force) {
    // 全新建：把模板按顺序拼起来
    const parts = [];
    for (const t of templates) {
      const { preamble, sections } = parseSections(t.text);
      if (parts.length === 0 && preamble.length) parts.push(preamble.join('\n'));
      for (const s of sections) parts.push(s.lines.join('\n'));
    }
    out = parts.join('\n\n') + '\n';
    addedSections.push('(全部：目标不存在，按模板生成)');
  } else {
    const existing = readFileSync(targetPath, 'utf8');
    const parsed = parseSections(existing);
    const byKey = sectionMap(parsed.sections);

    for (const t of templates) {
      const { sections } = parseSections(t.text);
      for (const s of sections) {
        const have = byKey.get(s.key);
        if (!have) {
          parsed.sections.push({ key: s.key, lines: s.lines.slice() });
          byKey.set(s.key, parsed.sections[parsed.sections.length - 1]);
          addedSections.push(s.key);
          continue;
        }
        if (s.key === 'llm-pi-ai') {
          const dst = parseProviders(have.lines, s.key);
          const src = parseProviders(s.lines, s.key);
          if (dst.providersIdx < 0 && src.providersIdx >= 0) {
            // target 没有 providers 段：整段补进去
            have.lines.push(...s.lines.slice(src.providersIdx));
            addedProviders.push(...src.blocks.map((b) => b.name));
            continue;
          }
          const haveNames = new Set(dst.blocks.map((b) => b.name));
          let insertAt = have.lines.length;
          for (const b of src.blocks) {
            if (haveNames.has(b.name)) { skipped.push(`llm-pi-ai.providers.${b.name}`); continue; }
            have.lines.splice(insertAt, 0, ...b.lines, '');
            insertAt += b.lines.length + 1;
            haveNames.add(b.name);
            addedProviders.push(b.name);
          }
        } else {
          skipped.push(s.key);
        }
      }
    }
    out = [...parsed.preamble, ...parsed.sections.flatMap((s) => s.lines)].join('\n').replace(/\n*$/, '\n');
  }

  const report = { target: targetPath, addedSections, addedProviders, skipped, changed: out !== (existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '') };

  if (!args.dryRun && report.changed) {
    mkdirSync(dirname(targetPath), { recursive: true });
    if (existsSync(targetPath)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const bak = `${targetPath}.bak-merge-${stamp}`;
      copyFileSync(targetPath, bak);
      report.backup = bak;
    }
    writeFileSync(targetPath, out, 'utf8');
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[merge-settings] 目标: ${targetPath}${args.dryRun ? '  (dry-run)' : ''}`);
    if (!report.changed) console.log('  无改动');
    if (report.backup) console.log(`  已备份 -> ${report.backup}`);
    if (addedSections.length) console.log(`  + 新增 section: ${addedSections.join(', ')}`);
    if (addedProviders.length) console.log(`  + 新增 provider: ${addedProviders.join(', ')}`);
    if (skipped.length) console.log(`  = 保留本机已有（未改动）: ${skipped.join(', ')}`);
  }
}

main();
