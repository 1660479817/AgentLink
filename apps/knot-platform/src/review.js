import { access } from "node:fs/promises";
import { processAgentId, runProcessAgent } from "./agents/openclaw.js";
import { normalize } from "./agents/process.js";
import { loadBootstrapConfig } from "./config.js";
import { recordNotification } from "./notifications.js";
import { adjustPoints } from "./points.js";
import { storagePath } from "./uploads.js";

const INTEL_REWARD_MIN = 1;
const INTEL_REWARD_MAX = 10;

function lengthScore(body) {
  const n = String(body || "").trim().length;
  if (n < 8) return INTEL_REWARD_MIN;
  return Math.min(INTEL_REWARD_MAX, Math.max(INTEL_REWARD_MIN, Math.ceil(n / 24)));
}

async function imageFiles(pool, expressionId) {
  const { uploadDir } = loadBootstrapConfig();
  const { rows } = await pool.query(
    `SELECT u.storage_name
     FROM expression_images ei
     JOIN uploads u ON u.id = ei.upload_id
     WHERE ei.expression_id = $1
     ORDER BY ei.sort_order ASC, ei.upload_id ASC
     LIMIT 3`,
    [expressionId]
  );
  const files = [];
  for (const row of rows) {
    const file = storagePath(uploadDir, row.storage_name);
    await access(file);
    files.push(file);
  }
  return files;
}

async function saveIntelClass(pool, expressionId, intelClass) {
  if (!intelClass) {
    await pool.query(`DELETE FROM intel_classes WHERE expression_id = $1`, [expressionId]);
    return;
  }
  await pool.query(
    `INSERT INTO intel_classes (expression_id, category, fact, basis)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (expression_id) DO UPDATE
     SET category = EXCLUDED.category, fact = EXCLUDED.fact, basis = EXCLUDED.basis`,
    [expressionId, intelClass.category, intelClass.fact, intelClass.basis]
  );
}

async function reject(pool, expression, result) {
  await saveIntelClass(pool, expression.id, null);
  await pool.query(
    `UPDATE expressions
     SET review_status = 'rejected', reject_code = $1, reject_reason = $2,
         processed = NULL, card = NULL, evaluation = $3::jsonb,
         intel_reward = NULL
     WHERE id = $4`,
    [result.reject.code, result.reject.reason, JSON.stringify(result.evaluation), expression.id]
  );
  await recordNotification(pool, {
    personId: expression.person_id,
    kind: "review_rejected",
    title: "信息未通过审核",
    body: result.reject.reason,
    href: "/mine/submissions",
  });
  return { published: false };
}

function publicCardText(expression, result) {
  if (result.card?.summary && result.card?.subject) return result.card;
  const text = normalize(expression.body);
  return { summary: text, subject: text };
}

async function publish(pool, expression, result) {
  const { summary, subject } = publicCardText(expression, result);
  const intelClass = expression.role === "intel" ? result.intelClass || null : null;
  const reward = intelClass ? result.evaluation.score : null;
  await saveIntelClass(pool, expression.id, intelClass);
  await pool.query(
    `UPDATE expressions
     SET processed = $1, card = $2::jsonb, evaluation = $3::jsonb,
         review_status = 'published', reject_reason = NULL, reject_code = NULL,
         intel_reward = $4
     WHERE id = $5`,
    [
      summary,
      JSON.stringify({ summary, subject }),
      JSON.stringify(result.evaluation),
      reward,
      expression.id,
    ]
  );
  if (reward != null) {
    const balance = await adjustPoints(pool, {
      personId: expression.person_id,
      delta: reward,
      reason: "intel_reward",
      refId: expression.id,
    });
    await recordNotification(pool, {
      personId: expression.person_id,
      kind: "intel_credited",
      title: `情报奖励 +${reward} 积分`,
      body: `当前余额 ${balance} 积分。`,
      href: "/mine",
    });
  }
  return { published: true, summary };
}

export async function runReview(pool, expression) {
  if (processAgentId()) {
    const images = await imageFiles(pool, expression.id);
    const result = await runProcessAgent(expression, images);
    if (result.verdict === "reject") return reject(pool, expression, result);
    return publish(pool, expression, result);
  }
  const text = normalize(expression.body);
  const score = lengthScore(text);
  return publish(pool, expression, {
    card: { summary: text, subject: text },
    evaluation: { score, reason: "按原文长度暂记" },
    intelClass: null,
  });
}
