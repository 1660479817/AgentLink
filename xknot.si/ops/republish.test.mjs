// 运行期重算门户快照：接通之后卡片要自己出现，档案缺失也不能让整站停更。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { republish } from "./republish.mjs";

async function makeRoot({ instances, profiles = {}, health = { instances: {} } }) {
  const root = await mkdtemp(path.join(tmpdir(), "xknot-republish-"));
  await writeFile(path.join(root, "instances.json"), `${JSON.stringify({ version: 1, instances }, null, 2)}\n`);
  await mkdir(path.join(root, "var", "profiles"), { recursive: true });
  await writeFile(path.join(root, "var", "health.json"), `${JSON.stringify(health)}\n`);
  for (const [id, payload] of Object.entries(profiles)) {
    await writeFile(path.join(root, "var", "profiles", `${id}.json`), `${JSON.stringify(payload)}\n`);
  }
  return root;
}

const live = {
  id: "alpha",
  url: "https://alpha.xknot.si",
  since: "2026-10-23",
  tier: "free",
  status: "active",
};

const profile = {
  formatVersion: 2,
  issued: { id: "alpha", url: "https://alpha.xknot.si", since: "2026-10-23", tier: "free", status: "active" },
  site: { name: "Alpha Node", tagline: "hello" },
  fetchedAt: "2026-10-23T10:00:00.000Z",
};

test("republish: an active instance lands in the snapshot with its profile", async () => {
  const root = await makeRoot({ instances: [live], profiles: { alpha: profile } });
  const outFile = path.join(root, "web", "dist", "data", "hub.json");

  const result = await republish({ root, outFile, doFetch: false, now: () => new Date("2026-10-23T12:00:00Z") });

  assert.equal(result.count, 1);
  assert.deepEqual(result.warnings, []);
  const data = JSON.parse(await readFile(outFile, "utf8"));
  assert.equal(data.instances.length, 1);
  assert.equal(data.instances[0].id, "alpha");
  assert.equal(data.instances[0].name, "Alpha Node");
  assert.equal(data.instances[0].profileFetchedAt, "2026-10-23T10:00:00.000Z");
  assert.equal(data.generatedAt, "2026-10-23T12:00:00.000Z");
});

test("republish: a pending instance stays out of the snapshot", async () => {
  // pending 是「已收录、未验收」：留在清单里等验收，但绝不上门户。
  const root = await makeRoot({
    instances: [{ ...live, status: "pending" }, { ...live, id: "beta", url: "https://beta.xknot.si" }],
  });
  const outFile = path.join(root, "web", "dist", "data", "hub.json");
  const result = await republish({ root, outFile, doFetch: false });
  assert.equal(result.count, 1);
  const data = JSON.parse(await readFile(outFile, "utf8"));
  assert.deepEqual(data.instances.map((item) => item.id), ["beta"]);
});

test("republish: an empty snapshot is refused rather than emptying the portal", async () => {
  // 只剩 pending 时算出来的快照是空的。发出去等于把门户清空，
  // 所以守住上一份、报错，等节点验收通过再更新。
  const root = await makeRoot({ instances: [{ ...live, status: "pending" }] });
  const outFile = path.join(root, "web", "dist", "data", "hub.json");
  await assert.rejects(() => republish({ root, outFile, doFetch: false }), /the portal would be empty/);
});

test("republish: no profile yet still publishes, with the id as the card name", async () => {
  // 伙伴档案拉不到（超时、目录不可写、还没来得及填）不能变成「整站不更新」：
  // 卡片退回 id，档案到了下一轮自然补上。
  const root = await makeRoot({ instances: [live] });
  const outFile = path.join(root, "web", "dist", "data", "hub.json");

  const result = await republish({ root, outFile, doFetch: false });

  assert.equal(result.count, 1);
  assert.match(result.warnings.join("\n"), /alpha: no site profile yet/);
  const data = JSON.parse(await readFile(outFile, "utf8"));
  assert.equal(data.instances[0].name, "alpha");
  assert.equal(data.instances[0].profileFetchedAt, null);
});

test("republish: a snapshot that breaks the guard is never written", async () => {
  // 清单里有一条 http 地址：发布出去就是一个不安全的跳转。宁可不更新。
  const root = await makeRoot({
    instances: [{ ...live, url: "http://alpha.xknot.si" }],
    profiles: { alpha: { ...profile, issued: { ...profile.issued, url: "http://alpha.xknot.si" } } },
  });
  const outFile = path.join(root, "web", "dist", "data", "hub.json");
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, '{"instances":["previous"]}\n');

  await assert.rejects(() => republish({ root, outFile, doFetch: false }), /snapshot rejected: .*url must be https/);
  // 上一份快照原样留着：门户读到的还是完整的一份 JSON。
  assert.equal(await readFile(outFile, "utf8"), '{"instances":["previous"]}\n');
});

test("republish: a failing profile fetch does not block publishing", async () => {
  const root = await makeRoot({ instances: [live], profiles: { alpha: profile } });
  const outFile = path.join(root, "web", "dist", "data", "hub.json");

  const result = await republish({
    root,
    outFile,
    doFetch: true,
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });

  assert.equal(result.count, 1);
  assert.match(result.warnings.join("\n"), /alpha: profile failed unreachable|profile fetch skipped/);
});

test("republish: an unreadable manifest fails loudly instead of writing an empty portal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xknot-republish-"));
  await assert.rejects(
    () => republish({ root, outFile: path.join(root, "hub.json"), doFetch: false }),
    /cannot read instances/
  );
});
