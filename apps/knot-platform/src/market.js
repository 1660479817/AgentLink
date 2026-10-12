import { access } from "node:fs/promises";
import {
  briefAgentId,
  demandAgentId,
  intelAgentId,
  runBriefAgent,
  runDemandAgent,
  runIntelAgent,
} from "./agents/openclaw.js";
import { tryFinishBounty } from "./bounties.js";
import { loadBootstrapConfig } from "./config.js";
import { fileView, informationOf, listedFiles } from "./information.js";
import { recordNotification } from "./notifications.js";
import { applyPoints, feeConfig, getBalance, packetPrice, PLATFORM_USER_ID } from "./points.js";
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
    ...informationOf({ body: row.body, files: listedFiles(row.files || [], row.granted !== false) }),
    category: row.category || "",
    price: Number(row.price) || 0,
    verdict: row.verdict,
    rejectReason: row.reject_reason,
    granted: row.granted !== false,
    createdAt: row.created_at,
  };
}

const EMPTY_DELIVERY = "没有找到相关内容。";

export function presentDemand(row) {
  if (!row) return null;
  const info = informationOf({ files: row.attachments || [] });
  const deliveries = row.deliveries || [];
  const cards = deliveries.flatMap((delivery) =>
    (delivery.cards || []).map((card) => ({ ...card, deliveredAt: delivery.createdAt }))
  );
  return {
    id: row.id,
    brief: row.brief,
    category: row.category || "",
    citationLimit: row.citation_limit,
    status: row.status,
    body: deliveries.map((delivery) => delivery.body).filter(Boolean).join("\n\n"),
    citationCount: deliveries.reduce((sum, delivery) => sum + (delivery.citationCount || 0), 0),
    cost: deliveries.reduce((sum, delivery) => sum + (delivery.cost || 0), 0),
    createdAt: row.created_at,
    stoppedAt: row.stopped_at || null,
    stopReason: row.stop_reason || null,
    images: info.images,
    attachments: info.attachments,
    cards,
    replies: repliesOf(row, deliveries),
  };
}

function repliesOf(row, deliveries) {
  const replies = [];
  for (const delivery of deliveries) {
    const cards = (delivery.cards || []).filter((card) => card.body || card.images?.length || card.attachments?.length);
    if (cards.length) {
      for (const card of cards) {
        replies.push({
          kind: "delivery",
          id: card.id,
          createdAt: delivery.createdAt,
          body: card.body || "",
          category: card.category || "",
          price: Number(card.price) || 0,
          granted: card.granted !== false,
          images: card.images || [],
          attachments: card.attachments || [],
          starred: Boolean(card.starred),
          starrable: true,
        });
      }
      continue;
    }
    const text = (delivery.body || "").trim();
    if (text && text !== EMPTY_DELIVERY) {
      replies.push({
        kind: "delivery",
        id: delivery.id,
        createdAt: delivery.createdAt,
        body: text,
        images: [],
        attachments: [],
      });
    }
  }
  const outcome = [];
  if (!replies.length) {
    if (deliveries.length) outcome.push(systemReply("empty", deliveries[0].createdAt || row.created_at));
    else if (row.status === "open") outcome.push(systemReply("working", row.created_at));
    else if (row.stop_reason === "timeout") outcome.push(systemReply("timeout", row.stopped_at || row.created_at));
    else if (row.stop_reason === "review") outcome.push(systemReply("review", row.stopped_at || row.created_at));
    else if (row.status === "stopped") outcome.push(systemReply("stopped", row.stopped_at || row.created_at));
    else outcome.push(systemReply("empty", row.created_at));
    if (deliveries.length && row.stop_reason === "timeout") outcome.push(systemReply("timeout", row.stopped_at));
    else if (deliveries.length && row.status === "stopped") outcome.push(systemReply("stopped", row.stopped_at));
    return outcome;
  }
  outcome.push(systemReply("delivered", replies[0].createdAt || row.created_at, replies.length));
  outcome.push(...replies);
  if (row.stop_reason === "timeout") outcome.push(systemReply("timeout", row.stopped_at));
  else if (row.status === "stopped") outcome.push(systemReply("stopped", row.stopped_at));
  return outcome;
}

