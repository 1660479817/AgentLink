#!/usr/bin/env bash
# 量一组地址的访问速度，给「部署完了，到底快不快」一个可重复的数字。
#
# 用法：
#   ./ops/scripts/speed-check.sh https://wang.xknot.si/ https://wang.xknot.si/api/health
#   ./ops/scripts/speed-check.sh --runs 9 http://192.168.3.91:8080/
#
# 每一项都打 N 次，去掉第一次（TLS 握手、DNS、连接复用还没建立），取中位数。
# 输出两列时间：
#   ttfb   从发出请求到收到第一个字节。含 DNS、连接、TLS、后端处理，是「点了多久有反应」。
#   total  从发出请求到收完。对首页相当于多了下载 index.html 和解析前的时间；
#          /api/health 这种小响应 ttfb 与 total 基本相等。
#
# 走不走系统代理由 --proxy 决定，默认不走（--noproxy '*'），免得本机代理把数字算进去。
set -euo pipefail

RUNS=5
USE_PROXY=0
URLS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runs)
      [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || { echo "--runs 后面要跟次数" >&2; exit 2; }
      RUNS="$2"
      shift 2
      ;;
    --proxy)
      USE_PROXY=1
      shift
      ;;
    -h | --help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      URLS+=("$1")
      shift
      ;;
  esac
done

[[ ${#URLS[@]} -gt 0 ]] || { echo "至少给一个地址。用法见 --help。" >&2; exit 2; }
(( RUNS >= 2 )) || { echo "--runs 至少 2，否则去不掉第一次。" >&2; exit 2; }

PROXY_OPT=(--noproxy '*')
[[ "$USE_PROXY" == 1 ]] && PROXY_OPT=()

# 中位数：排序后取中间那个。偶数的取下半，不做插值——测的是「平常多少」，不是平均值。
median() {
  sort -n | awk '{ a[NR] = $1 } END { if (NR == 0) { print "-"; exit } print a[int((NR + 1) / 2)] }'
}

printf '%-46s %4s %9s %9s %10s\n' "地址" "码" "ttfb(s)" "total(s)" "bytes"
printf '%s\n' "----------------------------------------------------------------------------------------"

FAILED=0
for url in "${URLS[@]}"; do
  ttfb=""
  total=""
  code=""
  bytes=""
  ok=1
  for _ in $(seq 1 "$RUNS"); do
    if ! out="$(curl -s -o /dev/null -m 30 "${PROXY_OPT[@]}" \
      -w '%{http_code} %{time_starttransfer} %{time_total} %{size_download}' "$url" 2>/dev/null)"; then
      ok=0
      continue
    fi
    read -r code ttfb_one total_one bytes <<<"$out"
    ttfb="${ttfb}${ttfb_one}"$'\n'
    total="${total}${total_one}"$'\n'
  done

  if [[ "$ok" != 1 || -z "$ttfb" ]]; then
    printf '%-46s %4s %9s %9s %10s\n' "$url" "ERR" "-" "-" "-"
    FAILED=1
    continue
  fi

  # 丢掉第一行（第一次请求）。
  ttfb_med="$(printf '%s' "$ttfb" | tail -n +2 | median)"
  total_med="$(printf '%s' "$total" | tail -n +2 | median)"
  printf '%-46s %4s %9s %9s %10s\n' "$url" "$code" "$ttfb_med" "$total_med" "$bytes"
done

echo
if [[ "$USE_PROXY" == 1 ]]; then
  echo "每个地址 ${RUNS} 次，取中位数，已去掉第一次。走系统代理。"
else
  echo "每个地址 ${RUNS} 次，取中位数，已去掉第一次。不走代理。"
fi
exit "$FAILED"
