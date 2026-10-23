// 内部包的版本引用必须和本地包一致。
//
// @knot/* 是私有包，装的是 workspace 链接；依赖里写的是精确版本（`0.4.0`/`0.1.0`），
// 不是范围。抬了本地包却忘了改引用时，npm 不会回落到 workspace，而是去 registry
// 找那个不存在的版本，`npm ci` 直接 404（S06-05）。这条断言让失配在测试里就暴露。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function manifest(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** workspaces 里的目录：只认 `packages/*` 这种一层通配与本目录两种写法。 */
function workspaceDirs() {
  const dirs = [];
  for (const pattern of manifest(path.join(root, "package.json")).workspaces || []) {
    if (!pattern.includes("*")) {
      dirs.push(path.join(root, pattern));
      continue;
    }
    const base = path.join(root, path.dirname(pattern));
    for (const name of fs.readdirSync(base)) {
      const full = path.join(base, name);
      if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "package.json"))) dirs.push(full);
    }
  }
  return dirs;
}

test("every @knot/* dependency matches the version of the local package", () => {
  const dirs = workspaceDirs();
  assert.ok(dirs.length >= 7, `只找到 ${dirs.length} 个 workspace，目录结构可能变了`);
  const local = new Map();
  for (const dir of dirs) {
    const pkg = manifest(path.join(dir, "package.json"));
    if (pkg.name) local.set(pkg.name, pkg.version);
  }

  const problems = [];
  for (const dir of dirs) {
    const pkg = manifest(path.join(dir, "package.json"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] || {})) {
        if (!name.startsWith("@knot/")) continue;
        const expected = local.get(name);
        if (!expected) {
          problems.push(`${pkg.name || dir}: ${name} 不在本仓 workspace 里`);
          continue;
        }
        if (range !== expected) {
          problems.push(`${pkg.name || dir}: ${name}@${range}，本地是 ${expected}`);
        }
      }
    }
  }
  assert.deepEqual(problems, [], "内部包引用与本地版本不一致，npm ci 会去 registry 找不存在的版本");
});
