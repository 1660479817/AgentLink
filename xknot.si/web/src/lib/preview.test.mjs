import assert from "node:assert/strict";
import test from "node:test";

import { mergePreview } from "./preview.js";

const realManifest = {
  version: 3,
  instances: [{ id: "core", name: { en: "Knot" }, tier: "demo", status: "active" }],
};

const previewManifest = {
  instances: [
    { id: "core", name: { en: "Sample core" } },
    { id: "nordhavn", name: { en: "Nordhavn" } },
    { id: "sakura", name: { en: "Sakura" } },
  ],
};

test("sample entries are appended after the real ones", () => {
  const { manifest } = mergePreview(realManifest, { instances: {} }, previewManifest, { instances: {} });
  assert.deepEqual(
    manifest.instances.map((item) => item.id),
    ["core", "nordhavn", "sakura"]
  );
});

test("a real entry wins over a sample with the same id", () => {
  const { manifest } = mergePreview(realManifest, { instances: {} }, previewManifest, { instances: {} });
  assert.equal(manifest.instances[0].name.en, "Knot");
  assert.equal(manifest.instances.length, 3);
});

test("real probe results win over sample states", () => {
  const { health } = mergePreview(
    realManifest,
    { checkedAt: "2026-10-19T06:00:00.000Z", instances: { core: { status: "down" } } },
    previewManifest,
    { checkedAt: "2026-10-19T05:20:00.000Z", instances: { core: { status: "up" }, nordhavn: { status: "up" } } }
  );
  assert.equal(health.instances.core.status, "down");
  assert.equal(health.instances.nordhavn.status, "up");
  assert.equal(health.checkedAt, "2026-10-19T06:00:00.000Z");
});

test("without a real probe the sample timestamp is used", () => {
  const { health } = mergePreview(realManifest, { instances: {} }, previewManifest, {
    checkedAt: "2026-10-19T05:20:00.000Z",
    instances: {},
  });
  assert.equal(health.checkedAt, "2026-10-19T05:20:00.000Z");
});

test("a missing sample set leaves the real data untouched", () => {
  const { manifest, health } = mergePreview(realManifest, { instances: {} }, null, null);
  assert.deepEqual(manifest.instances.map((item) => item.id), ["core"]);
  assert.deepEqual(health, { checkedAt: null, instances: {} });
});
