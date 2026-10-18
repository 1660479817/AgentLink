import { writeFile } from "node:fs/promises";
import { runRetrievalAgent } from "./agents/openclaw.js";
import { loadBootstrapConfig } from "./config.js";
import { createIntel, searchPublicIntel } from "./market.js";
import { recordNotification } from "./notifications.js";
import { economyConfig, PLATFORM_USER_ID } from "./points.js";
import { newStorageName, storagePath } from "./uploads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clip(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? value.slice(0, max) : value;
}

// 把自然语言检索要求落成一条 wish，并登记检索任务，交给后台信息检索员执行。
// 检索结果打包成 wishRespond（带报告附件），请求方到 wish 里下载时付费。
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
  const { rows } = await pool.query(
    `INSERT INTO retrieval_jobs (wish_id, user_id, query) VALUES ($1, $2, $3) RETURNING id`,
    [intel.kMeta.id, userId, text],
  );
  enqueueRetrieval(pool, rows[0].id);
  return { wish: intel, jobId: rows[0].id };
}

const queue = [];
const running = new Set();
let pumping = false;

function enqueueRetrieval(pool, jobId) {
  if (!jobId || running.has(jobId) || queue.includes(jobId)) return;
  queue.push(jobId);
  pumpRetrievals(pool);
}

const RETRIEVAL_MAX_ATTEMPTS = 3;
const attempts = new Map();

function retryDelay(attempt) {
  return Math.min(30 * 60 * 1000, 15_000 * 2 ** Math.min(attempt - 1, 6));
}

function scheduleRetry(pool, jobId) {
  const attempt = (attempts.get(jobId) || 0) + 1;
  attempts.set(jobId, attempt);
  const timer = setTimeout(() => enqueueRetrieval(pool, jobId), retryDelay(attempt));
  timer.unref();
}

async function markRunning(pool, jobId) {
  await pool.query(`UPDATE retrieval_jobs SET status = 'running', updated_at = now() WHERE id = $1`, [jobId]);
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

function reportFileName(query) {
  const base = clip(query, 40).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim() || "检索报告";
  return `${base}.md`;
}

async function storeReport(pool, uploadDir, report, query) {
  const storageName = newStorageName(reportFileName(query));
  await writeFile(storagePath(uploadDir, storageName), report, "utf8");
  const { rows } = await pool.query(
    `INSERT INTO uploads (user_id, storage_name, mime, original_name, size)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [PLATFORM_USER_ID, storageName, "text/markdown", reportFileName(query), Buffer.byteLength(report, "utf8")],
  );
  return rows[0].id;
}

// 内部优先、外部补充：先用平台信息流检索，再把命中交给信息检索员整合（可用工具补外部）。
async function processRetrieval(pool, jobId) {
  const { rows } = await pool.query(
    `SELECT id, wish_id, user_id, query, status FROM retrieval_jobs WHERE id = $1`,
    [jobId],
  );
  const job = rows[0];
  if (!job || job.status === "done" || job.status === "failed") return;
  if (!UUID.test(String(job.wish_id))) {
    await markFailed(pool, jobId, "bad_wish");
    return;
  }

  let internal = [];
  try {
    internal = await searchPublicIntel(pool, job.query, PLATFORM_USER_ID, {});
  } catch (error) {
    // 内部检索失败不中断任务，只把空命中交给检索员（它还能用外部工具）。
    console.error(error);
    internal = [];
  }

  let report;
  try {
    report = await runRetrievalAgent(job.query, internal, `retrieval-${jobId}`);
  } catch (error) {
    const attempt = (attempts.get(jobId) || 0) + 1;
    if (attempt < RETRIEVAL_MAX_ATTEMPTS) {
      await pool.query(`UPDATE retrieval_jobs SET status = 'pending', updated_at = now() WHERE id = $1`, [jobId]);
      scheduleRetry(pool, jobId);
      return;
    }
    await markFailed(pool, jobId, error.message || "retrieval_failed");
    await notifyRetrievalFailed(pool, job);
    return;
  }

  const { uploadDir } = loadBootstrapConfig();
  let uploadId;
  try {
    uploadId = await storeReport(pool, uploadDir, report, job.query);
  } catch (error) {
    await markFailed(pool, jobId, error.message || "report_store_failed");
    await notifyRetrievalFailed(pool, job);
    return;
  }

  try {
    const intel = await createIntel(pool, {
      userId: PLATFORM_USER_ID,
      actor: "platform",
      door: "platform",
      body: `信息检索：${clip(job.query, 80)}`,
      fileIds: [uploadId],
      kind: "wishRespond",
      respondsTo: job.wish_id,
      price: economyConfig().retrievalPrice,
    });
    await markDone(pool, jobId, intel.kMeta.id);
  } catch (error) {
    // 响应发布失败重试；超过次数记为失败。
    const attempt = (attempts.get(jobId) || 0) + 1;
    if (attempt < RETRIEVAL_MAX_ATTEMPTS) {
      await pool.query(`UPDATE retrieval_jobs SET status = 'pending', updated_at = now() WHERE id = $1`, [jobId]);
      scheduleRetry(pool, jobId);
      return;
    }
    await markFailed(pool, jobId, error.message || "respond_failed");
    await notifyRetrievalFailed(pool, job);
  }
}

async function notifyRetrievalFailed(pool, job) {
  await recordNotification(pool, {
    userId: job.user_id,
    kind: "retrieval_failed",
    title: "信息检索没有完成",
    body: `「${clip(job.query, 60)}」这次检索没做成，积分未扣，可重新提交。`,
    href: `/wish?wish=${job.wish_id}`,
  });
}

async function runOne(pool, jobId) {
  try {
    await markRunning(pool, jobId);
    await processRetrieval(pool, jobId);
    attempts.delete(jobId);
  } catch (error) {
    console.error(error);
    await markFailed(pool, jobId, error.message || "retrieval_failed");
    try {
      const { rows } = await pool.query(`SELECT id, wish_id, user_id, query FROM retrieval_jobs WHERE id = $1`, [jobId]);
      if (rows[0]) await notifyRetrievalFailed(pool, rows[0]);
    } catch (notifyError) {
      console.error(notifyError);
    }
  }
}

function pumpRetrievals(pool) {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const jobId = queue.shift();
    if (!jobId) {
      pumping = false;
      return;
    }
    running.add(jobId);
    runOne(pool, jobId).finally(() => {
      running.delete(jobId);
      step();
    });
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
