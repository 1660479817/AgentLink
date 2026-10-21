import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { brandView, cleanProfile, createProfileStore, pickLocale, profileFilePath } from "./profile.js";
import { webRouter } from "./routes/web.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function profileFile(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-profile-"));
  const file = path.join(dir, "profile.json");
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { dir, file };
}

test("a missing profile is not an error: the site simply has no self-description yet", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-profile-"));
  try {
    const store = createProfileStore({ file: path.join(dir, "profile.json") });
    const state = await store.reload();
    assert.equal(state.profile, null);
    assert.deepEqual(state.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the brand view keeps every locale instead of choosing one on the server", () => {
  const { profile } = cleanProfile({
    name: { en: "Knot · wang", "zh-CN": "Knot · wang" },
    intro: { oneLine: { en: "Exchange", "zh-CN": "交换" }, long: { en: "Long text." } },
    owner: { en: "PaulWang" },
    contact: "owner@example.com",
    logo: "https://wang.xknot.si/logo.png",
    themeColor: "#0866FF",
  });
  assert.deepEqual(brandView(profile), {
    name: { en: "Knot · wang", "zh-CN": "Knot · wang" },
    tagline: { en: "Exchange", "zh-CN": "交换" },
    logo: "https://wang.xknot.si/logo.png",
    owner: { en: "PaulWang" },
    intro: { en: "Long text." },
    contact: "owner@example.com",
    themeColor: "#0866FF",
  });
  assert.deepEqual(brandView(null), {
    name: null,
    tagline: null,
    logo: "",
    owner: null,
    intro: null,
    contact: "",
    themeColor: "",
  });
});

test("pickLocale falls back through en, zh-CN, zh-TW, then any value", () => {
  const map = { en: "Site", "zh-CN": "站点", "zh-TW": "站點" };
  assert.equal(pickLocale(map, "zh-TW"), "站點");
  assert.equal(pickLocale(map, "en"), "Site");
  assert.equal(pickLocale({ "zh-CN": "站点" }, "en"), "站点");
  assert.equal(pickLocale({ fr: "Site" }, "en"), "Site");
  assert.equal(pickLocale(null, "en"), "");
});

test("a saved profile is written in the documented shape and reloads", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-profile-"));
  try {
    const file = path.join(dir, "profile.json");
    const store = createProfileStore({ file });
    await store.reload();
    await store.save(
      {
        profile: {
          name: { en: "Knot" },
          intro: { oneLine: { en: "Exchange" } },
          contact: "ops@example.com",
        },
      },
      { now: () => new Date("2026-10-21T04:05:06Z") }
    );
    const state = store.view();
    assert.equal(state.updatedAt, "2026-10-21");
    assert.equal(state.profile.name.en, "Knot");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid profile is rejected and the previous file is kept", async () => {
  const { dir, file } = profileFile({
    formatVersion: 1,
    updatedAt: "2026-10-20",
    profile: { name: { en: "Old" }, intro: { oneLine: { en: "Old" } }, contact: "old@example.com" },
  });
  try {
    const store = createProfileStore({ file });
    await store.reload();
    await assert.rejects(
      () => store.save({ profile: { name: { en: "New" } } }),
      (error) => error.code === "bad_profile" && error.problems.includes("intro: required")
    );
    assert.equal(store.view().profile.name.en, "Old");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the profile file sits next to xknot.env, and can be pointed at explicitly", () => {
  assert.equal(
    profileFilePath({}, "/srv/knot/sites/wang/agents"),
    path.join("/srv/knot/sites/wang", "profile.json")
  );
  assert.equal(profileFilePath({ KNOT_PROFILE_FILE: "/tmp/p.json" }, "/srv/knot/sites/wang/agents"), "/tmp/p.json");
  assert.equal(profileFilePath({}, null), null);
});

test("the session payload carries the site identity for the header", async () => {
  const uploadDir = mkdtempSync(path.join(tmpdir(), "knot-brand-"));
  const { dir, file } = profileFile({
    formatVersion: 1,
    updatedAt: "2026-10-21",
    profile: {
      name: { en: "Observatory", "zh-CN": "观测站" },
      intro: { oneLine: { en: "Intel only.", "zh-CN": "只收情报" } },
      logo: "https://example.test/logo.png",
      owner: { en: "PaulWang" },
      contact: "owner@example.com",
    },
  });
  const store = createProfileStore({ file });
  await store.reload();

  const app = express();
  app.use(
    "/api/web",
    webRouter({
      pool: {},
      sessionCookieName: "knot_sid",
      uploadDir,
      profile: store,
    })
  );
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/web/session`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.brand.name, { en: "Observatory", "zh-CN": "观测站" });
    assert.deepEqual(body.brand.tagline, { en: "Intel only.", "zh-CN": "只收情报" });
    assert.equal(body.brand.logo, "https://example.test/logo.png");
    assert.deepEqual(body.brand.owner, { en: "PaulWang" });
    assert.equal(body.brand.contact, "owner@example.com");
    assert.equal(body.user, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(uploadDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
