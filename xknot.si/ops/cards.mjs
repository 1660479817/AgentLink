// 构建时读回 L3 橱窗。
//
// 文件名就是实例 id：var/cards/{id}.json。读取与「真实优先、样例补空」的规则
// 与档案、活动数据共用 ops/json-dir.mjs，这里只留这一层的路径与导出名。

import { mergeReal, readJsonDir } from "./json-dir.mjs";

export const PREVIEW_CARDS_PATH = "fixtures/preview-cards.json";

/**
 * @param {string} dir var/cards 目录
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readCards(dir) {
  return readJsonDir(dir);
}

/** 真实的拉取结果优先，样例只补空缺。 */
export function mergeCards(real = {}, samples = {}) {
  return mergeReal(real, samples);
}
