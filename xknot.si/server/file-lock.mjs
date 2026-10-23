// 跨进程的文件锁：instances.json 与 federation.json 有几个独立的写者——
// 接口进程（控制台保存）、provision worker（发布、改 active）、admin-cli（publish）。
// 每一处都是「读-改-写」，中间没有锁，两个进程交错时就丢更新：
// 后写的那个把自己读到的旧副本盖回去，前一个刚加进去的条目就没了。
//
// 只做一件事：拿一把以清单文件命名的锁（`<file>.lock`），做完删掉。
// 锁文件由 `wx` 独占创建，存在即被占；写完就删。锁文件名固定按清单算，
// 所以几个写者即使改的不是同一份名册，也排在同一个队列里。

import { open, stat, unlink } from "node:fs/promises";

// 持锁进程被杀会把锁文件留下。超过这个时长的锁一律当陈旧锁清掉，
// 否则一次 kill -9 就让清单再也写不进去。
const STALE_MS = 30_000;
const WAIT_MS = 5_000;
const RETRY_MS = 15;

async function acquire(lockFile) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      return await open(lockFile, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockFile);
        if (Date.now() - info.mtimeMs > STALE_MS) {
          await unlink(lockFile).catch(() => {});
          continue;
        }
      } catch {
        // 锁在这一刻被别人删掉了，直接再抢一次。
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`lock_timeout: ${lockFile}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

/**
 * @param {string} anchor 用来命名锁的文件（清单路径）
 * @param {() => Promise<any>} fn 读-改-写，整段在锁内
 */
export async function withFileLock(anchor, fn) {
  if (!anchor) return fn();
  const lockFile = `${anchor}.lock`;
  const handle = await acquire(lockFile);
  try {
    await handle.writeFile(`${process.pid}\n`, "utf8");
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await unlink(lockFile).catch(() => {});
  }
}
