import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { updateInstanceConfig } from "./edit.mjs";

const INSTANCE = {
  id: "wang",
  url: "https://wang.xknot.si",
  since: "2026-10-19",
  tier: "paid",
  status: "active",
};

const MEMBER = {
  id: "wang",
  host: "wang.xknot.si",
  role: "founder",
  standing: "permanent",
  mode: "subdomain",
  tunnel: { account: "knot-tunnel", port: 18080 },
  listed: true,
  since: "2026-10-19",
  note: "创始实例。",
};

function setup(t, { instances = [INSTANCE], members = [MEMBER] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "xknot-edit-"));
  const instancesFile = path.join(dir, "instances.json");
  const federationFile = path.join(dir, "federation.json");
  writeFileSync(instancesFile, `${JSON.stringify({ version: 3, updatedAt: "2026-10-19", instances }, null, 2)}\n`);
  writeFileSync(
    federationFile,
    `${JSON.stringify({ version: 1, updatedAt: "2026-10-19", hub: "xknot.si", members }, null, 2)}\n`
  );
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const read = () => ({
    manifest: JSON.parse(readFileSync(instancesFile, "utf8")),
    roster: JSON.parse(readFileSync(federationFile, "utf8")),
  });
  return { instancesFile, federationFile, read };
}

test("edit: 保存清单与名册，其他字段原样保留", async (t) => {
  const files = setup(t);

  const result = await updateInstanceConfig({
    instancesFile: files.instancesFile,
    federationFile: files.federationFile,
    id: "wang",
    instance: {
      url: "https://wang.xknot.si",
      tier: "paid",
      status: "suspended",
      since: "2026-10-19",
      cardsUrl: "",
      statsUrl: "",
    },
    member: {
      host: "wang.xknot.si",
      role: "founder",
      standing: "permanent",
      listed: true,
      since: "2026-10-19",
      note: "改过备注。",
    },
  });

  assert.equal(result.error, undefined, JSON.stringify(result));
  const { manifest, roster } = files.read();
  const instance = manifest.instances[0];
  assert.equal(instance.status, "suspended");
  assert.equal(instance.cardsUrl, undefined, "空字符串等于删掉该字段");
  assert.equal(instance.since, "2026-10-19");

  const member = roster.members[0];
  assert.equal(member.note, "改过备注。");
  assert.equal(member.mode, "subdomain", "接入形态不由编辑改动");
  assert.deepEqual(member.tunnel, { account: "knot-tunnel", port: 18080 });
});

test("edit: 清单地址必须挂在中枢名下", async (t) => {
  const files = setup(t);
  const before = files.read();

  const result = await updateInstanceConfig({
    instancesFile: files.instancesFile,
    federationFile: files.federationFile,
    id: "wang",
    instance: { url: "https://knot.example.com" },
  });

  assert.equal(result.error, "invalid");
  assert.ok(result.fields.some((message) => message.includes("xknot.si")));
  assert.deepEqual(files.read(), before);
});

test("edit: 校验不过时不落盘", async (t) => {
  const files = setup(t);
  const before = files.read();

  const result = await updateInstanceConfig({
    instancesFile: files.instancesFile,
    federationFile: files.federationFile,
    id: "wang",
    instance: { url: "http://not-https.example" },
    member: null,
  });

  assert.equal(result.error, "invalid");
  assert.ok(result.fields.some((message) => message.includes("url")));
  assert.deepEqual(files.read(), before, "校验失败必须保持文件不变");
});

test("edit: 名册里没有的实例可以补一条", async (t) => {
  const files = setup(t, { members: [] });

  const result = await updateInstanceConfig({
    instancesFile: files.instancesFile,
    federationFile: files.federationFile,
    id: "wang",
    instance: { tier: "paid" },
    member: {
      host: "wang.xknot.si",
      role: "partner",
      standing: "regular",
      mode: "subdomain",
      tunnel: { account: "knot-tunnel", port: 18080 },
      listed: true,
      since: "2026-10-19",
      note: "补登记。",
    },
  });

  assert.equal(result.error, undefined, JSON.stringify(result));
  const { roster } = files.read();
  assert.equal(roster.members.length, 1);
  assert.equal(roster.members[0].id, "wang");
  assert.equal(roster.members[0].role, "partner");
});

test("edit: 改完 leader 身份会撞上名册规则，被拒绝", async (t) => {
  const files = setup(t);

  const result = await updateInstanceConfig({
    instancesFile: files.instancesFile,
    federationFile: files.federationFile,
    id: "wang",
    instance: {},
    member: { role: "partner", standing: "permanent", listed: true, host: "wang.xknot.si" },
  });

  assert.equal(result.error, "invalid");
  assert.ok(
    result.fields.some((message) => message.includes("founder")),
    `应该提示创始席位缺失，实际：${result.fields.join(" | ")}`
  );
});

test("edit: 不存在的实例返回 not_found，不写文件", async (t) => {
  const files = setup(t);
  const before = files.read();
  const result = await updateInstanceConfig({
    instancesFile: files.instancesFile,
    federationFile: files.federationFile,
    id: "ghost",
    instance: { tier: "paid" },
  });
  assert.equal(result.error, "not_found");
  assert.deepEqual(files.read(), before);
});

test("edit: 没给文件路径时明确拒绝", async () => {
  const result = await updateInstanceConfig({ instancesFile: null, id: "wang", instance: {} });
  assert.equal(result.error, "editing_unavailable");
});
