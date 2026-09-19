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
// 换行（2026-09-19 增补，与 .gitattributes 配套）:
//   EOL_CRLF : .ps1 .psm1 .psd1 .cmd .bat   —— Windows 专属，惯例 CRLF
//   EOL_LF   : 其余所有文本文件            —— **.sh 必须是 LF**
//
//   为什么把换行也塞进这道闸门：Windows 上 core.autocrlf 默认 true，会把 install.sh
//   一并转成 CRLF，于是 Ubuntu 上的 shebang 变成
//     bash: ./install.sh: /usr/bin/env bash^M: bad interpreter: No such file or directory
//   报错信息完全指不到"换行符"这个真因，极难排查。.gitattributes 负责"入库时"的规范，
//   这个脚本负责"手上这份工作区"的规范；两者都要有，否则本地改一改就又漂了。
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
const EOL_CRLF = new Set(['.ps1', '.psm1', '.psd1', '.cmd', '.bat']);
const BINARY_EXT = new Set(['.exe', '.dll', '.ico', '.png', '.jpg', '.jpeg', '.gif', '.lnk', '.db', '.zstd', '.zip']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'bin', 'obj']);

function shouldHaveBom(name) {
  const ext = extname(name).toLowerCase();
  if (MUST_HAVE_BOM.has(ext)) return true;
  if (MUST_NOT_BOM.has(ext)) return false;
  if (name === '.gitignore' || name === '.gitattributes') return false;
  return null; // 不关心
}

/** 想要的换行：'crlf' / 'lf' / null（不关心，例如二进制）。 */
function wantEol(name) {
  const ext = extname(name).toLowerCase();
  if (BINARY_EXT.has(ext)) return null;
  return EOL_CRLF.has(ext) ? 'crlf' : 'lf';
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** 统计换行情况。 */
function eolStats(buf) {
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 13) { if (buf[i + 1] === 10) { crlf++; i++; } else cr++; }
    else if (buf[i] === 10) lf++;
  }
  return { crlf, lf, cr };
}

/** 把换行统一成 target（保留 BOM 前缀）。 */
function convertEol(buf, target) {
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = hasBom ? buf.subarray(3) : buf;
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    if (b === 13) {
      if (body[i + 1] === 10) i++;            // CRLF -> 一个换行
      // 孤立 CR 也当作换行处理（源码里的裸 CR 几乎总是残渣）
      out.push(10);
    } else if (b === 10) {
      out.push(10);
    } else {
      out.push(b);
    }
  }
  // LF -> 目标
  const final = target === 'crlf'
    ? out.flatMap((b) => (b === 10 ? [13, 10] : [b]))
    : out;
  const res = Buffer.from(final);
  return hasBom ? Buffer.concat([BOM, res]) : res;
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
  let fixedBom = 0;
  let fixedEol = 0;
  for (const file of walk(root)) {
    const name = basename(file);
    let buf = readFileSync(file);
    const rel = file.slice(root.length + 1);
    let dirty = false;

    // ---- BOM 策略 ----
    const want = shouldHaveBom(name);
    if (want !== null) {
      const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      if (want !== hasBom) {
        if (want) {
          violations.push(`${rel}: .ps1 缺少 UTF-8 BOM（Windows PowerShell 5.1 在代码页 936 上会把它当 GBK 读 → 语法错误）`);
          if (fix) { buf = Buffer.concat([BOM, buf]); dirty = true; fixedBom++; }
        } else {
          violations.push(`${rel}: 不应有 UTF-8 BOM（Linux 内核会把 BOM 当成解释器路径的一部分，脚本无法执行；YAML/Python 也可能受影响）`);
          if (fix) { buf = buf.subarray(3); dirty = true; fixedBom++; }
        }
      }
    }

    // ---- 换行策略 ----
    const target = wantEol(name);
    if (target !== null && !isBinary(buf)) {
      const { crlf, lf, cr } = eolStats(buf);
      const mixed = crlf > 0 && lf > 0;
      const wrong = target === 'lf' ? (crlf > 0 || cr > 0) : (lf > 0 || cr > 0);
      if (wrong) {
        const detail = mixed
          ? `换行混用（CRLF ${crlf} 处 / LF ${lf} 处）`
          : (target === 'lf' ? `是 CRLF，应为 LF` : `是 LF，应为 CRLF`);
        const why = target === 'lf'
          ? '在 Ubuntu 上 shebang 会变成 "/usr/bin/env bash^M: bad interpreter"，脚本直接跑不起来'
          : 'Windows 专属脚本惯例用 CRLF';
        violations.push(`${rel}: ${detail}（${why}）`);
        if (fix) { buf = convertEol(buf, target); dirty = true; fixedEol++; }
      }
    }

    if (dirty) writeFileSync(file, buf);
  }

  if (!violations.length) { console.log(`[check-encoding] OK（BOM + 换行，扫描 ${root}）`); return; }
  for (const v of violations) console.log(`  ${fix ? 'FIXED' : 'BAD  '} ${v}`);
  if (fix) {
    console.log(`[check-encoding] 已修正：BOM ${fixedBom} 个文件，换行 ${fixedEol} 个文件`);
  } else {
    console.log(`[check-encoding] ${violations.length} 处违反编码/换行约定；用 --fix 修正`);
    process.exit(1);
  }
}

main();

