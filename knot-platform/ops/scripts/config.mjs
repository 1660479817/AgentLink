#!/usr/bin/env node
// 配置工具：校验、生成模板、生成文档、写实例运行时文件。
//
//   node ops/scripts/config.mjs sites
//   node ops/scripts/config.mjs init <站点>
//   node ops/scripts/config.mjs check --site <站点>
//   node ops/scripts/config.mjs check --platform --site <站点>
//   node ops/scripts/config.mjs template [--write]
//   node ops/scripts/config.mjs platform-template [--write]
//   node ops/scripts/config.mjs xknot-template [--write]
//   node ops/scripts/config.mjs docs [--write]
//   node ops/scripts/config.mjs env --site <站点> [--out path] [--root path] [--deploy-root path]
//   node ops/scripts/config.mjs join --site <站点> [--in <接入件>] [--out path]
//   node ops/scripts/config.mjs show --for dev|platform|entry --site <站点>
//
// 站点用 --site 选择，也可以用环境变量 KNOT_SITE。只有 sites/ 下恰好一个站点时才自动选中。
// check 发现类型错误、缺必填、跨键矛盾时以退出码 1 结束。部署脚本据此在动任何东西之前停下。

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KEYS,
  FORBIDDEN_PLATFORM_KEYS,
  checkEntryFile,
  checkJoin,
  checkPlatform,
  checkSite,
  formatValue,
  isBlank,
  parseEnv,
  removeEnvKeys,
  renderDocs,
  renderJoinExample,
  renderJoinFile,
  renderPlatformExample,
  renderPlatformFile,
  renderSiteExample,
  resolve,
  truthy,
  updateEnvText,
} from "../../packages/knot-config/src/schema.mjs";
import {
  deployRootOf,
  listEntryFiles,
  listSites,
  readEntryFile,
  readSiteEnv,
  resolveSitePaths,
  validSiteName,
} from "../config/sites.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// APP 是代码目录（源码目录，或 <部署根>/releases/<版本>）；DEPLOY 是部署根，sites/ 在这里。
// 从暂存区安装时位置推不出部署根，site-config.sh 会用 KNOT_DEPLOY_ROOT 显式给出来。
const APP = path.resolve(HERE, "../..");
const DEPLOY = process.env.KNOT_DEPLOY_ROOT
  ? path.resolve(process.env.KNOT_DEPLOY_ROOT)
  : deployRootOf(APP);

