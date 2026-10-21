#!/usr/bin/env node
// 一次性迁移：把 site.env 里的站点身份搬进 profile.json。
//
// 旧版本把名称、标语、logo、主理人写在 site.env 的 KNOT_SITE_* 六项里。
// 现在这些属于「自述区」，由主理人在 /admin 里编辑，存在 sites/<站点>/profile.json。
// 这个脚本读一次旧的 site.env，生成 profile.json，再把那六项从 site.env 删掉。
//
// 用法（在部署根上跑一次即可，重复执行没有副作用）：
//   node ops/scripts/migrate-profile.mjs --site bot01
//   node ops/scripts/migrate-profile.mjs --site local --dir sites/local
//   node ops/scripts/migrate-profile.mjs --site bot01 --dry-run
//   node ops/scripts/migrate-profile.mjs --site bot01 --env var/bot01/platform.env
//
// 站点目录默认从 KNOT_PROFILE_FILE 推导，其次是 KNOT_DEPLOY_ROOT/sites/<站点>，
// 最后是仓库里的 sites/<站点>。所以在实例主机上直接跑 current/ops/scripts/ 里的这份也可以。
//
// 已经存在 profile.json 时不写档案，只把 site.env 和 --env 给的伴生配置里的旧键删掉：
// 迁移只补空缺，不覆盖主理人后来写的内容。

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "@knot/config";
import { FORMAT_VERSION } from "../../backend/src/profile.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const LEGACY_KEYS = [
  "KNOT_SITE_NAME",
  "KNOT_SITE_TAGLINE",
  "KNOT_SITE_LOGO",
  "KNOT_SITE_OWNER",
  "KNOT_SITE_OWNER_NOTE",
  "KNOT_SITE_OWNER_CONTACT",
];

function arg(argv, name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return argv[index + 1] ?? fallback;
}

/** 同一个参数可以给多次，例如 --env 一份部署脚本生成的 platform.env。 */
function args(argv, name) {
  const out = [];
  argv.forEach((value, index) => {
    if (value === `--${name}` && argv[index + 1]) out.push(argv[index + 1]);
  });
  return out;
}

const text = (value) => String(value ?? "").trim();

/**
 * 旧配置只有一份文案，直接当成 v2 的字符串。
 * 旧版 profile.json（formatVersion 1）按简中优先取一份，其余语种落不下来。
 */
