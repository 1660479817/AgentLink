import { access } from "node:fs/promises";
import { demandAgentId, intelAgentId, runDemandAgent, runIntelAgent } from "./agents/openclaw.js";
import { loadBootstrapConfig } from "./config.js";
import { recordNotification } from "./notifications.js";
import { applyPoints, getBalance, UNIT_PRICE } from "./points.js";
import { scoreText } from "./search.js";
import { storagePath } from "./uploads.js";

const POOL_LIMIT = 200;
const DEFAULT_LIMIT = 10;

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(DEFAULT_LIMIT, n);
}

function intelText(row) {
  const note = row.detail && typeof row.detail.note === "string" ? row.detail.note : "";
  return `${row.body || ""} ${note}`.trim();
}

function composeFile(_brief, items) {
  if (!items.length) return "没有找到相关内容。";
  return items.map((item, index) => `${index + 1}. ${item.text}`).join("\n\n");
}

async function imageFiles(pool, intelId) {
  const { uploadDir } = loadBootstrapConfig();
  const { rows } = await pool.query(
    `SELECT u.storage_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1 AND u.mime LIKE 'image/%'
     ORDER BY f.sort_order ASC, f.upload_id ASC
     LIMIT 3`,
    [intelId]
  );
  const files = [];
  for (const row of rows) {
    const file = storagePath(uploadDir, row.storage_name);
    await access(file);
    files.push(file);
  }
  return files;
}

export function presentIntel(row) {
  if (!row) return null;
  return {
    id: row.id,
    body: row.body || "",
    verdict: row.verdict,
    rejectReason: row.reject_reason,
    reward: row.verdict === "passed" ? UNIT_PRICE : null,
    createdAt: row.created_at,
  };
}

export function presentDemand(row) {
  if (!row) return null;
  return {
    id: row.id,
    brief: row.brief,
    citationLimit: row.citation_limit,
    status: row.status,
    body: row.delivery_body || "",
    citationCount: row.citation_count ?? 0,
    cost: row.cost ?? 0,
    createdAt: row.created_at,
    attachments: row.attachments || [],
  };
}

function attachmentView(row) {
  const mime = row.mime || "";
  return {
    id: row.id,
    name: row.original_name || "",
    mime,
    url: `/api/web/uploads/${row.id}`,
    image: mime.startsWith("image/"),
  };
}