const PATHS = {
  sites: path.join(DEPLOY, "sites"),
  templateDir: path.join(DEPLOY, "sites", "_template"),
  siteTemplate: path.join(DEPLOY, "sites", "_template", "site.env"),
  platformTemplate: path.join(DEPLOY, "sites", "_template", "platform.env"),
  xknotTemplate: path.join(DEPLOY, "sites", "_template", "xknot.env"),
  docs: path.join(APP, "docs", "CONFIG.md"),
};

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 后面要跟一个值`);
  return value;
}

function has(argv, name) {
  return argv.includes(name);
}

// 可选值参数：`--platform` 可以单独当开关，也可以写 `--platform /path/to/file`。
function optionalArgValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function selectedSite(argv) {
  const site = argValue(argv, "--site", process.env.KNOT_SITE || "");
  const file = argValue(argv, "--site-file", process.env.KNOT_SITE_FILE || "");
  return resolveSitePaths(DEPLOY, { site, file });
}

function report(title, { errors, warnings }) {
  for (const message of warnings) console.error(`警告：${message}`);
  for (const message of errors) console.error(`错误：${message}`);
  if (errors.length) {
    console.error(`\n${title} 未通过：${errors.length} 个错误，${warnings.length} 个警告。`);
    return 1;
  }
  if (!warnings.length) console.log(`${title} 通过。`);
  else console.log(`${title} 通过，有 ${warnings.length} 个警告。`);
  return 0;
}

function cmdCheck(argv) {
  const paths = selectedSite(argv);
  const label = `sites/${paths.name}/site.env`;

  if (has(argv, "--xknot")) {
    const joinPath = path.resolve(optionalArgValue(argv, "--xknot", paths.joinEnv));
    if (!existsSync(joinPath)) {
      // 没接入联邦是合法状态，不是错误。
      console.log(`${path.basename(joinPath)} 不存在：这个站点还没有接入 XKnot。`);
      return 0;
    }
    const mode = statSync(joinPath).mode;
    return report("XKnot 接入配置", checkJoin(readText(joinPath), { mode }));
  }

  if (has(argv, "--platform")) {
    const platformPath = path.resolve(optionalArgValue(argv, "--platform", paths.platformEnv));
    const text = readText(platformPath);
    if (!text) {
      console.error(`错误：找不到实例运行时配置 ${platformPath}`);
      return 1;
    }
    const mode = statSync(platformPath).mode;
    return report(`实例运行时配置 ${path.basename(platformPath)}`, checkPlatform(text, { mode }));
  }

  const site = checkSite(readSiteEnv(paths));
  const entries = checkEntries(paths);
  const title = entries.count
    ? `站点配置 ${label}（1 个 xknot.si 子域入口）`
    : `站点配置 ${label}`;
  return report(title, {
    errors: [...site.errors, ...entries.errors],
    warnings: [...site.warnings, ...entries.warnings],
  });
}

// 一个站点最多一个 xknot.si 子域入口。
//
// 除了单份文件的合法性，还查入口与站点配置是否对得上：
//   1. 入口域名必须是 xknot.si 签发的二级子域；
//   2. KNOT_ENTRY_ENABLED=1 时必须有入口文件，且对外地址就是这个子域；
//   3. KNOT_ENTRY_ENABLED=0（local）时不带入口文件。
function checkEntries(paths) {
  const entries = listEntryFiles(paths.dir);
  const base = readSiteEnv(paths);
  const errors = [];
  const warnings = [];

  if (entries.length > 1) {
    errors.push(
      `sites/${paths.name}/ 下有 ${entries.length} 个入口文件。官方只支持一个 xknot.si 子域入口，请删掉多余的 entry.<标签>.xknot.si.env。`
    );
  }
  const entry = entries[0] || null;

  if (entry) {
    const env = readEntryFile(paths, entry);
    const result = checkEntryFile(env, { file: entry.file });
    for (const message of result.errors) errors.push(`${entry.name}: ${message}`);
    for (const message of result.warnings) warnings.push(`${entry.name}: ${message}`);
  }

  const enabled = truthy(base.KNOT_ENTRY_ENABLED);
  if (enabled) {
    if (!entry) {
      errors.push(
        `KNOT_ENTRY_ENABLED=1 但 sites/${paths.name}/ 下没有 entry.<标签>.xknot.si.env。接入 xknot.si 子域要有且只有一份入口文件。`
      );
    } else {
      let originHost = "";
      try {
        originHost = new URL(String(base.KNOT_PUBLIC_ORIGIN || "")).hostname;
      } catch {
        originHost = "";
      }
      if (originHost && entry.host && originHost !== entry.host) {
        errors.push(`KNOT_PUBLIC_ORIGIN 的主机名 ${originHost} 与入口文件 ${entry.name} 不一致。`);
      }
    }
  } else if (entry) {
    errors.push(
      `KNOT_ENTRY_ENABLED=0 是 local 部署，但 sites/${paths.name}/ 下还有 ${entry.name}；local 不带入口文件，要接子域请设 KNOT_ENTRY_ENABLED=1。`
    );
  }

  return { errors, warnings, count: entry ? 1 : 0 };
}

function writeOut(file, text, mode = 0o644) {
  mkdirSync(path.dirname(file), { recursive: true });
  // 先按目标权限创建再写：writeFileSync 后 chmod 之间有一个窗口，文件按 umask
  // （通常 0644）存在。这个函数写的是 platform.env，里面有 DATABASE_URL。
  writeFileSync(file, text, { mode });
  chmodSync(file, mode);
  console.log(`写入 ${path.relative(DEPLOY, file)}`);
}

function cmdTemplate(argv) {
  const text = renderSiteExample();
  if (has(argv, "--write")) writeOut(PATHS.siteTemplate, text);
  else process.stdout.write(text);
  return 0;
}

function cmdPlatformTemplate(argv) {
  const text = renderPlatformExample();
  if (has(argv, "--write")) writeOut(PATHS.platformTemplate, text);
  else process.stdout.write(text);
  return 0;
}

function cmdXknotTemplate(argv) {
  const text = renderJoinExample();
  if (has(argv, "--write")) writeOut(PATHS.xknotTemplate, text);
  else process.stdout.write(text);
  return 0;
}

// 写入接入配置：把中枢接入件里的键合并进 sites/<站点>/xknot.env。
//
// 只碰这一个文件。接入件里给了的键覆盖旧值，没给的沿用——重领一次不会把中枢地址抹掉。
// 唯一例外是委托发信凭据：它是一次签发一份，不能拿旧文件的一半去配新件的一半。
function cmdJoin(argv) {
  const paths = selectedSite(argv);
  const outPath = path.resolve(optionalArgValue(argv, "--out", paths.joinEnv));
  const inPath = argValue(argv, "--in", "");
  if (inPath && !existsSync(path.resolve(inPath))) {
    console.error(`错误：找不到接入件 ${inPath}`);
    return 1;
  }

  const given = {};
  if (inPath) {
    for (const [key, value] of Object.entries(parseEnv(readText(path.resolve(inPath))))) {
      if (!isBlank(value)) given[key] = String(value).trim();
    }
  }
  if (!Object.keys(given).length) {
    console.error("接入件里没有可用的键。至少要 XKNOT_INSTANCE_ID；要委托发信再加 XKNOT_HUB_RELAY_TOKEN。");
    return 1;
  }
  // 地址单独出现时不借旧凭据：那会把上一份签发的东西发到新地址去。要换入口，让中枢整份重发。
  if (Object.hasOwn(given, "XKNOT_HUB_RELAY_URL") && !Object.hasOwn(given, "XKNOT_HUB_RELAY_TOKEN")) {
    console.error("接入件里写了 XKNOT_HUB_RELAY_URL 却没有 XKNOT_HUB_RELAY_TOKEN；换入口请让中枢重发一整份，不要单独改地址。");
    return 1;
  }

  const base = existsSync(outPath) ? readText(outPath) : renderJoinFile({});
  const existing = parseEnv(base);
  const merged = { ...given };

  // 凭据单独处理：接入件带新凭据就整份换，旧文件里的发信地址属于上一份签发，一并清掉；
  // 接入件不带凭据时沿用旧凭据（也沿用旧的地址覆盖），免得重领一份把发信能力弄没。
  if (Object.hasOwn(given, "XKNOT_HUB_RELAY_TOKEN")) {
    if (!Object.hasOwn(given, "XKNOT_HUB_RELAY_URL")) merged.XKNOT_HUB_RELAY_URL = "";
  } else if (!isBlank(existing.XKNOT_HUB_RELAY_TOKEN)) {
    merged.XKNOT_HUB_RELAY_TOKEN = String(existing.XKNOT_HUB_RELAY_TOKEN).trim();
    if (!isBlank(existing.XKNOT_HUB_RELAY_URL)) merged.XKNOT_HUB_RELAY_URL = String(existing.XKNOT_HUB_RELAY_URL).trim();
  }

  // 其余键沿用旧值，避免重领时把实例 id 或中枢地址清空。
  for (const key of [
    "XKNOT_INSTANCE_ID",
    "XKNOT_ISSUED_URL",
    "XKNOT_ISSUED_AT",
    "XKNOT_TIER",
    "XKNOT_STATUS",
    "XKNOT_HUB_ORIGIN",
  ]) {
    if (Object.hasOwn(merged, key)) continue;
    if (!isBlank(existing[key])) merged[key] = String(existing[key]).trim();
  }

  // 先校验再落盘：宁可让旧文件留着，也别写进一份半对的接入配置。
  const text = updateEnvText(base, merged);
  const check = checkJoin(text, { mode: 0o600 });
  if (check.errors.length) return report("XKnot 接入配置", check);

  writeOut(outPath, text, 0o600);
  return report("XKnot 接入配置", check);
}

function cmdDocs(argv) {
  const text = renderDocs();
  if (has(argv, "--write")) writeOut(PATHS.docs, text);
  else process.stdout.write(text);
  return 0;
}

function cmdSites() {
  const names = listSites(DEPLOY);
  if (!names.length) {
    console.log("sites/ 下还没有站点。先跑 node ops/scripts/config.mjs init <站点>。");
    return 0;
  }
  for (const name of names) {
    const dir = path.join(PATHS.sites, name);
    const platform = existsSync(path.join(dir, "platform.env")) ? "platform.env 已生成" : "还没有 platform.env";
    // 接入状态单独一列：没有 xknot.env 就是没接入，不是缺配置。
    const joinFile = path.join(dir, "xknot.env");
    let join = "未接入";
    if (existsSync(joinFile)) {
      const env = parseEnv(readFileSync(joinFile, "utf8"));
      join = env.XKNOT_INSTANCE_ID ? `已接入 ${env.XKNOT_INSTANCE_ID}` : "xknot.env 缺实例 id";
    }
    const entries = listEntryFiles(dir).map((entry) => entry.host);
    const entryNote = entries.length ? `，入口 ${entries.join("、")}` : "，无公网入口";
    console.log(`${name.padEnd(16)} ${platform}${entryNote}，${join}`);
  }
  return 0;
}

function cmdInit(argv) {
  const name = String(argv[0] || "").trim();
  if (!validSiteName(name)) {
    console.error("用法：config.mjs init <站点>（站点名用字母、数字、点、下划线或短横线）");
    return 2;
  }
  const dir = path.join(PATHS.sites, name);
  const siteEnv = path.join(dir, "site.env");
  if (existsSync(siteEnv)) {
    console.error(`已经存在：${path.relative(DEPLOY, siteEnv)}`);
    return 1;
  }
  if (!existsSync(PATHS.siteTemplate) || !existsSync(PATHS.platformTemplate)) {
    console.error("缺少 sites/_template。先跑 template --write 和 platform-template --write。");
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);
  copyFileSync(PATHS.siteTemplate, siteEnv);
  const platform = path.join(dir, "platform.env");
  if (!existsSync(platform)) copyFileSync(PATHS.platformTemplate, platform);
  chmodSync(siteEnv, 0o600);
  chmodSync(platform, 0o600);
  console.log(`已创建 ${path.relative(DEPLOY, dir)}/`);
  console.log("接着改 site.env 里的对外地址、管理员邮箱和部署目标，再跑：");
  console.log(`  node ops/scripts/config.mjs check --site ${name}`);
  return 0;
}

function computedValue(key, env, ctx) {
  switch (key) {
    case "KNOT_SITE":
      return ctx.site;
    case "DATABASE_URL": {
      if (!isBlank(process.env.DATABASE_URL)) return process.env.DATABASE_URL;
      if (env.KNOT_DB_MODE === "external") return env.KNOT_DATABASE_URL || "";
      const port = resolve(KEYS.find((entry) => entry.key === "KNOT_PGPORT"), env, ctx);
      return `postgres://knot@127.0.0.1:${port}/knot`;
    }
    case "STATIC_WEB_DIR":
      return path.join(ctx.root, "web/dist");
    case "KNOT_AGENT_ENV_DIR":
      return path.join(ctx.deployRoot || ctx.root, "sites", ctx.site, "agents");
    case "KNOT_PROFILE_FILE":
      return path.join(ctx.deployRoot || ctx.root, "sites", ctx.site, "profile.json");
    case "KNOT_DISCOVER_PUSH_CMD":
      return truthy(env.KNOT_ENTRY_ENABLED) ? path.join(ctx.root, "ops/scripts/push-discover.sh") : "";
    default:
      return "";
  }
}

