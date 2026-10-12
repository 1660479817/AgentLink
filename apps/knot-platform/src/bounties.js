import { applyPoints, feeConfig, PLATFORM_USER_ID } from "./points.js";

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
  if (!Number.isInteger(span) || span < 1 || span > 72) return { error: "bad_hours", status: 400 };
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

export async function listBounties(pool) {
  const { rows } = await pool.query(
    `SELECT id, body, hours, status, created_at
     FROM bounties
     WHERE status = 'open' AND hours BETWEEN 1 AND 72
       AND created_at > now() - make_interval(hours => hours)
     ORDER BY created_at ASC`
  );
  return rows.map(present);
}

export async function tryFinishBounty(pool, bountyId, intelId) {
  const fee = feeConfig().completionFee;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT b.id, b.user_id, b.hours, b.created_at, b.status, i.user_id AS author_id,
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
      `UPDATE bounties SET status = 'settled', completed_intel_id = $2
       WHERE id = $1 AND status = 'open'
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
