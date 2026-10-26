// 入口静态根的安装与裁剪。
//
// 2026-10-26 的现场结论：微信能打开，是因为 legacy 包真的能解析了。但同一台入口主机上
// 每次发布都是 `rsync --delete`，上一版的 /assets 会被清空——任何还攥着旧 HTML 的地方
// （X5 离线缓存、没关的老标签页、中间代理）都会去取一批已经不存在的文件名。
// 那种情况下按「重新加载」也没用，它拿回来的还是同一份旧 HTML。
//
// 这里用真的 rsync 与真的文件跑：protect 规则是不是真的挡住了删除、
// 裁剪是不是真的保住了当前首页引用的文件，只有跑一遍才知道。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("./lib/entry-assets.sh", import.meta.url));

// KNOT_SUDO 置空：测试里的目录归当前用户，函数就按当前用户跑。
function run(script) {
  return execFileSync(
    "bash",
    ["-c", `set -euo pipefail; source "$1"; KNOT_SUDO=""; ${script}`, "_", LIB],
    { encoding: "utf8" }
  );
}

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "knot-entry-assets-"));
  const src = path.join(root, "stage", "web");
  const dst = path.join(root, "www");
  mkdirSync(path.join(src, "assets"), { recursive: true });
  mkdirSync(path.join(dst, "assets"), { recursive: true });
  return { root, src, dst };
}

const at = (file, content = "x") => writeFileSync(file, content);
const daysAgo = (file, days) => {
  const stamp = new Date(Date.now() - days * 86_400_000);
  const pad = (n) => String(n).padStart(2, "0");
  const value =
    `${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}` +
    `${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}`;
  // touch -t 按本地时区解释，留出一天的余量，断言只看「远超保留期」的文件。
  execFileSync("touch", ["-t", value, file]);
};

test("entry-assets: an old chunk survives a publish that no longer builds it", () => {
  const { src, dst } = workspace();
  at(path.join(dst, "assets", "index-legacy-OLD.js"), "old build");
  at(path.join(dst, "index.html"), "<script src=/assets/index-legacy-OLD.js></script>");
  at(path.join(dst, "stale.txt"), "left over");
  at(path.join(src, "assets", "index-legacy-NEW.js"), "new build");
  at(path.join(src, "index.html"), "<script src=/assets/index-legacy-NEW.js></script>");

  run(`knot_install_static "${src}" "${dst}"`);

  // 旧 HTML 引用的那一份还在：缓存里的页面照样能跑起来。
  assert.ok(existsSync(path.join(dst, "assets", "index-legacy-OLD.js")));
  assert.ok(existsSync(path.join(dst, "assets", "index-legacy-NEW.js")));
  // 首页换成了新的，其它顶层文件照旧被 --delete 清掉。
  assert.match(readFileSync(path.join(dst, "index.html"), "utf8"), /index-legacy-NEW/);
  assert.equal(existsSync(path.join(dst, "stale.txt")), false);
});

test("entry-assets: a rebuilt file with the same name is updated, not kept old", () => {
  const { src, dst } = workspace();
  at(path.join(dst, "assets", "index-abc.js"), "v1");
  at(path.join(src, "assets", "index-abc.js"), "v2-different-length");
  at(path.join(src, "index.html"), "<script src=/assets/index-abc.js></script>");

  run(`knot_install_static "${src}" "${dst}"`);
  assert.equal(readFileSync(path.join(dst, "assets", "index-abc.js"), "utf8"), "v2-different-length");
});

test("entry-assets: pruning drops expired chunks but keeps what the page still uses", () => {
  const { dst } = workspace();
  at(path.join(dst, "assets", "index-abc.js"), "current");
  at(path.join(dst, "assets", "old-gone.js"), "expired");
  at(path.join(dst, "assets", "fresh-unreferenced.js"), "recent");
  at(path.join(dst, "index.html"), '<script src="/assets/index-abc.js"></script>');
  daysAgo(path.join(dst, "assets", "old-gone.js"), 30);
  // 时钟偏一点也可能把「当前那一版」算成过期；引用即保留，不受 mtime 影响。
  daysAgo(path.join(dst, "assets", "index-abc.js"), 30);

  run(`knot_prune_assets "${dst}" 7`);

  assert.ok(existsSync(path.join(dst, "assets", "index-abc.js")), "当前首页引用的文件被删了");
  assert.equal(existsSync(path.join(dst, "assets", "old-gone.js")), false);
  assert.ok(existsSync(path.join(dst, "assets", "fresh-unreferenced.js")));
});

test("entry-assets: a keep window of 0 or a bad value deletes nothing", () => {
  for (const keep of ["0", "", "abc"]) {
    const { dst } = workspace();
    at(path.join(dst, "assets", "old-gone.js"), "expired");
    at(path.join(dst, "index.html"), "<html></html>");
    daysAgo(path.join(dst, "assets", "old-gone.js"), 30);

    run(`knot_prune_assets "${dst}" "${keep}"`);
    assert.ok(existsSync(path.join(dst, "assets", "old-gone.js")), `keep=${JSON.stringify(keep)} 时删了文件`);
  }
});

test("entry-assets: pruning a root without assets is a no-op", () => {
  const { dst } = workspace();
  execFileSync("rm", ["-rf", path.join(dst, "assets")]);
  assert.doesNotThrow(() => run(`knot_prune_assets "${dst}" 7`));
});

test("entry-assets: the default window is used when no argument is given", () => {
  const { dst } = workspace();
  // 默认 7 天：8 天前的删掉，3 天前的留着。
  at(path.join(dst, "assets", "week-ago.js"), "expired");
  at(path.join(dst, "assets", "recent.js"), "recent");
  at(path.join(dst, "index.html"), "<html></html>");
  daysAgo(path.join(dst, "assets", "week-ago.js"), 8);
  daysAgo(path.join(dst, "assets", "recent.js"), 3);

  run(`knot_prune_assets "${dst}"`);
  assert.equal(existsSync(path.join(dst, "assets", "week-ago.js")), false);
  assert.ok(existsSync(path.join(dst, "assets", "recent.js")));
});
