import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateRoster } from "./validate-federation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function load() {
  const [roster, manifest] = await Promise.all([
    readFile(path.join(HERE, "..", "federation.json"), "utf8").then(JSON.parse),
    readFile(path.join(HERE, "..", "instances.json"), "utf8").then(JSON.parse),
  ]);
  return { roster, manifest };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

test("the shipped roster and manifest agree", async () => {
  const { roster, manifest } = await load();
  assert.deepEqual(validateRoster(roster, manifest), []);
});

test("the founder is a permanent account and cannot be unlisted", async () => {
  const { roster, manifest } = await load();
  const founder = roster.members.find((member) => member.role === "founder");
  assert.equal(founder.id, "wang");
  assert.equal(founder.standing, "permanent");

  const broken = clone(roster);
  broken.members.find((member) => member.id === "wang").listed = false;
  const problems = validateRoster(broken, manifest);
  assert.ok(problems.some(([id, errors]) => id === "wang" && errors.some((e) => e.startsWith("listed"))));
});

test("exactly one founder is allowed", async () => {
  const { roster, manifest } = await load();
  const broken = clone(roster);
  broken.members.find((member) => member.id === "cpswang").role = "founder";
  const problems = validateRoster(broken, manifest);
  assert.ok(problems.some(([id, errors]) => id === "—" && errors.some((e) => e.startsWith("founder:"))));
});

test("tunnel accounts must be knot-tunnel names, never system accounts", async () => {
  const { roster, manifest } = await load();
  // 名册是开通流程取账号的唯一来源：一个手写条目就能让它去操作已有系统账号。
  for (const account of ["root", "ec2-user", "nginx", "adm", "sshd", "postgres"]) {
    const broken = clone(roster);
    broken.members.find((member) => member.id === "cpswang").tunnel.account = account;
    const errors = validateRoster(broken, manifest).find(([id]) => id === "cpswang")?.[1] || [];
    assert.ok(
      errors.some((error) => error.startsWith("tunnel.account:")),
      `${account} must be refused`
    );
  }
  // 本流程自己的命名照常通过。
  const fine = clone(roster);
  fine.members.find((member) => member.id === "cpswang").tunnel.account = "knot-tunnel-cpswang-2";
  assert.deepEqual(validateRoster(fine, manifest), []);
});

test("tunnel accounts and ports must be unique", async () => {
  const { roster, manifest } = await load();
  const broken = clone(roster);
  broken.members.find((member) => member.id === "cpswang").tunnel = { account: "knot-tunnel", port: 18080 };
  const problems = validateRoster(broken, manifest);
  const errors = problems.find(([id]) => id === "cpswang")?.[1] || [];
  assert.ok(errors.some((e) => e.startsWith("tunnel.account: duplicate")));
  assert.ok(errors.some((e) => e.startsWith("tunnel.port: duplicate")));
});

test("every member needs an entry tunnel", async () => {
  const { roster, manifest } = await load();

  const noTunnel = clone(roster);
  noTunnel.members.find((member) => member.id === "wang").tunnel = null;
  const problems = validateRoster(noTunnel, manifest);
  assert.ok(
    problems.some(([id, errors]) =>
      id === "wang" && errors.includes("tunnel: required — every member is served through the entry tunnel")
    )
  );
});

test("the published host must sit under the hub", async () => {
  const { roster, manifest } = await load();

  const outside = clone(roster);
  outside.members.find((member) => member.id === "cpswang").host = "cpswang.example";
  const otherwise = clone(manifest);
  otherwise.instances.find((instance) => instance.id === "cpswang").url = "https://cpswang.example";
  assert.ok(
    validateRoster(outside, otherwise).some(([id, errors]) =>
      id === "cpswang" && errors.some((e) => e.startsWith("host: must be under xknot.si"))
    )
  );
});

test("a member listed in the roster must exist in the manifest, and the reverse", async () => {
  const { roster, manifest } = await load();

  const missingEntry = clone(roster);
  missingEntry.members.find((member) => member.id === "cpswang").listed = false;
  assert.ok(validateRoster(missingEntry, manifest).some(([id, errors]) => id === "cpswang" && errors[0].includes("present in instances.json")));

  const orphan = clone(manifest);
  orphan.instances.push({ ...orphan.instances[0], id: "ghost" });
  assert.ok(validateRoster(roster, orphan).some(([id, errors]) => id === "ghost" && errors[0].startsWith("roster:")));
});

test("the roster host must match the published url host", async () => {
  const { roster, manifest } = await load();
  const broken = clone(manifest);
  broken.instances.find((instance) => instance.id === "cpswang").url = "https://zj.example";
  const problems = validateRoster(roster, broken);
  assert.ok(problems.some(([id, errors]) => id === "cpswang" && errors.some((e) => e.startsWith("host:"))));
});

test("a listed member needs since, and reserved hosts stay out of the manifest", async () => {
  const { roster, manifest } = await load();

  const noDate = clone(roster);
  noDate.members.find((member) => member.id === "cpswang").since = null;
  assert.ok(validateRoster(noDate, manifest).some(([id, errors]) => id === "cpswang" && errors.includes("since: required")));

  const leaked = clone(manifest);
  leaked.instances.push({ ...leaked.instances[0], id: "travel", url: "https://travel.xknot.si" });
  assert.ok(validateRoster(roster, leaked).some(([id, errors]) => id === "travel" && errors[0].includes("not registered in federation.json")));
});

test("the founder must stay in the paid tier", async () => {
  const { roster, manifest } = await load();
  const broken = clone(manifest);
  broken.instances.find((instance) => instance.id === "wang").tier = "free";
  const problems = validateRoster(roster, broken);
  assert.ok(problems.some(([id, errors]) => id === "wang" && errors.some((e) => e.startsWith("tier:"))));
});

test("unknown enum values are rejected", async () => {
  const { roster, manifest } = await load();
  const broken = clone(roster);
  const partner = broken.members.find((member) => member.id === "cpswang");
  partner.role = "owner";
  partner.standing = "trial";
  partner.mode = "vpn";
  const errors = validateRoster(broken, manifest).find(([id]) => id === "cpswang")?.[1] || [];
  assert.ok(errors.some((e) => e.startsWith("role:")));
  assert.ok(errors.some((e) => e.startsWith("standing:")));
  assert.ok(errors.some((e) => e.startsWith("mode:")));
});

test("an empty or malformed roster reports instead of throwing", () => {
  assert.deepEqual(validateRoster(null, { instances: [] }), [["", ["roster: must be an object"]]]);
  const problems = validateRoster({ version: 0, hub: "NOPE" }, { instances: [] });
  assert.ok(problems.some(([id, errors]) => id === "" && errors.some((e) => e.startsWith("version:"))));
  assert.ok(problems.some(([id, errors]) => id === "" && errors.some((e) => e.startsWith("hub:"))));
});
