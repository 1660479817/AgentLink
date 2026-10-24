// 构建时读回 L3 橱窗。
//
// 文件名就是实例 id：var/cards/{id}.json。缺失的目录、坏掉的文件都跳过，
// 一份伙伴数据不该让整次构建失败；没有文件的条目自然没有橱窗。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PREVIEW_CARDS_PATH = "fixtures/preview-cards.json";

/**
 * @param {string} dir var/cards 目录
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readCards(dir) {
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
          // 坏文件跳过，页面只是少一条橱窗。
        }
      })
  );
  return out;
}

/** 真实的拉取结果优先，样例只补空缺。 */
export function mergeCards(real = {}, samples = {}) {
  return { ...(samples || {}), ...(real || {}) };
}
