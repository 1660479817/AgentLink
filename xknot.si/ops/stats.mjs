// 构建时读回 L2 活动数据。
//
// 文件名就是实例 id：var/stats/{id}.json。缺失的目录、坏掉的文件都跳过；
// 一份伙伴数据不该让整次构建失败。没有文件的条目在页面上显示「未公开」，
// 不是 0。结构见 docs/FEDERATION.md 第 5.5 节。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PREVIEW_STATS_PATH = "fixtures/preview-stats.json";

/**
 * @param {string} dir var/stats 目录
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readStats(dir) {
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
          // 坏文件跳过，页面只是显示「未公开」。
        }
      })
  );
  return out;
}

/** 真实的拉取结果优先，样例只补空缺。 */
export function mergeStats(real = {}, samples = {}) {
  return { ...(samples || {}), ...(real || {}) };
}
