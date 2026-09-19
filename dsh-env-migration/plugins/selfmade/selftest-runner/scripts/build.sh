#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ] || [ ! -d "$CHECKOUT/packages" ]; then echo "no checkout" >&2; exit 1; fi
TSC="$CHECKOUT/node_modules/.bin/tsc"
link_pkg() {
  node -e "const fs=require('fs');const path=require('path');const l=path.resolve(process.argv[1]);const t=path.resolve(process.argv[2]);fs.rmSync(l,{recursive:true,force:true});fs.mkdirSync(path.dirname(l),{recursive:true});fs.symlinkSync(t,l,process.platform==='win32'?'junction':'dir');" "node_modules/$1" "$2"
}
mkdir -p node_modules/@deepseek-ai
node -e "const fs=require('fs');fs.rmSync('node_modules/@standard-schema',{recursive:true,force:true})"
link_pkg cordis "$CHECKOUT/vendor/cordis"
link_pkg cosmokit "$CHECKOUT/vendor/cosmokit"
link_pkg schemastery "$CHECKOUT/vendor/schemastery"
link_pkg @deepseek-ai/dsh-tools "$CHECKOUT/packages/core/tools"
link_pkg @types/node "$CHECKOUT/node_modules/@types/node"
"$TSC" -p tsconfig.json
