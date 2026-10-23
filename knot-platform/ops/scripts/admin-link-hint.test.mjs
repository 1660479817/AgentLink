// 管理后台链接的部署期提醒。
//
// 2026-10-23 的一次实际故障：cpswang 在域名上、另一个设备打开 /mine 点「进入管理后台」，
// 拿到的链接是 http://127.0.0.1:8081/admin/#t=…——在那台设备上连的是它自己。
// 部署是「成功」的，探活也全绿，因为链接本来就只在实例那台机器上成立。
//
// 判断在 shell 里（Backend 的地址由 adminHosts.js 现算，这里只复述后果），
// 所以用真的 bash 跑 site-config.sh，用 JS 复刻一遍测不出问题。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("./lib/site-config.sh", import.meta.url));

// site.env 由函数参数拼出来：提醒只看公开地址、绑定地址与端口这三项。
function makeSite(lines) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "knot-hint-")));
  writeFileSync(path.join(dir, "site.env"), `${lines.join("\n")}\n`, { mode: 0o600 });
  return dir;
}

function hint(siteDir) {
  const script = 'source "$1"; knot_admin_link_hint';
  return execFileSync("bash", ["-c", script, "_", LIB], {
    env: { ...process.env, KNOT_SITE_FILE: path.join(siteDir, "site.env") },
    encoding: "utf8",
  }).trim();
}

test("域名 + 只绑回环：提醒链接会在别的设备上打不开", () => {
  const site = makeSite([
    "KNOT_PUBLIC_ORIGIN=https://cpswang.xknot.si",
    "KNOT_PORT=8081",
    "KNOT_BIND_HOST=127.0.0.1",
  ]);
  const text = hint(site);
  assert.match(text, /cpswang\.xknot\.si/);
  assert.match(text, /127\.0\.0\.1:8081\/admin\//);
  assert.match(text, /KNOT_BIND_HOST 设成 0\.0\.0\.0/);
});

test("域名 + 绑通配地址：地址由网卡枚举，不提这条", () => {
  const site = makeSite([
    "KNOT_PUBLIC_ORIGIN=https://cpswang.xknot.si",
    "KNOT_PORT=8081",
    "KNOT_BIND_HOST=0.0.0.0",
  ]);
  assert.equal(hint(site), "");
});

test("域名 + 绑一个具体内网地址：链接就是这个地址，不提这条", () => {
  const site = makeSite([
    "KNOT_PUBLIC_ORIGIN=https://cpswang.xknot.si",
    "KNOT_PORT=8081",
    "KNOT_BIND_HOST=192.168.3.9",
  ]);
  assert.equal(hint(site), "");
});

test("本身就只在本机：绑回环不是问题，不提这条", () => {
  const site = makeSite(["KNOT_PUBLIC_ORIGIN=http://127.0.0.1:8099", "KNOT_PORT=8099", "KNOT_BIND_HOST=127.0.0.1"]);
  assert.equal(hint(site), "");
});

test("IPv6 回环也要认出来：[::1] 不能被截成「[」当成对外站点", () => {
  const site = makeSite(["KNOT_PUBLIC_ORIGIN=http://[::1]:8099", "KNOT_PORT=8099", "KNOT_BIND_HOST=::1"]);
  assert.equal(hint(site), "");
});

test("IPv6 公网地址 + 绑回环：该提醒照提", () => {
  const site = makeSite([
    "KNOT_PUBLIC_ORIGIN=https://[2001:db8::1]:8443",
    "KNOT_PORT=8081",
    "KNOT_BIND_HOST=127.0.0.1",
  ]);
  assert.match(hint(site), /KNOT_BIND_HOST 设成 0\.0\.0\.0/);
});

test("KNOT_ADMIN_ORIGIN 写死了可用地址时也不提", () => {
  // 多网卡或隧道拓扑下运维会写死一条；Backend 会照它生成链接，绑回环不再决定链接。
  const site = makeSite([
    "KNOT_PUBLIC_ORIGIN=https://cpswang.xknot.si",
    "KNOT_PORT=8081",
    "KNOT_BIND_HOST=127.0.0.1",
  ]);
  const script = 'source "$1"; KNOT_ADMIN_ORIGIN="http://knot.lan:9000"; knot_admin_link_hint';
  const text = execFileSync("bash", ["-c", script, "_", LIB], {
    env: { ...process.env, KNOT_SITE_FILE: path.join(site, "site.env") },
    encoding: "utf8",
  }).trim();
  assert.equal(text, "");
});
