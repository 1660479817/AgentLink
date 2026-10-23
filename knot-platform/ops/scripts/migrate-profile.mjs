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
// 已经存在 profile.json 时不覆盖主理人写的内容，只补两项：
//   * 缺 `site.locale` 的旧档案，补一个按文案推断的默认语种（保存一次就不再推）；
//   * 把 site.env 与伴生配置里的旧 KNOT_SITE_* 键删掉。
//
// 默认语种只在档案里没有这一项时写入；主理人后来在 /admin 改过就归他。

import { chmodSync, copyFileSync, existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "@knot/config";
import { inferLocale, isLocale } from "@knot/locale";
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
  // 旧配置没有语种字段：按文案推一个写进档案，之后主理人可以在 /admin 改。
  site.locale = inferLocale([name, tagline, note].join(" "));
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
  // v1 的 languages 就是主理人当时声明的语种，优先用它；没有才按文案推。
  const declared = Array.isArray(profile.languages) ? profile.languages.find((item) => isLocale(item)) : null;
  site.locale = declared || inferLocale([site.name, tagline, intro].join(" "));
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
  const rows = [];
  for (const line of source.split("\n")) {
    const key = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1];
    if (key && LEGACY_KEYS.includes(key)) continue;
    // 只服务这六项的说明行也一并删掉，免得留下无主注释。
    if (/^# (站点名|一句话介绍|站点自己的 logo|主理人（owner）)/.test(line)) continue;
    rows.push(line);
  }
  return rows.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * 就地覆盖配置是这次迁移里最危险的一步：非原子写入遇到失败或磁盘满，
 * 留下的是一份被截断的 site.env / platform.env，而后者是运行时唯一来源。
 * 所以先留一份 .bak，再写临时文件、换名，权限沿用原文件。
 */
function writeInPlace(file, text) {
  if (existsSync(file)) {
    const backup = `${file}.bak`;
    if (!existsSync(backup)) copyFileSync(file, backup);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  try {
    chmodSync(tmp, statSync(file).mode & 0o777);
  } catch {
    /* 新建的文件就用 0600 */
  }
  renameSync(tmp, file);
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

/** 站点名会成为 sites/<名字> 的一段路径，`.` 与 `..` 和带斜线的值都要挡掉。 */
function siteNameOk(name) {
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(String(name || ""));
}

export function main(argv) {
  const site = arg(argv, "site", process.env.KNOT_SITE || "local");
  if (!siteNameOk(site)) {
    console.error(`站点名不合法：${JSON.stringify(site)}。只允许字母、数字、点、下划线和短横线，且不能以点开头。`);
    return 2;
  }
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
  // 「文件不存在」和「文件存在但写坏了」是两件事。主理人手工编辑 profile.json
  // 留下一个尾逗号时，以前会被当成「没有档案」，随后按 site.env 旧值整份覆盖：
  // 名称、介绍、主理人全部退回部署前的值。这里只放过 ENOENT。
  let existingRaw = null;
  try {
    existingRaw = readFileSync(profileFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`读不到 ${profileFile}（${error.code || error.message}）`);
      return 1;
    }
  }
  if (existingRaw !== null) {
    try {
      existing = JSON.parse(existingRaw);
    } catch (error) {
      console.error(
        `${profileFile} 不是合法 JSON：${error.message}。先把它修好再跑；这个脚本不会覆盖一份读不懂的档案。`
      );
      return 1;
    }
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
      writeInPlace(entry.file, entry.after);
      console.log(`清理 ${path.relative(process.cwd(), entry.file)} 里的 KNOT_SITE_* 旧键`);
    }
  };

  // v2 档案已经在位：不覆盖主理人写的字段，只补缺的 locale。
  // 补的值按文案推一次，之后归主理人；/admin 的表单也会先预填同一个建议值。
  let localeBackfill = null;
  if (
    existing?.formatVersion === FORMAT_VERSION &&
    existing.site &&
    typeof existing.site === "object" &&
    !Array.isArray(existing.site) &&
    !isLocale(existing.site.locale)
  ) {
    const site = existing.site;
    localeBackfill = {
      ...existing,
      updatedAt: new Date().toISOString().slice(0, 10),
      site: {
        ...site,
        locale: inferLocale([site.name, site.tagline, site.intro].filter(Boolean).join(" ")),
      },
    };
  }

  if (existing?.formatVersion === FORMAT_VERSION) {
    console.log(`${profileFile} 已存在（v${FORMAT_VERSION}），其它字段不覆盖。`);
    if (localeBackfill) {
      if (dryRun) {
        console.log(`--- ${profileFile}（补 site.locale）---`);
        console.log(JSON.stringify(localeBackfill, null, 2));
      } else {
        writeInPlace(profileFile, `${JSON.stringify(localeBackfill, null, 2)}\n`);
        console.log(
          `补上 ${path.relative(process.cwd(), profileFile)} 的 site.locale=${localeBackfill.site.locale}（之后可在 /admin 改）`,
        );
      }
    }
    if (stripped === source) {
      writeCompanions();
      return 0;
    }
    if (dryRun) {
      console.log(`--- ${siteEnv}（去掉旧键）---`);
      console.log(stripped);
    } else {
      writeInPlace(siteEnv, stripped);
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

  writeInPlace(profileFile, `${JSON.stringify(payload, null, 2)}\n`);
  writeInPlace(siteEnv, stripped);
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
