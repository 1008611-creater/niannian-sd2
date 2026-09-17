#!/usr/bin/env bash
# smoke.sh — 构建产物可启动的最小冒烟验证
# 校验：next start 能起、/api/health 返回 200、首页返回 200
set -uo pipefail

PORT="${SMOKE_PORT:-3999}"
BASE="http://127.0.0.1:${PORT}"
APP_ORIGIN="${APP_ORIGIN:-$BASE}"
AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-false}"

if [ ! -d .next ] && [ -z "${NEXT_DIST_DIR:-}" ]; then
  echo "[smoke] 未找到 .next，请先 npm run build"
  exit 1
fi

echo "[smoke] 启动 next start -p ${PORT}"
APP_ORIGIN="$APP_ORIGIN" AUTH_COOKIE_SECURE="$AUTH_COOKIE_SECURE" npx next start -p "$PORT" >/tmp/sd2-smoke.log 2>&1 &
PID=$!

cleanup() { kill "$PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# 就绪探测同样要绕过代理，否则探测的永远是代理而不是本机服务。
for i in $(seq 1 40); do
  if curl --noproxy '*' -fsS -m 3 "${BASE}/api/health" >/tmp/sd2-health.json 2>/dev/null; then
    break
  fi
  sleep 1
done

FAILED=0

# 本地回环必须绕过代理：环境里一旦设了 HTTP_PROXY，curl 会把 127.0.0.1 也发给代理，
# 表现为「308 + 50 次重定向」，看起来像应用死循环，其实是代理在兜圈子。
CURL=(curl --noproxy '*')

echo "[smoke] 1/3 health"
if "${CURL[@]}" -fsS -m 5 "${BASE}/api/health" -o /tmp/sd2-health.json; then
  echo "  ✓ $(head -c 200 /tmp/sd2-health.json)"
else
  echo "  ✗ /api/health 不可达"; FAILED=1
fi

echo "[smoke] 2/3 首页"
code=$("${CURL[@]}" -sS -o /dev/null -m 8 -w "%{http_code}" -L "${BASE}/")
if [ "$code" = "200" ]; then echo "  ✓ HTTP 200"; else echo "  ✗ HTTP $code"; FAILED=1; fi

echo "[smoke] 3/3 未登录接口应返回 401"
code=$("${CURL[@]}" -sS -o /dev/null -m 5 -w "%{http_code}" "${BASE}/api/providers")
if [ "$code" = "401" ]; then echo "  ✓ 401（鉴权生效）"; else echo "  ✗ 期望 401，实际 $code"; FAILED=1; fi

if [ "$FAILED" -eq 0 ]; then
  echo "[smoke] OK"
  exit 0
fi
echo "[smoke] FAILED"
exit 1
