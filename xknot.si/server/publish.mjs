// 申请通过之后，把实例写进 instances.json 与 federation.json。
//
// 与 `admin-cli publish` 是同一套规则（server/manifest.mjs 生成、两份校验器把关），
// 区别只有两点：这里不打印、不退出，而且幂等 —— 已经有同一个地址或同一个 id 就跳过。
// 自动接通会重试同一张单，不能每重试一次就往清单里多塞一条。

import { readFile, rename, writeFile } from "node:fs/promises";

import { validateRoster } from "../ops/validate-federation.mjs";
import { checkManifestEntry, toManifestEntry, toRosterMember } from "./manifest.mjs";

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`${label}: ${error.message}`);
  }
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

/**
 * 幂等发布：清单缺条目就补，名册缺成员就补；缺一半时补齐另一半。
 *
 * @returns {{ error: string } | { entry: object, skipped: boolean }}
 */
export async function publishInstance({
  application,
  tunnelAccount,
  tunnelPort,
  manifestFile,
  rosterFile,
}) {
  const entry = toManifestEntry(application);
  const problems = checkManifestEntry(entry);
  if (problems.length) return { error: "invalid_entry", details: problems };

  const manifest = (await readJson(manifestFile, "instances.json")) || { version: 1, instances: [] };
  if (!Array.isArray(manifest.instances)) return { error: "manifest_unreadable" };

  const sameUrl = manifest.instances.find((item) => item.url === entry.url);
  const sameId = manifest.instances.find((item) => item.id === entry.id);
  if (sameUrl && sameUrl.id !== entry.id) return { error: "url_taken" };
  if (sameId && sameId.url !== entry.url) return { error: "id_taken" };

  const roster = (await readJson(rosterFile, "federation.json")) || { version: 1, members: [] };
  if (!Array.isArray(roster.members)) return { error: "roster_unreadable" };

  const member = roster.members.find((item) => item.id === entry.id);
  const nextManifest = sameId
    ? { ...manifest, updatedAt: new Date().toISOString().slice(0, 10) }
    : {
        ...manifest,
        updatedAt: new Date().toISOString().slice(0, 10),
        instances: [...manifest.instances, entry],
      };

  let nextRoster = roster;
  if (!member) {
    nextRoster = {
      ...roster,
      updatedAt: new Date().toISOString().slice(0, 10),
      members: [
        ...roster.members,
        toRosterMember(entry, { tunnelAccount, tunnelPort }),
      ],
    };
    const problems = validateRoster(nextRoster, nextManifest);
    if (problems.length) return { error: "roster_invalid", details: problems };
  }

  // 两份都通过校验才落盘；名册先写，清单后写，中途失败最多是多一条待接通的名册条目，
  // 不会出现「清单里有、名册里没有」的悬挂状态（那是校验器直接判错的那一种）。
  if (!member) await writeJsonAtomic(rosterFile, nextRoster);
  if (!sameId) await writeJsonAtomic(manifestFile, nextManifest);

  return {
    entry: nextManifest.instances.find((item) => item.id === entry.id),
    skipped: Boolean(sameId && member),
  };
}

/** 验收通过：把清单里的这一条从 pending 改成 active。 */
export async function markActive({ manifestFile, id }) {
  const manifest = await readJson(manifestFile, "instances.json");
  if (!manifest || !Array.isArray(manifest.instances)) return { error: "manifest_unreadable" };
  const instance = manifest.instances.find((item) => item.id === id);
  if (!instance) return { error: "not_listed" };
  if (instance.status === "active") return { ok: true, changed: false };
  instance.status = "active";
  manifest.updatedAt = new Date().toISOString().slice(0, 10);
  await writeJsonAtomic(manifestFile, manifest);
  return { ok: true, changed: true };
}
