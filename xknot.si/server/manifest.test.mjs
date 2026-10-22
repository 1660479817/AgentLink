// 清单条目 → 名册成员的推导。
//
// 名册与清单靠 id 双向对齐；host 只能从条目 url 取，标题里不再抄一遍。
// 接入只有签发子域一种，所以 mode 恒为 subdomain。

import assert from "node:assert/strict";
import test from "node:test";

import { toRosterMember } from "./manifest.mjs";
import { validateMemberRecord } from "../ops/validate-federation.mjs";

const ENTRY = { id: "cpswang", url: "https://cpswang.xknot.si", since: "2026-10-21" };

test("roster member: host comes from the manifest url", () => {
  const member = toRosterMember(ENTRY, { tunnelAccount: "knot-tunnel-cpswang", tunnelPort: 18090 });
  assert.equal(member.id, "cpswang");
  assert.equal(member.host, "cpswang.xknot.si");
  assert.equal(member.mode, "subdomain");
  assert.equal(member.listed, true);
  assert.equal(member.since, "2026-10-21");
  assert.deepEqual(member.tunnel, { account: "knot-tunnel-cpswang", port: 18090 });
  assert.deepEqual(validateMemberRecord(member), []);
});

test("roster member: partners are regular, founders are permanent", () => {
  assert.equal(toRosterMember(ENTRY, { tunnelAccount: "a", tunnelPort: 18090 }).standing, "regular");
  assert.equal(
    toRosterMember(ENTRY, { tunnelAccount: "a", tunnelPort: 18090, role: "founder" }).standing,
    "permanent"
  );
  // 显式给的 standing 不被默认值盖掉。
  assert.equal(
    toRosterMember(ENTRY, { tunnelAccount: "a", tunnelPort: 18090, role: "founder", standing: "regular" })
      .standing,
    "regular"
  );
});

test("roster member: a bad tunnel fails the same validator the build uses", () => {
  const member = toRosterMember(ENTRY, { tunnelAccount: "Bad Account", tunnelPort: 80 });
  const problems = validateMemberRecord(member);
  assert.ok(problems.some((item) => item.startsWith("tunnel.account")), problems.join("; "));
  assert.ok(problems.some((item) => item.startsWith("tunnel.port")), problems.join("; "));
});
