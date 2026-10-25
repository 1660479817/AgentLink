#!/usr/bin/env bash
# 确保若干「测速员」账号与长期会话，供 bench 的压测使用。可重复执行。
#
# 用法：./ops/scripts/ensure-bench-testers.sh [数量] [前缀]
#   数量默认 20，前缀默认 bench。账号 label 与显示名都是 <前缀>-NN。
#
# 为什么单独一批账号：检索限流按「一个身份每分钟 120 次」算。压测时所有 VU
# 共用一个会话，它们其实是一个人，后一档会成片 429，看起来像「间歇错误」。
# 这批账号带 label=tester 的子类前缀，不占外部注册名额，也不参与注册统计。
#
# 会话写进 sites/<站点>/bench-testers.env（权限 600，不进版本库），每行一个
# 完整的 Cookie 头，可直接给 bench 的 --cookies-file。脚本只打印数量，不回显会话值。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

COUNT="${1:-20}"
PREFIX="${2:-bench}"
case "$COUNT" in
  '' | *[!0-9]*) echo "数量必须是正整数：$COUNT" >&2; exit 2 ;;
esac
case "$PREFIX" in
  '' | *[!A-Za-z0-9_-]*) echo "前缀只允许字母、数字、下划线和短横线：$PREFIX" >&2; exit 2 ;;
esac
[[ "$COUNT" -ge 1 && "$COUNT" -le 200 ]] || { echo "数量范围 1..200：$COUNT" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
[[ -f "$KNOT_PLATFORM_ENV" ]] || {
  echo "缺少 ${KNOT_PLATFORM_ENV}。先跑 ./ops/scripts/deploy-site.sh --site ${KNOT_SITE}。" >&2
  exit 1
}
knot_source_platform_env

PSQL="psql"
[[ -x "${KNOT_PG_BIN:-}/psql" ]] && PSQL="$KNOT_PG_BIN/psql"
command -v "$PSQL" >/dev/null 2>&1 || {
  echo "找不到 psql。装 postgresql 或把 KNOT_PG_BIN 指向它的 bin 目录。" >&2
  exit 1
}

OUT="$KNOT_SITE_DIR/bench-testers.env"
declare -a COOKIES=()

# 复用以有的会话：重复执行不会换掉正在被压测使用的身份。
if [[ -f "$OUT" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && COOKIES+=("$line")
  done < "$OUT"
fi

ensure_one() {
  local index="$1" name sid account_id
  name="$(printf '%s-%02d' "$PREFIX" "$index")"
  if [[ "${#COOKIES[@]}" -ge "$index" ]]; then
    sid="${COOKIES[$((index - 1))]#knot_sid=}"
  else
    sid="$(openssl rand -hex 24)"
  fi
  case "$sid" in
    *[!A-Za-z0-9_-]* | '') echo "会话值不合规，拒绝写入：第 $index 个" >&2; exit 1 ;;
  esac

  account_id="$("$PSQL" "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 \
    -v name="$name" -v email="${name}@knot.local" -v label="$name" <<'SQL'
INSERT INTO accounts (role, side, email, display_name, label, points_balance)
VALUES ('user', 'external', :'email', :'name', :'label', 100)
ON CONFLICT (label) WHERE label IS NOT NULL DO UPDATE SET label = EXCLUDED.label
RETURNING id;
SQL
)"
  [[ -n "$account_id" ]] || { echo "建账号失败：$name" >&2; exit 1; }

  "$PSQL" "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -v sid="$sid" -v account_id="$account_id" <<'SQL'
INSERT INTO sessions (sid, account_id, expires_at)
VALUES (:'sid', :'account_id'::uuid, now() + interval '10 years')
ON CONFLICT (sid) DO UPDATE
  SET account_id = EXCLUDED.account_id, expires_at = now() + interval '10 years';
SQL
  COOKIES[$((index - 1))]="knot_sid=$sid"
}

for i in $(seq 1 "$COUNT"); do
  ensure_one "$i"
done

umask 077
{
  for c in "${COOKIES[@]:0:$COUNT}"; do
    printf '%s\n' "$c"
  done
} > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"

echo "${COUNT} 个测速员已就绪（会话文件 ${OUT}）"
