#!/usr/bin/env bash
# 入口静态根的安装与裁剪。
#
# 为什么不能每次发布都删光上一版的 /assets：
#
# index.html 是 no-store，正常情况下没人会拿着旧 HTML。但 WebView 的离线缓存层、
# 没关的老标签页、中间代理都可能攥着一份旧 HTML，它引用的 chunk 名在新一版里已经
# 不存在。默认的 `rsync --delete` 会把那些文件删掉，那个页面再去取就是 404，
# 白屏，而且按「重新加载」也救不了——拿回来的还是同一份旧 HTML。
#
# 所以安装用 rsync 的 protect 规则：`--delete` 照旧清掉不该留的东西，
# 但 /assets 下已在磁盘上的文件不删。之后按时间裁掉超过保留期的那些，
# 并且当前 index.html 还在引用的文件一律不删（防开发机与入口的时钟不一致）。
#
# 变量：
#   KNOT_SUDO                提权命令，默认 sudo；设成空字符串表示不需要提权（测试用）。
#   KNOT_ENTRY_ASSET_KEEP_DAYS  保留天数，默认 7；0 或非数字表示不裁剪。
#
# 用法（在入口主机上）：
#   . "$stage/entry-assets.sh"
#   knot_install_static "$stage/web" "$web_root"
#   knot_prune_assets "$web_root"

# 默认 7 天：一次发布约 3.5MB，七天不到 25MB，相对 2g 的缓存区可以忽略；
# 而微信这类 WebView 的缓存寿命通常以天计，一周足够覆盖。
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
# 把一份构建产物装进静态根：index.html 与其它顶层文件整体替换，
# /assets 下已经存在的文件保留（新文件照常写入，同名文件照常更新）。
knot_install_static() {
  local src="$1"
  local web_root="$2"
  [[ -d "$src" ]] || { echo "没有可安装的构建产物：$src" >&2; return 1; }
  [[ -n "$web_root" ]] || { echo "静态根为空" >&2; return 1; }

  knot_elevate mkdir -p "$web_root"
  # --exclude 默认也保护接收端的同名文件，所以 .well-known、快照与媒体目录不会被删。
  # protect 规则只挡删除，不挡写入：新一版里同名但内容不同的文件仍会被替换。
  #
  # -c（按内容校验）不能省：rsync 默认按「大小 + mtime」判断是否需要传输，
  # 而构建产物的 mtime 常常落在同一秒——两份长度相同的 index.html 会被当成没变，
  # 装上去的还是旧首页。旧首页引用的是新一版不存在的 chunk 名，等于白屏。
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
  # 空、0、非数字都表示不裁剪：宁可多留几个文件，也不要在参数写错时删掉别人的页面。
  case "$keep" in ''|*[!0-9]*) return 0 ;; esac
  [[ "$keep" -gt 0 ]] || return 0

  # 当前首页还引用的文件名。时钟偏了、mtime 被保留过、或者同一份产物又发了一次，
  # 都可能让「应该留着的文件」看上去很旧；这一条把它们无条件保住。
  local -a guards=()
  local name
  if [[ -f "$web_root/index.html" ]]; then
    while IFS= read -r name; do
      [[ -n "$name" ]] && guards+=('!' -name "$name")
    done < <(grep -oE 'assets/[A-Za-z0-9._-]+\.(js|css)' "$web_root/index.html" 2>/dev/null |
      sed 's#^assets/##' | sort -u)
  fi

  local -a expired=()
  if [[ ${#guards[@]} -gt 0 ]]; then
    while IFS= read -r name; do
      [[ -n "$name" ]] && expired+=("$name")
    done < <(find "$dir" -type f -mtime +"$keep" "${guards[@]}" -print 2>/dev/null)
  else
    while IFS= read -r name; do
      [[ -n "$name" ]] && expired+=("$name")
    done < <(find "$dir" -type f -mtime +"$keep" -print 2>/dev/null)
  fi

  [[ ${#expired[@]} -gt 0 ]] || return 0
  knot_elevate rm -f "${expired[@]}"
  echo "    清理过期静态文件 ${#expired[@]} 个（保留 ${keep} 天）"
}
