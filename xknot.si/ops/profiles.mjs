// 构建时读回站点自述的档案。
//
// 文件名就是实例 id：var/profiles/{id}.json，由 ops/fetch-profile.mjs 写入。
// 读取与「真实优先、样例补空」的规则与橱窗、活动数据共用 ops/json-dir.mjs：
// 一个站点没交档案，只影响它自己那一条，不拦整次构建。

import { mergeReal, readJsonDir } from "./json-dir.mjs";

export const PREVIEW_PROFILES_PATH = "fixtures/preview-profiles.json";

/**
 * @param {string} dir var/profiles 目录
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readProfiles(dir) {
  return readJsonDir(dir);
}

/** 真实的取回结果优先，样例只补空缺。 */
export function mergeProfiles(real = {}, samples = {}) {
  return mergeReal(real, samples);
}
