import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runRetrievalAgent } from "./agents/openclaw.js";
import { loadBootstrapConfig } from "./config.js";
import { visibleVerdict } from "./information.js";
import { createIntel, searchPublicIntel } from "./market.js";
import { recordNotification } from "./notifications.js";
import { economyConfig, PLATFORM_ACCOUNT_ID } from "./points.js";
import { searchConfig } from "./searchConfig.js";
import { newStorageName, storagePath } from "./uploads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clip(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? value.slice(0, max) : value;
}

// 把自然语言检索要求落成一条 wish，并登记检索任务，交给后台信息检索员执行。
// 检索结果打包成 wishRespond（带报告附件），请求方到 wish 里下载时付费。
//
// 重复提交是常态：代理超时后会重发同一句。createIntel 对相同正文返回同一条 wish，
// 所以这里对 retrieval_jobs 用 upsert，重复提交认回原来那个任务，不再撞唯一约束。
// 登记任务并决定这次要不要重跑。重复提交是常态：同一个 wish 的任务行用 upsert，
// 认回原来那一行，不再撞唯一约束。
//   pending / running  → 已经在跑，认回原任务，不重排、不重扣；
//   done 且已有可见响应 → 已经交付，认回原任务；
//   done 但响应被撤销/删除 → 重新排队，否则请求方永远卡在这条 wish 上；
//   新行 / failed → 改成 pending 并安排执行。
export async function prepareRetrievalJob(pool, { wishId, userId, query }) {
  const { rows } = await pool.query(
    `INSERT INTO retrieval_jobs (wish_id, account_id, query) VALUES ($1, $2, $3)
     ON CONFLICT (wish_id) DO UPDATE SET query = EXCLUDED.query
     RETURNING id, status`,
    [wishId, userId, query],
  );
  const job = rows[0];
  if (job.status === "pending" || job.status === "running") {
    return { jobId: job.id, status: job.status, duplicate: true, run: false };
  }
  if (job.status === "done" && (await existingResponseId(pool, wishId))) {
    return { jobId: job.id, status: "done", duplicate: true, run: false };
  }
  await pool.query(
    `UPDATE retrieval_jobs SET status = 'pending', error = NULL, attempts = 0, updated_at = now() WHERE id = $1`,
    [job.id],
  );
  return { jobId: job.id, status: "pending", duplicate: false, run: true };
}

export async function createRetrieval(pool, { userId, actor, door, query }) {
  const text = clip(query, 400);
  if (!text) {
    const error = new Error("bad_body");
    error.code = "bad_body";
    throw error;
  }
  const intel = await createIntel(pool, {
    userId,
    actor,
    door,
    body: text,
    kind: "wish",
    hours: 24,
  });
  const job = await prepareRetrievalJob(pool, { wishId: intel.kMeta.id, userId, query: text });
  if (job.run) enqueueRetrieval(pool, job.jobId);
  return { wish: intel, jobId: job.jobId, status: job.status, duplicate: job.duplicate };
}

const queue = [];
const running = new Set();
let pumping = false;

function enqueueRetrieval(pool, jobId) {
  if (!jobId || running.has(jobId) || queue.includes(jobId)) return;
  queue.push(jobId);
  pumpRetrievals(pool);
}

function retryDelay(attempt) {
  return Math.min(30 * 60 * 1000, 15_000 * 2 ** Math.min(attempt - 1, 6));
}

function scheduleRetry(pool, jobId, attempt = 1) {
  const timer = setTimeout(() => enqueueRetrieval(pool, jobId), retryDelay(attempt));
  timer.unref();
}

async function markRunning(pool, jobId) {
  // 只有还在排队的任务才领走。已经 done / failed 的行不能被重新跑起来：
  // 重复入队或重启恢复时，无条件改成 running 会让一条已完成的检索再发一份结果。
  const { rowCount } = await pool.query(
    `UPDATE retrieval_jobs SET status = 'running', updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [jobId],
  );
  return Boolean(rowCount);
}

async function markDone(pool, jobId, respondId) {
  await pool.query(
    `UPDATE retrieval_jobs SET status = 'done', respond_id = $2, error = NULL, updated_at = now() WHERE id = $1`,
    [jobId, respondId],
  );
}

async function markFailed(pool, jobId, message) {
  await pool.query(
    `UPDATE retrieval_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    [jobId, clip(message, 400)],
  );
}

