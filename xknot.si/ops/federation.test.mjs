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
  broken.members.find((member) => member.id === "zjj").role = "founder";
  const problems = validateRoster(broken, manifest);
  assert.ok(problems.some(([id, errors]) => id === "—" && errors.some((e) => e.startsWith("founder:"))));
});

test("tunnel accounts and ports must be unique", async () => {
  const { roster, manifest } = await load();
  const broken = clone(roster);
  broken.members.find((member) => member.id === "zjj").tunnel = { account: "knot-tunnel", port: 18080 };
  const problems = validateRoster(broken, manifest);
  const errors = problems.find(([id]) => id === "zjj")?.[1] || [];
  assert.ok(errors.some((e) => e.startsWith("tunnel.account: duplicate")));
  assert.ok(errors.some((e) => e.startsWith("tunnel.port: duplicate")));
});

test("tunnel is required for subdomain mode and forbidden for own-domain", async () => {
  const { roster, manifest } = await load();

  const noTunnel = clone(roster);
  noTunnel.members.find((member) => member.id === "wang").tunnel = null;
  const problems = validateRoster(noTunnel, manifest);
  assert.ok(
    problems.some(([id, errors]) => id === "wang" && errors.includes("tunnel: required when mode is subdomain"))
  );

  const ownDomain = clone(roster);
  ownDomain.members.find((member) => member.id === "wang").mode = "own-domain";
  const ownProblems = validateRoster(ownDomain, manifest);
  assert.ok(
    ownProblems.some(([id, errors]) => id === "wang" && errors.includes("tunnel: must be null when mode is own-domain"))
  );
});

test("mode and url must agree", async () => {
  const { roster, manifest } = await load();

  // 自有域名模式不能挂在 hub 下。
  const hubHost = clone(roster);
  hubHost.members.find((member) => member.id === "wang").mode = "own-domain";
  hubHost.members.find((member) => member.id === "wang").tunnel = null;
  assert.ok(
    validateRoster(hubHost, manifest).some(([id, errors]) =>
      id === "wang" && errors.some((e) => e.startsWith("mode: own-domain"))
    )
  );

  // 签发子域模式必须在 hub 下。
  const outside = clone(roster);
  outside.members.find((member) => member.id === "zjj").host = "zjj.example";
  const otherwise = clone(manifest);
  otherwise.instances.find((instance) => instance.id === "zjj").url = "https://zjj.example";
  assert.ok(
    validateRoster(outside, otherwise).some(([id, errors]) =>
      id === "zjj" && errors.some((e) => e.startsWith("mode: subdomain"))
    )
  );
});

test("a member listed in the roster must exist in the manifest, and the reverse", async () => {
  const { roster, manifest } = await load();

  const missingEntry = clone(roster);
  missingEntry.members.find((member) => member.id === "zjj").listed = false;
  assert.ok(validateRoster(missingEntry, manifest).some(([id, errors]) => id === "zjj" && errors[0].includes("present in instances.json")));

  const orphan = clone(manifest);
  orphan.instances.push({ ...orphan.instances[0], id: "ghost" });
  assert.ok(validateRoster(roster, orphan).some(([id, errors]) => id === "ghost" && errors[0].startsWith("roster:")));
});

test("the roster host must match the published url host", async () => {
  const { roster, manifest } = await load();
  const broken = clone(manifest);
  broken.instances.find((instance) => instance.id === "zjj").url = "https://zj.example";
  const problems = validateRoster(roster, broken);
  assert.ok(problems.some(([id, errors]) => id === "zjj" && errors.some((e) => e.startsWith("host:"))));
});

test("a listed member needs since, and reserved hosts stay out of the manifest", async () => {
  const { roster, manifest } = await load();

  const noDate = clone(roster);
  noDate.members.find((member) => member.id === "zjj").since = null;
  assert.ok(validateRoster(noDate, manifest).some(([id, errors]) => id === "zjj" && errors.includes("since: required")));

  const leaked = clone(manifest);
  leaked.instances.push({ ...leaked.instances[0], id: "travel", url: "https://travel.xknot.si" });
  assert.ok(validateRoster(roster, leaked).some(([id, errors]) => id === "travel" && errors[0].includes("not registered in federation.json")));
});

test("the founder must stay tier partner", async () => {
  const { roster, manifest } = await load();
  const broken = clone(manifest);
  broken.instances.find((instance) => instance.id === "wang").tier = "community";
  const problems = validateRoster(roster, broken);
  assert.ok(problems.some(([id, errors]) => id === "wang" && errors.some((e) => e.startsWith("tier:"))));
});

test("unknown enum values are rejected", async () => {
  const { roster, manifest } = await load();
  const broken = clone(roster);
  const zjj = broken.members.find((member) => member.id === "zjj");
  zjj.role = "owner";
  zjj.standing = "trial";
  zjj.mode = "vpn";
  const errors = validateRoster(broken, manifest).find(([id]) => id === "zjj")?.[1] || [];
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
