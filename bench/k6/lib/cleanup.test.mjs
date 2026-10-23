import test from "node:test";
import assert from "node:assert/strict";
import { deletePassed, intelIdFrom } from "./cleanup.js";

// k6 的 res.json(selector) 在 node 下可以用一个假响应代替。
function fake(status, body) {
  return {
    status,
    body,
    json(selector) {
      const parsed = JSON.parse(body);
      return selector ? parsed[selector] : parsed;
    },
  };
}

test("intelIdFrom 从 intel.id 或 kMeta.id 取 id，取不到返回空串", () => {
  assert.equal(intelIdFrom(fake(201, '{"intel":{"id":"a1"}}')), "a1");
  assert.equal(intelIdFrom(fake(201, '{"intel":{"kMeta":{"id":"b2"}}}')), "b2");
  // 发帖成功但响应里没有 id：调用方必须用空串判失败，不能静默跳过。
  assert.equal(intelIdFrom(fake(201, '{"ok":true}')), "");
  assert.equal(intelIdFrom(fake(201, "not json")), "");
  assert.equal(intelIdFrom(fake(201, '{"intel":null}')), "");
});

test("deletePassed 要求 2xx 且 body.ok，429 与 200 {ok:false} 都算没删掉", () => {
  assert.equal(deletePassed(fake(200, '{"ok":true}')), true);
  assert.equal(deletePassed(fake(200, '{"ok":true,"already":true}')), true);
  assert.equal(deletePassed(fake(404, '{"error":"not_found"}')), true);
  assert.equal(deletePassed(fake(200, '{"ok":false}')), false);
  assert.equal(deletePassed(fake(200, '{"error":"not_found"}')), false);
  // 429 在 probe.js 里只算限流；清理链路关心的是记录还在不在，所以这里必须是 false。
  assert.equal(deletePassed(fake(429, '{"error":"too_many"}')), false);
  assert.equal(deletePassed(fake(500, '{"error":"boom"}')), false);
  assert.equal(deletePassed(fake(200, "<html>ok</html>")), false);
  assert.equal(deletePassed(null), false);
});
