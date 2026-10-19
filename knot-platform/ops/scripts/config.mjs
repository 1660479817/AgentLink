#!/usr/bin/env node
// 配置工具：校验、生成模板、生成文档、写平台运行时文件。
//
//   node ops/scripts/config.mjs sites
//   node ops/scripts/config.mjs init <站点>
//   node ops/scripts/config.mjs check --site <站点> [--variant <变体>]
//   node ops/scripts/config.mjs check --platform --site <站点>
//   node ops/scripts/config.mjs template [--write]
//   node ops/scripts/config.mjs platform-template [--write]
//   node ops/scripts/config.mjs docs [--write]
//   node ops/scripts/config.mjs env --site <站点> [--out path] [--root path]
//   node ops/scripts/config.mjs show --for dev|platform|edge --site <站点>
//
// 站点用 --site 选择，也可以用环境变量 KNOT_SITE。只有 sites/ 下恰好一个站点时才自动选中。
// 变体是 site.<变体>.env 叠加层，用 --variant 选择。
// check 发现类型错误、缺必填、跨键矛盾时以退出码 1 结束。部署脚本据此在动任何东西之前停下。

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KEYS,
  FORBIDDEN_PLATFORM_KEYS,
  checkPlatform,
  checkSite,
  formatValue,
  isBlank,
  parseEnv,
  removeEnvKeys,
  renderDocs,
  renderPlatformExample,
  renderPlatformFile,
  renderSiteExample,
  resolve,
  truthy,
  updateEnvText,
} from "../config/schema.mjs";
import { listSites, readSiteEnv, resolveSitePaths, validSiteName } from "../config/sites.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

const PATHS = {
  sites: path.join(REPO, "sites"),
  templateDir: path.join(REPO, "sites/_template"),
  siteTemplate: path.join(REPO, "sites/_template/site.env"),
  platformTemplate: path.join(REPO, "sites/_template/platform.env"),
  docs: path.join(REPO, "docs/CONFIG.md"),
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
  const variant = argValue(argv, "--variant", process.env.KNOT_SITE_VARIANT || "");
  const file = argValue(argv, "--site-file", process.env.KNOT_SITE_FILE || "");
  return resolveSitePaths(REPO, { site, variant, file });
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
  const overlayName = paths.overlay ? path.basename(paths.overlay) : "";
  const label = `sites/${paths.name}/site.env${overlayName ? ` + ${overlayName}` : ""}`;

  if (has(argv, "--platform")) {
    const platformPath = path.resolve(optionalArgValue(argv, "--platform", paths.platformEnv));
    const text = readText(platformPath);
    if (!text) {
      console.error(`错误：找不到平台运行时配置 ${platformPath}`);
      return 1;
    }
    const mode = statSync(platformPath).mode;
    return report(`平台运行时配置 ${path.basename(platformPath)}`, checkPlatform(text, { mode }));
  }

  return report(`站点配置 ${label}`, checkSite(readSiteEnv(paths)));
}

function writeOut(file, text, mode = 0o644) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, mode);
  console.log(`写入 ${path.relative(REPO, file)}`);
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

function cmdDocs(argv) {
  const text = renderDocs();
  if (has(argv, "--write")) writeOut(PATHS.docs, text);
  else process.stdout.write(text);
  return 0;
}

function cmdSites() {
  const names = listSites(REPO);
  if (!names.length) {
    console.log("sites/ 下还没有站点。先跑 node ops/scripts/config.mjs init <站点>。");
    return 0;
  }
  for (const name of names) {
    const dir = path.join(PATHS.sites, name);
    const variants = readdirSync(dir)
      .map((entry) => /^site\.(.+)\.env$/.exec(entry))
      .filter(Boolean)
      .map((match) => match[1]);
    const platform = existsSync(path.join(dir, "platform.env")) ? "platform.env 已生成" : "还没有 platform.env";
    const tail = variants.length ? `，变体 ${variants.join("、")}` : "";
    console.log(`${name.padEnd(16)} ${platform}${tail}`);
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
    console.error(`已经存在：${path.relative(REPO, siteEnv)}`);
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
  console.log(`已创建 ${path.relative(REPO, dir)}/`);
  console.log("接着改 site.env 里的站点名、对外地址、管理员邮箱和部署目标，再跑：");
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
      const port = env.KNOT_PGPORT || 5433;
      return `postgres://knot@127.0.0.1:${port}/knot`;
    }
    case "STATIC_WEB_DIR":
      return path.join(ctx.root, "web/dist");
    case "KNOT_AGENT_ENV_DIR":
      return path.join(ctx.root, "sites", ctx.site, "agents");
    case "KNOT_DISCOVER_PUSH_CMD":
      return truthy(env.KNOT_EDGE) ? path.join(ctx.root, "ops/scripts/push-discover.sh") : "";
    default:
      return "";
  }
}

function cmdEnv(argv) {
  const paths = selectedSite(argv);
  const outPath = path.resolve(argValue(argv, "--out", paths.platformEnv));
  const root = path.resolve(argValue(argv, "--root", REPO));
  const home = process.env.HOME || "";

  // 部署脚本算出来的值（DATABASE_URL、展开后的目录）通过环境传进来，优先于文件里的字面量。
  const env = readSiteEnv(paths);
  for (const entry of KEYS) {
    if (entry.file !== "site") continue;
    if (!isBlank(process.env[entry.key])) env[entry.key] = process.env[entry.key];
  }
  const ctx = { root, home, expand: true, site: paths.name };

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
    // 旧版本把开发机的键写进来了；生成时顺手清掉，避免密钥路径跟着跑错机器。
    const cleaned = removeEnvKeys(base, FORBIDDEN_PLATFORM_KEYS);
    base = cleaned.text;
    if (cleaned.removed.length) {
      console.error(`警告：从运行时配置里移除了不属于平台主机的键：${cleaned.removed.join("、")}`);
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
  const ctx = { root: REPO, home: process.env.HOME || "" };
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
  docs: cmdDocs,
  env: cmdEnv,
  show: cmdShow,
};

function main(argv) {
  const [command, ...rest] = argv;
  const run = COMMANDS[command];
  if (!run) {
    console.error(
      "用法：config.mjs <sites|init|check|template|platform-template|docs|env|show> [选项]"
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
