import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyHubData } from "./verify-hub-data.mjs";
import { buildHubData } from "../web/src/lib/snapshot.js";
import { mergePreview } from "../web/src/lib/preview.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function manifest(ids) {
  return {
    instances: ids.map((id) => ({
      id,
      name: { en: id },
      url: `https://${id}.xknot.si`,
      tier: "partner",
      status: "active",
    })),
  };
}

function snapshot(ids) {
  return {
    instances: ids.map((id) => ({ id, url: `https://${id}.xknot.si` })),
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

test("a reserved host suffix fails even when it is listed", () => {
  const data = { instances: [{ id: "wang", url: "https://tester-nordhavn.example" }] };
  const problems = verifyHubData({ data, manifest: manifest(["wang"]) });
  assert.ok(problems.some((line) => line.includes("reserved host suffix .example")));
});

test("a non-https url fails", () => {
  const data = { instances: [{ id: "wang", url: "http://wang.xknot.si" }] };
  const problems = verifyHubData({ data, manifest: manifest(["wang"]) });
  assert.ok(problems.some((line) => line.includes("url must be https")));
});

test("duplicate ids fail", () => {
  const data = { instances: [{ id: "wang", url: "https://wang.xknot.si" }, { id: "wang", url: "https://wang.xknot.si" }] };
  const problems = verifyHubData({ data, manifest: manifest(["wang"]) });
  assert.ok(problems.some((line) => line.includes('duplicate id "wang"')));
});

test("an empty snapshot fails", () => {
  const problems = verifyHubData({ data: { instances: [] }, manifest: { instances: [] } });
  assert.ok(problems.some((line) => line.includes("no instances")));
});

test("the shipped manifest produces a snapshot this guard accepts", async () => {
  const shipped = JSON.parse(await readFile(path.join(here, "..", "instances.json"), "utf8"));
  const data = buildHubData(shipped, { instances: {} });
  assert.deepEqual(verifyHubData({ data, manifest: shipped }), []);
});

test("preview fixtures are rejected unless the build is a preview", async () => {
  const shipped = JSON.parse(await readFile(path.join(here, "..", "instances.json"), "utf8"));
  const samples = JSON.parse(await readFile(path.join(here, "..", "fixtures", "preview-instances.json"), "utf8"));

  const merged = mergePreview(shipped, { instances: {} }, samples, { instances: {} });
  const data = buildHubData(merged.manifest, merged.health);

  const strict = verifyHubData({ data, manifest: shipped });
  assert.ok(strict.length > 0);

  const preview = verifyHubData({ data, manifest: shipped, fixtures: samples });
  assert.deepEqual(preview, []);
});
