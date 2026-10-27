import assert from "node:assert/strict";
import test from "node:test";

import { isRecordId, recordPath, recordUrl, withRecordUrl, withRecordUrls } from "./recordUrl.js";

const ID = "27b21d25-26b2-4ad8-b24e-320377984013";

test("a record address is the same deep link the share image opens", () => {
  assert.equal(recordPath(ID), `/discover?post=${ID}`);
  assert.equal(recordUrl("https://cpswang.xknot.si", ID), `https://cpswang.xknot.si/discover?post=${ID}`);
  // 站点配置里常带一个尾斜杠；不能拼出 //discover。
  assert.equal(recordUrl("https://cpswang.xknot.si/", ID), `https://cpswang.xknot.si/discover?post=${ID}`);
});

test("没有公开地址或 id 不合法时不给地址", () => {
  assert.equal(recordUrl("", ID), "");
  assert.equal(recordUrl(null, ID), "");
  assert.equal(recordUrl("https://cpswang.xknot.si", ""), "");
  assert.equal(recordUrl("https://cpswang.xknot.si", "not-an-id"), "");
  assert.equal(recordPath("27b21d25"), "");
  assert.equal(isRecordId(` ${ID} `), true);
  assert.equal(isRecordId(`${ID}-extra`), false);
});

test("a record gains url in place; without an origin the shape is untouched", () => {
  const record = { id: ID, body: "x" };
  assert.equal(withRecordUrl(record, ""), record);
  assert.equal(withRecordUrl(null, "https://knot.example"), null);
  assert.deepEqual(withRecordUrl(record, "https://knot.example"), {
    id: ID,
    body: "x",
    url: `https://knot.example/discover?post=${ID}`,
  });
  assert.deepEqual(withRecordUrls([record], "https://knot.example").map((item) => item.url), [
    `https://knot.example/discover?post=${ID}`,
  ]);
  assert.deepEqual(withRecordUrls(null, "https://knot.example"), []);
});
