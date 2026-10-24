import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readInstancesCached } from "./instances.mjs";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-inst-"));
  const file = path.join(dir, "instances.json");
  return { dir, file };
}

test("reads the instance list and caches by mtime/size", () => {
  const { dir, file } = fixture();
  writeFileSync(file, JSON.stringify({ instances: [{ id: "a", status: "active" }] }));

  const first = readInstancesCached({ file, cache: { key: "", list: [] } });
  assert.deepEqual(first.list, [{ id: "a", status: "active" }]);
  assert.notEqual(first.cache.key, "");

  // 文件没变，同一个 key 直接命中缓存，返回的是同一份对象。
  const second = readInstancesCached({ file, cache: first.cache });
  assert.equal(second.list, first.list);

  rmSync(dir, { recursive: true, force: true });
});

test("a broken manifest clears the cache instead of reusing it (fail-closed)", () => {
  const { dir, file } = fixture();
  writeFileSync(file, JSON.stringify({ instances: [{ id: "a", status: "active" }] }));
  const ok = readInstancesCached({ file, cache: { key: "", list: [] } });
  assert.equal(ok.list.length, 1);

  // 文件坏了：返回空清单，缓存也被清空，绝不沿用暂停/下架之前的名单。
  writeFileSync(file, "{ not json");
  const errors = [];
  const broken = readInstancesCached({ file, cache: ok.cache, onError: (error) => errors.push(error) });
  assert.deepEqual(broken.list, []);
  assert.deepEqual(broken.cache, { key: "", list: [] });
  assert.equal(errors.length, 1);

  rmSync(dir, { recursive: true, force: true });
});

test("a manifest without an instances array reads as empty", () => {
  const { dir, file } = fixture();
  writeFileSync(file, JSON.stringify({ something: "else" }));
  const result = readInstancesCached({ file, cache: { key: "", list: [] } });
  assert.deepEqual(result.list, []);
  rmSync(dir, { recursive: true, force: true });
});
