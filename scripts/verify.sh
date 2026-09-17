#!/usr/bin/env bash
# verify.sh — 统一质量门（本地与 CI 共用同一入口）
# 顺序：env 键名 → typecheck → lint → 单测/契约测试 → secret 扫描 → build → 冒烟
set -uo pipefail

FAILED=0
step() {
  echo ""
  echo "=== $1 ==="
}

run() {
  local name="$1"; shift
  if "$@"; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name"
    FAILED=1
  fi
}

step "1/7 env keys"
run "check-env" bash scripts/check-env.sh --keys-only --skip-missing

step "2/7 typecheck"
if npm run typecheck --silent >/dev/null 2>&1; then
  echo "  ✓ typecheck"
elif npm run lint --silent >/dev/null 2>&1; then
  echo "  ✓ typecheck（回退到 npm run lint：当前 lint 实为 tsc --noEmit，见 T2-3）"
else
  echo "  ✗ typecheck"
  FAILED=1
fi

step "3/7 lint"
if [ -d node_modules/eslint ] || [ -f .eslintrc.json ] || [ -f .eslintrc.js ] || [ -f eslint.config.mjs ]; then
  run "eslint" npm run lint:eslint --silent
else
  echo "  ! eslint 未安装，跳过（技术债 T2-3；当前 npm run lint 实为 tsc --noEmit）"
fi

step "4/7 unit + contract tests"
run "tests" npm run test --silent

step "5/7 secret scan"
run "secret-scan" bash scripts/secret-scan.sh

step "6/7 build"
run "build" npm run build --silent

step "7/7 smoke"
run "smoke" bash scripts/smoke.sh

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "VERIFY OK"
  exit 0
fi
echo "VERIFY FAILED — 停止宣布完成，先修复再重跑"
exit 1
