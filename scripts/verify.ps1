# verify.ps1 — Windows 版统一质量门（与 scripts/verify.sh 等价）
# 用法：npm run verify:win

$ErrorActionPreference = 'Continue'
$failed = 0

function Step($name) { Write-Host ""; Write-Host "=== $name ===" }
function Run($name, $cmd) {
  Write-Host "  -> $name"
  Invoke-Expression $cmd
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  x $name" -ForegroundColor Red
    $script:failed = 1
  } else {
    Write-Host "  ok $name" -ForegroundColor Green
  }
}

Step "1/7 env keys"
Run "check-env" "bash scripts/check-env.sh --keys-only --skip-missing"

Step "2/7 typecheck"
Run "typecheck" "npm run typecheck --silent"

Step "3/7 lint"
if (Test-Path node_modules/eslint) {
  Run "eslint" "npm run lint:eslint --silent"
} else {
  Write-Host "  ! eslint 未安装，跳过（技术债 T2-3）" -ForegroundColor Yellow
}

Step "4/7 unit + contract tests"
Run "tests" "npm run test --silent"

Step "5/7 secret scan"
Run "secret-scan" "bash scripts/secret-scan.sh"

Step "6/7 build"
Run "build" "npm run build --silent"

Step "7/7 smoke"
Run "smoke" "bash scripts/smoke.sh"

Write-Host ""
if ($failed -eq 0) {
  Write-Host "VERIFY OK" -ForegroundColor Green
  exit 0
}
Write-Host "VERIFY FAILED" -ForegroundColor Red
exit 1