// 失败一次就把尝试次数写回行里：进程重启不会把上限清零，运维也能从表里看到重试过几次。
async function markRetry(pool, jobId) {
  await pool.query(
    `UPDATE retrieval_jobs SET status = 'pending', attempts = attempts + 1, updated_at = now() WHERE id = $1`,
    [jobId],
  );
}

function reportFileName(query) {
  const base = clip(query, 40).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim() || "检索报告";
  return `${base}.md`;
}

async function storeReport(pool, uploadDir, report, query) {
  const storageName = newStorageName(reportFileName(query));
  const file = storagePath(uploadDir, storageName);
  const bytes = Buffer.byteLength(report, "utf8");
  const sha256 = createHash("sha256").update(report, "utf8").digest("hex");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, report, "utf8");
  try {
    const { rows } = await pool.query(
      `INSERT INTO uploads (account_id, storage_name, mime, original_name, size, sha256)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [PLATFORM_ACCOUNT_ID, storageName, "text/markdown", reportFileName(query), bytes, sha256],
    );
    return { id: rows[0].id, storageName };
  } catch (error) {
    // 写库失败时删掉刚写的报告，否则审计里会多一个没有库记录的文件。
    await rm(file, { force: true }).catch(() => {});
    throw error;
  }
}

// 发布失败时收掉刚写的报告：重试会再写一份，不删就只能等 gc-uploads.mjs。
// 只删没被任何记录引用的行——发布其实已经提交、只是后续步骤抛错时，附件还在用。
async function discardReport(pool, uploadDir, upload) {
  const { rowCount } = await pool.query(
    `DELETE FROM uploads u
      WHERE u.id = $1
        AND NOT EXISTS (SELECT 1 FROM intel_files f WHERE f.upload_id = u.id)`,
    [upload.id],
  );
  if (!rowCount) return;
  await rm(storagePath(uploadDir, upload.storageName), { force: true }).catch(() => {});
}

// 这条 wish 是否已经有可用响应。重试前先认一次：上一次可能已经把结果发出去了，
// 只是没来得及把任务标成 done（进程被杀、或 markDone 那一刻数据库抖了一下）。
// 不查这一下，重试会再发一份，请求方就为同一次检索看到两条付费响应。
export async function existingResponseId(pool, wishId) {
  const { rows } = await pool.query(
    `SELECT id FROM intel
      WHERE responds_to = $1 AND kind = 'wishRespond' AND ${visibleVerdict("verdict")}
      ORDER BY created_at DESC LIMIT 1`,
    [wishId],
  );
  return rows[0]?.id || null;
}

// 内部优先、外部补充：先用平台信息流检索，再把命中交给信息检索员整合（可用工具补外部）。
// 返回 true 表示这次失败后已排入重试（计数已落库，调用方不必再管）。
async function processRetrieval(pool, jobId) {
  const { rows } = await pool.query(
    `SELECT id, wish_id, account_id, query, status, attempts FROM retrieval_jobs WHERE id = $1`,
    [jobId],
  );
  const job = rows[0];
  if (!job || job.status === "done" || job.status === "failed") return false;
  if (!UUID.test(String(job.wish_id))) {
    await markFailed(pool, jobId, "bad_wish");
    return false;
  }
  const maxAttempts = searchConfig().retrievalMaxAttempts;

  // 先认已有的响应。上一次可能已经把结果发出去了，只是没来得及把任务标成 done
  // （进程被杀、或 markDone 那一刻数据库抖了一下）。
  const existing = await existingResponseId(pool, job.wish_id);
  if (existing) {
    await markDone(pool, jobId, existing);
    return false;
  }

  let internal = [];
  try {
    // 内部检索不记打点：它不是「有人搜过」，记到平台账号上会污染检索次数，
    // 精算师看到的用量也就不对了。
    internal = await searchPublicIntel(pool, job.query, null, {});
  } catch (error) {
    // 内部检索失败不中断任务，只把空命中交给检索员（它还能用外部工具）。
    console.error(error);
    internal = [];
  }

  let report;
  try {
    report = await runRetrievalAgent(job.query, internal, `retrieval-${jobId}`);
  } catch (error) {
    if ((Number(job.attempts) || 0) + 1 < maxAttempts) {
      const attempt = Number(job.attempts) + 2;
      await markRetry(pool, jobId);
      scheduleRetry(pool, jobId, attempt);
      return true;
    }
    await markFailed(pool, jobId, error.message || "retrieval_failed");
    await notifyRetrievalFailed(pool, job);
    return false;
  }

  const { uploadDir } = loadBootstrapConfig();
  let upload;
  try {
    upload = await storeReport(pool, uploadDir, report, job.query);
  } catch (error) {
    await markFailed(pool, jobId, error.message || "report_store_failed");
    await notifyRetrievalFailed(pool, job);
    return false;
  }

  try {
    const intel = await createIntel(pool, {
      userId: PLATFORM_ACCOUNT_ID,
      actor: "platform",
      door: "platform",
      body: `信息检索：${clip(job.query, 80)}`,
      fileIds: [upload.id],
      kind: "wishRespond",
      respondsTo: job.wish_id,
      price: economyConfig().retrievalPrice,
    });
    await markDone(pool, jobId, intel.kMeta.id);
  } catch (error) {
    // 没发出去的报告是孤儿：删掉再重排，否则每次重试都多留一份文件与 uploads 行。
    await discardReport(pool, uploadDir, upload).catch((cleanupError) => console.error(cleanupError));
    // 响应发布失败重试；超过次数记为失败。
    if ((Number(job.attempts) || 0) + 1 < maxAttempts) {
      const attempt = Number(job.attempts) + 2;
      await markRetry(pool, jobId);
      scheduleRetry(pool, jobId, attempt);
      return true;
    }
    await markFailed(pool, jobId, error.message || "respond_failed");
    await notifyRetrievalFailed(pool, job);
  }
  return false;
}

async function notifyRetrievalFailed(pool, job) {
  await recordNotification(pool, {
    userId: job.account_id,
    kind: "retrieval_failed",
    title: "信息检索没有完成",
    body: `「${clip(job.query, 60)}」这次检索没做成，积分未扣，可重新提交。`,
    href: `/wish?wish=${job.wish_id}`,
    data: { query: clip(job.query, 60) },
  });
}

async function runOne(pool, jobId) {
  try {
    if (!(await markRunning(pool, jobId))) return;
    await processRetrieval(pool, jobId);
  } catch (error) {
    console.error(error);
    await markFailed(pool, jobId, error.message || "retrieval_failed");
    try {
      const { rows } = await pool.query(`SELECT id, wish_id, account_id, query FROM retrieval_jobs WHERE id = $1`, [jobId]);
      if (rows[0]) await notifyRetrievalFailed(pool, rows[0]);
    } catch (notifyError) {
      console.error(notifyError);
    }
  }
}

// 检索员队列：并发数可配（KNOT_RETRIEVAL_CONCURRENCY）。检索一次要调一轮检索员，
// 串行时排在后面的请求会等到前一个超时才动，超时上限又是分钟级。
function pumpRetrievals(pool) {
  if (pumping) return;
  pumping = true;
  const width = searchConfig().retrievalConcurrency;
  let active = 0;
  const step = () => {
    while (active < width) {
      const jobId = queue.shift();
      if (!jobId) break;
      active += 1;
      running.add(jobId);
      runOne(pool, jobId).finally(() => {
        running.delete(jobId);
        active -= 1;
        step();
      });
    }
    if (active === 0 && !queue.length) pumping = false;
  };
  step();
}

// 重启后恢复未完成的任务：running 是上次崩溃遗留，重置回 pending 重新执行。
export async function resumePendingRetrievals(pool) {
  await pool.query(
    `UPDATE retrieval_jobs SET status = 'pending', updated_at = now() WHERE status = 'running'`,
  );
  const { rows } = await pool.query(
    `SELECT id FROM retrieval_jobs WHERE status = 'pending' ORDER BY created_at ASC`,
  );
  for (const row of rows) enqueueRetrieval(pool, row.id);
}
