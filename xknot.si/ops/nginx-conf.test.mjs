import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 门户是纯静态站，gzip 只能在 nginx 里开：这份 conf 就是唯一的地方。
// 关掉它，154KB 的主包会按原文发给每一个访客，而且不会报任何错。

const conf = readFileSync(fileURLToPath(new URL("./xknot.si.conf", import.meta.url)), "utf8");

test("中枢门户的 nginx 打开 gzip，且只压文本类", () => {
  assert.match(conf, /^\s*gzip on;$/m);
  assert.match(conf, /^\s*gzip_vary on;$/m);
  assert.match(conf, /^\s*gzip_proxied any;$/m);
  assert.match(conf, /gzip_types[^;]*application\/javascript/);
  assert.match(conf, /gzip_types[^;]*text\/css/);
  assert.match(conf, /gzip_types[^;]*application\/json/);
  // 图片与字体已经压过，不要再走一遍。
  assert.doesNotMatch(conf, /gzip_types[^;]*image\/(jpeg|png)/);
});
