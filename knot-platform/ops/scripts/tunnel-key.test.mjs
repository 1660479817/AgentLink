// 隧道私钥路径的解析：托管段只写文件名，绝对不能是绝对路径。
//
// 这一条是 2026-10-23 那次 cpswang 入口 502 的回归测试：托管段里存了当时
// Backend 所在目录的绝对路径，那份目录被清理后私钥跟着消失，隧道一直认证失败，
// 而实例自己的 /api/health 一直是 200。
//
// 用真的 bash 跑 site-config.sh：解析逻辑在 shell 里，用 JS 复刻一遍测不出问题。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("./lib/site-config.sh", import.meta.url));

function makeSite() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "knot-site-")));
  writeFileSync(
    path.join(dir, "site.env"),
    'KNOT_PUBLIC_ORIGIN="http://127.0.0.1:8099"\nKNOT_PORT=8099\n',
    { mode: 0o600 },
  );
  return dir;
}

function resolveKey(siteDir, value) {
  const script = 'source "$1"; KNOT_TUNNEL_KEY="$2"; knot_tunnel_key_path';
  return execFileSync("bash", ["-c", script, "_", LIB, value], {
    env: {
      ...process.env,
      HOME: "/home/tester",
      KNOT_SITE_FILE: path.join(siteDir, "site.env"),
      KNOT_TUNNEL_KEY: value,
    },
    encoding: "utf8",
  }).trim();
}

test("tunnel key: a bare file name resolves inside the site dir", () => {
  const site = makeSite();
  assert.equal(resolveKey(site, "tunnel_ed25519"), path.join(site, "tunnel_ed25519"));
});

test("tunnel key: empty means the managed default, still inside the site dir", () => {
  const site = makeSite();
  assert.equal(resolveKey(site, ""), path.join(site, "tunnel_ed25519"));
});

test("tunnel key: an absolute path is honored as-is", () => {
  const site = makeSite();
  assert.equal(resolveKey(site, "/Users/me/.ssh/knot-entry"), "/Users/me/.ssh/knot-entry");
});

test("tunnel key: ~ expands against the running user's home", () => {
  const site = makeSite();
  assert.equal(resolveKey(site, "~/k/entry"), "/home/tester/k/entry");
});

test("tunnel key: a relative name never escapes the site dir implicitly", () => {
  // 相对路径一律拼在站点目录后：换部署根、换机器、整份复制站点目录，
  // 读的都是同一份位置关系，不会指到「写配置时那台机器」的别处去。
  const site = makeSite();
  const resolved = resolveKey(site, "keys/tunnel_ed25519");
  assert.equal(resolved, path.join(site, "keys/tunnel_ed25519"));
  assert.ok(resolved.startsWith(`${site}${path.sep}`));
});
