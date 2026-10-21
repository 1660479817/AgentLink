import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";

import { createProfileStore } from "../profile.js";
import { adminRouter } from "./admin.js";

const TOKEN = "test-token";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function withAdmin(fn, { file = null } = {}) {
  const store = createProfileStore({ file });
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool: {}, token: TOKEN, profile: store, publicWebOrigin: "https://knot.example" }));
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const call = (pathname, options = {}) =>
    fetch(`${base}${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
  try {
    return await fn({ call });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("the site owner reads the two halves in one request", async () => {
  await withAdmin(async ({ call }) => {
    const response = await call("/profile");
    assert.equal(response.status, 200);
    const data = await response.json();
    // 签发区来自接入件，端侧没有接入件时是空串而不是 null。
    assert.equal(data.issued.id, "");
    assert.equal(data.issued.url, "https://knot.example");
    assert.equal(data.site, null);
    assert.equal(data.updatedAt, null);
  });
});

test("a saved profile is validated, written, and read back", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-admin-profile-"));
  const file = path.join(dir, "profile.json");
  try {
    await withAdmin(
      async ({ call }) => {
        const saved = await call("/profile", {
          method: "PUT",
          body: JSON.stringify({
            site: {
              name: "王的站点",
              tagline: "收二手，也收问题。",
              owner: "Paul",
              contact: "paul@example.com",
              region: "CN",
              timezone: "Asia/Shanghai",
              tags: ["二手", "问答"],
            },
          }),
        });
        assert.equal(saved.status, 200);
        const savedBody = await saved.json();
        assert.equal(savedBody.site.name, "王的站点");
        assert.match(savedBody.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
        // 保存后表单要能继续显示文件位置，所以响应里带着它。
        assert.equal(savedBody.file, file);

        const onDisk = JSON.parse(readFileSync(file, "utf8"));
        assert.equal(onDisk.formatVersion, 2);
        assert.equal(onDisk.site.owner, "Paul");

        const again = await (await call("/profile")).json();
        assert.equal(again.site.tagline, "收二手，也收问题。");
        assert.deepEqual(again.site.tags, ["二手", "问答"]);
      },
      { file }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid profile is refused with per-field problems and nothing is written", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-admin-profile-"));
  const file = path.join(dir, "profile.json");
  try {
    await withAdmin(
      async ({ call }) => {
        const response = await call("/profile", {
          method: "PUT",
          body: JSON.stringify({ site: { logo: "http://insecure.example/a.png", region: "中国" } }),
        });
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.error, "bad_profile");
        assert.ok(body.problems.includes("name: required"));
        assert.ok(body.problems.includes("logo: must be https, or omit it"));
        assert.ok(body.problems.includes("region: must be a two-letter country code, or GLOBAL"));
        assert.throws(() => readFileSync(file, "utf8"), { code: "ENOENT" });
      },
      { file }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a release without a site directory refuses to accept a profile", async () => {
  await withAdmin(async ({ call }) => {
    const response = await call("/profile", {
      method: "PUT",
      body: JSON.stringify({ site: { name: "站点", tagline: "介绍" } }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "profile_unconfigured");
  });
});
