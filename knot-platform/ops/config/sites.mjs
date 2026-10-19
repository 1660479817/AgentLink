// 站点目录的定位与读取。
//
// 一个站点一个目录：
//
//   sites/<站点>/site.env          站点身份与拓扑
//   sites/<站点>/site.<变体>.env   可选叠加层
//   sites/<站点>/platform.env      平台主机运行时值（部署脚本生成）
//
// 这里只做文件系统上的事，不解释每个键的含义；键在 schema.mjs 里登记。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "./schema.mjs";

export const SITES_DIR = "sites";
export const TEMPLATE_SITE = "_template";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validSiteName(value) {
  return NAME.test(String(value || "").trim());
}

function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// 列出 sites/ 下带 site.env 的站点目录，模板目录不算。
export function listSites(root) {
  const dir = path.join(root, SITES_DIR);
  if (!isDirectory(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith("_") && isDirectory(path.join(dir, name)))
    .filter((name) => existsSync(path.join(dir, name, "site.env")))
    .sort();
}

// 定位一个站点的三个文件。site 留空时，只有恰好一个站点才自动选中。
export function resolveSitePaths(root, { site, variant, file } = {}) {
  const siteName = String(site || "").trim();
  const variantName = String(variant || "").trim();
  const filePath = String(file || "").trim();
  let dir;
  let name;

  if (filePath) {
    const absolute = path.resolve(root, filePath);
    dir = path.dirname(absolute);
    name = siteName || path.basename(dir);
    if (path.basename(absolute) !== "site.env") {
      throw new Error(`--site-file 要指向 site.env，收到 ${filePath}`);
    }
  } else if (siteName) {
    if (!validSiteName(siteName)) {
      throw new Error(`站点名只能用字母、数字、点、下划线和短横线：${siteName}`);
    }
    name = siteName;
    dir = path.join(root, SITES_DIR, siteName);
  } else {
    const sites = listSites(root);
    if (sites.length === 1) {
      [name] = sites;
      dir = path.join(root, SITES_DIR, name);
    } else if (!sites.length) {
      throw new Error(
        `sites/ 下没有站点配置。先创建：mkdir -p sites/<站点> && cp sites/_template/site.env sites/<站点>/site.env`
      );
    } else {
      throw new Error(`sites/ 下有多个站点，请用 --site 指定：${sites.join("、")}`);
    }
  }

  if (variantName && !validSiteName(variantName)) {
    throw new Error(`变体名只能用字母、数字、点、下划线和短横线：${variantName}`);
  }

  const siteEnv = path.join(dir, "site.env");
  const overlay = variantName ? path.join(dir, `site.${variantName}.env`) : "";
  const platformEnv = path.join(dir, "platform.env");

  if (!existsSync(siteEnv)) {
    throw new Error(`找不到站点配置：${path.relative(root, siteEnv)}`);
  }
  if (overlay && !existsSync(overlay)) {
    throw new Error(`找不到变体配置：${path.relative(root, overlay)}`);
  }

  return { name, dir, siteEnv, overlay, platformEnv };
}

// site.env 与可选的叠加层合成一份视图。叠加层里写空的键也会覆盖。
export function readSiteEnv(paths) {
  const env = { ...parseEnv(readFileSync(paths.siteEnv, "utf8")) };
  if (paths.overlay) Object.assign(env, parseEnv(readFileSync(paths.overlay, "utf8")));
  return env;
}

export function readPlatformEnv(paths) {
  return existsSync(paths.platformEnv) ? readFileSync(paths.platformEnv, "utf8") : "";
}
