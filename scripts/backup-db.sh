#!/usr/bin/env bash
# backup-db.sh — 生产库每日备份（pg_dump），保留 14 天
# 用法：bash scripts/backup-db.sh [输出目录]
# 依赖环境变量：POSTGRES_HOST / POSTGRES_PORT / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
set -uo pipefail

OUT_DIR="${1:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
HOST="${POSTGRES_HOST:-127.0.0.1}"
PORT="${POSTGRES_PORT:-5432}"

mkdir -p "$OUT_DIR"
TARGET="${OUT_DIR}/niannian-${STAMP}.dump"

echo "[backup] host=${HOST}:${PORT} db=${POSTGRES_DB:-<unset>} -> ${TARGET}"

if [ -z "${POSTGRES_DB:-}" ]; then
  echo "[backup] FAIL 缺少 POSTGRES_DB（这正是线上当前的问题，见风险 R2）"
  exit 1
fi

PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  --host "$HOST" --port "$PORT" --username "${POSTGRES_USER}" \
  --format=custom --no-owner --no-acl \
  --file "$TARGET" "${POSTGRES_DB}"

if [ ! -s "$TARGET" ]; then
  echo "[backup] FAIL 备份文件为空"
  exit 1
fi

echo "[backup] 完成：$(du -h "$TARGET" | cut -f1)"
find "$OUT_DIR" -name 'niannian-*.dump' -type f -mtime +"${RETENTION_DAYS}" -delete
echo "[backup] 已清理 ${RETENTION_DAYS} 天前的备份"
echo "[backup] 建议校验：pg_restore -l ${TARGET} | head"
