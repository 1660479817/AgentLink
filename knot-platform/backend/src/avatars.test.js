import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  agentAvatarSlug,
  agentAvatarUrl,
  avatarUrlFor,
  DEFAULT_AVATAR_COUNT,
  defaultAvatarUrl,
} from "./avatars.js";
import { AGENT_TYPES, GENERIC_AGENT_TYPE } from "./agentTypes.js";

const avatarDir = path.resolve(import.meta.dirname, "../../web/public/avatars");
const agentAvatarDir = path.join(avatarDir, "agents");

test("each user keeps one default avatar from the set", () => {
  const first = defaultAvatarUrl("33333333-3333-4333-8333-333333333333");
  assert.equal(first, defaultAvatarUrl("33333333-3333-4333-8333-333333333333"));
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

test("an agent picks its avatar by the product in its name", () => {
  assert.equal(agentAvatarUrl("豆包二号"), "/avatars/agents/doubao.svg");
  assert.equal(agentAvatarUrl("Manus 助理"), "/avatars/agents/manus.svg");
  assert.equal(agentAvatarUrl("DeepSeek Pro"), "/avatars/agents/deepseek.svg");
  assert.equal(agentAvatarUrl("work buddy"), "/avatars/agents/workbuddy.svg");
  assert.equal(agentAvatarUrl("OpenClaw 01"), "/avatars/agents/openclaw.svg");
  assert.equal(agentAvatarUrl("Hermes"), "/avatars/agents/hermes.svg");
  assert.equal(agentAvatarUrl("小助手"), `/avatars/agents/${GENERIC_AGENT_TYPE}.svg`);
  assert.equal(agentAvatarUrl(null), `/avatars/agents/${GENERIC_AGENT_TYPE}.svg`);
});

test("a declared type wins over the name, and an unknown one does not fall back to it", () => {
  // 自述了就是自述的那一张，称呼里写着别的产品也不算数。
  assert.equal(agentAvatarUrl({ agent_type: "doubao", display_name: "Manus 助理" }), "/avatars/agents/doubao.svg");
  // 自述的是别名，一样归一。
  assert.equal(agentAvatarUrl({ agent_type: "豆包" }), "/avatars/agents/doubao.svg");
  // 自述了名单外的产品：通用图，不再回头按称呼猜。
  assert.equal(
    agentAvatarUrl({ agent_type: "cursor", display_name: "豆包四号" }),
    `/avatars/agents/${GENERIC_AGENT_TYPE}.svg`
  );
  // 没自述才看称呼。
  assert.equal(agentAvatarUrl({ agent_type: null, display_name: "豆包四号" }), "/avatars/agents/doubao.svg");
});

test("every agent named in the README table has its own avatar", () => {
  // 表在仓库根的 README 里（IPA 那一行）：Grokbot、Manus、……、doubao 等。
  // 名字与图必须一起长，改表忘了补图时这条会红。
  // README 会被译成英文，别绑死中文句子：认 (IPA) 这个稳定标记，再取名字段。
  const readme = fs.readFileSync(path.resolve(import.meta.dirname, "../../../README.md"), "utf8");
  const line = readme.split("\n").find((item) => item.includes("(IPA)"));
  assert.ok(line, "README 里找不到 IPA 那一行");
  const listed = line.match(/Personal Agents\.\s+(.+?)\s+and other agents/);
  assert.ok(listed, "IPA 那一行没有列出 Agent 名字");
  const names = listed[1].split(",").map((name) => name.trim()).filter(Boolean);
  assert.ok(names.length >= 7);
  for (const name of names) {
    const slug = agentAvatarSlug(name);
    assert.notEqual(slug, GENERIC_AGENT_TYPE, `${name} 还没有自己的头像`);
    assert.ok(fs.existsSync(path.join(agentAvatarDir, `${slug}.svg`)), `${name} 指向的 ${slug}.svg 不存在`);
  }
});

test("only agent rows leave the portrait set; a chosen picture still wins", () => {
  assert.equal(
    avatarUrlFor({ id: "bot", role: "agent", display_name: "Kimi 001" }),
    "/avatars/agents/kimi.svg"
  );
  assert.equal(
    avatarUrlFor({ id: "bot", role: "agent", display_name: "小助手" }),
    `/avatars/agents/${GENERIC_AGENT_TYPE}.svg`
  );
  // 自述的类型比称呼更可信，头像跟着自述走。
  assert.equal(
    avatarUrlFor({ id: "bot", role: "agent", display_name: "小助手", agent_type: "manus" }),
    "/avatars/agents/manus.svg"
  );
  // 人叫「豆包」也还是分人像，Agent 那套不跟称呼串门。
  assert.match(avatarUrlFor({ id: "person", role: "user", display_name: "豆包" }), /^\/avatars\/\d{2}\.svg$/);
  assert.equal(
    avatarUrlFor({
      id: "bot",
      role: "agent",
      display_name: "豆包",
      avatar_upload_id: "11111111-1111-1111-1111-111111111111",
    }),
    "/api/web/uploads/11111111-1111-1111-1111-111111111111"
  );
});

test("the agent avatar files match the list and stay parseable", () => {
  const names = fs.readdirSync(agentAvatarDir).filter((name) => name.endsWith(".svg"));
  const expected = [...AGENT_TYPES.map((item) => `${item.slug}.svg`), `${GENERIC_AGENT_TYPE}.svg`].sort();
  assert.deepEqual(names.sort(), expected);
  for (const name of names) {
    const text = fs.readFileSync(path.join(agentAvatarDir, name), "utf8");
    // 控制字符会把 XML 写坏，svg 在这里是当文本存的，先在测试里挡住。
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text), `${name} carries control characters`);
    assert.ok(text.startsWith("<svg"), `${name} does not open with <svg`);
    assert.ok(text.trimEnd().endsWith("</svg>"), `${name} does not close with </svg>`);
  }
});
