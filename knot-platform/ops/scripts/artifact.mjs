#!/usr/bin/env node
// 发布包的读取与校验。build.sh / deploy-site.sh / rollback.sh 共用。
//
//   node ops/scripts/artifact.mjs latest   <artifacts 目录>
//   node ops/scripts/artifact.mjs field    <字段> <BUILD.json 或发布包目录>
//   node ops/scripts/artifact.mjs verify   <tar.gz>
//   node ops/scripts/artifact.mjs checksum <tar.gz>
//   node ops/scripts/artifact.mjs platform
//
// 只做文件读取和校验，不构建、不部署。

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUILD_FILE = "BUILD.json";
const REQUIRED = ["version", "commit", "platform", "builtAt"];

export function platformTag(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

// 发布目录名和回滚目标名。同一份代码两次构建得到同一个名字，覆盖安装即可。
export function releaseName(info) {
  // BUILD.json 里有 release 就以它为准：发布目录名、deployed.json 的记录、
  // /api/health 报出来的 release 必须是同一个字符串，否则探活会拿两个名字比对，
  // 或者出现「目录叫 A、健康检查说 B」的部署记录。
  const explicit = String(info.release || "").trim();
  if (explicit) return explicit;
  const suffix = info.dirty ? "-dirty" : "";
  return `knot-${info.version}-${info.commit}${suffix}`;
}

export function readBuildFile(target) {
  const file = target.endsWith(".json") ? target : path.join(target, BUILD_FILE);
  if (!existsSync(file)) throw new Error(`缺少 ${BUILD_FILE}：${file}。这是源码目录，不是发布包。`);
  let info;
  try {
    info = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} 不是合法的 JSON：${error.message}`);
  }
  for (const key of REQUIRED) {
    if (!String(info[key] ?? "").trim()) throw new Error(`${file} 缺少 ${key}。`);
  }
  return info;
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// 发布包的 .sha256 文件和 `shasum -a 256` 的输出格式一致：`<hex>  <文件名>`。
export async function verifyArtifact(tarball) {
  const checksum = `${tarball}.sha256`;
  if (!existsSync(checksum)) throw new Error(`缺少校验和：${checksum}`);
  const expected = readFileSync(checksum, "utf8").trim().split(/\s+/)[0].toLowerCase();
  const actual = await sha256File(tarball);
  if (!expected || expected !== actual) {
    throw new Error(`${path.basename(tarball)} 校验和不一致：期望 ${expected || "(空)"}，实际 ${actual}`);
  }
  return actual;
}

// 取 artifacts 目录里最新的发布包。按修改时间排，不看文件名。
export function latestArtifact(dir) {
  if (!existsSync(dir)) throw new Error(`发布包目录不存在：${dir}`);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".tar.gz"))
    .map((name) => path.join(dir, name))
    .filter((file) => statSync(file).isFile());
  if (!files.length) throw new Error(`${dir} 里没有 .tar.gz 发布包。先跑 ./ops/scripts/build.sh。`);
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "platform":
      process.stdout.write(`${platformTag()}\n`);
      return 0;
    case "latest":
      if (!rest[0]) throw new Error("用法：artifact.mjs latest <目录>");
      process.stdout.write(`${latestArtifact(rest[0])}\n`);
      return 0;
    case "field": {
      const [field, target] = rest;
      if (!field || !target) throw new Error("用法：artifact.mjs field <字段> <发布包目录|BUILD.json>");
      const info = readBuildFile(target);
      if (field === "release") process.stdout.write(`${releaseName(info)}\n`);
      else process.stdout.write(`${info[field] ?? ""}\n`);
      return 0;
    }
    case "verify":
      if (!rest[0]) throw new Error("用法：artifact.mjs verify <tar.gz>");
      return verifyArtifact(rest[0]).then((sum) => {
        process.stdout.write(`${sum}\n`);
        return 0;
      });
    case "checksum": {
      if (!rest[0]) throw new Error("用法：artifact.mjs checksum <文件>");
      return sha256File(rest[0]).then((sum) => {
        process.stdout.write(`${sum}\n`);
        return 0;
      });
    }
    default:
      throw new Error("用法：artifact.mjs <latest|field|verify|checksum|platform>");
  }
}

// 被 import 时不执行 CLI。比较真实路径：macOS 的 /var 是 /private/var 的软链，
// 直接比字符串会在临时目录里失配，命令行一句话都不输出。
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
