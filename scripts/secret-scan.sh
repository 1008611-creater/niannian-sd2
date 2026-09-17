#!/usr/bin/env bash
# secret-scan.sh — 轻量密钥扫描（CI 门禁）
# 只报文件路径与行号，绝不打印疑似密钥内容
set -uo pipefail

echo "[secret-scan] 开始"

PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'
  'AKID[A-Za-z0-9]{20,}'
  'ghp_[A-Za-z0-9]{20,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'AIza[A-Za-z0-9_-]{20,}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)

EXCLUDES=(
  --exclude-dir=node_modules
  --exclude-dir=.next
  --exclude-dir=.git
  --exclude-dir=dist
  --exclude-dir=build
  --exclude=package-lock.json
  --exclude=*.tar.gz
  --exclude=*.png --exclude=*.jpg --exclude=*.mp4
)

hits=0
for p in "${PATTERNS[@]}"; do
  # shellcheck disable=SC2068
  result=$(grep -rInE --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude=package-lock.json "$p" . 2>/dev/null || true)
  if [ -n "$result" ]; then
    echo "[secret-scan] FAIL 命中模式：$p"
    echo "$result" | cut -c1-120 | sed 's/=.*/=<redacted>/'
    hits=$((hits + 1))
  fi
done

# 额外规则：env 文件不得入库
if git ls-files 2>/dev/null | grep -qE '^\.env($|\.)' ; then
  echo "[secret-scan] FAIL 仓库中存在被跟踪的 .env 文件"
  git ls-files | grep -E '^\.env($|\.)'
  hits=$((hits + 1))
fi

if [ "$hits" -gt 0 ]; then
  echo "[secret-scan] 发现 $hits 类风险，禁止合入"
  exit 1
fi
echo "[secret-scan] OK 未发现密钥"
