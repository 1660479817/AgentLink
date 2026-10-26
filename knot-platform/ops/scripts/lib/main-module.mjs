// 「这个文件是被直接执行，还是被别处 import」的判断。
//
// 必须比真实路径，不能比字符串。部署机上所有入口都从 <部署根>/current 这个软链调用，
// 而 node 解析 import.meta.url 时已经把软链解成 releases/<版本>/…；两边一比就不相等，
// 脚本于是整段跳过、退出码还是 0——日志一片空白，看上去像「跑了但没事」。
// macOS 的 /var → /private/var 也是同一类失配。
//
// 调用方把自己的 import.meta.url 传进来：这个模块自己的 URL 在这里没有意义。
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function invokedDirectly(importMetaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
