// 构建时读回 L2 活动数据。
//
// 文件名就是实例 id：var/stats/{id}.json。读取与「真实优先、样例补空」的规则
// 与橱窗、档案共用 ops/json-dir.mjs。没有文件的条目在页面上显示「未公开」，
// 不是 0。结构见 docs/FEDERATION.md 第 5.5 节。

import { mergeReal, readJsonDir } from "./json-dir.mjs";

export const PREVIEW_STATS_PATH = "fixtures/preview-stats.json";

/**
 * @param {string} dir var/stats 目录
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readStats(dir) {
  return readJsonDir(dir);
}

/** 真实的拉取结果优先，样例只补空缺。 */
export function mergeStats(real = {}, samples = {}) {
  return mergeReal(real, samples);
}
