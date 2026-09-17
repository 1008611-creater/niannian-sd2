#!/usr/bin/env bash
# apply-env-and-recreate-app.sh — 生产应用：修 env + 重建 app 容器（保留旧容器可回退）
#
# 为什么不用 docker compose up：
#   现有容器是手工起的（服务名 app/database 与容器名 niannian-sd2-app/niannian-sd2-postgres 对不上，
#   且 postgres 无 database 别名）。直接 compose up 会另起一个空 Postgres，属高危操作。
#   这里采用最小增量：保留现有 49 个环境变量，只补 DATABASE_URL / POSTGRES_DB / DATABASE_SSL。
#
# 用法：
#   ssh -o BatchMode=yes haika-kidswear-1757 'bash -s' < deploy/apply-env-and-recreate-app.sh
set -uo pipefail

D=/srv/kidswear-data/staging/niannian-sd2-4998bd8
STAMP=$(date +%Y%m%d-%H%M%S)
PG_HOST=niannian-sd2-postgres
PG_PORT=5432
PG_DB=niannian
IMAGE=$(docker inspect niannian-sd2-app --format '{{.Config.Image}}')
NET=$(docker inspect niannian-sd2-app --format '{{.HostConfig.NetworkMode}}')

echo "=== 0. 前置确认 ==="
echo "  镜像=$IMAGE  网络=$NET  PG主机=$PG_HOST"
[ -f "$D/.env.production" ] || { echo "缺少 .env.production"; exit 1; }

echo ""
echo "=== 1. 修复 .env.production（CRLF→LF、还原污染键名、补 DATABASE_URL）==="
sed -i.bak.$STAMP -e 's/\r$//' -e 's/^[a-z]\{8,\}\(POSTGRES_DB=\)/\1/' "$D/.env.production"
PW=$(grep -E '^POSTGRES_DB=' "$D/.env.production" >/dev/null && echo ok)
if ! grep -qE '^DATABASE_URL=' "$D/.env.production"; then
  U=$(grep -E '^POSTGRES_USER=' "$D/.env.production" | cut -d= -f2-)
  P=$(grep -E '^POSTGRES_PASSWORD=' "$D/.env.production" | cut -d= -f2-)
  printf 'DATABASE_URL=postgres://%s:%s@%s:%s/%s\n' "$U" "$P" "$PG_HOST" "$PG_PORT" "$PG_DB" >> "$D/.env.production"
fi
chmod 600 "$D/.env.production"
echo "  已修复，备份：.env.production.bak.$STAMP"
echo "  CRLF 行数：$(grep -c $'\r' "$D/.env.production" || true)"
echo "  污染键名：$(grep -cE '^[a-z]{8,}[A-Z_]+=' "$D/.env.production" || true)"
echo "  DATABASE_URL：$(grep -cE '^DATABASE_URL=' "$D/.env.production") 条"

echo ""
echo "=== 2. 生成新容器环境变量（现有 49 项 + 3 项增量）==="
NEWENV=/tmp/sd2-app-env.$STAMP
docker inspect niannian-sd2-app --format '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}' \
  | grep -vE '^nnvlwyufbemejgjfPOSTGRES_DB=' > "$NEWENV"
U=$(grep -E '^POSTGRES_USER=' "$D/.env.production" | cut -d= -f2-)
P=$(grep -E '^POSTGRES_PASSWORD=' "$D/.env.production" | cut -d= -f2-)
{
  printf 'POSTGRES_DB=%s\n' "$PG_DB"
  printf 'DATABASE_URL=postgres://%s:%s@%s:%s/%s\n' "$U" "$P" "$PG_HOST" "$PG_PORT" "$PG_DB"
  printf 'DATABASE_SSL=false\n'
} >> "$NEWENV"
chmod 600 "$NEWENV"
echo "  变量总数：$(wc -l < "$NEWENV")"
echo "  新增键：$(grep -E '^(POSTGRES_DB|DATABASE_URL|DATABASE_SSL)=' "$NEWENV" | cut -d= -f1 | tr '\n' ' ')"

echo ""
echo "=== 3. 保留旧容器并重建 ==="
docker stop niannian-sd2-app
docker rename niannian-sd2-app "niannian-sd2-app.bak.$STAMP"
echo "  旧容器已保留为：niannian-sd2-app.bak.$STAMP（回退用）"

docker run -d \
  --name niannian-sd2-app \
  --network "$NET" \
  --restart unless-stopped \
  --env-file "$NEWENV" \
  -v "$D/data:/app/data" \
  "$IMAGE" >/dev/null

echo "  新容器已启动"
sleep 8
docker ps --format '{{.Names}} | {{.Status}}' | grep niannian-sd2-app

echo ""
echo "=== 4. 环境验证 ==="
docker exec niannian-sd2-app sh -c 'printenv | grep -E "^(DATABASE_URL|POSTGRES_DB|DATABASE_SSL)=" | sed -E "s/(:\/\/[^:]+:)[^@]+@/\1<redacted>@/"'

IP=$(docker inspect niannian-sd2-app --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
echo "  容器 IP：$IP"
echo "  health："
curl -sS -m 10 "http://$IP:3026/api/health" | head -c 300
echo ""

echo ""
echo "=== 5. 站点对外验证 ==="
echo "  https://sd2.cauai.fun/api/health -> $(curl -sS -o /dev/null -m 15 -w '%{http_code}' https://sd2.cauai.fun/api/health)"
echo "  https://sd2.cauai.fun/api/providers（未登录应 401）-> $(curl -sS -o /dev/null -m 15 -w '%{http_code}' https://sd2.cauai.fun/api/providers)"

echo ""
echo "=== 完成 ==="
echo "  下一步：迁移 SQLite -> Postgres（先演练）"
echo "  docker exec niannian-sd2-app npm run db:migrate:dry-run"
echo ""
echo "  回退命令（如需）："
echo "  docker stop niannian-sd2-app && docker rm niannian-sd2-app"
echo "  docker rename niannian-sd2-app.bak.$STAMP niannian-sd2-app && docker start niannian-sd2-app"