function cmdEnv(argv) {
  const paths = selectedSite(argv);
  const outPath = path.resolve(argValue(argv, "--out", paths.platformEnv));
  // --root 是代码目录（决定 STATIC_WEB_DIR），--deploy-root 是配置和数据所在的部署根。
  const root = path.resolve(argValue(argv, "--root", APP));
  const deployRoot = path.resolve(argValue(argv, "--deploy-root", DEPLOY));
  const home = process.env.HOME || "";

  // 部署脚本算出来的值（DATABASE_URL、展开后的目录）通过环境传进来，优先于文件里的字面量。
  const env = readSiteEnv(paths);
  for (const entry of KEYS) {
    if (entry.file !== "site") continue;
    if (!isBlank(process.env[entry.key])) env[entry.key] = process.env[entry.key];
  }
  const ctx = { root, deployRoot, home, expand: true, site: paths.name };

  const always = {};
  for (const entry of KEYS) {
    if (entry.file === "site" && entry.runtime) {
      always[entry.runtime] = resolve(entry, env, ctx);
    }
    if (entry.file === "platform" && entry.computed) {
      always[entry.key] = computedValue(entry.key, env, ctx);
    }
  }

  const existing = parseEnv(readText(outPath));
  const seeds = {};
  for (const entry of KEYS) {
    if (entry.file !== "platform" || entry.computed) continue;
    if (isBlank(entry.default)) continue;
    if (Object.hasOwn(existing, entry.key)) continue;
    seeds[entry.key] = resolve(entry, env, ctx);
  }

  let base = existsSync(outPath) ? readText(outPath) : renderPlatformFile({ ...always, ...seeds });
  if (existsSync(outPath)) {
    // 生成时顺手清掉不该进站点配置的键，避免密钥路径跟着跑错机器。
    const cleaned = removeEnvKeys(base, FORBIDDEN_PLATFORM_KEYS);
    base = cleaned.text;
    if (cleaned.removed.length) {
      console.error(`警告：从运行时配置里移除了不属于实例主机的键：${cleaned.removed.join("、")}`);
    }
    // 0.3 之前委托发信凭据写在 platform.env；现在归 xknot.env。迁移一次，别把凭据留成孤儿。
    const joinKeys = KEYS.filter((entry) => entry.file === "xknot").map((entry) => entry.key);
    const leftover = {};
    for (const key of joinKeys) {
      if (!isBlank(existing[key])) leftover[key] = String(existing[key]).trim();
    }
    if (Object.keys(leftover).length) {
      const joinPath = path.resolve(argValue(argv, "--out-join", paths.joinEnv));
      const joinText = existsSync(joinPath) ? readText(joinPath) : renderJoinFile({});
      const joinExisting = parseEnv(joinText);
      const move = {};
      for (const [key, value] of Object.entries(leftover)) {
        if (isBlank(joinExisting[key])) move[key] = value;
      }
      if (Object.keys(move).length) writeOut(joinPath, updateEnvText(joinText, move), 0o600);
      base = removeEnvKeys(base, Object.keys(leftover)).text;
      console.error(
        `警告：platform.env 里的 XKnot 接入项已迁到 ${path.relative(DEPLOY, joinPath)}：${Object.keys(leftover).join("、")}。`
      );
    }
  }
  // seeds 只含文件里还没有的键，所以合并成一次写入既不会覆盖运维改过的值，也只有一个追加段。
  const text = existsSync(outPath) ? updateEnvText(base, { ...always, ...seeds }) : base;
  writeOut(outPath, text, 0o600);
  return 0;
}

function cmdShow(argv) {
  const role = argValue(argv, "--for", "platform");
  const paths = selectedSite(argv);
  const env = readSiteEnv(paths);
  const ctx = { root: APP, deployRoot: DEPLOY, home: process.env.HOME || "" };
  for (const entry of KEYS) {
    if (entry.file !== "site") continue;
    if (!entry.scope.includes(role)) continue;
    console.log(`${entry.key}=${formatValue(resolve(entry, env, ctx))}`);
  }
  return 0;
}

const COMMANDS = {
  sites: cmdSites,
  init: cmdInit,
  check: cmdCheck,
  template: cmdTemplate,
  "platform-template": cmdPlatformTemplate,
  "xknot-template": cmdXknotTemplate,
  docs: cmdDocs,
  env: cmdEnv,
  join: cmdJoin,
  show: cmdShow,
};

function main(argv) {
  const [command, ...rest] = argv;
  const run = COMMANDS[command];
  if (!run) {
    console.error(
      "用法：config.mjs <sites|init|check|template|platform-template|xknot-template|docs|env|join|show> [选项]"
    );
    return 2;
  }
  try {
    return run(rest);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = main(process.argv.slice(2));
}
