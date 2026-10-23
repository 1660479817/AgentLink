import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 入口的静态根与 nginx conf 落到同一个值上，第二个子域推上去就会把第一个的页面
// 和配置换掉（rsync --delete + cp 都以 root 跑）。site-config.sh 里的校验是唯一
// 拦得住这一层的地方，所以单独拿出来跑：函数收的是「已经解析过默认值」的两个路径，
// 默认值本身必须被拒，不能只看空字符串。
const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib", "site-config.sh");

const HELPER = `
set -euo pipefail
source "$1"
knot_require_entry_paths "$2" "$3" probe.xknot.si
echo OK
`;

function siteFile() {
  const root = mkdtempSync(path.join(tmpdir(), "knot-entry-paths-"));
  const file = path.join(root, "site.env");
  writeFileSync(file, "KNOT_SITE=probe\n");
  return file;
}

function check(webRoot, conf) {
  const result = spawnSync("bash", ["-c", HELPER, "bash", LIB, webRoot, conf], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, KNOT_SITE_FILE: siteFile() },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("每个子域自己的静态根与 conf 通过", () => {
  const { status, output } = check("/var/www/probe", "/etc/nginx/conf.d/probe.xknot.si.conf");
  assert.equal(status, 0);
  assert.match(output, /OK/);
});

test("共用缺省值被拒：两个子域会互相覆盖", () => {
  const webRoot = check("/var/www/knot", "/etc/nginx/conf.d/probe.xknot.si.conf");
  assert.notEqual(webRoot.status, 0);
  assert.match(webRoot.output, /KNOT_ENTRY_WEB_ROOT 还是共用的缺省值/);

  const conf = check("/var/www/probe", "/etc/nginx/conf.d/knot.conf");
  assert.notEqual(conf.status, 0);
  assert.match(conf.output, /KNOT_ENTRY_CONF 还是共用的缺省值/);
});

test("留空与相对路径也被拒", () => {
  const empty = check("", "/etc/nginx/conf.d/probe.xknot.si.conf");
  assert.notEqual(empty.status, 0);
  assert.match(empty.output, /KNOT_ENTRY_WEB_ROOT 是空的/);

  const relative = check("/var/www/probe", "conf.d/probe.conf");
  assert.notEqual(relative.status, 0);
  assert.match(relative.output, /必须是绝对路径/);
});
