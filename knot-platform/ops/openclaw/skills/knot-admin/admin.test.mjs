import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildRequest, execute, isEntry, parseArgs, readAdminToken, tokenCandidates } from "./admin.mjs";

const TOKEN = "super-secret-token";

function jsonResponse(status, body) {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}

test("commands map onto the admin API", () => {
  const cases = [
    [["users", "--q", "ada"], { method: "GET", path: "/api/admin/users", query: { q: "ada" } }],
    [
      ["posts", "--user", "ada", "--within", "7d"],
      { method: "GET", path: "/api/admin/posts", query: { user: "ada", within: "7d" } },
    ],
    [
      ["remove", "--id", "post-1", "--reason", "含有欺诈内容。"],
      { method: "POST", path: "/api/admin/posts/post-1/remove", json: { reason: "含有欺诈内容。" } },
    ],
    [
      ["points", "--user", "ada", "--amount", "50", "--body", "补偿"],
      { method: "POST", path: "/api/admin/points", json: { user: "ada", amount: 50, body: "补偿" } },
    ],
    [
      ["entitlements", "--user", "ada", "--grant", "早期用户", "--grant", "供稿", "--revoke", "试用", "--body", "调整"],
      {
        method: "POST",
        path: "/api/admin/entitlements",
        json: { user: "ada", grant: ["早期用户", "供稿"], revoke: ["试用"], body: "调整" },
      },
    ],
    [
      ["sponsor-edit", "--id", "s1", "--image", ""],
      { method: "POST", path: "/api/admin/sponsors/s1", json: { image: "" } },
    ],
    [
      ["sponsor-add", "--title", "一则标题", "--href", "/store"],
      { method: "POST", path: "/api/admin/sponsors", json: { title: "一则标题", href: "/store" } },
    ],
    [["patrol-record", "--body", "无"], { method: "POST", path: "/api/admin/patrol", json: { body: "无" } }],
    [["system"], { method: "GET", path: "/api/admin/system" }],
    [
      ["system-set", "--guest-browsing", "0", "--registration", "invite"],
      {
        method: "PATCH",
        path: "/api/admin/system",
        json: { guestBrowsing: false, registrationMode: "invite" },
      },
    ],
    [
      ["invite-new", "--max-uses", "3", "--expires", "7d", "--note", "首批"],
      { method: "POST", path: "/api/admin/invites", json: { maxUses: 3, expiresIn: "7d", note: "首批" } },
    ],
    [["invites"], { method: "GET", path: "/api/admin/invites" }],
    [["invite-disable", "--id", "inv-1"], { method: "POST", path: "/api/admin/invites/inv-1/disable" }],
    [
      ["issue", "--name", "豆包", "--specialty", "网页搜索", "--specialty", "资料整理"],
      {
        method: "POST",
        path: "/api/admin/internal-agents",
        json: { name: "豆包", specialties: ["网页搜索", "资料整理"] },
      },
    ],
  ];
  for (const [argv, expected] of cases) {
    const parsed = parseArgs(argv);
    const built = buildRequest(parsed.command, parsed.flags);
    assert.equal(built.method, expected.method);
    assert.equal(built.path, expected.path);
    assert.deepEqual(built.query, expected.query);
    assert.deepEqual(built.json, expected.json);
  }
});

test("a call sends the bearer token and does not return it", async () => {
  let seen;
  const result = await execute(["users", "--q", "ada"], {
    token: TOKEN,
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      return jsonResponse(200, { users: [{ id: "1" }] });
    },
  });
  assert.equal(seen.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(new URL(seen.url).searchParams.get("q"), "ada");
  assert.equal(result.code, 0);
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
});

test("an empty token never calls the API", async () => {
  let called = false;
  const result = await execute(["patrol"], {
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

test("issue needs a name", () => {
  const parsed = parseArgs(["issue", "--specialty", "网页搜索"]);
  const built = buildRequest(parsed.command, parsed.flags);
  assert.equal(built.error.error, "bad_args");
});

test("a rejected name explains the rule without echoing a code", async () => {
  const result = await execute(["issue", "--name", "豆 包"], {
    token: TOKEN,
    fetch: async () => jsonResponse(400, { error: "bad_name" }),
  });
  assert.equal(result.code, 1);
  assert.equal(result.body.error, "bad_name");
  assert.match(result.body.hint, /连字符/);
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
});

test("a rejected token explains the mismatch without echoing the secret", async () => {
  const result = await execute(["patrol"], {
    token: TOKEN,
    fetch: async () => jsonResponse(401, { error: "bad_token" }),
  });
  assert.equal(result.code, 1);
  assert.equal(result.body.error, "bad_token");
  assert.match(result.body.hint, /KNOT_ADMIN_TOKEN/);
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
});

test("a downed admin API is reported as unreachable", async () => {
  const result = await execute(["sponsors"], {
    token: TOKEN,
    fetch: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });
  assert.equal(result.body.error, "unreachable");
});

test("upload sends the file and leaves out the token", async () => {
  let seen;
  const result = await execute(["upload", "--file", "/tmp/rail.jpg"], {
    token: TOKEN,
    readFile: async () => Buffer.from("img"),
    fetch: async (_url, init) => {
      seen = init.body.get("file");
      return jsonResponse(201, { id: "u1", url: "/api/web/uploads/u1" });
    },
  });
  assert.equal(result.code, 0);
  assert.equal(seen.name, "rail.jpg");
  assert.equal(seen.type, "image/jpeg");
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
});

test("a missing flag does not call the API", async () => {
  let called = false;
  const result = await execute(["warn", "--user", "ada"], {
    token: TOKEN,
    fetch: async () => {
      called = true;
      return jsonResponse(200, {});
    },
  });
  assert.equal(called, false);
  assert.equal(result.body.error, "bad_args");
  assert.match(result.body.hint, /--body/);
});

test("the token is read from the workspace file", async () => {
  const files = tokenCandidates("/work", "/work/skills/knot-admin/admin.mjs");
  assert.deepEqual(files, ["/work/.admin-token"]);
  const token = await readAdminToken(files, async (file) => {
    assert.equal(file, "/work/.admin-token");
    return "line-one\n";
  });
  assert.equal(token, "line-one");
  const empty = await readAdminToken(["/missing"], async () => {
    const error = new Error("missing");
    error.code = "ENOENT";
    throw error;
  });
  assert.equal(empty, "");
});

test("a symlinked path is still the entry, so the command speaks", () => {
  const script = fileURLToPath(new URL("./admin.mjs", import.meta.url));
  assert.equal(isEntry(script, ["node", script]), true);
  assert.equal(isEntry(script, ["node"]), false);
  assert.equal(isEntry(script, ["node", `${script}.nope`]), false);

  // macOS 的 /tmp 是软链，process.argv[1] 与 import.meta.url 会不一样。
  const dir = mkdtempSync(path.join(tmpdir(), "knot-admin-"));
  const link = path.join(dir, "admin.mjs");
  symlinkSync(script, link);
  const run = spawnSync(process.execPath, [link, "patrol"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(run.stdout.trim(), "", "软链路径下命令不该什么都不输出");
  assert.equal(JSON.parse(run.stdout).error, "admin_unconfigured");
  assert.equal(run.status, 1);
});
