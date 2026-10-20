import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 发布包根上的 BUILD.json，由 ops/scripts/build.sh 写。
// 从源码目录直接跑时没有这个文件，返回 null，探活只报版本号。
export function readBuildInfo() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "BUILD.json"), "utf8"));
    return {
      release: info.release || null,
      commit: info.commit || null,
      builtAt: info.builtAt || null,
      platform: info.platform || null,
    };
  } catch {
    return null;
  }
}