function systemReply(code, createdAt, count) {
  const reply = { kind: "system", code, createdAt };
  if (count != null) reply.count = count;
  return reply;
}

function attachmentView(row) {
  return fileView(row);
}

async function withDemandFiles(pool, rows, userId = null) {
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
  const deliveries = await loadDeliveries(pool, rows.map((row) => row.id), userId);
  return rows.map((row) =>
    presentDemand({
      ...row,
      attachments: byId.get(row.id) || [],
      deliveries: deliveries.get(row.id) || [],
    })
  );
}

async function filesByIntel(pool, ids) {
  const byId = new Map();
  if (!ids.length) return byId;
  const { rows } = await pool.query(
    `SELECT f.intel_id, u.id, u.mime, u.original_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = ANY($1::uuid[])
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [ids]
  );
  for (const row of rows) {
    const list = byId.get(row.intel_id) || [];
    list.push(fileView(row));
    byId.set(row.intel_id, list);
  }
  return byId;
}

async function loadDeliveries(pool, ids, userId = null) {
  const byDemand = new Map();
  if (!ids.length) return byDemand;
  const { rows: deliveries } = await pool.query(
    `SELECT id, demand_id, body, citation_count, cost, created_at
     FROM deliveries
     WHERE demand_id = ANY($1::uuid[])
     ORDER BY created_at ASC`,
    [ids]
  );
  const deliveryIds = deliveries.map((delivery) => delivery.id);
  let citations = [];
  if (deliveryIds.length) {
    const cited = await pool.query(
      `SELECT c.delivery_id, i.id, i.body, i.price, i.category, i.user_id,
         ($2::uuid IS NOT NULL AND (
           i.user_id = $2 OR EXISTS (
             SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.user_id = $2
           )
         )) AS granted
       FROM delivery_citations c
       JOIN intel i ON i.id = c.intel_id
       WHERE c.delivery_id = ANY($1::uuid[])
       ORDER BY i.created_at ASC`,
      [deliveryIds, userId]
    );
    citations = cited.rows;
  }
  const files = await filesByIntel(pool, citations.map((row) => row.id));
  const starred = new Set();
  if (userId && citations.length) {
    const { rows } = await pool.query(
      `SELECT intel_id FROM intel_stars WHERE user_id = $1 AND intel_id = ANY($2::uuid[])`,
      [userId, citations.map((row) => row.id)]
    );
    for (const row of rows) starred.add(row.intel_id);
  }
  const cardsByDelivery = new Map();
  for (const row of citations) {
    const list = cardsByDelivery.get(row.delivery_id) || [];
    const granted = Boolean(row.granted);
    list.push({
      id: row.id,
      ...informationOf({ body: row.body, files: listedFiles(files.get(row.id) || [], granted) }),
      category: row.category || "",
      price: Number(row.price) || 0,
      granted,
      starred: starred.has(row.id),
    });
    cardsByDelivery.set(row.delivery_id, list);
  }
  for (const delivery of deliveries) {
    const list = byDemand.get(delivery.demand_id) || [];
    list.push({
      id: delivery.id,
      body: delivery.body || "",
      citationCount: delivery.citation_count,
      cost: delivery.cost,
      createdAt: delivery.created_at,
      cards: cardsByDelivery.get(delivery.id) || [],
    });
    byDemand.set(delivery.demand_id, list);
  }
  return byDemand;
}

async function loadIntel(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, user_id, body, verdict, detail, bounty_id FROM intel WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function loadPresentedIntel(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, user_id, body, verdict, reject_reason, category, price, created_at FROM intel WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const files = await filesByIntel(pool, [id]);
  return presentIntel({ ...rows[0], files: files.get(id) || [] });
}

export async function judgeIntel(pool, id) {
  const intel = await loadIntel(pool, id);
  if (!intel || intel.verdict !== "pending") return presentIntel(intel);
  let result = { verdict: "pass", reason: "", note: "", category: "" };
  if (intelAgentId()) {
    const images = await imageFiles(pool, id);
    result = await runIntelAgent(intel, images);
  }
  if (result.verdict === "reject") {
    const { rows } = await pool.query(
      `UPDATE intel SET verdict = 'rejected', reject_reason = $2, detail = NULL, category = ''
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
      `UPDATE intel SET verdict = 'passed', reject_reason = NULL, category = $2, detail = $3::jsonb
       WHERE id = $1 AND verdict = 'pending'
       RETURNING id`,
      [id, result.category || "", JSON.stringify({ note: result.note || "" })]
    );
    if (rows.length) {
      await recordNotification(pool, {
        userId: intel.user_id,
        kind: "intel_passed",
        title: "已留下",
        body: result.category || "",
        href: "/mine/submissions",
      });
      if (intel.bounty_id) await tryFinishBounty(pool, intel.bounty_id, id);
    }
  }
  return loadPresentedIntel(pool, id);
}

