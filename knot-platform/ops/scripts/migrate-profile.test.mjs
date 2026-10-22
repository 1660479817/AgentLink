import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { main, siteFromLegacy, stripLegacyKeys } from "./migrate-profile.mjs";

const siteEnv = `# ---- 站点 ----
# 站点名。WebUI 顶栏正中、浏览器标题、分享图落款都用它。
KNOT_SITE_NAME="王家小站"
# 一句话介绍。未登录首页和分享图用。
KNOT_SITE_TAGLINE="只收值得换的信息。"
# 站点自己的 logo，登录卡和未登录首页用。
KNOT_SITE_LOGO=https://example.test/logo.png
# 主理人（owner）：这个站点的人类主人。
KNOT_SITE_OWNER="PaulWang"
KNOT_SITE_OWNER_NOTE="夜里写的。"
KNOT_SITE_OWNER_CONTACT="paul@example.test"

# ---- 端口 ----
PORT=8081
PUBLIC_WEB_ORIGIN=http://127.0.0.1:8081
`;

function site() {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-migrate-"));
  writeFileSync(path.join(dir, "site.env"), siteEnv);
  return dir;
}

test("the legacy keys become one flat self-described site", () => {
  assert.deepEqual(siteFromLegacy({ KNOT_SITE_NAME: "王家小站", KNOT_SITE_TAGLINE: "只收值得换的信息。" }), {
    name: "王家小站",
    // 旧配置没有语种：按文案推一个写进档案，之后由主理人改。
    locale: "zh-CN",
    tagline: "只收值得换的信息。",
  });
  assert.equal(siteFromLegacy({ KNOT_SITE_NAME: "Knot", KNOT_SITE_TAGLINE: "a site for agents" }).locale, "en");
});

test("a logo must be https, because the hub reads it from another machine", () => {
  assert.equal(siteFromLegacy({ KNOT_SITE_NAME: "Knot", KNOT_SITE_LOGO: "/logo.png" }).logo, undefined);
  assert.equal(siteFromLegacy({ KNOT_SITE_NAME: "Knot", KNOT_SITE_LOGO: "http://example.test/l.png" }).logo, undefined);
  assert.equal(
    siteFromLegacy({ KNOT_SITE_NAME: "Knot", KNOT_SITE_LOGO: "https://example.test/l.png" }).logo,
    "https://example.test/l.png",
  );
});

test("stripping removes the six keys and their own comments, nothing else", () => {
  const stripped = stripLegacyKeys(siteEnv);
  assert.ok(!stripped.includes("KNOT_SITE_"));
  assert.ok(stripped.includes("PORT=8081"));
  assert.ok(stripped.includes("PUBLIC_WEB_ORIGIN=http://127.0.0.1:8081"));
  assert.ok(!stripped.includes("# 一句话介绍"));
  assert.ok(stripped.includes("# ---- 端口 ----"));
  // 没有旧键时原样返回，重复执行不会改文件。
  assert.equal(stripLegacyKeys(stripped), stripped);
});

test("the first run writes profile.json, later runs only clean up", () => {
  const dir = site();
  const envFile = path.join(dir, "platform.env");
  writeFileSync(envFile, siteEnv);

  assert.equal(main(["--dir", dir, "--env", envFile]), 0);
  const profile = JSON.parse(readFileSync(path.join(dir, "profile.json"), "utf8"));
  assert.equal(profile.formatVersion, 2);
  assert.equal(profile.site.name, "王家小站");
  assert.equal(profile.site.contact, "paul@example.test");
  assert.ok(!readFileSync(path.join(dir, "site.env"), "utf8").includes("KNOT_SITE_"));
  assert.ok(!readFileSync(envFile, "utf8").includes("KNOT_SITE_"));

  // 主理人后来在 /admin 改过档案：再跑一次不能覆盖。
  const edited = { ...profile, site: { ...profile.site, owner: "Paul" } };
  writeFileSync(path.join(dir, "profile.json"), JSON.stringify(edited));
  writeFileSync(path.join(dir, "site.env"), `KNOT_SITE_NAME="旧名字"\nPORT=8081\n`);
  assert.equal(main(["--dir", dir]), 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "profile.json"), "utf8")), edited);
  assert.ok(!readFileSync(path.join(dir, "site.env"), "utf8").includes("KNOT_SITE_NAME"));
});

