#!/usr/bin/env bash
# fix-postgres-role-password.sh — 给干净角色 niannian 设上正确密码
#
# 背景：.env.production 被 CRLF 污染，initdb 建出的角色名实为 "niannian\r"。
#       ALTER ROLE ... RENAME 无法执行（不能重命名当前会话用户），因此改为
#       新建干净角色 niannian；但之前设密码时被 shell 引号嵌套吃掉，变成空密码。
#
# 本脚本的解法：把 SQL 写成文件再 docker cp 进容器执行，全程不做引号嵌套。
# 安全：密码只在服务器本地流转，不回显、不落盘到仓库、不打印。
#
# 用法： ssh haika-kidswear-1757 'bash -s' < deploy/fix-postgres-role-password.sh
set -uo pipefail

D=/srv/kidswear-data/staging/niannian-sd2-4998bd8

echo "=== 1. 取干净密码（去 CR/LF，只统计长度不回显）==="
PW=$(grep -E '^POSTGRES_PASSWORD=' "$D/.env.production" | cut -d= -f2- | tr -d '\r\n')
echo "  密码长度=${#PW}  含单引号=$(printf '%s' "$PW" | grep -c "'")"

echo "=== 2. 生成 SQL（文件中的单引号已转义）==="
SQL=/tmp/fix-role-password.sql
ESC=${PW//\'/\'\'}
cat > "$SQL" <<SQL
-- 给干净角色 niannian 设置与 .env.production 一致的密码
ALTER ROLE niannian WITH LOGIN CREATEDB PASSWORD '${ESC}';
ALTER DATABASE niannian OWNER TO niannian;
ALTER SCHEMA public OWNER TO niannian;
GRANT ALL ON SCHEMA public TO niannian;
GRANT ALL PRIVILEGES ON DATABASE niannian TO niannian;
SQL
chmod 600 "$SQL"
echo "  SQL 行数=$(wc -l < "$SQL")"

echo "=== 3. 复制进容器并以现有(带CR)管理员身份执行 ==="
docker cp "$SQL" niannian-sd2-postgres:/tmp/fix-role-password.sql >/dev/null
docker exec niannian-sd2-postgres sh -c 'psql -U "$POSTGRES_USER" -d niannian -v ON_ERROR_STOP=1 -f /tmp/fix-role-password.sql' 2>&1 | head -10
echo "  清理容器内临时文件"
docker exec niannian-sd2-postgres sh -c 'rm -f /tmp/fix-role-password.sql'

echo "=== 4. 角色清单（cat -A 看 CR）==="
docker exec niannian-sd2-postgres sh -c 'psql -U "$POSTGRES_USER" -d niannian -tAc "select rolname from pg_roles where rolname like '"'"'%niannian%'"'"'"' | cat -A

echo "=== 5. 从 app 容器用干净账号真连一次 ==="
cat > /tmp/pg_verify.mjs <<'EOF'
import pg from "pg";
const u = new URL(process.env.DATABASE_URL);
console.log("host=", u.hostname, "db=", u.pathname, "user=", JSON.stringify(u.username));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await c.connect();
  const r = await c.query("select current_user u, current_database() db");
  console.log("CONNECTED:", JSON.stringify(r.rows[0]));
  const t = await c.query("select count(*)::int c from information_schema.tables where table_schema='public'");
  console.log("public tables:", t.rows[0].c);
  await c.end();
} catch (e) { console.log("PG_ERR", e.message.slice(0, 200)); }
EOF
docker cp /tmp/pg_verify.mjs niannian-sd2-app:/tmp/pg_verify.mjs >/dev/null 2>&1
docker exec -w /app niannian-sd2-app node /tmp/pg_verify.mjs
