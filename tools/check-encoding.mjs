#!/usr/bin/env node
// check-encoding.mjs — 强制本仓库的文件编码约定（Windows / Ubuntu 差异的直接产物）
//
// 为什么需要它（本机实测）:
//   · 系统 ANSI 代码页 = 936 (GBK)。Windows PowerShell 5.1 在**没有 BOM** 时按 ANSI 解码 .ps1，
//     于是 UTF-8 的中文被打乱，字符串里的字节恰好凑出引号 → 直接语法错误：
//       "The string is missing the terminator" / "Unexpected token"
//     README 里推荐的调用方式是 `powershell -ExecutionPolicy Bypass -File .\install.ps1`
//     （Windows PowerShell 5.1，不是 pwsh），所以 **.ps1 必须带 UTF-8 BOM**。
//     仓库原有的 install.ps1 / set-credentials.ps1 确实带 BOM（EF BB BF）—— 这个约定不能丢。
//   · 反过来，Linux 上**带 BOM 的 shell 脚本会直接跑不起来**：
//     内核把 BOM 当成解释器路径的一部分 → `bash: ./install.sh: cannot execute: required file not found`。
//     同理 .py / .yaml / .toml / .json / .mjs 带 BOM 也是坑。
//
// 规则:
//   MUST_HAVE_BOM  : .ps1 .psm1 .psd1
//   MUST_NOT_BOM   : .sh .bash .py .js .mjs .cjs .ts .json .yaml .yml .toml .md .cs .txt .gitignore .gitattributes
//
// 用法:
//   node tools/check-encoding.mjs            # 检查，违规则退出码 1
//   node tools/check-encoding.mjs --fix      # 就地修正
//   node tools/check-encoding.mjs --dir <path> [--fix]

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const MUST_HAVE_BOM = new Set(['.ps1', '.psm1', '.psd1']);
const MUST_NOT_BOM = new Set([
  '.sh', '.bash', '.py', '.js', '.mjs', '.cjs', '.ts', '.json',
  '.yaml', '.yml', '.toml', '.md', '.cs', '.txt', '.xml', '.html',
]);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'bin', 'obj']);

function shouldHaveBom(name) {
  const ext = extname(name).toLowerCase();
  if (MUST_HAVE_BOM.has(ext)) return true;
  if (MUST_NOT_BOM.has(ext)) return false;
  if (name === '.gitignore' || name === '.gitattributes') return false;
  return null; // 不关心
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const fix = argv.includes('--fix');
  const di = argv.indexOf('--dir');
  const root = resolve(di >= 0 ? argv[di + 1] : '.');
  if (!statSync(root).isDirectory()) { console.error(`不是目录: ${root}`); process.exit(2); }

  const violations = [];
  const fixed = [];
  for (const file of walk(root)) {
    const name = basename(file);
    const want = shouldHaveBom(name);
    if (want === null) continue;
    const buf = readFileSync(file);
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    if (want === hasBom) continue;

    const rel = file.slice(root.length + 1);
    if (want) {
      violations.push(`${rel}: .ps1 缺少 UTF-8 BOM（Windows PowerShell 5.1 在代码页 936 上会把它当 GBK 读 → 语法错误）`);
      if (fix) { writeFileSync(file, Buffer.concat([BOM, buf])); fixed.push(rel); }
    } else {
      violations.push(`${rel}: 不应有 UTF-8 BOM（Linux 内核会把 BOM 当成解释器路径的一部分，脚本无法执行；YAML/Python 也可能受影响）`);
      if (fix) { writeFileSync(file, buf.subarray(3)); fixed.push(rel); }
    }
  }

  if (!violations.length) { console.log(`[check-encoding] OK（扫描 ${root}）`); return; }
  for (const v of violations) console.log(`  ${fix ? 'FIXED' : 'BAD  '} ${v}`);
  if (fix) console.log(`[check-encoding] 已修正 ${fixed.length} 个文件的 BOM`);
  else { console.log(`[check-encoding] ${violations.length} 个文件违反编码约定；用 --fix 修正`); process.exit(1); }
}

main();
