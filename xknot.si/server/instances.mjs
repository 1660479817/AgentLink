// 清单（instances.json）按 mtime/size 缓存的读取。
//
// 委托发信要判断实例是否在册、是否 active，以及回信域名，统一读清单文件。
// 清单会被 `admin-cli publish` 或人工改动，按 mtime/size 缓存，改完立刻生效。
//
// 单独抽出来是为了能注入 file 与 cache 做测试：index.mjs 一 import 就起 HTTP 服务，
// 直接测它会连带监听端口；这份纯函数不碰网络，用临时目录就能覆盖两种分支。
import { readFileSync, statSync } from "node:fs";

/**
 * 读一次清单，按 mtime/size 决定要不要重新解析。
 * @param {{ file: string, cache: { key: string, list: unknown[] }, onError?: (error: Error) => void }} input
 * @returns {{ cache: { key: string, list: unknown[] }, list: unknown[] }}
 */
export function readInstancesCached({ file, cache, onError = () => {} }) {
  try {
    const stat = statSync(file);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (key === cache.key) return { cache, list: cache.list };
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const next = {
      key,
      list: Array.isArray(parsed.instances) ? parsed.instances : [],
    };
    return { cache: next, list: next.list };
  } catch (error) {
    onError(error);
    // 不能沿用上一份缓存：解析失败时那份名单可能是暂停/下架之前的，
    // 委托发信与「实例是否在册」的判断会一起 fail-open。清空即一切按不在册处理。
    const cleared = { key: "", list: [] };
    return { cache: cleared, list: cleared.list };
  }
}
