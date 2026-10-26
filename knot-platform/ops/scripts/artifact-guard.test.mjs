import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

// 发布包是外部输入：校验和只能证明「这个包没被改过」，证明不了「包里的路径没往外走」。
// 这里手搓 tar 头来造包——不需要额外依赖，也能精确造出 `..`、绝对路径、外指链接
// 这几种「正常打包工具不肯生成、但解包方不得不防」的成员。

const GUARD = path.join(import.meta.dirname, "lib", "artifact-guard.sh");

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header({ name, type = "0", linkname = "", size = 0 }) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  block.write(octal(0o644, 8), 100, 8, "latin1");
  block.write(octal(0, 8), 108, 8, "latin1");
  block.write(octal(0, 8), 116, 8, "latin1");
  block.write(octal(size, 12), 124, 12, "latin1");
  block.write(octal(0, 12), 136, 12, "latin1");
  block.write("        ", 148, 8, "latin1");
  block.write(type, 156, 1, "latin1");
  block.write(linkname, 157, 100, "utf8");
  block.write("ustar\0", 257, 6, "latin1");
  block.write("00", 263, 2, "latin1");
  block.write("root", 265, 32, "utf8");
  block.write("root", 297, 32, "utf8");
  block.write(octal(0, 8), 329, 8, "latin1");
  block.write(octal(0, 8), 337, 8, "latin1");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "latin1");
  return block;
}

function body(text) {
  if (!text) return Buffer.alloc(0);
  const data = Buffer.from(text, "utf8");
  const pad = 512 - (data.length % 512 || 512);
  return Buffer.concat([data, Buffer.alloc(pad)]);
}

function tarball(entries) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-guard-"));
  const parts = [];
  for (const entry of entries) {
    const data = body(entry.content);
    // 没写 type 时：目录名以 / 结尾用 "5"，其余当普通文件 "0"（旧写法 type==="0" 才算 size，
    // 未写 type 的文件会变成 size=0，GNU tar 读完会非零退出）。
    const type = entry.type ?? (entry.name.endsWith("/") ? "5" : "0");
    const size = type === "0" ? data.length : 0;
    parts.push(header({ ...entry, type, size }), data);
  }
  parts.push(Buffer.alloc(1024));
  const file = path.join(dir, "pkg.tar.gz");
  writeFileSync(file, gzipSync(Buffer.concat(parts)));
  return file;
}

function check(file) {
  const result = spawnSync("bash", ["-c", `source "${GUARD}"; knot_check_tar_members "$1"`, "bash", file], {
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

test("普通的发布包通过：目录、文件、包内相对链接", () => {
  const file = tarball([
    { name: "knot-0.4.0/" },
    { name: "knot-0.4.0/BUILD.json", content: '{"version":"0.4.0"}' },
    { name: "knot-0.4.0/node_modules/.bin/vite", type: "2", linkname: "../vite/bin/vite.js" },
    { name: "knot-0.4.0/node_modules/vite/bin/vite.js", content: "#!/usr/bin/env node\n" },
  ]);
  const { code, out } = check(file);
  assert.equal(code, 0, out);
});

test("成员路径里有 .. 就拒绝", () => {
  const file = tarball([
    { name: "knot-0.4.0/" },
    { name: "knot-0.4.0/../../etc/cron.d/knot", content: "* * * * * root id\n" },
  ]);
  const { code, out } = check(file);
  assert.equal(code, 1, out);
  assert.match(out, /\.\./);
});

test("绝对路径的成员被拒绝", () => {
  const file = tarball([{ name: "/etc/cron.d/knot", content: "x" }]);
  const { code, out } = check(file);
  assert.equal(code, 1, out);
  assert.match(out, /绝对路径/);
});

test("指向包外的链接被拒绝", () => {
  const file = tarball([
    { name: "knot-0.4.0/" },
    { name: "knot-0.4.0/escape", type: "2", linkname: "../../etc" },
  ]);
  const { code, out } = check(file);
  assert.equal(code, 1, out);
  assert.match(out, /链接指向包外/);
});

test("空包按失败处理，不当作「没什么好解」放过", () => {
  const file = tarball([]);
  const { code, out } = check(file);
  assert.equal(code, 1, out);
  assert.match(out, /空/);
});
