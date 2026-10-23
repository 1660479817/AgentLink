// 自动接通的发布步骤：清单与名册一起写，重跑不重复。
//
// 这里用临时目录里的两份真文件跑，校验器就是构建时用的那一套；
// 所以「能发布」与「能构建」不会得出两个结论。

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { markActive, publishInstance } from "./publish.mjs";
import { validateInstances } from "../ops/validate-instances.mjs";
import { validateRoster } from "../ops/validate-federation.mjs";

const APP = {
  id: "XK-2026-M5CMKG",
  name: "cpswang",
  subdomain: "cpswang",
  url: "https://cpswang.xknot.si",
  email: "manwjh@126.com",
};

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xknot-publish-"));
  const manifestFile = path.join(dir, "instances.json");
  const rosterFile = path.join(dir, "federation.json");
  const manifest = {
    version: 5,
    updatedAt: "2026-10-19",
    instances: [{ id: "wang", url: "https://wang.xknot.si", since: "2026-10-19", tier: "paid", status: "active" }],
  };
  const roster = {
    version: 1,
    updatedAt: "2026-10-19",
    hub: "xknot.si",
    members: [
      {
        id: "wang",
        host: "wang.xknot.si",
        role: "founder",
        standing: "permanent",
        tunnel: { account: "knot-tunnel", port: 18080 },
        listed: true,
        since: "2026-10-19",
        mode: "subdomain",
      },
    ],
  };
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(rosterFile, `${JSON.stringify(roster, null, 2)}\n`);
  return { dir, manifestFile, rosterFile };
}

test("publish: writes both files and both pass the build validators", async () => {
  const { manifestFile, rosterFile } = await fixture();
  const result = await publishInstance({
    application: APP,
    tunnelAccount: "knot-tunnel-cpswang",
    tunnelPort: 18090,
    manifestFile,
    rosterFile,
  });

  assert.equal(result.entry.id, "cpswang");
  assert.equal(result.entry.tier, "free");
  assert.equal(result.entry.status, "pending");
  assert.equal(result.skipped, false);

  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const roster = JSON.parse(await readFile(rosterFile, "utf8"));
  assert.deepEqual(validateInstances(manifest), []);
  assert.deepEqual(validateRoster(roster, manifest), []);
  assert.deepEqual(roster.members.find((m) => m.id === "cpswang").tunnel, {
    account: "knot-tunnel-cpswang",
    port: 18090,
  });
});

test("publish: running it again changes nothing", async () => {
  const { manifestFile, rosterFile } = await fixture();
  const args = {
    application: APP,
    tunnelAccount: "knot-tunnel-cpswang",
    tunnelPort: 18090,
    manifestFile,
    rosterFile,
  };
  await publishInstance(args);
  const before = await readFile(manifestFile, "utf8");
  const second = await publishInstance(args);
  assert.equal(second.skipped, true);
  assert.equal(await readFile(manifestFile, "utf8"), before);
});

test("publish: the same address under another id is refused", async () => {
  const { manifestFile, rosterFile } = await fixture();
  await writeFile(
    manifestFile,
    `${JSON.stringify(
      {
        version: 5,
        updatedAt: "2026-10-19",
        instances: [
          { id: "wang", url: "https://wang.xknot.si", since: "2026-10-19", tier: "paid", status: "active" },
          { id: "cps-1", url: "https://cpswang.xknot.si", since: "2026-10-19", tier: "free", status: "pending" },
        ],
      },
      null,
      2
    )}\n`
  );
  const result = await publishInstance({
    application: { ...APP, subdomain: null },
    tunnelAccount: "knot-tunnel-cpswang",
    tunnelPort: 18090,
    manifestFile,
    rosterFile,
  });
  // 同一地址已经挂在别的 id 下，不能再塞一条。
  assert.equal(result.error, "url_taken");
});

test("publish: a roster write that breaks validation leaves the manifest alone", async () => {
  const { manifestFile, rosterFile } = await fixture();
  const before = await readFile(manifestFile, "utf8");
  const result = await publishInstance({
    application: APP,
    tunnelAccount: "Bad Account",
    tunnelPort: 80,
    manifestFile,
    rosterFile,
  });
  assert.equal(result.error, "roster_invalid");
  assert.equal(await readFile(manifestFile, "utf8"), before);
});

test("active: flips the published entry only, twice is a no-op", async () => {
  const { manifestFile, rosterFile } = await fixture();
  await publishInstance({
    application: APP,
    tunnelAccount: "knot-tunnel-cpswang",
    tunnelPort: 18090,
    manifestFile,
    rosterFile,
  });

  assert.equal((await markActive({ manifestFile, id: "cpswang" })).changed, true);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  assert.equal(manifest.instances.find((item) => item.id === "cpswang").status, "active");
  assert.deepEqual(validateInstances(manifest), []);
  assert.equal((await markActive({ manifestFile, id: "cpswang" })).changed, false);
  assert.equal((await markActive({ manifestFile, id: "nope" })).error, "not_listed");
});

test("active: a suspended or retired entry is not flipped back", async () => {
  for (const status of ["suspended", "retired"]) {
    const { manifestFile, rosterFile } = await fixture();
    await publishInstance({
      application: APP,
      tunnelAccount: "knot-tunnel-cpswang",
      tunnelPort: 18090,
      manifestFile,
      rosterFile,
    });
    // 运营在清单上按下暂停/下架：worker 每一轮仍会调用 markActive，
    // 只有 pending 才允许迁入，否则这个决定下一轮就被改回去。
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    manifest.instances.find((item) => item.id === "cpswang").status = status;
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await markActive({ manifestFile, id: "cpswang" });
    assert.equal(result.error, "not_pending");
    assert.equal(result.status, status);
    const after = JSON.parse(await readFile(manifestFile, "utf8"));
    assert.equal(after.instances.find((item) => item.id === "cpswang").status, status);
  }
});

test("publish: two workers publishing at the same moment keep both entries", async () => {
  const { manifestFile, rosterFile } = await fixture();
  const second = {
    id: "XK-2026-SECOND",
    name: "second",
    subdomain: "second",
    url: "https://second.xknot.si",
    email: "second@example.test",
  };

  // 两个写者各自「读-改-写」同一份清单：没有锁时后写的那份会把前一个刚加的
  // 条目盖回去，两个都以为自己成功。这里同时发起，要求两条都留在文件里。
  const [first, other] = await Promise.all([
    publishInstance({
      application: APP,
      tunnelAccount: "knot-tunnel-cpswang",
      tunnelPort: 18090,
      manifestFile,
      rosterFile,
    }),
    publishInstance({
      application: second,
      tunnelAccount: "knot-tunnel-second",
      tunnelPort: 18091,
      manifestFile,
      rosterFile,
    }),
  ]);
  assert.equal(first.error, undefined, JSON.stringify(first));
  assert.equal(other.error, undefined, JSON.stringify(other));

  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const roster = JSON.parse(await readFile(rosterFile, "utf8"));
  assert.deepEqual(manifest.instances.map((item) => item.id).sort(), ["cpswang", "second", "wang"]);
  assert.deepEqual(roster.members.map((item) => item.id).sort(), ["cpswang", "second", "wang"]);
  assert.deepEqual(validateInstances(manifest), []);
  assert.deepEqual(validateRoster(roster, manifest), []);
});
