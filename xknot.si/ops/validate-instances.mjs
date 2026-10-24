// 中枢登记表 instances.json 的校验。
//
// 登记表只装中枢签发的字段：id、url、since、tier、status，外加中枢自己决定
// 要拉的 cardsUrl / statsUrl。站点名称、介绍、联系方式在实例的 profile.json 里，
// 由 ops/fetch-profile.mjs 取回，规则见 ops/profile-schema.mjs。
//
// 用法：
//   node xknot.si/ops/validate-instances.mjs
//   node xknot.si/ops/validate-instances.mjs --instances fixtures/preview-instances.json
// 退出码：0 通过，1 有问题。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkIssued, STATUSES, TIERS } from "./profile-schema.mjs";

export { TIERS, STATUSES };

/**
 * 校验登记表里的一条。
 * @param {unknown} instance
 * @param {Set<string>} [seen] 已出现过的 id
 * @returns {string[]}
 */
export function validateInstance(instance, seen = new Set()) {
  return checkIssued(instance, seen);
}

/**
 * 校验整份登记表。
 * @param {unknown} manifest
 * @returns {Array<[string, string[]]>} 每条 id 与它的问题
 */
export function validateInstances(manifest) {
  const out = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [["manifest", ["manifest: must be a JSON object"]]];
  }
  if (!Array.isArray(manifest.instances)) {
    return [["manifest", ["instances: must be an array"]]];
  }
  const seen = new Set();
  for (const [index, instance] of manifest.instances.entries()) {
    const id = typeof instance?.id === "string" && instance.id ? instance.id : `#${index}`;
    const errors = validateInstance(instance, seen);
    if (errors.length) out.push([id, errors]);
  }
  return out;
}

async function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const index = argv.indexOf("--instances");
  const file = index >= 0 ? argv[index + 1] : path.join(here, "..", "instances.json");

  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const problems = validateInstances(manifest);
  if (!problems.length) {
    console.log(`${file}: ${manifest.instances.length} 条，通过`);
    return;
  }
  for (const [label, errors] of problems) {
    for (const error of errors) console.error(`${label}: ${error}`);
  }
  process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
