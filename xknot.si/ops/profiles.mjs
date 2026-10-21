// 构建时读回站点自述的档案。
//
// 文件名就是实例 id：var/profiles/{id}.json，由 ops/fetch-profile.mjs 写入。
// 缺失的目录、坏掉的文件都跳过：一个站点没交档案，只影响它自己那一条，
// 不拦整次构建。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PREVIEW_PROFILES_PATH = "fixtures/preview-profiles.json";

/**
 * @param {string} dir var/profiles 目录
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readProfiles(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return {};
  }

  const out = {};
  await Promise.all(
    names
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .map(async (name) => {
        try {
          const payload = JSON.parse(await readFile(path.join(dir, name), "utf8"));
          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            out[name.slice(0, -".json".length)] = payload;
          }
        } catch {
          // 坏文件跳过，页面只是少一条介绍。
        }
      })
  );
  return out;
}

/** 真实的取回结果优先，样例只补空缺。 */
export function mergeProfiles(real = {}, samples = {}) {
  return { ...(samples || {}), ...(real || {}) };
}
