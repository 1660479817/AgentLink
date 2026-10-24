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
  // Agent 指引的原文走 text/markdown，不列进来就一点不压。
  assert.match(conf, /gzip_types[^;]*text\/markdown/);
  // 图片与字体已经压过，不要再走一遍。
  assert.doesNotMatch(conf, /gzip_types[^;]*image\/(jpeg|png)/);
});

test("Agent 指引有两条静态地址：HTML 给浏览器，原文给 Agent", () => {
  // 两个都是磁盘上的文件，不能回源、不能落到 SPA 的 location /。
  assert.match(conf, /location = \/knot-help \{\s*try_files \/knot-help\.html =404;/);
  assert.match(conf, /location = \/knot-help\.md \{\s*default_type text\/markdown;/);
  // 文档会随实例策略改，别让它按一年缓存住。
  assert.doesNotMatch(conf, /location = \/knot-help[^}]*immutable/s);
});

