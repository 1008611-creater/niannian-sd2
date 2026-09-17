#!/usr/bin/env bash
# switch-app-image.sh — 用新镜像替换生产 app 容器（保留旧容器可秒回退）
#
# 前提：容器是手工起的（compose 服务名与容器名对不上，且 postgres 无 database 别名），
#       不能用 docker compose up，否则会另起空 Postgres。这里沿用"取旧容器 env + 换镜像重建"。
#
# 用法：
#   ssh haika-kidswear-1757 'bash -s -- niannian-sd2:billing-20260918-r1' < deploy/switch-app-image.sh
# 不带参数则默认用 TARGET_IMAGE 变量（下面可改）
set -uo pipefail

TARGET_IMAGE="${1:-${TARGET_IMAGE:-}}"
D=/srv/kidswear-data/staging/niannian-sd2-4998bd8
STAMP=$(date +%Y%m%d-%H%M%S)

if [ -z "$TARGET_IMAGE" ]; then
  echo "用法：bash -s -- <镜像:标签>"; exit 1
fi

echo "=== 0. 前置检查 ==="
docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1 || { echo "镜像不存在：$TARGET_IMAGE"; exit 1; }
CURRENT_IMAGE=$(docker inspect niannian-sd2-app --format '{{.Config.Image}}')
NET=$(docker inspect niannian-sd2-app --format '{{.HostConfig.NetworkMode}}')
echo "  当前镜像=$CURRENT_IMAGE"
echo "  目标镜像=$TARGET_IMAGE"
echo "  网络=$NET"

echo ""
echo "=== 1. 导出当前环境变量（原样沿用，不做任何修改）==="
NEWENV=/tmp/sd2-app-env.$STAMP
docker inspect niannian-sd2-app --format '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}' > "$NEWENV"
chmod 600 "$NEWENV"
echo "  变量总数：$(wc -l < "$NEWENV")"
echo "  DATABASE_URL：$(grep -cE '^DATABASE_URL=' "$NEWENV") 条"

echo ""
echo "=== 2. 保留旧容器 ==="
docker stop niannian-sd2-app
docker rename niannian-sd2-app "niannian-sd2-app.bak.$STAMP"
echo "  旧容器保留为：niannian-sd2-app.bak.$STAMP"

echo ""
echo "=== 3. 用新镜像启动 ==="
docker run -d \
  --name niannian-sd2-app \
  --network "$NET" \
  --restart unless-stopped \
  --env-file "$NEWENV" \
  -v "$D/data:/app/data" \
  "$TARGET_IMAGE" >/dev/null
sleep 10
docker ps --format '{{.Names}} | {{.Status}}' | grep niannian-sd2-app

echo ""
echo "=== 4. 验证 ==="
IP=$(docker inspect niannian-sd2-app --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
echo "  容器 IP=$IP"
echo "  内网 health -> $(curl -sS -m 10 -o /dev/null -w '%{http_code}' "http://$IP:3026/api/health")"
echo "  外网 health -> $(curl -sS -m 15 -o /dev/null -w '%{http_code}' https://sd2.cauai.fun/api/health)"
echo "  外网 providers（未登录应 401）-> $(curl -sS -m 15 -o /dev/null -w '%{http_code}' https://sd2.cauai.fun/api/providers)"
docker exec niannian-sd2-app sh -c 'cat /app/.next/BUILD_ID'

echo ""
echo "=== 回退命令（如需）==="
echo "  docker stop niannian-sd2-app && docker rm niannian-sd2-app"
echo "  docker rename niannian-sd2-app.bak.$STAMP niannian-sd2-app && docker start niannian-sd2-app"