async function assertOpenBounty(pool, bountyId) {
  if (!bountyId) return;
  const { rows } = await pool.query(
    `SELECT id FROM bounties
     WHERE id = $1 AND status = 'open' AND hours BETWEEN 1 AND 72
       AND created_at > now() - make_interval(hours => hours)`,
    [bountyId]
  );
  if (!rows.length) {
    const error = new Error("bad_state");
    error.code = "bad_state";
    throw error;
  }
}

export async function createIntel(pool, { userId, actor, door, body, imageIds = [], fileIds = [], price, bountyId = null }) {
  await assertOpenBounty(pool, bountyId);
  const uploadIds = [...new Set([...imageIds, ...fileIds])];
  const inserted = await pool.query(
    `INSERT INTO intel (user_id, actor, door, body, bounty_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, actor, door, body, bountyId]
  );
  const intelId = inserted.rows[0].id;
  let owned = [];
  if (uploadIds.length) {
    const { rows } = await pool.query(
      `SELECT id FROM uploads WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, uploadIds]
    );
    const order = new Map(uploadIds.map((id, index) => [id, index]));
    owned = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    for (let i = 0; i < owned.length; i += 1) {
      await pool.query(`INSERT INTO intel_files (intel_id, upload_id, sort_order) VALUES ($1, $2, $3)`, [
        intelId,
        owned[i].id,
        i,
      ]);
    }
  }
  await pool.query(`UPDATE intel SET price = $2 WHERE id = $1`, [intelId, packetPrice(owned.length, price)]);
  try {
    return await judgeIntel(pool, intelId);
  } catch (error) {
    try {
      await pool.query(`DELETE FROM intel WHERE id = $1 AND verdict = 'pending'`, [intelId]);
    } catch (cleanup) {
      console.error(cleanup);
    }
    throw error;
  }
}

const PUBLIC_INTEL_SQL = `
  SELECT i.id, i.body, i.detail, i.weight, i.price, i.category, i.user_id, i.created_at,
    u.display_name, u.avatar_upload_id,
    EXISTS (
      SELECT 1 FROM intel_stars s
      WHERE s.intel_id = i.id AND s.user_id = $1
    ) AS starred,
    ($1::uuid IS NOT NULL AND (
      i.user_id = $1 OR EXISTS (
        SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.user_id = $1
      )
    )) AS granted
  FROM intel i
  JOIN users u ON u.id = i.user_id
  WHERE i.verdict = 'passed'
    AND ($1::uuid IS NULL OR NOT EXISTS (
      SELECT 1 FROM intel_dismissals d
      WHERE d.intel_id = i.id AND d.user_id = $1
    ))
`;

export function compareByWeight(a, b) {
  const weight = (b.weight || 0) - (a.weight || 0);
  if (weight) return weight;
  return new Date(b.created_at) - new Date(a.created_at);
}

