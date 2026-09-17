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
  'postgres(ql)?://[A-Za-z0-9_.-]+:[^@[:space:]]+@'   # 连接串里带明文口令
  'DATABASE_URL=postgres(ql)?://[A-Za-z0-9_.-]+:[^@[:space:]]+@'
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
  # 占位值与本机 CI 测试用的 DSN 不算泄密：replace-with-password / 127.0.0.1 / localhost
  result=$(grep -rInE --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude=package-lock.json "$p" . 2>/dev/null \
    | grep -vE 'replace-with-password|@(127\.0\.0\.1|localhost)[:/]' || true)
  if [ -n "$result" ]; then
    echo "[secret-scan] FAIL 命中模式：$p"
    echo "$result" | cut -c1-120 | sed 's/=.*/=<redacted>/'
    hits=$((hits + 1))
  fi
done

# 额外规则：env 文件不得入库（模板文件 .env.example / .env.sample 等除外）
# 说明：.env.example 之类是"键名清单+占位值"，本就该入库；真正危险的是带真值的 .env / .env.production
ENV_ALLOWLIST='^\.env(\.docker)?\.(example|sample|template|dist)$'
tracked_env=$(git ls-files 2>/dev/null | grep -E '^\.env($|\.)' | grep -vE "$ENV_ALLOWLIST" || true)
if [ -n "$tracked_env" ]; then
  echo "[secret-scan] FAIL 仓库中存在被跟踪的非模板 .env 文件"
  echo "$tracked_env"
  hits=$((hits + 1))
fi

if [ "$hits" -gt 0 ]; then
  echo "[secret-scan] 发现 $hits 类风险，禁止合入"
  exit 1
fi
echo "[secret-scan] OK 未发现密钥"
