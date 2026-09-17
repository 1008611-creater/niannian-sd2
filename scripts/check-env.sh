#!/usr/bin/env bash
# check-env.sh — 校验环境变量键名完整性与文件格式
# 用法：
#   bash scripts/check-env.sh                      校验 .env.local / .env.production（按存在情况）
#   bash scripts/check-env.sh --keys-only          只报告，不因缺失退出
#   bash scripts/check-env.sh --skip-missing       缺失时以 0 退出（CI 首次接入用）
#   bash scripts/check-env.sh --file .env.production
set -uo pipefail

FILE=""
KEYS_ONLY=0
SKIP_MISSING=0

for arg in "$@"; do
  case "$arg" in
    --keys-only) KEYS_ONLY=1 ;;
    --skip-missing) SKIP_MISSING=1 ;;
    --file) shift; FILE="${1:-}" ;;
  esac
done

if [ -z "$FILE" ]; then
  for candidate in .env.local .env.production .env; do
    if [ -f "$candidate" ]; then FILE="$candidate"; break; fi
  done
fi

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "[check-env] 未找到 env 文件，跳过（CI 中属正常）"
  exit 0
fi

echo "[check-env] 目标文件：$FILE"

# 1) 格式检查：CRLF / BOM / 污染行
if head -c 3 "$FILE" | od -An -tx1 | grep -q "ef bb bf"; then
  echo "[check-env] FAIL 文件含 UTF-8 BOM"
  exit 1
fi
CR_COUNT=$(grep -c $'\r' "$FILE" || true)
if [ "${CR_COUNT:-0}" -gt 0 ]; then
  echo "[check-env] FAIL 文件含 CRLF 换行（${CR_COUNT} 行），请转为 LF"
  exit 1
fi
# 污染行：以小写乱序串开头的键（如 nnvlwyufbemejgjfPOSTGRES_DB）
DIRTY=$(grep -nE '^[a-z]{8,}[A-Z_]+=' "$FILE" || true)
if [ -n "$DIRTY" ]; then
  echo "[check-env] FAIL 发现被污染的键名行："
  echo "$DIRTY"
  exit 1
fi

# 2) 键名完整性
REQUIRED=(
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
  AUTH_SESSION_SECRET AUTH_OTP_PEPPER AUTH_COOKIE_SECURE APP_ORIGIN
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS
  ZIYU_API_KEY
  TENCENT_COS_BUCKET TENCENT_COS_REGION TENCENT_COS_SECRET_ID TENCENT_COS_SECRET_KEY
)
OPTIONAL=(
  ZIYU_BASE_URL
  MIMO_BASE_URL MIMO_USERNAME MIMO_PASSWORD MIMO_TOKEN
  MIORA_BASE_URL MIORA_CDP_URL MIORA_COOKIE MIORA_PROVIDER_SUBMIT_ENABLED
  VIDEO_SERVER_DISPATCH_URL VIDEO_SERVER_DISPATCH_TOKEN
  RUNNINGHUB_BASE_URL RUNNINGHUB_API_KEY
  NIANNIAN_GPT_API_BASE_URL NIANNIAN_GPT_API_KEY NIANNIAN_GPT55_MODEL NIANNIAN_GPT56_MODEL
  NIANNIAN_SEEDANCE_API_BASE_URL NIANNIAN_SEEDANCE_API_KEY NIANNIAN_SEEDANCE2_MODEL
  LDXP_SHOP_URL LDXP_REDEEM_SECRET
)

missing=()
for key in "${REQUIRED[@]}"; do
  if ! grep -qE "^${key}=" "$FILE"; then
    missing+=("$key")
  fi
done

echo "[check-env] 必需键 ${#REQUIRED[@]} 项，缺失 ${#missing[@]} 项"
if [ "${#missing[@]}" -gt 0 ]; then
  printf '  - %s\n' "${missing[@]}"
fi

echo "[check-env] 可选渠道键状态："
for key in "${OPTIONAL[@]}"; do
  if grep -qE "^${key}=" "$FILE"; then
    # 只报是否有值，绝不打印内容
    value_len=$(grep -E "^${key}=" "$FILE" | head -1 | cut -d= -f2- | wc -c)
    value_len=$((value_len - 1))
    if [ "$value_len" -gt 0 ]; then
      echo "  - $key: 已配置(len=$value_len)"
    else
      echo "  - $key: 空值（对应渠道不可用）"
    fi
  else
    echo "  - $key: 未设置"
  fi
done

if [ "${#missing[@]}" -gt 0 ] && [ "$SKIP_MISSING" -eq 0 ] && [ "$KEYS_ONLY" -eq 0 ]; then
  exit 1
fi
echo "[check-env] OK"
