#!/usr/bin/env bash
# backup-postgres-host.sh — 生产 Postgres 每日备份（宿主机侧执行）
#
# 背景：迁移前线上"能出片但记不住账"，且从未有过备份。迁到 Postgres 后
#       必须把备份变成默认值，否则下一次磁盘/容器事故就是全量丢账。
#
# 做法：docker exec 容器内 pg_dump（custom 格式），stdout 重定向到宿主机备份目录。
#       密码只从 .env.production 读取、只进 PGPASSWORD 环境变量，不回显、不落日志。
#
# 安装（宿主机）：
#   ( crontab -l 2>/dev/null; echo "10 3 * * * /bin/bash /srv/kidswear-data/staging/niannian-sd2-4998bd8/backup-postgres-host.sh >> /srv/kidswear-data/staging/niannian-sd2-4998bd8/backups/backup.log 2>&1" ) | crontab -
# 手动跑一次： bash /srv/kidswear-data/staging/niannian-sd2-4998bd8/backup-postgres-host.sh
set -uo pipefail

D="${SD2_DIR:-/srv/kidswear-data/staging/niannian-sd2-4998bd8}"
OUT="${BACKUP_DIR:-$D/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$OUT"
TARGET="${OUT}/niannian-${STAMP}.dump"

PW=$(grep -E '^POSTGRES_PASSWORD=' "$D/.env.production" | cut -d= -f2- | tr -d '\r\n')
if [ -z "$PW" ]; then
  echo "[backup] FAIL 读不到 POSTGRES_PASSWORD"
  exit 1
fi

echo "[backup] $(date -Is) db=niannian -> ${TARGET}"

docker exec -e PGPASSWORD="$PW" niannian-sd2-postgres \
  pg_dump --username niannian --dbname niannian \
  --format=custom --no-owner --no-acl > "$TARGET"

if [ ! -s "$TARGET" ]; then
  echo "[backup] FAIL 备份文件为空，已删除"
  rm -f "$TARGET"
  exit 1
fi

echo "[backup] OK $(du -h "$TARGET" | cut -f1)  校验：pg_restore -l $TARGET | head"
find "$OUT" -name 'niannian-*.dump' -type f -mtime +"${RETENTION_DAYS}" -delete
echo "[backup] 已清理 ${RETENTION_DAYS} 天前备份"
