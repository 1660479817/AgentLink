// 构建时读回一份「按实例 id 存的 JSON 目录」。
//
// var/cards、var/profiles、var/stats 的布局一样：文件名就是实例 id，一份文件一个实例。
// 这三处原本各写一份逐字相同的实现，改一处就得记着改另外两处；收在这里一份。
//
// 缺失的目录、坏掉的 JSON、不是对象的 payload 一律跳过：一份伙伴数据不该让整次构建失败，
// 页面只是少那一条。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * @param {string} dir 目录（如 var/cards）
 * @returns {Promise<Record<string, unknown>>} 以文件名为键，坏文件不在里面
 */
export async function readJsonDir(dir) {
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
          // 坏文件跳过，页面只是少那一条。
        }
      })
  );
  return out;
}

/** 真实的拉取结果优先，样例只补空缺。 */
export function mergeReal(real = {}, samples = {}) {
  return { ...(samples || {}), ...(real || {}) };
}
