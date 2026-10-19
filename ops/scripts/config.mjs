#!/usr/bin/env node
// 配置工具：校验、生成示例、生成文档、写运行时环境文件。
//
//   node ops/scripts/config.mjs check [--deploy ops/deploy.env] [--runtime [path]]
//   node ops/scripts/config.mjs template [--write]
//   node ops/scripts/config.mjs runtime-template [--write]
//   node ops/scripts/config.mjs docs [--write]
//   node ops/scripts/config.mjs env [--deploy ops/deploy.env] [--out path] [--root path]
//   node ops/scripts/config.mjs show --for dev|platform|edge
//
// check 发现类型错误、缺必填、跨键矛盾时以退出码 1 结束。部署脚本据此在动任何东西之前停下。

import { readFileSync, statSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KEYS,
  checkDeploy,
  checkRuntime,
  FORBIDDEN_RUNTIME_KEYS,
  formatValue,
  isBlank,
  parseEnv,
  removeEnvKeys,
  renderDeployExample,
  renderDocs,
  renderRuntimeExample,
  renderRuntimeFile,
  resolve,
  truthy,
  updateEnvText,
} from "../config/schema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

const PATHS = {
  // 一个站点一份部署配置。多站点时用 KNOT_DEPLOY_ENV 指到另一份。
  deploy: process.env.KNOT_DEPLOY_ENV || path.join(REPO, "ops/deploy.env"),
  deployExample: path.join(REPO, "ops/deploy.env.example"),
  runtime: path.join(REPO, "ops/env/knot-platform.local.env"),
  runtimeExample: path.join(REPO, "ops/env/knot-platform.env.example"),
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

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
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
  const deployPath = argValue(argv, "--deploy", PATHS.deploy);
  const runtimePath = has(argv, "--runtime") ? argValue(argv, "--runtime", PATHS.runtime) : null;

  let code = 0;
  if (runtimePath != null) {
    const text = readText(runtimePath);
    if (!text) {
      console.error(`错误：找不到运行时配置 ${runtimePath}`);
      return 1;
    }
    const mode = statSync(runtimePath).mode;
    code = report(`运行时配置 ${path.basename(runtimePath)}`, checkRuntime(text, { mode })) || code;
  } else {
    if (!existsSync(deployPath)) {
      console.error(`错误：找不到 ${deployPath}。先 cp ops/deploy.env.example ops/deploy.env。`);
      return 1;
    }
    const env = parseEnv(readText(deployPath));
    code = report(`部署配置 ${path.basename(deployPath)}`, checkDeploy(env)) || code;
  }
  return code;
}

function writeOut(file, text, mode = 0o644) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, mode);
  console.log(`写入 ${path.relative(REPO, file)}`);
}

function cmdTemplate(argv) {
  const text = renderDeployExample();
  if (has(argv, "--write")) writeOut(PATHS.deployExample, text);
  else process.stdout.write(text);
  return 0;
}

function cmdRuntimeTemplate(argv) {
  const text = renderRuntimeExample();
  if (has(argv, "--write")) writeOut(PATHS.runtimeExample, text);
  else process.stdout.write(text);
  return 0;
}

function cmdDocs(argv) {
  const text = renderDocs();
  if (has(argv, "--write")) writeOut(PATHS.docs, text);
  else process.stdout.write(text);
  return 0;
}

function computedValue(key, env, ctx) {
  switch (key) {
    case "DATABASE_URL": {
      if (!isBlank(process.env.DATABASE_URL)) return process.env.DATABASE_URL;
      if (env.KNOT_DB_MODE === "external") return env.KNOT_DATABASE_URL || "";
      const port = env.KNOT_PGPORT || 5433;
      return `postgres://knot@127.0.0.1:${port}/knot`;
    }
    case "STATIC_WEB_DIR":
      return path.join(ctx.root, "apps/web/dist");
    case "KNOT_AGENT_ENV_DIR":
      return path.join(ctx.root, "ops/env");
    case "KNOT_DISCOVER_PUSH_CMD":
      return truthy(env.KNOT_EDGE) ? path.join(ctx.root, "ops/scripts/push-discover.sh") : "";
    default:
      return "";
  }
}

function cmdEnv(argv) {
  const deployPath = argValue(argv, "--deploy", PATHS.deploy);
  const outPath = argValue(argv, "--out", PATHS.runtime);
  const root = path.resolve(argValue(argv, "--root", REPO));
  const home = process.env.HOME || "";
  if (!existsSync(deployPath)) {
    console.error(`错误：找不到 ${deployPath}。`);
    return 1;
  }

  // 部署脚本算出来的值（DATABASE_URL、展开后的目录）通过环境传进来，优先于文件里的字面量。
  const fileEnv = parseEnv(readText(deployPath));
  const env = { ...fileEnv };
  for (const entry of KEYS) {
    if (entry.file !== "deploy") continue;
    if (!isBlank(process.env[entry.key])) env[entry.key] = process.env[entry.key];
  }
  const ctx = { root, home, expand: true };

  const always = {};
  for (const entry of KEYS) {
    if (entry.file === "deploy" && entry.runtime) {
      always[entry.runtime] = resolve(entry, env, ctx);
    }
    if (entry.file === "runtime" && entry.computed) {
      always[entry.key] = computedValue(entry.key, env, ctx);
    }
  }

  const existing = parseEnv(readText(outPath));
  const seeds = {};
  for (const entry of KEYS) {
    if (entry.file !== "runtime" || entry.computed) continue;
    if (isBlank(entry.default)) continue;
    if (Object.hasOwn(existing, entry.key)) continue;
    seeds[entry.key] = resolve(entry, env, ctx);
  }

  let base = existsSync(outPath) ? readText(outPath) : renderRuntimeFile({ ...always, ...seeds });
  if (existsSync(outPath)) {
    // 旧版本把开发机的键写进来了；生成时顺手清掉，避免密钥路径跟着跑错机器。
    const cleaned = removeEnvKeys(base, FORBIDDEN_RUNTIME_KEYS);
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
  const env = parseEnv(readText(PATHS.deploy));
  const ctx = { root: REPO, home: process.env.HOME || "" };
  for (const entry of KEYS) {
    if (entry.file !== "deploy") continue;
    if (!entry.scope.includes(role)) continue;
    console.log(`${entry.key}=${formatValue(resolve(entry, env, ctx))}`);
  }
  return 0;
}

const COMMANDS = {
  check: cmdCheck,
  template: cmdTemplate,
  "runtime-template": cmdRuntimeTemplate,
  docs: cmdDocs,
  env: cmdEnv,
  show: cmdShow,
};

function main(argv) {
  const [command, ...rest] = argv;
  const run = COMMANDS[command];
  if (!run) {
    console.error("用法：config.mjs <check|template|runtime-template|docs|env|show> [选项]");
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