export function siteFromLegacy(env) {
  const name = text(env.KNOT_SITE_NAME);
  const tagline = text(env.KNOT_SITE_TAGLINE);
  const logo = text(env.KNOT_SITE_LOGO);
  const owner = text(env.KNOT_SITE_OWNER);
  const note = text(env.KNOT_SITE_OWNER_NOTE);
  const contact = text(env.KNOT_SITE_OWNER_CONTACT);

  const site = { name: name || "Knot" };
  if (tagline) site.tagline = tagline.slice(0, 60);
  if (note) site.intro = note.slice(0, 800);
  // logo 只接受 https 地址：站内相对路径在新契约里没有意义（中枢可能不在这台机器上）。
  if (/^https:\/\//i.test(logo)) site.logo = logo;
  if (owner) site.owner = owner;
  if (contact) site.contact = contact;

  return site;
}

function firstOf(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  for (const key of ["zh-CN", "en", "zh-TW"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  const first = Object.values(value).find((item) => typeof item === "string" && item.trim());
  return first ? first.trim() : "";
}

/** v1 的档案（多语种映射）转成 v2 的扁平字段；转不出来就返回 null。 */
export function siteFromV1(profile) {
  if (!profile || typeof profile !== "object") return null;
  const site = { name: firstOf(profile.name) };
  if (!site.name) return null;
  const tagline = firstOf(profile.intro?.oneLine);
  const intro = firstOf(profile.intro?.long);
  const owner = firstOf(profile.owner);
  if (tagline) site.tagline = tagline;
  if (intro) site.intro = intro;
  if (owner) site.owner = owner;
  if (typeof profile.contact === "string" && profile.contact.trim()) site.contact = profile.contact.trim();
  if (typeof profile.logo === "string" && /^https:\/\//i.test(profile.logo)) site.logo = profile.logo;
  const region = Array.isArray(profile.regions) ? profile.regions[0] : null;
  if (typeof region === "string" && (region === "GLOBAL" || /^[A-Z]{2}$/.test(region))) site.region = region;
  if (typeof profile.timezone === "string" && profile.timezone.trim()) site.timezone = profile.timezone.trim();
  const tags = Array.isArray(profile.tags) ? profile.tags : [];
  const seen = new Set();
  const clean = [];
  for (const tag of tags) {
    if (typeof tag !== "string" || !tag.trim()) continue;
    const value = tag.trim().slice(0, 16);
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(value);
    if (clean.length >= 9) break;
  }
  if (clean.length) site.tags = clean;
  return site;
}

/** 删掉旧键，保留注释与其余配置。 */
export function stripLegacyKeys(source) {
  const out = [];
  for (const line of source.split("\n")) {
    const key = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1];
    if (key && LEGACY_KEYS.includes(key)) continue;
    // 只服务这六项的说明行也一并删掉，免得留下无主注释。
    if (/^# (站点名|一句话介绍|站点自己的 logo|主理人（owner）)/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * 站点目录：--dir 最优先。
 * 在部署机上从 current/ 调用时脚本位于 releases/<版本>/ 里，默认的 ROOT/sites 是空的，
 * 所以先看运行时配置给出的 KNOT_PROFILE_FILE（在 sites/<站点>/profile.json），
 * 再看 KNOT_DEPLOY_ROOT/sites/<站点>，最后才是仓库里的 sites/<站点>。
 */
function siteDir(argv, site) {
  const given = arg(argv, "dir");
  if (given) return path.resolve(given);
  const hint = String(process.env.KNOT_PROFILE_FILE || "").trim();
  if (hint) return path.dirname(path.resolve(hint));
  const root = String(process.env.KNOT_DEPLOY_ROOT || "").trim();
  return path.join(root ? path.resolve(root) : ROOT, "sites", site);
}

export function main(argv) {
  const site = arg(argv, "site", process.env.KNOT_SITE || "local");
  const dir = siteDir(argv, site);
  const dryRun = argv.includes("--dry-run");
  const siteEnv = path.join(dir, "site.env");
  const profileFile = path.join(dir, "profile.json");

  let source;
  try {
    source = readFileSync(siteEnv, "utf8");
  } catch (error) {
    console.error(`读不到 ${siteEnv}（${error.code || error.message}）`);
    return 1;
  }

  let existing = null;
  try {
    existing = JSON.parse(readFileSync(profileFile, "utf8"));
  } catch {
    /* 不存在或读不动，按没有档案处理 */
  }

  const env = parseEnv(source);
  // v1 档案先就地升级：能转就转，转不出来才用 site.env 里的旧值。
  let migrated = null;
  if (existing?.formatVersion === 1) {
    migrated = siteFromV1(existing.profile);
    if (migrated) console.log(`${profileFile} 是 v1 档案，按简中优先升级到 v${FORMAT_VERSION}。`);
  }
  const payload = {
    formatVersion: FORMAT_VERSION,
    updatedAt: new Date().toISOString().slice(0, 10),
    site: migrated || siteFromLegacy(env),
  };
  const exists = Boolean(existing);
  const stripped = stripLegacyKeys(source);

  // 部署脚本生成的 platform.env 也带着这几项。档案已经有了也要清掉，
  // 否则它会在每次校验时报未知键。
  const companions = args(argv, "env").map((file) => path.resolve(file));
  const stale = companions
    .map((file) => {
      try {
        const text = readFileSync(file, "utf8");
        return { file, before: text, after: stripLegacyKeys(text) };
      } catch (error) {
        console.error(`读不到 ${file}（${error.code || error.message}）`);
        return { file, before: null, after: null };
      }
    })
    .filter((entry) => entry.before !== null && entry.after !== entry.before);

  const writeCompanions = () => {
    for (const entry of stale) {
      if (dryRun) {
        console.log(`--- ${entry.file}（去掉旧键）---`);
        console.log(entry.after);
        continue;
      }
      writeFileSync(entry.file, entry.after);
      console.log(`清理 ${path.relative(process.cwd(), entry.file)} 里的 KNOT_SITE_* 旧键`);
    }
  };

  // v2 档案已经在位就只清旧键；v1 档案在上面已经转成 v2，走的是写入分支。
  if (existing?.formatVersion === FORMAT_VERSION) {
    console.log(`${profileFile} 已存在（v${FORMAT_VERSION}），不覆盖。`);
    if (stripped === source) {
      writeCompanions();
      return 0;
    }
    if (dryRun) {
      console.log(`--- ${siteEnv}（去掉旧键）---`);
      console.log(stripped);
    } else {
      writeFileSync(siteEnv, stripped);
      console.log(`清理 ${path.relative(process.cwd(), siteEnv)} 里的 KNOT_SITE_* 旧键`);
    }
    writeCompanions();
    return 0;
  }

  if (dryRun) {
    console.log(`--- ${profileFile} ---`);
    console.log(JSON.stringify(payload, null, 2));
    console.log(`--- ${siteEnv}（去掉 ${LEGACY_KEYS.length} 个旧键）---`);
    console.log(stripped);
    writeCompanions();
    return 0;
  }

  writeFileSync(profileFile, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(siteEnv, stripped);
  console.log(`写入 ${path.relative(process.cwd(), profileFile)}`);
  console.log(`清理 ${path.relative(process.cwd(), siteEnv)} 里的 KNOT_SITE_* 旧键`);
  writeCompanions();
  console.log("接着重启 Backend（或重新部署），新的站点身份才会生效。");
  return 0;
}

// 部署机上 `current` 是指向 releases/<版本> 的软链，argv[1] 走的是软链路径，
// 而 import.meta.url 已经是真实路径。两边都取 realpath 再比，否则从 current/ 调进来什么都不做。
const isMain =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = main(process.argv.slice(2));