test("a v1 profile is upgraded in place, keeping the Chinese wording", () => {
  const dir = site();
  const v1 = {
    formatVersion: 1,
    updatedAt: "2026-10-20",
    profile: {
      name: { "zh-CN": "王家小站", en: "Wang's Place" },
      intro: { oneLine: { "zh-CN": "只收值得换的信息。" }, long: { en: "Nightly notes." } },
      owner: { en: "PaulWang" },
      contact: "paul@example.test",
      logo: "https://example.test/logo.png",
      regions: ["CN", "SG"],
      timezone: "Asia/Shanghai",
      tags: ["信息交换", "Agent", "信息交换"],
    },
  };
  writeFileSync(path.join(dir, "profile.json"), JSON.stringify(v1));

  assert.equal(main(["--dir", dir]), 0);
  const upgraded = JSON.parse(readFileSync(path.join(dir, "profile.json"), "utf8"));
  assert.equal(upgraded.formatVersion, 2);
  assert.deepEqual(upgraded.site, {
    name: "王家小站",
    locale: "zh-CN",
    tagline: "只收值得换的信息。",
    intro: "Nightly notes.",
    logo: "https://example.test/logo.png",
    owner: "PaulWang",
    contact: "paul@example.test",
    region: "CN",
    timezone: "Asia/Shanghai",
    tags: ["信息交换", "Agent"],
  });
});

test("a v2 profile without locale gets one, and nothing else changes", () => {
  const dir = site();
  writeFileSync(path.join(dir, "site.env"), "PORT=8081\n");
  const before = {
    formatVersion: 2,
    updatedAt: "2026-10-20",
    site: { name: "Nightly notes", tagline: "Kept by hand", owner: "Paul" },
  };
  writeFileSync(path.join(dir, "profile.json"), JSON.stringify(before));

  // 先看一眼会写什么。
  assert.equal(main(["--dir", dir, "--dry-run"]), 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "profile.json"), "utf8")), before);

  assert.equal(main(["--dir", dir]), 0);
  const after = JSON.parse(readFileSync(path.join(dir, "profile.json"), "utf8"));
  assert.equal(after.site.locale, "en");
  assert.equal(after.site.owner, "Paul");
  assert.equal(after.site.name, "Nightly notes");

  // 第二次跑不再动它：主理人后来改的语种不会被推断覆盖。
  writeFileSync(path.join(dir, "profile.json"), JSON.stringify({ ...after, site: { ...after.site, locale: "zh-TW" } }));
  assert.equal(main(["--dir", dir]), 0);
  assert.equal(JSON.parse(readFileSync(path.join(dir, "profile.json"), "utf8")).site.locale, "zh-TW");
});

test("a profile with no self-description is left alone", () => {
  const dir = site();
  writeFileSync(path.join(dir, "site.env"), "PORT=8081\n");
  const before = { formatVersion: 2, updatedAt: "2026-10-20", site: null };
  writeFileSync(path.join(dir, "profile.json"), JSON.stringify(before));
  assert.equal(main(["--dir", dir]), 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "profile.json"), "utf8")), before);
});

test("a dry run prints the plan and leaves every file alone", () => {
  const dir = site();
  const before = readFileSync(path.join(dir, "site.env"), "utf8");
  assert.equal(main(["--dir", dir, "--dry-run"]), 0);
  assert.equal(readFileSync(path.join(dir, "site.env"), "utf8"), before);
  assert.throws(() => readFileSync(path.join(dir, "profile.json"), "utf8"), /ENOENT/);
});

test("on the instance the site directory comes from the runtime config", () => {
  const dir = site();
  const before = process.env.KNOT_PROFILE_FILE;
  // 部署机上从 current/ 调进来时 ROOT 是 releases/<版本>，默认目录要有别的来源。
  process.env.KNOT_PROFILE_FILE = path.join(dir, "profile.json");
  try {
    assert.equal(main(["--site", "ignored"]), 0);
  } finally {
    if (before === undefined) delete process.env.KNOT_PROFILE_FILE;
    else process.env.KNOT_PROFILE_FILE = before;
  }
  assert.ok(!readFileSync(path.join(dir, "site.env"), "utf8").includes("KNOT_SITE_"));
});

test("running it through the deploy symlink still does the work", () => {
  const dir = site();
  // 部署机上 current 是指向 releases/<版本> 的软链；用软链路径调用不能变成空跑。
  const link = path.join(dir, "current");
  symlinkSync(path.dirname(fileURLToPath(import.meta.url)), link);

  const result = spawnSync(process.execPath, [path.join(link, "migrate-profile.mjs"), "--dir", dir], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /写入/);
  assert.ok(!readFileSync(path.join(dir, "site.env"), "utf8").includes("KNOT_SITE_"));
});
