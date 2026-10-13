import { applyPoints, feeConfig, PLATFORM_USER_ID, policyConfig } from "./points.js";
import { publicUploadUrl } from "./uploads.js";

const TODAY = `(timezone('Asia/Shanghai', now()))::date`;

function present(row) {
  const created = new Date(row.created_at);
  const ends = Number.isFinite(created.getTime()) ? new Date(created.getTime() + row.hours * 3600 * 1000) : null;
  return {
    id: row.id,
    body: row.body,
    hours: row.hours,
    status: row.status,
    endsAt: ends ? ends.toISOString() : null,
  };
}

export async function openBounty(pool, { userId, body, hours }) {
  const text = typeof body === "string" ? body.trim() : "";
  const span = Number(hours);
  if (!text) return { error: "empty_body", status: 400 };
  if (!Number.isInteger(span) || span < 1 || span > policyConfig().bountyMaxHours) {
    return { error: "bad_hours", status: 400 };
  }
  const fee = feeConfig().listingFee;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO bounties (body, reward, bounty_date, status, user_id, hours)
       VALUES ($1, 0, ${TODAY}, 'open', $2, $3)
       RETURNING id, body, hours, status, created_at`,
      [text, userId, span]
    );
    const bounty = inserted.rows[0];
    if (fee > 0) {
      await applyPoints(client, {
        userId,
        delta: -fee,
        reason: "bounty_listing",
        refId: bounty.id,
      });
      await applyPoints(client, {
        userId: PLATFORM_USER_ID,
        delta: fee,
        reason: "bounty_listing",
        refId: bounty.id,
      });
    }
    await client.query("COMMIT");
    return { bounty: present(bounty) };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.message === "insufficient_points") return { error: "insufficient_points", status: 402 };
    throw error;
  } finally {
    client.release();
  }
}

export async function listBounties(pool, viewerId = null) {
  const { rows } = await pool.query(
    `SELECT b.id, b.body, b.hours, b.status, b.created_at, b.user_id,
            (SELECT count(*)::int FROM intel i
             WHERE i.bounty_id = b.id AND i.verdict = 'passed') AS response_count
     FROM bounties b
     WHERE b.status = 'open' AND b.hours >= 1
       AND b.created_at > now() - make_interval(hours => b.hours)
     ORDER BY b.created_at ASC`
  );
  return rows.map((row) => {
    const item = present(row);
    const mine = Boolean(viewerId && row.user_id === viewerId);
    item.mine = mine;
    if (mine) item.responseCount = Number(row.response_count) || 0;
    return item;
  });
}

function replyVideos(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? { url: item } : { url: item?.url || "", poster: item?.poster || "" }))
    .filter((item) => item.url);
}

export async function listBountyResponses(pool, userId, bountyId) {
  const owned = await pool.query(`SELECT id FROM bounties WHERE id = $1 AND user_id = $2`, [bountyId, userId]);
  if (!owned.rows.length) return { error: "not_found", status: 404 };
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.videos, i.category, i.price, i.created_at,
            u.display_name, u.avatar_upload_id,
            EXISTS (
              SELECT 1 FROM packet_downloads pd
              WHERE pd.intel_id = i.id AND pd.user_id = $2
            ) AS granted
     FROM intel i
     JOIN users u ON u.id = i.user_id
     WHERE i.bounty_id = $1 AND i.verdict = 'passed'
     ORDER BY i.created_at ASC`,
    [bountyId, userId]
  );
  const ids = rows.map((row) => row.id);
  const names = new Map();
  if (ids.length) {
    const found = await pool.query(
      `SELECT f.intel_id, u.original_name
       FROM intel_files f
       JOIN uploads u ON u.id = f.upload_id
       WHERE f.intel_id = ANY($1::uuid[])
       ORDER BY f.sort_order, f.upload_id`,
      [ids]
    );
    for (const file of found.rows) {
      const list = names.get(file.intel_id) || [];
      list.push(file.original_name || "");
      names.set(file.intel_id, list);
    }
  }
  return {
    responses: rows.map((row) => ({
      id: row.id,
      body: row.body || "",
      category: row.category || "",
      price: Number(row.price) || 0,
      createdAt: row.created_at,
      granted: Boolean(row.granted),
      author: {
        name: row.display_name || "",
        avatarUrl: row.avatar_upload_id ? publicUploadUrl(row.avatar_upload_id) : null,
      },
      fileNames: names.get(row.id) || [],
      videos: replyVideos(row.videos),
    })),
  };
}

export async function tryFinishBounty(pool, bountyId, intelId) {
  const fee = feeConfig().completionFee;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT b.id, b.user_id, b.hours, b.created_at, b.status, b.completed_intel_id, i.user_id AS author_id,
              EXISTS (SELECT 1 FROM intel_files f WHERE f.intel_id = i.id) AS has_files
       FROM bounties b
       JOIN intel i ON i.id = $2
       WHERE b.id = $1
       FOR UPDATE OF b`,
      [bountyId, intelId]
    );
    const row = rows[0];
    const open =
      row &&
      !row.completed_intel_id &&
      row.status === "open" &&
      row.hours >= 1 &&
      row.has_files &&
      row.author_id !== row.user_id &&
      new Date(row.created_at).getTime() + row.hours * 3600 * 1000 > Date.now();
    if (!open) {
      await client.query("COMMIT");
      return;
    }
    if (fee > 0) {
      await applyPoints(client, {
        userId: row.user_id,
        delta: -fee,
        reason: "bounty_completion",
        refId: bountyId,
      });
      await applyPoints(client, {
        userId: PLATFORM_USER_ID,
        delta: fee,
        reason: "bounty_completion",
        refId: bountyId,
      });
    }
    const updated = await client.query(
      `UPDATE bounties SET completed_intel_id = $2
       WHERE id = $1 AND status = 'open' AND completed_intel_id IS NULL
       RETURNING id`,
      [bountyId, intelId]
    );
    if (!updated.rows.length) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.message !== "insufficient_points") console.error(error);
  } finally {
    client.release();
  }
}

export function kickSettle() {
  return Promise.resolve();
}
