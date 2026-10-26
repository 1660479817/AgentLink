// 「这个文件是被直接跑的，还是被 import 的？」
//
// 部署机上的入口一律从 <部署根>/current 调用，而 node 解析 import.meta.url 时
// 已经把那条软链解开；`path.resolve(process.argv[1])` 保留的是调用方写的字符串。
// 两者直接按字符串比不会报错，只会让脚本整段跳过、退出 0：日志空白，构建照样打印
// done，只是 knot-help、快照、robots 全都没生成。构建目录本身带软链时也一样
// （/tmp 在 macOS 上就是 /private/tmp 的软链）。
//
// 所以一律比真实路径，并且只在两边都解得开时才认。

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function invokedDirectly(importMetaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