async function withDemandFiles(pool, rows) {
  if (!rows.length) return [];
  const { rows: files } = await pool.query(
    `SELECT f.demand_id, u.id, u.mime, u.original_name
     FROM demand_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.demand_id = ANY($1::uuid[])
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [rows.map((row) => row.id)]
  );
  const byId = new Map();
  for (const file of files) {
    const list = byId.get(file.demand_id) || [];
    list.push(attachmentView(file));
    byId.set(file.demand_id, list);
  }
  return rows.map((row) => presentDemand({ ...row, attachments: byId.get(row.id) || [] }));
}

async function loadIntel(pool, id) {
  const { rows } = await pool.query(`SELECT id, user_id, body, verdict, detail FROM intel WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function judgeIntel(pool, id) {
  const intel = await loadIntel(pool, id);
  if (!intel || intel.verdict !== "pending") return presentIntel(intel);
  let result = { verdict: "pass", reason: "", note: "" };
  if (intelAgentId()) {
    const images = await imageFiles(pool, id);
    result = await runIntelAgent(intel, images);
  }
  if (result.verdict === "reject") {
    const { rows } = await pool.query(
      `UPDATE intel SET verdict = 'rejected', reject_reason = $2, detail = NULL
       WHERE id = $1 AND verdict = 'pending'
       RETURNING id`,
      [id, result.reason]
    );
    if (rows.length) {
      await recordNotification(pool, {
        userId: intel.user_id,
        kind: "intel_rejected",
        title: "信息未通过",
        body: result.reason,
        href: "/mine/submissions",
      });
    }
  } else {
    const { rows } = await pool.query(
      `UPDATE intel SET verdict = 'passed', reject_reason = NULL, detail = $2::jsonb
       WHERE id = $1 AND verdict = 'pending'
       RETURNING id`,
      [id, JSON.stringify({ note: result.note || "" })]
    );
    if (rows.length) {
      const balance = await adjustReward(pool, intel.user_id, id);
      await recordNotification(pool, {
        userId: intel.user_id,
        kind: "intel_credited",
        title: `信息奖励 +${UNIT_PRICE} 积分`,
        body: `当前余额 ${balance} 积分。`,
        href: "/mine",
      });
    }
  }
  const { rows } = await pool.query(
    `SELECT id, body, verdict, reject_reason, created_at FROM intel WHERE id = $1`,
    [id]
  );
  return presentIntel(rows[0]);
}

async function adjustReward(pool, userId, intelId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const balance = await applyPoints(client, {
      userId,
      delta: UNIT_PRICE,
      reason: "intel_reward",
      refId: intelId,
    });
    await client.query("COMMIT");
    return balance;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createIntel(pool, { userId, actor, door, body, imageIds = [], fileIds = [] }) {
  const uploadIds = [...new Set([...imageIds, ...fileIds])];
  const inserted = await pool.query(
    `INSERT INTO intel (user_id, actor, door, body) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, actor, door, body]
  );
  const intelId = inserted.rows[0].id;
  if (uploadIds.length) {
    const { rows } = await pool.query(
      `SELECT id FROM uploads WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, uploadIds]
    );
    const order = new Map(uploadIds.map((id, index) => [id, index]));
    const owned = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    for (let i = 0; i < owned.length; i += 1) {
      await pool.query(`INSERT INTO intel_files (intel_id, upload_id, sort_order) VALUES ($1, $2, $3)`, [
        intelId,
        owned[i].id,
        i,
      ]);
    }
  }
  return judgeIntel(pool, intelId);
}

export async function listPublicIntel(pool, limit = 30) {
  const { rows } = await pool.query(
    `SELECT id, body, created_at FROM intel WHERE verdict = 'passed' ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function searchPublicIntel(pool, query) {
  const { rows } = await pool.query(
    `SELECT id, body, detail, created_at
     FROM intel
     WHERE verdict = 'passed'
     ORDER BY created_at DESC
     LIMIT 500`
  );
  return rows
    .map((row) => ({ ...row, score: scoreText(query, intelText(row)) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 30);
}

async function candidates(pool) {
  const { rows } = await pool.query(
    `SELECT id, body, detail FROM intel WHERE verdict = 'passed' ORDER BY created_at DESC LIMIT $1`,
    [POOL_LIMIT]
  );
  return rows.map((row) => ({ id: row.id, text: intelText(row) || row.body || "" }));
}

function localCitations(brief, items, limit) {
  return items
    .map((item) => ({ item, score: scoreText(brief, item.text) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

async function attachDemandFiles(pool, demandId, userId, fileIds) {
  if (!fileIds.length) return "";
  const { rows: owned } = await pool.query(
    `SELECT id, original_name FROM uploads WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, fileIds]
  );
  const order = new Map(fileIds.map((id, index) => [id, index]));
  owned.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  for (let i = 0; i < owned.length; i += 1) {
    await pool.query(`INSERT INTO demand_files (demand_id, upload_id, sort_order) VALUES ($1, $2, $3)`, [
      demandId,
      owned[i].id,
      i,
    ]);
  }
  return owned
    .map((row) => row.original_name)
    .filter(Boolean)
    .join(" ");
}

