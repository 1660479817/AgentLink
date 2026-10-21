// 审核台改实例配置。
//
// 一次保存要同时照顾两份文件：instances.json 是门户展示用的清单，
// federation.json 是网络的名册（身份、接入模式、隧道）。
// 只改运营自己维护的那几个字段，其余字段原样保留；改完先整份校验，
// 校验不过一个字节都不写。
//
// 写入走临时文件 + rename：进程在写一半时退出，也不会留下半份 JSON。

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateInstances } from "../ops/validate-instances.mjs";
import { validateRoster } from "../ops/validate-federation.mjs";

// 清单里可改的文本字段。空字符串等于删掉这个字段（写成 null）。
// 名称、介绍、联系方式不在这里：它们由主理人在实例的 /admin 里写，
// 中枢只取回副本，见 ops/fetch-profile.mjs。
// healthUrl 也不在里面：探测地址由 url 推出，见 ops/probe-target.mjs。
const INSTANCE_TEXT_FIELDS = [
  "url",
  "tier",
  "status",
  "since",
  "cardsUrl",
  "statsUrl",
];

// 名册里可改的字段。tunnel 单独处理。
const MEMBER_FIELDS = ["host", "role", "standing", "mode", "since", "note"];

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(temp, text, "utf8");
  await rename(temp, file);
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function applyInstancePatch(instance, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ...instance };
  const next = { ...instance };

  for (const field of INSTANCE_TEXT_FIELDS) {
    if (!(field in patch)) continue;
    next[field] = textOrNull(patch[field]);
  }

  // 空字段一律不写进 JSON，清单保持干净。
  for (const field of INSTANCE_TEXT_FIELDS) {
    if (next[field] === null) delete next[field];
  }

  return next;
}

// 名册成员：没进名册的实例在第一次保存时补一条。
// mode 改成 own-domain 时顺手把 tunnel 清空，避免留下一份不再生效的隧道配置。
function applyMemberPatch(member, patch) {
  const next = member && typeof member === "object" ? { ...member } : {};
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return next;

  for (const field of MEMBER_FIELDS) {
    if (!(field in patch)) continue;
    if (field === "listed") {
      next.listed = Boolean(patch.listed);
      continue;
    }
    const text = textOrNull(patch[field]);
    if (text == null) delete next[field];
    else next[field] = text;
  }

  if ("listed" in patch) next.listed = Boolean(patch.listed);

  if ("tunnel" in patch) {
    const tunnel = patch.tunnel;
    if (tunnel == null) next.tunnel = null;
    else if (typeof tunnel === "object" && !Array.isArray(tunnel)) {
      const account = textOrNull(tunnel.account);
      const rawPort = tunnel.port;
      const port = rawPort == null || rawPort === "" ? null : Number(rawPort);
      next.tunnel = { account: account || "", port: Number.isFinite(port) ? port : null };
    }
  }

  if ("mode" in patch && patch.mode !== "subdomain" && !("tunnel" in patch)) {
    next.tunnel = null;
  }

  return next;
}

// 只回传与这次改动有关的错误：别的条目早就存在的问题不该挡住这一条。
function relevantProblems(problems, id, before) {
  return problems.filter(([label, errors]) => {
    if (label === id) return true;
    if (label !== "" && label !== "—") return false;
    return !before.has(`${label}|${errors.join(";")}`);
  });
}

function describe(problems) {
  return problems.flatMap(([label, errors]) => errors.map((error) => (label ? `${label}: ${error}` : error)));
}

/**
 * 修改一个实例的配置。
 *
 * @param {{
 *   instancesFile: string,
 *   federationFile?: string|null,
 *   id: string,
 *   instance?: object,   // 清单字段
 *   member?: object,     // 名册字段；实例不在名册时按这份内容补一条
 * }} input
 * @returns {Promise<{ok: true, instance: object, member: object|null} | {error: string, fields?: string[]}>}
 */
export async function updateInstanceConfig({ instancesFile, federationFile, id, instance: instancePatch, member: memberPatch }) {
  if (!instancesFile) return { error: "editing_unavailable" };

  let manifest;
  try {
    manifest = await readJson(instancesFile);
  } catch {
    return { error: "manifest_unreadable" };
  }
  if (!manifest || !Array.isArray(manifest.instances)) return { error: "manifest_unreadable" };

  const index = manifest.instances.findIndex((item) => item?.id === id);
  if (index < 0) return { error: "not_found" };

  // 名册读不到时只允许改清单，不要把名册写坏。
  let roster = null;
  let rosterReadable = false;
  if (federationFile) {
    try {
      roster = await readJson(federationFile);
      rosterReadable = Boolean(roster) && Array.isArray(roster.members);
    } catch {
      roster = null;
    }
  }
  if (memberPatch && !rosterReadable) return { error: "roster_unreadable" };

  const nextInstance = applyInstancePatch(manifest.instances[index], instancePatch);
  const nextManifest = {
    ...manifest,
    updatedAt: new Date().toISOString().slice(0, 10),
    instances: manifest.instances.map((item, position) => (position === index ? nextInstance : item)),
  };

  // 校验前后各跑一次：只把这次引入的问题报回去。
  const instanceBefore = new Set(
    validateInstances(manifest).flatMap(([label, errors]) => errors.map((error) => `${label}|${error}`))
  );
  const instanceProblems = relevantProblems(validateInstances(nextManifest), id, instanceBefore);
  if (instanceProblems.length) return { error: "invalid", fields: describe(instanceProblems) };

  let memberBefore = new Set();
  let member = null;
  let nextRoster = null;

  if (rosterReadable) {
    const position = roster.members.findIndex((entry) => entry?.id === id);
    member = position >= 0 ? roster.members[position] : null;
    if (memberPatch) {
      const nextMember = applyMemberPatch(member, memberPatch);
      nextMember.id = id;
      if (nextMember.listed == null) nextMember.listed = true;
      const members = position >= 0
        ? roster.members.map((entry, at) => (at === position ? nextMember : entry))
        : [...roster.members, nextMember];
      nextRoster = { ...roster, updatedAt: new Date().toISOString().slice(0, 10), members };

      memberBefore = new Set(
        validateRoster(roster, manifest).flatMap(([label, errors]) =>
          errors.map((error) => `${label}|${error}`)
        )
      );
      const rosterProblems = relevantProblems(validateRoster(nextRoster, nextManifest), id, memberBefore);
      if (rosterProblems.length) return { error: "invalid", fields: describe(rosterProblems) };
      member = nextMember;
    }
  }

  await writeJson(instancesFile, nextManifest);
  if (nextRoster && federationFile) await writeJson(federationFile, nextRoster);

  return { ok: true, instance: nextInstance, member };
}
