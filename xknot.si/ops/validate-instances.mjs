// 实例清单校验。清单不过就不发布。
// 规则见 docs/I18N.md 第 3、4 节和 docs/FEDERATION.md 第 4 节。
//
// 用法：
//   node xknot.si/ops/validate-instances.mjs
//   node xknot.si/ops/validate-instances.mjs --instances ./instances.json

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LOCALES } from "../web/src/lib/i18n.js";
import { isCountryCode } from "../web/src/lib/regions.js";

export const TIERS = ["demo", "partner", "community"];
export const STATUSES = ["active", "suspended", "retired"];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isHttps(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.host);
  } catch {
    return false;
  }
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// 本地化字段：对象、键都在白名单里、没有空字符串、en 必有值。
function checkLocalized(field, value, errors, { required, maxLength } = {}) {
  if (value == null) {
    if (required) errors.push(`${field}: required`);
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field}: must be a locale map, not a plain value`);
    return;
  }
  const keys = Object.keys(value);
  if (!keys.length) {
    if (required) errors.push(`${field}: required`);
    return;
  }
  for (const key of keys) {
    if (!LOCALES.includes(key)) errors.push(`${field}.${key}: unknown locale`);
    const text = value[key];
    if (typeof text !== "string") {
      errors.push(`${field}.${key}: must be a string`);
      continue;
    }
    if (text.trim() === "") errors.push(`${field}.${key}: empty string, omit the key instead`);
    else if (maxLength && [...text].length > maxLength) errors.push(`${field}.${key}: longer than ${maxLength}`);
  }
  const english = value.en;
  if (required && !(typeof english === "string" && english.trim() !== "")) {
    errors.push(`${field}.en: required`);
  }
}

function checkTags(value, errors) {
  if (value == null) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push("tags: must be a locale map of string arrays");
    return;
  }
  for (const [key, list] of Object.entries(value)) {
    if (!LOCALES.includes(key)) errors.push(`tags.${key}: unknown locale`);
    if (!Array.isArray(list)) {
      errors.push(`tags.${key}: must be an array`);
      continue;
    }
    if (list.length > 5) errors.push(`tags.${key}: more than 5`);
  }
}

export function validateInstance(instance, seen = new Set()) {
  const errors = [];
  const id = instance?.id;

  if (typeof id !== "string" || !ID_RE.test(id)) errors.push("id: must be 2-32 chars, lowercase letters, digits, hyphens");
  else if (seen.has(id)) errors.push(`id: duplicate "${id}"`);
  else seen.add(id);

  checkLocalized("name", instance?.name, errors, { required: true, maxLength: 40 });
  checkLocalized("shortName", instance?.shortName, errors, { maxLength: 12 });
  checkLocalized("operator", instance?.operator, errors, { maxLength: 80 });
  checkLocalized("owner", instance?.owner, errors, { maxLength: 40 });
  checkLocalized("intro.oneLine", instance?.intro?.oneLine, errors, { required: true, maxLength: 60 });
  checkLocalized("intro.long", instance?.intro?.long, errors, { maxLength: 800 });
  checkTags(instance?.tags, errors);

  if (!isHttps(instance?.url)) errors.push("url: must be https");
  if (instance?.redirect != null && !isHttps(instance.redirect)) errors.push("redirect: must be https");
  if (instance?.canonical != null && !isHttps(instance.canonical)) errors.push("canonical: must be https");
  for (const key of ["healthUrl", "statsUrl", "cardsUrl"]) {
    if (instance?.[key] != null && !isHttps(instance[key])) errors.push(`${key}: must be https`);
  }

  const languages = instance?.languages;
  if (!Array.isArray(languages) || !languages.length) errors.push("languages: required");
  else {
    if (!languages.includes("en")) errors.push("languages: must include en");
    for (const tag of languages) if (!LOCALES.includes(tag)) errors.push(`languages: unknown locale "${tag}"`);
  }

  const regions = instance?.regions;
  if (!Array.isArray(regions) || !regions.length) errors.push("regions: required");
  else {
    for (const code of regions) if (!isCountryCode(code)) errors.push(`regions: unknown code "${code}"`);
    if (regions.includes("GLOBAL") && regions.length > 1) errors.push("regions: GLOBAL must be used alone");
  }

  if (!instance?.timezone) errors.push("timezone: required");
  else if (!validTimeZone(instance.timezone)) errors.push(`timezone: unknown "${instance.timezone}"`);

  if (typeof instance?.contact !== "string" || instance.contact.trim() === "") errors.push("contact: required");
  if (typeof instance?.since !== "string" || !DATE_RE.test(instance.since)) errors.push("since: must be YYYY-MM-DD");
  if (!TIERS.includes(instance?.tier)) errors.push(`tier: must be one of ${TIERS.join(", ")}`);
  if (!STATUSES.includes(instance?.status)) errors.push(`status: must be one of ${STATUSES.join(", ")}`);

  if (instance?.social != null) {
    if (!Array.isArray(instance.social)) errors.push("social: must be an array");
    else {
      if (instance.social.length > 5) errors.push("social: more than 5");
      for (const [index, item] of instance.social.entries()) {
        if (!item?.label) errors.push(`social[${index}].label: required`);
        if (!isHttps(item?.url)) errors.push(`social[${index}].url: must be https`);
      }
    }
  }

  return errors;
}

export function validateInstances(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object") return [["", ["manifest: must be an object"]]];
  if (!Array.isArray(manifest.instances)) return [["", ["instances: must be an array"]]];

  const seen = new Set();
  for (const [index, instance] of manifest.instances.entries()) {
    const errors = validateInstance(instance, seen);
    if (errors.length) problems.push([instance?.id || `#${index}`, errors]);
  }
  return problems;
}

async function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const index = argv.indexOf("--instances");
  const file = index >= 0 ? argv[index + 1] : path.join(here, "..", "instances.json");

  const manifest = JSON.parse(await readFile(file, "utf8"));
  const problems = validateInstances(manifest);

  if (!problems.length) {
    console.log(`${file}: ${manifest.instances.length} instance(s), ok`);
    return 0;
  }
  for (const [id, errors] of problems) {
    console.error(`${id}:`);
    for (const error of errors) console.error(`  - ${error}`);
  }
  return 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
