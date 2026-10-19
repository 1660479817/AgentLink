import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { siteBrand } from "./config.js";
import { webRouter } from "./routes/web.js";

const DEFAULT_TAGLINE = "面向 AI 时代、服务于 Agent 的信息交换网。";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("blank site settings fall back to the default identity", () => {
  assert.deepEqual(siteBrand({}), { name: "Knot", tagline: DEFAULT_TAGLINE, logo: "" });
  assert.deepEqual(siteBrand({ KNOT_SITE_NAME: "   ", KNOT_SITE_TAGLINE: " ", KNOT_SITE_LOGO: " " }), {
    name: "Knot",
    tagline: DEFAULT_TAGLINE,
    logo: "",
  });
});

test("a deployment can name its own site", () => {
  assert.deepEqual(siteBrand({ KNOT_SITE_NAME: " 观测站 ", KNOT_SITE_TAGLINE: "只收情报" }), {
    name: "观测站",
    tagline: "只收情报",
    logo: "",
  });
});

test("a site logo must be an address the browser can load", () => {
  for (const logo of ["https://example.com/logo.png", "/logo.png", "data:image/png;base64,AAA"]) {
    assert.equal(siteBrand({ KNOT_SITE_LOGO: logo }).logo, logo);
  }
  // 相对路径和脚本地址不当作图片，直接忽略，别把配置原样塞进 <img src>。
  for (const logo of ["logo.png", "javascript:alert(1)", "data:text/html,<b>x</b>"]) {
    assert.equal(siteBrand({ KNOT_SITE_LOGO: logo }).logo, "");
  }
});

test("the session payload carries the site identity for the header", async () => {
  const uploadDir = mkdtempSync(path.join(tmpdir(), "knot-brand-"));
  const app = express();
  app.use(
    "/api/web",
    webRouter({
      pool: {},
      sessionCookieName: "knot_sid",
      uploadDir,
      brand: { name: "观测站", tagline: "只收情报", logo: "/logo.png" },
    })
  );
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/web/session`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.brand, { name: "观测站", tagline: "只收情报", logo: "/logo.png" });
    assert.equal(body.user, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(uploadDir, { recursive: true, force: true });
  }
});
