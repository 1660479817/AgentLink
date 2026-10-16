import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execute, isEntry, readAdminToken, tokenCandidates } from "./actuary.mjs";

const TOKEN = "super-secret-token";

function jsonResponse(status, body) {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}

test("economy reads the three numbers and never echoes the token", async () => {
  let seen;
  const result = await execute(["economy"], {
    token: TOKEN,
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      return jsonResponse(200, { issued: 500, circulating: 480, platform: 20 });
    },
  });
  assert.equal(seen.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(new URL(seen.url).pathname, "/api/admin/economy");
  assert.equal(seen.init.method, "GET");
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, { issued: 500, circulating: 480, platform: 20 });
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
});

test("only economy is a command, and it takes no arguments", async () => {
  let called = false;
  const fetch = async () => {
    called = true;
    return jsonResponse(200, {});
  };
  const missing = await execute([], { token: TOKEN, fetch });
  assert.equal(missing.body.error, "bad_args");
  const extra = await execute(["economy", "--days", "30"], { token: TOKEN, fetch });
  assert.equal(extra.body.error, "bad_args");
  const unknown = await execute(["points", "--user", "ada"], { token: TOKEN, fetch });
  assert.equal(unknown.body.error, "bad_args");
  assert.equal(called, false);
});

test("an empty token never calls the API", async () => {
  let called = false;
  const result = await execute(["economy"], {
    token: "  ",
    fetch: async () => {
      called = true;
      return jsonResponse(200, {});
    },
  });
  assert.equal(called, false);
  assert.equal(result.body.error, "admin_unconfigured");
  assert.match(result.body.hint, /还没配好/);
});

test("a rejected token explains the mismatch without echoing the secret", async () => {
  const result = await execute(["economy"], {
    token: TOKEN,
    fetch: async () => jsonResponse(401, { error: "bad_token" }),
  });
  assert.equal(result.code, 1);
  assert.equal(result.body.error, "bad_token");
  assert.match(result.body.hint, /KNOT_ADMIN_TOKEN/);
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
});

test("a downed admin API is reported as unreachable", async () => {
  const result = await execute(["economy"], {
    token: TOKEN,
    fetch: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });
  assert.equal(result.body.error, "unreachable");
});

test("the token is read from the workspace file", async () => {
  const files = tokenCandidates("/work", "/work/skills/knot-actuary/actuary.mjs");
  assert.deepEqual(files, ["/work/.admin-token"]);
  const token = await readAdminToken(files, async (file) => {
    assert.equal(file, "/work/.admin-token");
    return "line-one\n";
  });
  assert.equal(token, "line-one");
});

test("a symlinked path is still the entry, so the command speaks", () => {
  const script = fileURLToPath(new URL("./actuary.mjs", import.meta.url));
  assert.equal(isEntry(script, ["node", script]), true);
  assert.equal(isEntry(script, ["node"]), false);
  assert.equal(isEntry(script, ["node", `${script}.nope`]), false);

  // macOS 的 /tmp 是软链，process.argv[1] 与 import.meta.url 会不一样。
  const dir = mkdtempSync(path.join(tmpdir(), "knot-actuary-"));
  const link = path.join(dir, "actuary.mjs");
  symlinkSync(script, link);
  const run = spawnSync(process.execPath, [link, "economy"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(run.stdout.trim(), "", "软链路径下命令不该什么都不输出");
  assert.equal(JSON.parse(run.stdout).error, "admin_unconfigured");
  assert.equal(run.status, 1);
});
