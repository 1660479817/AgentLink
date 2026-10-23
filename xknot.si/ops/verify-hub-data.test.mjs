import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyHubData } from "./verify-hub-data.mjs";
import { buildHubData } from "../web/src/lib/snapshot.js";
import { mergePreview } from "../web/src/lib/preview.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(here, "..", relative), "utf8"));
}

function manifest(ids) {
  return {
    instances: ids.map((id) => ({
      id,
      url: `https://${id}.xknot.si`,
      tier: "paid",
      status: "active",
    })),
  };
}

// 快照里的每一条都该带着自述副本的痕迹：名称和取回时间。
function snapshot(ids) {
  return {
    instances: ids.map((id) => ({
      id,
      url: `https://${id}.xknot.si`,
      name: `Site ${id}`,
      profileFetchedAt: "2026-10-19T02:00:00.000Z",
    })),
  };
}

test("a snapshot that matches the manifest passes", () => {
  assert.deepEqual(verifyHubData({ data: snapshot(["wang"]), manifest: manifest(["wang"]) }), []);
});

test("a missing instance fails", () => {
  const problems = verifyHubData({ data: snapshot([]), manifest: manifest(["wang"]) });
  assert.ok(problems.some((line) => line.includes('"wang" is missing')));
});

test("an instance that is not in the manifest fails", () => {
  const problems = verifyHubData({
    data: snapshot(["wang", "nordhavn"]),
    manifest: manifest(["wang"]),
  });
  assert.ok(problems.some((line) => line.includes('"nordhavn" is not in instances.json')));
});

test("fixture ids are allowed when the fixture manifest is passed", () => {
  const problems = verifyHubData({
    data: snapshot(["wang", "nordhavn"]),
    manifest: manifest(["wang"]),
    fixtures: manifest(["nordhavn"]),
  });
  assert.deepEqual(problems, []);
});

test("a site whose profile was never fetched is reported", () => {
  const data = { instances: [{ id: "wang", url: "https://wang.xknot.si", name: "wang", profileFetchedAt: null }] };
  const problems = verifyHubData({ data, manifest: manifest(["wang"]) });
  assert.ok(problems.some((line) => line.includes("has never been fetched")));
});

test("a site that names itself after its id is allowed once the profile is fetched", () => {
  const data = {
    instances: [{ id: "cpswang", url: "https://cpswang.xknot.si", name: "cpswang", profileFetchedAt: "2026-10-21T15:30:00.000Z" }],
  };
  const problems = verifyHubData({ data, manifest: manifest(["cpswang"]) });
  assert.deepEqual(problems, []);
});

test("a reserved host suffix fails even when it is listed", () => {
  const data = { instances: [{ id: "wang", url: "https://tester-nordhavn.example" }] };
  const problems = verifyHubData({ data, manifest: manifest(["wang"]) });
  assert.ok(problems.some((line) => line.includes("reserved host suffix .example")));
});

test("example.com/net/org are reserved too, and only as whole labels", () => {
  // RFC 2606 保留了这三个域；人写样例最常用的就是它们。
  for (const url of ["https://demo.example.com", "https://example.net", "https://a.b.example.org"]) {
    const data = { instances: [{ id: "wang", url }] };
    const problems = verifyHubData({ data, manifest: manifest(["wang"]) });
    assert.ok(
      problems.some((line) => line.includes("reserved host")),
      `${url} must be caught`
    );
  }
  // 只是结尾像的普通域名不能被误杀。
  const fine = { instances: [{ id: "wang", url: "https://myexample.com", name: "Wang", profileFetchedAt: "2026-10-20T00:00:00.000Z" }] };
  assert.deepEqual(verifyHubData({ data: fine, manifest: manifest(["wang"]) }), []);
});

test("a non-https url fails", () => {
  const data = { instances: [{ id: "wang", url: "http://wang.xknot.si" }] };
  const problems = verifyHubData({ data, manifest: manifest(["wang"]) });
  assert.ok(problems.some((line) => line.includes("url must be https")));
});

test("duplicate ids fail", () => {
  const data = {
    instances: [
      { id: "wang", url: "https://wang.xknot.si" },
      { id: "wang", url: "https://wang.xknot.si" },
    ],
  };
  const problems = verifyHubData({ data, manifest: manifest(["wang"]) });
  assert.ok(problems.some((line) => line.includes('duplicate id "wang"')));
});

test("an empty snapshot fails", () => {
  const problems = verifyHubData({ data: { instances: [] }, manifest: { instances: [] } });
  assert.ok(problems.some((line) => line.includes("no instances")));
});

test("a pending instance is not required and must stay out of the snapshot", () => {
  const manifest = {
    instances: [
      { id: "done", url: "https://done.example.com", status: "active" },
      { id: "waiting", url: "https://waiting.example.com", status: "pending" },
    ],
  };
  assert.deepEqual(
    verifyHubData({ data: snapshot(["done"]), manifest }),
    []
  );
  assert.ok(
    verifyHubData({ data: snapshot(["waiting"]), manifest }).some((line) => line.includes("still pending"))
  );
});

// 测试用：给登记表里的每条造一份最小自述副本。
function profilesFor(manifest) {
  const out = {};
  for (const instance of manifest.instances || []) {
    out[instance.id] = {
      formatVersion: 2,
      fetchedAt: "2026-10-19T02:00:00.000Z",
      issued: instance,
      site: { name: `Site ${instance.id}`, tagline: "Hi", contact: "hi@example.test" },
    };
  }
  return out;
}

test("the shipped manifest produces a snapshot this guard accepts", async () => {
  const shipped = await readJson("instances.json");
  const data = buildHubData(shipped, { instances: {} }, undefined, {}, {}, profilesFor(shipped));
  assert.deepEqual(verifyHubData({ data, manifest: shipped }), []);
});

test("preview fixtures are rejected unless the build is a preview", async () => {
  const shipped = await readJson("instances.json");
  const samples = await readJson("fixtures/preview-instances.json");
  const sampleProfiles = await readJson("fixtures/preview-profiles.json");

  const merged = mergePreview(shipped, { instances: {} }, samples, { instances: {} });
  const data = buildHubData(
    merged.manifest,
    merged.health,
    undefined,
    {},
    {},
    { ...profilesFor(shipped), ...sampleProfiles }
  );

  const strict = verifyHubData({ data, manifest: shipped });
  assert.ok(strict.length > 0);

  const preview = verifyHubData({ data, manifest: shipped, fixtures: samples });
  assert.deepEqual(preview, []);
});
