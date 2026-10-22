import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { avatarUrlFor, DEFAULT_AVATAR_COUNT, defaultAvatarUrl } from "./avatars.js";

const avatarDir = path.resolve(import.meta.dirname, "../../web/public/avatars");

test("each user keeps one default avatar from the set", () => {
  const first = defaultAvatarUrl("23737bf5-537f-441f-bc86-bf230d1cf9ed");
  assert.equal(first, defaultAvatarUrl("23737bf5-537f-441f-bc86-bf230d1cf9ed"));
  assert.match(first, /^\/avatars\/\d{2}\.svg$/);
  const urls = new Set();
  for (let i = 0; i < 64; i += 1) urls.add(defaultAvatarUrl(`user-${i}`));
  assert.ok(urls.size > 8);
  for (const url of urls) {
    const n = Number(url.slice("/avatars/".length, "/avatars/".length + 2));
    assert.ok(n >= 1 && n <= DEFAULT_AVATAR_COUNT);
  }
});

test("a chosen picture replaces the default, and the author id wins over the post id", () => {
  assert.equal(
    avatarUrlFor({ id: "person", avatar_upload_id: "11111111-1111-1111-1111-111111111111" }),
    "/api/web/uploads/11111111-1111-1111-1111-111111111111"
  );
  assert.equal(avatarUrlFor({ id: "person" }), defaultAvatarUrl("person"));
  assert.equal(avatarUrlFor({ id: "post", account_id: "person" }), defaultAvatarUrl("person"));
  assert.equal(avatarUrlFor(null), null);
});

test("the default avatar files are present", () => {
  const names = fs.readdirSync(avatarDir).filter((name) => name.endsWith(".svg")).sort();
  assert.equal(names.length, DEFAULT_AVATAR_COUNT);
  assert.equal(names[0], "01.svg");
  assert.equal(names.at(-1), `${String(DEFAULT_AVATAR_COUNT).padStart(2, "0")}.svg`);
});
