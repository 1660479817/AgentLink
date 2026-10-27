#!/usr/bin/env bash
# 经 ssh 传位置参数：每个值先自己带一层引号。
#
# ssh 只用空格把 argv 拼成一条命令串（不加引号），远端 shell 再重新拆词。
# 于是两件事都会让后面的 $N 逐位错开：
#   * 空串整个消失——`bash -s -- a "" b` 到远端只剩两个参数，$3 变成 b；
#   * 带空格的值被拆成两个——`/Users/my dir` 变成 $1=/Users/my、$2=dir。
#
# 远程部署踩过前一条：没带 --runtime 时的空串消失，`--bootstrap` 前移一个槽位，
# 被 deploy-site.sh 当成 `--runtime 1` 读掉，看起来像「bootstrap 开关没生效」。
#
# 这里给每个值加单引号，值里的单引号用 '"'"' 断开再续上（`it's` → `'it'"'"'s'`），
# 远端拆词后仍是一个参数，空串也还是一个（空的）参数。直接用 knot_shq 的输出做
# ssh 的位置参数即可：
#   remote=(); for v in "$a" "$b"; do remote+=("$(knot_shq "$v")"); done
knot_shq() {
  local quoted
  # 赋值右侧刻意不加双引号：双引号里的 \' 会原样留下反斜杠，替换串就多出一层
  # 转义（值里带单引号时到远端变成 it\'\'\'s）。赋值不受分词与通配影响，是安全的。
  quoted=${1:-}
  quoted=${quoted//\'/\'\"\'\"\'}
  printf "'%s'" "$quoted"
}