export async function listPublicIntel(pool, limit = 30, userId = null) {
  const { rows } = await pool.query(
    `${PUBLIC_INTEL_SQL} ORDER BY i.weight DESC, i.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function searchPublicIntel(pool, query, userId = null) {
  const { rows } = await pool.query(
    `${PUBLIC_INTEL_SQL} ORDER BY i.weight DESC, i.created_at DESC LIMIT 500`,
    [userId]
  );
  return rows
    .map((row) => ({ ...row, score: scoreText(query, intelText(row)) }))
    .filter((row) => row.score > 0)
    .sort(compareByWeight)
    .slice(0, 30);
}

export async function setIntelStar(pool, userId, intelId, starred) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id FROM intel WHERE id = $1 AND verdict = 'passed' FOR UPDATE`,
      [intelId]
    );
    if (!found.rows.length) {
      const error = new Error("not_found");
      error.code = "not_found";
      throw error;
    }
    if (starred) {
      await client.query(
        `INSERT INTO intel_stars (user_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, intelId]
      );
    } else {
      await client.query(`DELETE FROM intel_stars WHERE user_id = $1 AND intel_id = $2`, [userId, intelId]);
    }
    await client.query(
      `UPDATE intel
       SET weight = (SELECT count(*)::int FROM intel_stars WHERE intel_id = $1)
       WHERE id = $1`,
      [intelId]
    );
    await client.query("COMMIT");
    return { starred: Boolean(starred) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function candidates(pool) {
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.detail, i.weight
     FROM intel i
     WHERE i.verdict = 'passed'
       AND EXISTS (SELECT 1 FROM intel_files f WHERE f.intel_id = i.id)
     ORDER BY i.weight DESC, i.created_at DESC
     LIMIT $1`,
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

function citationKey(id) {
  return String(id || "").trim().toLowerCase();
}

export function pickCitations(citations, inventory, limit) {
  const byId = new Map(inventory.map((item) => [citationKey(item.id), item]));
  const chosen = [];
  for (const id of citations) {
    const item = byId.get(citationKey(id));
    if (!item || chosen.some((row) => row.id === item.id)) continue;
    chosen.push(item);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

async function reviewDemand(pool, demandId, userId, brief) {
  if (!briefAgentId()) return "passed";
  const result = await runBriefAgent({ id: demandId, brief });
  if (result.verdict === "reject") {
    await pool.query(
      `UPDATE demands
       SET status = 'stopped', stopped_at = now(), stop_reason = 'review', category = ''
       WHERE id = $1 AND status = 'open'`,
      [demandId]
    );
    await recordNotification(pool, {
      userId,
      kind: "demand_rejected",
      title: "需求未通过",
      body: result.reason || "",
      href: "/chat",
    });
    return "rejected";
  }
  await pool.query(`UPDATE demands SET category = $2 WHERE id = $1`, [demandId, result.category || ""]);
  return "passed";
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

export async function createDemand(pool, { userId, actor, door, brief, citationLimit, fileIds = [], imageIds = [] }) {
  const limit = clampLimit(citationLimit);
  const inserted = await pool.query(
    `INSERT INTO demands (user_id, actor, door, brief, citation_limit)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, actor, door, brief, limit]
  );
  const demandId = inserted.rows[0].id;
  const names = await attachDemandFiles(pool, demandId, userId, [...imageIds, ...fileIds]);
  const briefText = [brief, names].filter(Boolean).join("\n");
  try {
    const reviewed = await reviewDemand(pool, demandId, userId, briefText);
    if (reviewed === "passed") await fulfillDemand(pool, demandId);
  } catch (error) {
    await pool.query(
      `DELETE FROM demands d
       WHERE d.id = $1 AND d.status = 'open'
         AND NOT EXISTS (SELECT 1 FROM deliveries v WHERE v.demand_id = d.id)`,
      [demandId]
    );
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
  const brief = [demand.brief, ...names.map((row) => row.original_name).filter(Boolean)]
    .filter(Boolean)
    .join("\n");
  demand.brief = brief || demand.brief;
  const inventory = await candidates(pool);
  const balance = await getBalance(pool, demand.user_id);
  const unit = feeConfig().matchUnit;
  const affordable = unit > 0 ? Math.floor(balance / unit) : demand.citation_limit;
  const cap = Math.min(demand.citation_limit, Math.max(0, affordable));
  let chosen = [];
  if (cap > 0 && demandAgentId()) {
    try {
      const reply = await runDemandAgent({
        id: demand.id,
        brief: demand.brief,
        limit: cap,
        items: inventory,
      });
      chosen = pickCitations(reply.citations, inventory, cap);
    } catch (error) {
      console.error(error);
      chosen = localCitations(demand.brief, inventory, cap);
    }
  } else {
    chosen = localCitations(demand.brief, inventory, cap);
  }
  const body = composeFile(demand.brief, chosen);
  const cost = chosen.length * unit;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(`SELECT status FROM demands WHERE id = $1 FOR UPDATE`, [demandId]);
    if (locked.rows[0]?.status !== "open") {
      await client.query("ROLLBACK");
      return;
    }
    const existing = await client.query(`SELECT id FROM deliveries WHERE demand_id = $1`, [demandId]);
    if (existing.rows.length) {
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
        reason: "match",
        refId: delivery.rows[0].id,
      });
      await applyPoints(client, {
        userId: PLATFORM_USER_ID,
        delta: cost,
        reason: "match",
        refId: delivery.rows[0].id,
      });
    }
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
    href: "/chat",
  });
}

export async function downloadPacket(pool, userId, intelId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, user_id, price FROM intel WHERE id = $1 AND verdict = 'passed' FOR UPDATE`,
      [intelId]
    );
    const intel = rows[0];
    if (!intel) {
      const error = new Error("not_found");
      error.code = "not_found";
      throw error;
    }
    if (intel.user_id !== userId) {
      const prior = await client.query(
        `SELECT 1 FROM packet_downloads WHERE user_id = $1 AND intel_id = $2`,
        [userId, intelId]
      );
      if (!prior.rows.length && intel.price > 0) {
        await applyPoints(client, {
          userId,
          delta: -intel.price,
          reason: "download",
          refId: intelId,
        });
        await applyPoints(client, {
          userId: intel.user_id,
          delta: intel.price,
          reason: "download",
          refId: intelId,
        });
      }
      await client.query(
        `INSERT INTO packet_downloads (user_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, intelId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.message === "insufficient_points") error.code = "insufficient_points";
    throw error;
  } finally {
    client.release();
  }
  return loadPresentedIntel(pool, intelId);
}

const DEMAND_SQL = `
  SELECT d.id, d.brief, d.category, d.citation_limit, d.status, d.created_at, d.stopped_at, d.stop_reason
  FROM demands d
`;

const DEMAND_TTL = "24 hours";

export async function expireDemands(pool) {
  await pool.query(
    `UPDATE demands
     SET status = 'stopped', stopped_at = now(), stop_reason = 'timeout'
     WHERE status = 'open' AND created_at <= now() - $1::interval`,
    [DEMAND_TTL]
  );
}

export async function stopDemand(pool, id, userId) {
  await expireDemands(pool);
  const { rows } = await pool.query(
    `UPDATE demands
     SET status = 'stopped', stopped_at = now(), stop_reason = 'user'
     WHERE id = $1 AND user_id = $2 AND status = 'open'
     RETURNING id`,
    [id, userId]
  );
  if (!rows.length) {
    const existing = await pool.query(`SELECT id FROM demands WHERE id = $1 AND user_id = $2`, [id, userId]);
    const error = new Error(existing.rows.length ? "not_open" : "not_found");
    error.code = existing.rows.length ? "not_open" : "not_found";
    throw error;
  }
  return readDemand(pool, id, userId);
}

export async function readDemand(pool, id, userId) {
  await expireDemands(pool);
  const { rows } = await pool.query(`${DEMAND_SQL} WHERE d.id = $1 AND d.user_id = $2`, [id, userId]);
  const [demand] = await withDemandFiles(pool, rows, userId);
  return demand || null;
}

export async function listDemands(pool, userId, door) {
  await expireDemands(pool);
  const { rows } = await pool.query(
    `${DEMAND_SQL} WHERE d.user_id = $1 AND d.door = $2 ORDER BY d.created_at DESC`,
    [userId, door]
  );
  return withDemandFiles(pool, rows, userId);
}
