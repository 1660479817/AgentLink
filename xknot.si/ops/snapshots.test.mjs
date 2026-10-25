import assert from "node:assert/strict";
import test from "node:test";

import {
  boardEndpoint,
  collectSnapshots,
  digestOf,
  fetchSnapshot,
  instanceRoot,
  parseBoard,
  snapshotPath,
} from "./snapshots.mjs";

const BOARD = { version: "2026-10-25T00:00:00.000Z", information: [{ id: "a" }], requests: [] };
const MEMBER = { id: "cpswang", host: "cpswang.xknot.si", tunnel: { port: 18090 } };

function response({ status = 200, body = "", headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

function fakeHost({ fail = null } = {}) {
  const writes = new Map();
  return {
    writes,
    async writeEntryFile(file, text) {
      if (fail === "write") throw new Error("denied");
      writes.set(file, text);
    },
    async removeEntryFile(file) {
      if (fail === "remove") throw new Error("denied");
      writes.delete(file);
    },
  };
}

test("snapshot: the board is fetched over the tunnel's entry-side port", () => {
  // 回环端口是隧道在入口主机的一端。走这里就不经公网 DNS、TLS 与 nginx，
  // 也不需要给实例任何写权限。
  assert.equal(boardEndpoint(18090), "http://127.0.0.1:18090/api/web/board");
  assert.equal(instanceRoot("cpswang"), "/var/www/cpswang");
  assert.equal(snapshotPath("/var/www/cpswang/"), "/var/www/cpswang/discover.json");
  assert.equal(snapshotPath(""), "");
});

test("snapshot: a malformed body is not a snapshot", () => {
  assert.deepEqual(parseBoard(JSON.stringify(BOARD)), BOARD);
  assert.equal(parseBoard("<html>not found</html>"), null);
  assert.equal(parseBoard(JSON.stringify({ version: "x" })), null);
});

test("snapshot: an unchanged board costs one conditional request and no write", async () => {
  const text = JSON.stringify(BOARD);
  const seen = [];
  const fetchImpl = async (_url, init) => {
    seen.push(init.headers["if-none-match"] || "");
    return response({ status: 304 });
  };

  const host = fakeHost();
  const result = await collectSnapshots({
    members: [MEMBER],
    host,
    store: { entries: { cpswang: { etag: '"v1"', digest: digestOf(text), state: "present" } } },
    fetchImpl,
  });

  assert.deepEqual(seen, ['"v1"']);
  assert.deepEqual(result.unchanged, ["cpswang"]);
  assert.equal(host.writes.size, 0);
  assert.equal(result.store.entries.cpswang.etag, '"v1"');
});

test("snapshot: a changed board is written to the instance's static root", async () => {
  const text = JSON.stringify(BOARD);
  const fetchImpl = async () => response({ body: text, headers: { etag: '"v2"' } });
  const host = fakeHost();

  const result = await collectSnapshots({ members: [MEMBER], host, store: {}, fetchImpl });

  assert.deepEqual(result.written, ["cpswang"]);
  assert.equal(host.writes.get("/var/www/cpswang/discover.json"), text);
  assert.equal(result.store.entries.cpswang.etag, '"v2"');
  assert.equal(result.store.entries.cpswang.state, "present");
});

test("snapshot: a body that only looks different in whitespace is not rewritten", async () => {
  // 重写只换来一次 mtime 变化：浏览器那边会白校验一回，磁盘也多写一次。
  const text = JSON.stringify(BOARD);
  const host = fakeHost();
  const result = await collectSnapshots({
    members: [MEMBER],
    host,
    store: { entries: { cpswang: { digest: digestOf(text), state: "present" } } },
    fetchImpl: async () => response({ body: text }),
  });
  assert.deepEqual(result.unchanged, ["cpswang"]);
  assert.equal(host.writes.size, 0);
});

test("snapshot: an unreachable instance keeps the copy already on disk", async () => {
  // 隧道抖一下就把磁盘上那份删掉，等于让首屏 404；晚几十秒看到新帖要好得多。
  const host = fakeHost();
  const result = await collectSnapshots({
    members: [MEMBER],
    host,
    store: { entries: { cpswang: { etag: '"v1"', digest: "old", state: "present" } } },
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });

  assert.equal(result.errors[0].error, "unreachable");
  assert.equal(host.writes.size, 0);
  assert.equal(result.store.entries.cpswang.etag, '"v1"');
});

test("snapshot: a 500 from the instance also keeps the copy on disk", async () => {
  const host = fakeHost();
  const result = await collectSnapshots({
    members: [MEMBER],
    host,
    store: {},
    fetchImpl: async () => response({ status: 503 }),
  });
  assert.equal(result.errors[0].error, "board_error");
  assert.equal(host.writes.size, 0);
});

test("snapshot: an instance that no longer serves a board takes the disk copy with it", async () => {
  // 关掉公开快照之后入口还在发旧内容，是这里唯一不能容忍的失败方式。
  const host = fakeHost();
  host.writes.set("/var/www/cpswang/discover.json", "{}");

  const result = await collectSnapshots({
    members: [MEMBER],
    host,
    store: { entries: { cpswang: { etag: '"v1"', digest: "x", state: "present" } } },
    fetchImpl: async () => response({ status: 410 }),
  });

  assert.deepEqual(result.removed, ["cpswang"]);
  assert.equal(host.writes.size, 0);
  assert.equal(result.store.entries.cpswang.state, "absent");
});

test("snapshot: an endpoint that does not exist yet leaves the disk copy alone", async () => {
  // 实例还没升级到这个版本时 /api/web/board 是 404。这时磁盘上那份是唯一可用的数据，
  // 撤掉它等于让首屏白屏——等它升级比清空更对。
  const host = fakeHost();
  host.writes.set("/var/www/cpswang/discover.json", "{}");

  const result = await collectSnapshots({
    members: [MEMBER],
    host,
    store: { entries: { cpswang: { etag: '"v1"', digest: "x", state: "present" } } },
    fetchImpl: async () => response({ status: 404 }),
  });

  assert.deepEqual(result.removed, []);
  assert.equal(host.writes.size, 1);
  assert.equal(result.errors[0].error, "endpoint_missing");
});

test("snapshot: a failed write is retried later instead of every interval", async () => {
  // 失败时没有可用 etag，重试只能整份重取。跟着 20 秒节拍重取几十 KB 只为撞同一堵墙，
  // 不如隔几分钟再试。
  const now = new Date("2026-10-25T00:00:00.000Z");
  const host = fakeHost({ fail: "write" });
  const first = await collectSnapshots({
    members: [MEMBER],
    host,
    store: {},
    now,
    fetchImpl: async () => response({ body: JSON.stringify(BOARD) }),
  });
  assert.equal(first.errors[0].error, "write_failed");
  assert.ok(first.store.entries.cpswang.retryAt, "a failed write must be scheduled for a later retry");

  let calls = 0;
  const second = await collectSnapshots({
    members: [MEMBER],
    host,
    store: first.store,
    now: new Date("2026-10-25T00:00:20.000Z"),
    fetchImpl: async () => {
      calls += 1;
      return response({ body: JSON.stringify(BOARD) });
    },
  });
  assert.equal(calls, 0, "the next interval must not refetch");
  assert.deepEqual(second.errors, []);

  // 过了重试时间就再试一次。
  const third = await collectSnapshots({
    members: [MEMBER],
    host: fakeHost(),
    store: second.store,
    now: new Date("2026-10-25T00:06:00.000Z"),
    fetchImpl: async () => response({ body: JSON.stringify(BOARD) }),
  });
  assert.deepEqual(third.written, ["cpswang"]);
  assert.equal(third.store.entries.cpswang.retryAt, undefined);
});

test("snapshot: a 304 clears the retry window instead of parking the member forever", async () => {
  // 重试窗口要是跟着 304 留下来，这个成员每一轮都会在开头被跳过：
  // 实例早就好了，磁盘上那份却再也不更新。
  const host = fakeHost();
  const result = await collectSnapshots({
    members: [MEMBER],
    host,
    store: { entries: { cpswang: { state: "present", etag: '"v1"', digest: "x", retryAt: "2026-10-25T00:00:00.000Z" } } },
    now: new Date("2026-10-25T00:00:00.000Z"),
    fetchImpl: async () => response({ status: 304 }),
  });
  assert.deepEqual(result.unchanged, ["cpswang"]);
  assert.equal(result.store.entries.cpswang.retryAt, undefined);
  assert.equal(result.dirty, true);
});

test("snapshot: an already absent instance is not removed twice", async () => {
  let removals = 0;
  const host = {
    async writeEntryFile() {},
    async removeEntryFile() {
      removals += 1;
    },
  };
  const result = await collectSnapshots({
    members: [MEMBER],
    host,
    store: { entries: { cpswang: { state: "absent" } } },
    fetchImpl: async () => response({ status: 410 }),
  });
  assert.equal(removals, 0);
  assert.deepEqual(result.removed, []);
});

test("snapshot: a write failure is reported, not swallowed", async () => {
  const result = await collectSnapshots({
    members: [MEMBER],
    host: fakeHost({ fail: "write" }),
    store: {},
    fetchImpl: async () => response({ body: JSON.stringify(BOARD) }),
  });
  assert.equal(result.errors[0].error, "write_failed");
  assert.deepEqual(result.written, []);
});

test("snapshot: members without an allocated port are skipped", async () => {
  // 还没分配端口的实例连隧道都没有，去问它只会白等一次超时。
  let calls = 0;
  const result = await collectSnapshots({
    members: [{ id: "pending", host: "pending.xknot.si" }, { id: "bad", tunnel: { port: 80 } }],
    host: fakeHost(),
    store: {},
    fetchImpl: async () => {
      calls += 1;
      return response({ body: JSON.stringify(BOARD) });
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.store.entries, {});
});

test("snapshot: entries for members that left the roster are dropped", async () => {
  const result = await collectSnapshots({
    members: [],
    host: fakeHost(),
    store: { entries: { gone: { state: "present" } } },
    fetchImpl: async () => response({ status: 304 }),
  });
  assert.deepEqual(result.store.entries, {});
});

test("snapshot: fetch errors are classified, never thrown", async () => {
  // 410 与 404 的区别是这里最要紧的一条：前者是实例说「没有快照」，
  // 后者是「没这个地址」。弄反了会撤掉一份还能用的快照。
  assert.equal((await fetchSnapshot({ port: 18090, fetchImpl: async () => response({ status: 410 }) })).error, "board_absent");
  assert.equal((await fetchSnapshot({ port: 18090, fetchImpl: async () => response({ status: 404 }) })).error, "endpoint_missing");
  assert.equal((await fetchSnapshot({ port: 18090, fetchImpl: async () => response({ body: "{" }) })).error, "board_invalid");
  const failed = await fetchSnapshot({
    port: 18090,
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(failed.error, "unreachable");
});

test("snapshot: the static root only takes subdomain-shaped ids", async () => {
  // 这个路径要经 sudo 落盘，所以不认名册校验之外的东西：`..` 与斜杠不该拼出目录外。
  assert.equal(instanceRoot("cpswang"), "/var/www/cpswang");
  assert.equal(instanceRoot("cps-wang"), "/var/www/cps-wang");
  assert.equal(instanceRoot("../etc"), "");
  assert.equal(instanceRoot("a/b"), "");
  assert.equal(instanceRoot(""), "");

  let calls = 0;
  const result = await collectSnapshots({
    members: [{ id: "../etc", tunnel: { port: 18090 } }],
    host: fakeHost(),
    store: {},
    fetchImpl: async () => {
      calls += 1;
      return response({ body: JSON.stringify(BOARD) });
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.store.entries, {});
});

test("snapshot: a round where nothing changed does not rewrite the store", async () => {
  // 每 20 秒写一次 etag 表就是一天四千多次无意义的 rename。
  const text = JSON.stringify(BOARD);
  const result = await collectSnapshots({
    members: [MEMBER],
    host: fakeHost(),
    store: { entries: { cpswang: { etag: '"v1"', digest: digestOf(text), state: "present" } } },
    fetchImpl: async () => response({ status: 304 }),
  });
  assert.equal(result.dirty, false);
});

test("snapshot: any change marks the store for writing", async () => {
  const written = await collectSnapshots({
    members: [MEMBER],
    host: fakeHost(),
    store: {},
    fetchImpl: async () => response({ body: JSON.stringify(BOARD) }),
  });
  assert.equal(written.dirty, true);

  // 状态从 absent 回到 present 也算变化：下一轮不该再走一次删除。
  const restored = await collectSnapshots({
    members: [MEMBER],
    host: fakeHost(),
    store: { entries: { cpswang: { state: "absent" } } },
    fetchImpl: async () => response({ status: 304 }),
  });
  assert.equal(restored.dirty, true);
  assert.equal(restored.store.entries.cpswang.state, "present");
});