export async function createDemand(pool, { userId, actor, door, brief, citationLimit, fileIds = [] }) {
  const limit = clampLimit(citationLimit);
  const inserted = await pool.query(
    `INSERT INTO demands (user_id, actor, door, brief, citation_limit)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, actor, door, brief, limit]
  );
  const demandId = inserted.rows[0].id;
  await attachDemandFiles(pool, demandId, userId, fileIds);
  try {
    await fulfillDemand(pool, demandId);
  } catch (error) {
    await pool.query(`DELETE FROM demands WHERE id = $1 AND status = 'open'`, [demandId]);
    throw error;
  }
  return readDemand(pool, demandId, userId);
}

async function fulfillDemand(pool, demandId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, brief, citation_limit, status FROM demands WHERE id = $1`,
    [demandId]
  );
  const demand = rows[0];
  if (!demand || demand.status !== "open") return;
  const { rows: names } = await pool.query(
    `SELECT u.original_name
     FROM demand_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.demand_id = $1
     ORDER BY f.sort_order ASC`,
    [demandId]
  );
  const brief = [demand.brief, ...names.map((row) => row.original_name).filter(Boolean)].filter(Boolean).join("\n");
  demand.brief = brief || demand.brief;
  const inventory = await candidates(pool);
  const balance = await getBalance(pool, demand.user_id);
  const cap = Math.min(demand.citation_limit, Math.max(0, Math.floor(balance / UNIT_PRICE)));
  let chosen = [];
  let body = "";
  if (cap > 0 && demandAgentId()) {
    try {
      const reply = await runDemandAgent({
        id: demand.id,
        brief: demand.brief,
        limit: cap,
        items: inventory,
      });
      const byId = new Map(inventory.map((item) => [item.id, item]));
      chosen = reply.citations.map((id) => byId.get(id)).filter(Boolean).slice(0, cap);
      const same =
        chosen.length === reply.citations.length && reply.citations.every((id, index) => chosen[index]?.id === id);
      body = same && reply.body ? reply.body : composeFile(demand.brief, chosen);
    } catch (error) {
      console.error(error);
      chosen = localCitations(demand.brief, inventory, cap);
      body = composeFile(demand.brief, chosen);
    }
  } else {
    chosen = localCitations(demand.brief, inventory, cap);
    body = composeFile(demand.brief, chosen);
  }
  const cost = chosen.length * UNIT_PRICE;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(`SELECT status FROM demands WHERE id = $1 FOR UPDATE`, [demandId]);
    if (locked.rows[0]?.status !== "open") {
      await client.query("ROLLBACK");
      return;
    }
    const delivery = await client.query(
      `INSERT INTO deliveries (demand_id, body, citation_count, cost) VALUES ($1, $2, $3, $4) RETURNING id`,
      [demandId, body, chosen.length, cost]
    );
    for (const item of chosen) {
      await client.query(`INSERT INTO delivery_citations (delivery_id, intel_id) VALUES ($1, $2)`, [
        delivery.rows[0].id,
        item.id,
      ]);
    }
    if (cost > 0) {
      await applyPoints(client, {
        userId: demand.user_id,
        delta: -cost,
        reason: "demand",
        refId: delivery.rows[0].id,
      });
    }
    await client.query(`UPDATE demands SET status = 'fulfilled' WHERE id = $1`, [demandId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await recordNotification(pool, {
    userId: demand.user_id,
    kind: "demand_fulfilled",
    title: "有一条回复",
    body: chosen.length ? "已经写好。" : "没有找到相关内容。",
    href: "/buy",
  });
}

const DEMAND_SQL = `
  SELECT d.id, d.brief, d.citation_limit, d.status, d.created_at,
         v.body AS delivery_body, v.citation_count, v.cost
  FROM demands d
  LEFT JOIN deliveries v ON v.demand_id = d.id
`;

export async function readDemand(pool, id, userId) {
  const { rows } = await pool.query(`${DEMAND_SQL} WHERE d.id = $1 AND d.user_id = $2`, [id, userId]);
  const [demand] = await withDemandFiles(pool, rows);
  return demand || null;
}

export async function listDemands(pool, userId, door) {
  const { rows } = await pool.query(
    `${DEMAND_SQL} WHERE d.user_id = $1 AND d.door = $2 ORDER BY d.created_at DESC`,
    [userId, door]
  );
  return withDemandFiles(pool, rows);
}
