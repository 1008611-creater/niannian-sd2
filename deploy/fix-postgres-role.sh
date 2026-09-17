#!/usr/bin/env bash
# fix-postgres-role.sh — 修复被 CRLF 污染的 Postgres 角色名与密码
# 现象：角色名实为 "niannian\r"，导致 DATABASE_URL 里干净的 niannian 无法认证
# 操作：重命名角色 -> 重设密码（与 .env.production 中去掉 CR 的密码一致）
set -uo pipefail

D=/srv/kidswear-data/staging/niannian-sd2-4998bd8

echo "=== 1. 检测密码尾部是否混入 CR（只统计个数，不回显）==="
RAW=$(docker exec niannian-sd2-app sh -c 'printenv POSTGRES_PASSWORD | tr -d "\n" | wc -c')
CLEAN=$(docker exec niannian-sd2-app sh -c 'printenv POSTGRES_PASSWORD | tr -d "\r\n" | wc -c')
echo "  含 CR 长度=$RAW  去 CR 长度=$CLEAN  混入 CR 数=$((RAW - CLEAN))"

echo "=== 2. 重命名角色 niannian<CR> -> niannian ==="
docker exec niannian-sd2-postgres sh -c 'psql -U "$POSTGRES_USER" -d niannian -v ON_ERROR_STOP=1 -c "$(printf "ALTER ROLE \"niannian\r\" RENAME TO niannian;")"' 2>&1 | head -5

echo "=== 3. 重设密码（与 .env.production 中干净值一致）==="
PW=$(grep -E '^POSTGRES_PASSWORD=' "$D/.env.production" | cut -d= -f2- | tr -d '\r\n')
docker exec niannian-sd2-postgres sh -c "psql -U niannian -d niannian -v ON_ERROR_STOP=1 -c \"ALTER ROLE niannian PASSWORD '\$PW'\"" 2>&1 | head -5

echo "=== 4. 确认角色与库 ==="
docker exec niannian-sd2-postgres sh -c 'psql -U niannian -d niannian -tAc "select rolname from pg_roles where rolname like '"'"'%niannian%'"'"'"' | cat -A
docker exec niannian-sd2-postgres sh -c 'psql -U niannian -d niannian -tAc "select current_user, current_database()"'

echo "=== 5. public schema 权限（迁移需要建表）==="
docker exec niannian-sd2-postgres sh -c 'psql -U niannian -d niannian -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO niannian; ALTER SCHEMA public OWNER TO niannian;"' 2>&1 | head -5
