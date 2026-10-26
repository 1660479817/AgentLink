#!/usr/bin/env bash
# 入口静态根的安装与裁剪。
#
# index.html 是 no-store，但它之外还有缓存：WebView 的离线层、没关的标签页、
# 中间代理都可能留着旧 HTML，引用的 chunk 名在新一版里已经不存在。
# 默认的 `rsync --delete` 会删掉那些文件，旧页面从此取不到自己那一版。
#
# 所以安装用 rsync 的 protect 规则保住 /assets 下已有的文件，之后按时间裁剪，
# 当前 index.html 仍引用的一律保留。
#
# 变量：
#   KNOT_SUDO                   提权命令，默认 sudo；空字符串表示不提权（测试用）。
#   KNOT_ENTRY_ASSET_KEEP_DAYS  保留天数，默认 7；0 或非数字表示不裁剪。
#
# 用法（在入口主机上）：
#   . "$stage/entry-assets.sh"
#   knot_install_static "$stage/web" "$web_root"
#   knot_prune_assets "$web_root"

# 一次发布约 3.5MB；WebView 的缓存寿命通常以天计，一周足够覆盖。
KNOT_ENTRY_ASSET_KEEP_DAYS=7

# 提权前缀。测试里把它设成空串，函数就按当前用户跑。
knot_elevate() {
  if [[ -n "${KNOT_SUDO-sudo}" ]]; then
    "${KNOT_SUDO-sudo}" "$@"
  else
    "$@"
  fi
}

# knot_install_static <源目录> <静态根>
# 顶层文件整体替换；/assets 下已存在的文件保留，新增与同名的照常写入。
knot_install_static() {
  local src="$1"
  local web_root="$2"
  [[ -d "$src" ]] || { echo "没有可安装的构建产物：$src" >&2; return 1; }
  [[ -n "$web_root" ]] || { echo "静态根为空" >&2; return 1; }

  knot_elevate mkdir -p "$web_root"
  # --exclude 默认也保护接收端的同名文件，所以 .well-known、快照与媒体目录不会被删。
  # protect 只挡删除，不挡写入。
  #
  # -c 不能省：默认按「大小 + mtime」判断是否传输，而构建产物的 mtime 常常同一秒，
  # 长度相同的两份 index.html 会被当成没变，装上去的还是旧首页。
  knot_elevate rsync -a -c --delete \
    --exclude .well-known \
    --exclude /discover.json \
    --exclude /media/ \
    --filter='protect /assets/***' \
    "$src/" "$web_root/"
}

# knot_prune_assets <静态根> [保留天数]
# 删掉 /assets 下超过保留期、且当前 index.html 不再引用的文件。
knot_prune_assets() {
  local web_root="$1"
  local keep="${2-$KNOT_ENTRY_ASSET_KEEP_DAYS}"
  local dir="$web_root/assets"
  [[ -d "$dir" ]] || return 0
  # 空、0、非数字都不裁剪：参数写错时宁可多留文件，也不能删掉别人的页面。
  case "$keep" in ''|*[!0-9]*) return 0 ;; esac
  [[ "$keep" -gt 0 ]] || return 0

  # 首页引用的文件名无条件保住：时钟偏差、mtime 被保留、同一份产物重复发布，
  # 都会让在用的文件看上去很旧。
  local -a guards=()
  local name
  if [[ -f "$web_root/index.html" ]]; then
    while IFS= read -r name; do
      [[ -n "$name" ]] && guards+=('!' -name "$name")
    done < <(grep -oE 'assets/[A-Za-z0-9._-]+\.(js|css)' "$web_root/index.html" 2>/dev/null |
      sed 's#^assets/##' | sort -u)
  fi

  local -a expired=()
  # ${arr[@]+…} 而不是 "${arr[@]}"：bash 3.2 在 set -u 下会把空数组当成未定义变量。
  while IFS= read -r name; do
    [[ -n "$name" ]] && expired+=("$name")
  done < <(find "$dir" -type f -mtime +"$keep" ${guards[@]+"${guards[@]}"} -print 2>/dev/null)

  [[ ${#expired[@]} -gt 0 ]] || return 0
  knot_elevate rm -f "${expired[@]}"
  echo "    清理过期静态文件 ${#expired[@]} 个（保留 ${keep} 天）"
}
