// 发布前的快照守卫：确认 dist/data/hub.json 只包含清单里的实例。
//
// 构建只从 instances.json 取真实条目，fixtures/ 的样例只在 --preview 时并入。
// 这一步把那条约定变成可执行的检查，挡住两类事故：
//   1. 测试数据被并进生产快照；
//   2. 清单加了条目，快照却没跟上。
//
// 用法：
//   node xknot.si/ops/verify-hub-data.mjs --data web/dist/data/hub.json --instances instances.json
//   node xknot.si/ops/verify-hub-data.mjs --data web/dist/data/hub.json --instances instances.json \
//     --fixtures fixtures/preview-instances.json
//
// 退出码：0 通过，1 有问题。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 保留给示例与测试的顶级域，永远不该出现在对外清单里。
const RESERVED_TLDS = [".example", ".test", ".invalid", ".localhost"];

function isHttps(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.host);
  } catch {
    return false;
  }
}

function hostOf(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function idsOf(manifest) {
  const list = Array.isArray(manifest?.instances) ? manifest.instances : [];
  return list.map((item) => item?.id).filter((id) => typeof id === "string" && id);
}

/**
 * 检查一份已生成的快照。
 * @param {{
 *   data: unknown,
 *   manifest: unknown,
 *   fixtures?: unknown | null,
 * }} input
 * @returns {string[]} 问题列表，空数组即通过
 */
export function verifyHubData({ data, manifest, fixtures = null }) {
  const problems = [];
  const instances = Array.isArray(data?.instances) ? data.instances : null;

  if (!instances) {
    return ["snapshot: instances must be an array"];
  }
  if (!instances.length) {
    problems.push("snapshot: no instances, the portal would be empty");
  }

  const expected = idsOf(manifest);
  if (!expected.length) problems.push("manifest: no instances");

  const allowed = new Set(expected);
  if (fixtures) for (const id of idsOf(fixtures)) allowed.add(id);

  const seen = new Set();
  for (const item of instances) {
    const id = item?.id;
    if (typeof id !== "string" || !id) {
      problems.push("snapshot: an instance has no id");
      continue;
    }
    if (seen.has(id)) problems.push(`snapshot: duplicate id "${id}"`);
    seen.add(id);

    if (!allowed.has(id)) {
      problems.push(`snapshot: "${id}" is not in instances.json (test data leaked?)`);
    }

    if (!isHttps(item?.url)) problems.push(`${id}: url must be https`);

    const host = hostOf(item?.url);
    const reserved = RESERVED_TLDS.find((tld) => host.endsWith(tld));
    if (reserved) problems.push(`${id}: url uses reserved host suffix ${reserved}`);
  }

  for (const id of expected) {
    if (!seen.has(id)) problems.push(`snapshot: "${id}" is missing from the build`);
  }

  return problems;
}

export async function verifyHubDataFile({ dataPath, instancesPath, fixturesPath = null }) {
  const [data, manifest, fixtures] = await Promise.all([
    readFile(dataPath, "utf8").then(JSON.parse),
    readFile(instancesPath, "utf8").then(JSON.parse),
    fixturesPath ? readFile(fixturesPath, "utf8").then(JSON.parse) : Promise.resolve(null),
  ]);
  return verifyHubData({ data, manifest, fixtures });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (name === "--data") args.dataPath = argv[++i];
    else if (name === "--instances") args.instancesPath = argv[++i];
    else if (name === "--fixtures") args.fixturesPath = argv[++i];
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));
  const dataPath = args.dataPath || path.join(here, "..", "web", "dist", "data", "hub.json");
  const instancesPath = args.instancesPath || path.join(here, "..", "instances.json");

  verifyHubDataFile({ dataPath, instancesPath, fixturesPath: args.fixturesPath || null })
    .then((problems) => {
      if (!problems.length) {
        console.log(`${dataPath}: ok`);
        return;
      }
      for (const problem of problems) console.error(`- ${problem}`);
      process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
