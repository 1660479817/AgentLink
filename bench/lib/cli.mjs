// 命令行取值。只给 bench 的 node 脚本用，k6 场景脚本不 import 这里。
//
// 四份脚本原本各写一份 arg：有的把空值当缺省、有的原样返回 undefined，
// 于是 `--duration` 少写一个值时会静默用默认时长跑一轮，数字看起来没问题。
// 这里统一成「写了一半就报错」，宁可停下，也不拿默认值顶替。

export function flag(name) {
  return process.argv.includes(`--${name}`);
}

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    console.error(`--${name} 后面要跟一个值（当前：${value === undefined ? "行尾" : `"${value}"`}）`);
    process.exit(2);
  }
  return value;
}
