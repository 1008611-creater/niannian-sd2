#!/usr/bin/env bash
# fix-env-production.sh — 修复生产 .env.production（默认只演练，不落盘）
#
# 修复内容：
#   1. CRLF -> LF（本次线上事故的根因之一）
#   2. 首行污染键名：nnvlwyufbemejgjfPOSTGRES_DB=xxx  ->  POSTGRES_DB=xxx
#   3. 补齐 DATABASE_URL（应用真正读取的连接串；缺失会退回 sql.js SQLite 兜底）
#
# 用法（在部署服务器上执行）：
#   ssh -o BatchMode=yes haika-kidswear-1757 'bash -s' < deploy/fix-env-production.sh --dry-run
#   ssh -o BatchMode=yes haika-kidswear-1757 'bash -s' < deploy/fix-env-production.sh --apply
#
# 安全约束：
#   - 默认 --dry-run，只打印"将要发生的变更"，不写任何文件
#   - --apply 前自动备份为 .env.production.bak.<时间戳>
#   - 全程不打印任何密钥明文，只显示键名与长度
set -uo pipefail

MODE="--dry-run"
for arg in "$@"; do
  case "$arg" in
    --apply) MODE="--apply" ;;
    --dry-run) MODE="--dry-run" ;;
  esac
done

D="/srv/kidswear-data/staging/niannian-sd2-4998bd8"
F="$D/.env.production"
PG_HOST="${PG_HOST:-niannian-sd2-postgres}"
PG_PORT="${PG_PORT:-5432}"

if [ ! -f "$F" ]; then
  echo "[fix-env] 未找到 $F"
  exit 1
fi

echo "[fix-env] 模式：$MODE"
echo "[fix-env] 目标：$F"

# 读取键值（不回显）
get() { grep -E "^${1}=" "$F" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'; }

echo ""
echo "=== 现状诊断 ==="
CR=$(grep -c $'\r' "$F" || true)
echo "CRLF 行数：${CR:-0}"
DIRTY_KEYS=$(grep -nE '^[a-z]{8,}[A-Z_]+=' "$F" | cut -d= -f1 || true)
if [ -n "$DIRTY_KEYS" ]; then
  echo "污染键名："
  echo "$DIRTY_KEYS" | sed 's/^/  /'
else
  echo "污染键名：无"
fi
if grep -qE '^DATABASE_URL=' "$F"; then
  echo "DATABASE_URL：已设置(len=$(get DATABASE_URL | wc -c))"
else
  echo "DATABASE_URL：缺失  <-- 应用因此退回 sql.js SQLite 兜底"
fi
echo "POSTGRES_DB（干净键名）：$([ -n "$(get POSTGRES_DB)" ] && echo "存在" || echo "缺失")"

# 构造修复后的内容（内存中，不落盘）
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# 1) 去 CR
tr -d '\r' < "$F" > "$TMP"
# 2) 修污染键名
sed -i -E 's/^[a-z]{8,}(POSTGRES_DB=)/\1/' "$TMP"
# 3) 补齐 DATABASE_URL
if ! grep -qE '^DATABASE_URL=' "$TMP"; then
  U=$(grep -E '^POSTGRES_USER=' "$TMP" | head -1 | cut -d= -f2-)
  P=$(grep -E '^POSTGRES_PASSWORD=' "$TMP" | head -1 | cut -d= -f2-)
  DB=$(grep -E '^POSTGRES_DB=' "$TMP" | head -1 | cut -d= -f2-)
  if [ -z "$DB" ]; then DB="niannian"; echo "[fix-env] 注意：POSTGRES_DB 仍缺失，默认使用 niannian"; fi
  printf 'DATABASE_URL=postgres://%s:%s@%s:%s/%s\n' "$U" "$P" "$PG_HOST" "$PG_PORT" "$DB" >> "$TMP"
fi

echo ""
echo "=== 修复后（键名与长度，不显示值）==="
grep -E '^[A-Za-z_]+=' "$TMP" | while IFS= read -r line; do
  k="${line%%=*}"; v="${line#*=}"
  printf '  %-38s len=%s\n' "$k" "$(printf '%s' "$v" | wc -c)"
done

echo ""
echo "=== 关键差异 ==="
diff <(grep -E '^[A-Za-z_]+=' "$F" | cut -d= -f1 | sort -u) \
     <(grep -E '^[A-Za-z_]+=' "$TMP" | cut -d= -f1 | sort -u) \
  | sed 's/^/  /' || true

if [ "$MODE" = "--dry-run" ]; then
  echo ""
  echo "[fix-env] DRY-RUN 结束，未修改任何文件。"
  echo "[fix-env] 确认无误后执行："
  echo "  ssh -o BatchMode=yes haika-kidswear-1757 'bash -s' < deploy/fix-env-production.sh --apply"
  exit 0
fi

STAMP=$(date +%Y%m%d-%H%M%S)
cp -p "$F" "${F}.bak.${STAMP}"
echo ""
echo "[fix-env] 已备份：${F}.bak.${STAMP}"
install -m 600 "$TMP" "$F"
echo "[fix-env] 已写入（权限 600）"
echo ""
echo "[fix-env] 后续必须按序执行（顺序错了会出事故）："
echo ""
echo "  # ⚠️ 加了 DATABASE_URL 后，应用会从 sql.js SQLite 切到 Postgres。"
echo "  #    而 Postgres 现在是空库 —— 必须先迁移，否则 4 个用户会“消失”、全员掉线。"
echo ""
echo "  cd $D"
echo "  docker compose up -d --force-recreate app        # 1) 让新环境变量生效"
echo "  docker exec niannian-sd2-app printenv | grep -E '^(DATABASE_URL|POSTGRES_DB)=' | cut -d= -f1"
echo ""
echo "  # 2) 迁移：SQLite -> Postgres（先演练再执行）"
echo "  docker compose run --rm -v \"\$PWD/data:/app/data:ro\" app npm run db:migrate:dry-run"
echo "  docker compose run --rm -v \"\$PWD/data:/app/data:ro\" app npm run db:migrate:sqlite-to-postgres"
echo ""
echo "  # 3) 验收：表数量 > 0，且 users / sessions 行数与迁移前一致"
echo "  docker exec niannian-sd2-postgres psql -U niannian -d niannian -c \"select count(*) from information_schema.tables where table_schema='public'\""
echo "  docker exec niannian-sd2-postgres psql -U niannian -d niannian -c 'select count(*) from users'"
echo ""
echo "  # 4) 回滚方案（出问题立即执行）"
echo "  #    cp ${F}.bak.${STAMP} $F && docker compose up -d --force-recreate app"
echo "  #    （回到 SQLite 兜底，网站恢复出片能力，账目回到迁移前状态）"
