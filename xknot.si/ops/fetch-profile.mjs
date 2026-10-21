// L1 站点档案的拉取：读 instances.json，GET 每个实例的 /api/federation/profile，
// 清洗后原子写 var/profiles/{id}.json。
//
// 契约见 docs/FEDERATION.md 第 4 节。档案由主理人在实例自己的管理页写，
// 中枢只取回副本：格式不对、id 或地址对不上、整份不合法时保留上一份，
// 不拿中枢的判断覆盖主理人的内容。地址按不可信地址处理（见 fetch-guard.mjs）。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FetchGuardError,
  PROFILE_MAX_BYTES,
  safeGetJson,
  writeJsonAtomic,
} from "./fetch-guard.mjs";
import { cleanProfile, FORMAT_VERSION, isHttpsUrl } from "./profile-schema.mjs";

export { FORMAT_VERSION };

function hostOf(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 校验中枢取回的整份档案。
 * @returns {{ ok: boolean, problems: string[], payload?: object }}
 */
export function cleanProfilePayload(payload, { instance } = {}) {
  const problems = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, problems: ["payload: must be a JSON object"] };
  }
  if (payload.formatVersion !== FORMAT_VERSION) {
    return { ok: false, problems: [`formatVersion: must be ${FORMAT_VERSION}`] };
  }

  const issued = payload.issued;
  if (!issued || typeof issued !== "object" || Array.isArray(issued)) {
    return { ok: false, problems: ["issued: required"] };
  }
  if (issued.id !== instance?.id) {
    problems.push(`issued.id: "${issued.id}" does not match "${instance?.id}"`);
  }
  if (!isHttpsUrl(issued.url) || hostOf(issued.url) !== hostOf(instance?.url)) {
    problems.push("issued.url: must be https on the registered host");
  }
  if (problems.length) return { ok: false, problems };

  const cleaned = cleanProfile(payload.profile);
  if (!cleaned.profile) {
    return { ok: false, problems: [...cleaned.problems, "profile: no usable profile, keeping the previous copy"] };
  }
  if (!cleaned.ok) {
    // 字段级问题不拦整份：能用的字段照收，问题记下来给运营看。
    problems.push(...cleaned.problems);
  }

  return {
    ok: true,
    problems,
    payload: {
      formatVersion: FORMAT_VERSION,
      issued: {
        id: instance.id,
        url: String(issued.url).trim(),
        since: typeof issued.since === "string" ? issued.since : instance.since,
        tier: typeof issued.tier === "string" ? issued.tier : instance.tier,
        status: typeof issued.status === "string" ? issued.status : instance.status,
      },
      profile: cleaned.profile,
    },
  };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function run(options = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const {
    instancesPath = path.join(here, "..", "instances.json"),
    outDir = path.join(here, "..", "var", "profiles"),
    fetchImpl = fetch,
    resolve,
    timeoutMs,
    only = null,
    now = () => new Date(),
    log = () => {},
  } = options;

  const manifest = await readJson(instancesPath);
  if (!manifest || !Array.isArray(manifest.instances)) {
    throw new Error(`cannot read instances: ${instancesPath}`);
  }

  const results = [];
  for (const instance of manifest.instances) {
    if (!instance?.id) continue;
    if (only && instance.id !== only) continue;
    if (instance.status && instance.status !== "active") {
      results.push({ id: instance.id, status: "skipped", reason: "inactive" });
      continue;
    }

    const file = path.join(outDir, `${instance.id}.json`);
    const previous = await readJson(file);
    const target = `${String(instance.url || "").replace(/\/$/, "")}/api/federation/profile`;
    try {
      const response = await safeGetJson(target, {
        fetchImpl,
        resolve,
        timeoutMs,
        maxBytes: PROFILE_MAX_BYTES,
        etag: previous?.etag || null,
      });
      if (response.status === 304) {
        results.push({ id: instance.id, status: "unchanged" });
        continue;
      }
      const checked = cleanProfilePayload(response.body, { instance });
      if (!checked.ok) {
        results.push({ id: instance.id, status: "invalid", problems: checked.problems });
        continue;
      }
      await writeJsonAtomic(file, {
        ...checked.payload,
        source: response.url,
        etag: response.etag || null,
        fetchedAt: now().toISOString(),
      });
      results.push({ id: instance.id, status: "ok", problems: checked.problems });
    } catch (error) {
      const code = error instanceof FetchGuardError ? error.code : "unreachable";
      results.push({ id: instance.id, status: "failed", error: code });
    }
  }

  for (const result of results) {
    const extra =
      result.status === "ok"
        ? result.problems?.length
          ? ` ${result.problems[0]}`
          : ""
        : result.error
          ? ` ${result.error}`
          : result.problems?.length
            ? ` ${result.problems[0]}`
            : "";
    log(`${String(result.id).padEnd(16)} ${result.status}${extra}`);
  }
  return results;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--instances") args.instancesPath = argv[++index];
    else if (name === "--out-dir") args.outDir = argv[++index];
    else if (name === "--only") args.only = argv[++index];
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run({ ...parseArgs(process.argv.slice(2)), log: (line) => console.log(line) })
    .then(() => {})
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
