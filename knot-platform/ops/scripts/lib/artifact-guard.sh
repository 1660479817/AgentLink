#!/usr/bin/env bash
# 发布包解包前的成员检查。
#
# 发布包是从别处拷来的 tar.gz，是外部输入。`.sha256` 只说明「这个包没被改过」，
# 说明不了「包里装的是这个目录下的文件」——自己签的一个恶意包，校验和照样对。
# 解包这一步写的是系统目录，所以先看成员名单：
#
#   1. 绝对路径            直接写到 /etc 之类的地方，绕过部署根
#   2. 任何 `..` 段        写到 STAGING 之外（`a/../../x` 这种也拦）
#   3. 链接指向包外        先落一个 symlink 再往后写，等于是跳出去写
#
# 第 3 条不能只看目标是不是以 `..` 开头：`node_modules/.bin/vite -> ../vite/bin/vite.js`
# 是这类包里的常态，它相对自己的目录解析后仍在包内。所以要按「链接所在目录 + 目标」
# 解析，看结果有没有跳出根。
#
# 只在 `verify`（校验和）之后、`tar -xzf` 之前调用。纯 bash，不依赖 node：
# push-deploy.sh 的远端那段只有 bash，没有仓库可读。
#
# 用法：
#   source "$SCRIPT_DIR/lib/artifact-guard.sh"
#   knot_check_tar_members "$ARTIFACT" || knot_fail "..."

# 把相对路径里的 `.` 与 `..` 折叠掉。跳出根时输出以 `..` 开头。
knot_normalize_rel() {
  local IFS=/
  local part
  local -a out=()
  for part in $1; do
    case "$part" in
      "" | .) continue ;;
      ..)
        if (( ${#out[@]} )); then
          unset "out[${#out[@]}-1]"
        else
          echo ".."
          return 0
        fi
        ;;
      *) out+=("$part") ;;
    esac
  done
  local joined=""
  for part in "${out[@]}"; do
    joined="${joined:+$joined/}$part"
  done
  printf '%s\n' "$joined"
}

# 打印不合格的成员并返回 1；全部合格返回 0。
knot_check_tar_members() {
  local tarball="${1:-}"
  [[ -f "$tarball" ]] || {
    echo "找不到发布包：${tarball}" >&2
    return 1
  }

  local names details
  names="$(tar -tzf "$tarball" 2>/dev/null)" || {
    echo "读不出发布包成员：${tarball}" >&2
    return 1
  }
  details="$(tar -tvzf "$tarball" 2>/dev/null)" || {
    echo "读不出发布包成员：${tarball}" >&2
    return 1
  }
  [[ -n "$names" ]] || {
    echo "发布包是空的：${tarball}" >&2
    return 1
  }

  # 名字清单与详细清单是同一次读取的两个视图，顺序一致，按行号对齐。
  # 名称里可能有空格，所以 read -r 读整行，不做字段拆分。
  local -a name_list=() detail_list=()
  local line
  while IFS= read -r line; do
    name_list+=("$line")
  done <<< "$names"
  while IFS= read -r line; do
    detail_list+=("$line")
  done <<< "$details"

  local bad=0
  local name type target base resolved
  local i=0
  while (( i < ${#name_list[@]} )); do
    name="${name_list[$i]}"
    line="${detail_list[$i]:-}"
    i=$((i + 1))
    [[ -n "$name" ]] || continue

    case "$name" in
      /*)
        echo "  不合格：绝对路径 ${name}" >&2
        bad=1
        continue
        ;;
    esac
    case "/$name/" in
      */../*)
        echo "  不合格：含 .. 段 ${name}" >&2
        bad=1
        continue
        ;;
    esac

    # 链接：详细清单的第一列以 l（symlink）或 h（hardlink）开头。
    # bsdtar 与 GNU tar 的写法不同：symlink 是 `name -> target`，
    # hardlink 是 `name link to target`。
    case "$line" in
      l* | h*) ;;
      *) continue ;;
    esac
    case "$line" in
      *" -> "*) target="${line##* -> }" ;;
      *" link to "*) target="${line##* link to }" ;;
      *) target="" ;;
    esac
    if [[ -z "$target" ]]; then
      # 没有可读目标的链接行按不合格处理：宁可让人看一眼，也别默认它安全。
      echo "  不合格：链接没有可读目标 ${name}" >&2
      bad=1
      continue
    fi
    case "$target" in
      /*)
        echo "  不合格：链接指向绝对路径 ${name} -> ${target}" >&2
        bad=1
        continue
        ;;
    esac
    # 硬链接的目标在包里是根相对的；符号链接相对自己所在的目录。
    case "$line" in
      l*)
        base="${name%/*}"
        [[ "$base" == "$name" ]] && base=""
        resolved="$(knot_normalize_rel "${base:+$base/}$target")"
        ;;
      *) resolved="$(knot_normalize_rel "$target")" ;;
    esac
    case "$resolved" in
      .. | ../*)
        echo "  不合格：链接指向包外 ${name} -> ${target}" >&2
        bad=1
        ;;
    esac
  done

  return "$bad"
}
