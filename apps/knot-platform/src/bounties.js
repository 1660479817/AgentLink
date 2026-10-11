import { demandAgentId, runDemandAgent } from "./agents/openclaw.js";
import { loadBootstrapConfig } from "./config.js";
import { fileView, hasInformation, informationOf } from "./information.js";
import { applyPoints, UNIT_PRICE } from "./points.js";

const TODAY = `(timezone('Asia/Shanghai', now()))::date`;

function ttlHours() {
  return loadBootstrapConfig().bountyTtlHours;
}

function fresh(alias, param) {
  return `${alias}.created_at > now() - make_interval(hours => $${param}::int)`;
}

const FIELDS = `id, body, reward, status`;

function present(row) {
  const info = informationOf({
    body: row.body,
    files: row.files || [],
  });
  return {
    id: row.id,
    ...info,
    reward: row.reward,
    status: row.status,
  };
}

export function allocateReward(reward, entries) {
  const total = entries.reduce((sum, entry) => sum + entry.quality, 0);
  if (total <= 0 || reward <= 0) return entries.map((entry) => ({ ...entry, awarded: 0 }));
  const shares = entries.map((entry) => {
    const exact = (reward * entry.quality) / total;
    const awarded = Math.floor(exact);
    return { ...entry, awarded, fraction: exact - awarded };
  });
  let left = reward - shares.reduce((sum, entry) => sum + entry.awarded, 0);
  const order = [...shares].sort(
    (a, b) => b.fraction - a.fraction || new Date(a.submittedAt) - new Date(b.submittedAt)
  );
  for (const entry of order) {
    if (left <= 0) break;
    if (entry.quality <= 0) continue;
    entry.awarded += 1;
    left -= 1;
  }
  return shares;
}

export async function openGapBounty(pool, demandId, ask) {
  const body = typeof ask === "string" ? ask.trim() : "";
  if (!demandId || !body) return;
  try {
    await pool.query(
      `INSERT INTO bounties (body, reward, bounty_date, demand_id)
       SELECT $1, $2, ${TODAY}, $3
       WHERE NOT EXISTS (SELECT 1 FROM bounties WHERE demand_id = $3)`,
      [body, UNIT_PRICE, demandId]
    );
  } catch (error) {
    if (error.code !== "23505") throw error;
  }
}

async function miss(pool, id) {
  const { rows } = await pool.query(`SELECT 1 FROM bounties WHERE id = $1`, [id]);
  if (!rows.length) return { error: "not_found", status: 404 };
  return { error: "bad_state", status: 409 };
}

export async function listBounties(pool, userId) {
  kickSettle(pool);
  const { rows } = await pool.query(
    `SELECT b.id, b.body, b.reward, COALESCE(c.status, 'open') AS status
     FROM bounties b
     LEFT JOIN bounty_claims c ON c.bounty_id = b.id AND c.user_id = $1
     WHERE b.status = 'open' AND ${fresh("b", 2)}
     ORDER BY b.created_at ASC`,
    [userId, ttlHours()]
  );
  return rows.map(present);
}

export async function claimBounty(pool, userId, id) {
  kickSettle(pool);
  const { rows } = await pool.query(
    `INSERT INTO bounty_claims (bounty_id, user_id)
     SELECT b.id, $2
     FROM bounties b
     WHERE b.id = $1 AND b.status = 'open' AND ${fresh("b", 3)}
     ON CONFLICT DO NOTHING
     RETURNING bounty_id`,
    [id, userId, ttlHours()]
  );
  if (!rows.length) return miss(pool, id);
  const { rows: bounty } = await pool.query(`SELECT id, body, reward FROM bounties WHERE id = $1`, [id]);
  return { bounty: present({ ...bounty[0], status: "claimed" }) };
}

export async function completeBounty(pool, userId, id) {
  kickSettle(pool);
  const { rows } = await pool.query(
    `UPDATE bounty_claims c
     SET status = 'completed'
     FROM bounties b
     WHERE c.bounty_id = b.id AND c.bounty_id = $1 AND c.user_id = $2
       AND c.status = 'claimed' AND b.status = 'open' AND ${fresh("b", 3)}
     RETURNING b.id, b.body, b.reward, c.status`,
    [id, userId, ttlHours()]
  );
  if (!rows[0]) return miss(pool, id);
  return { bounty: present(rows[0]) };
}

async function claimFiles(pool, bountyId, userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.mime, u.original_name
     FROM bounty_claim_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.bounty_id = $1 AND f.user_id = $2
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [bountyId, userId]
  );
  return rows.map(fileView);
}

export async function submitBounty(pool, userId, id, delivery) {
  kickSettle(pool);
  const body = typeof delivery.body === "string" ? delivery.body.trim() : "";
  const uploadIds = [...new Set([...(delivery.imageIds || []), ...(delivery.fileIds || [])])];
  if (!hasInformation(informationOf({ body, files: uploadIds.map((item) => ({ id: item })) }))) {
    return { error: "empty_body", status: 400 };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE bounty_claims c
       SET status = 'submitted', result = $4, submitted_at = now()
       FROM bounties b
       WHERE c.bounty_id = b.id AND c.bounty_id = $1 AND c.user_id = $2
         AND c.status = 'completed' AND b.status = 'open' AND ${fresh("b", 3)}
       RETURNING b.id, b.reward, c.status, c.result AS body`,
      [id, userId, ttlHours(), body]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return miss(pool, id);
    }
    if (uploadIds.length) {
      const owned = await client.query(
        `SELECT id FROM uploads WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, uploadIds]
      );
      const have = new Set(owned.rows.map((row) => row.id));
      let order = 0;
      for (const uploadId of uploadIds) {
        if (!have.has(uploadId)) continue;
        await client.query(
          `INSERT INTO bounty_claim_files (bounty_id, user_id, upload_id, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [id, userId, uploadId, order]
        );
        order += 1;
      }
    }
    await client.query("COMMIT");
    const files = await claimFiles(pool, id, userId);
    return { bounty: present({ ...rows[0], files }) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function scoreSubmissions(bounty, claims) {
  if (!demandAgentId()) return claims.map((claim) => ({ ...claim, quality: 1 }));
  const reply = await runDemandAgent({
    id: `bounty-${bounty.id}`,
    brief: bounty.body,
    limit: claims.length,
    items: claims.map((claim) => ({
      id: claim.user_id,
      text: [claim.result, claim.names].filter(Boolean).join("\n"),
    })),
    selectOnly: true,
  });
  const picked = new Set(reply.citations.map((id) => id.toLowerCase()));
  return claims.map((claim) => ({
    ...claim,
    quality: picked.has(String(claim.user_id).toLowerCase()) ? 1 : 0,
  }));
}

async function settleOne(pool, bounty) {
  const { rows: claims } = await pool.query(
    `SELECT c.user_id, c.result, c.submitted_at,
            COALESCE(string_agg(u.original_name, ' '), '') AS names
     FROM bounty_claims c
     LEFT JOIN bounty_claim_files f ON f.bounty_id = c.bounty_id AND f.user_id = c.user_id
     LEFT JOIN uploads u ON u.id = f.upload_id
     WHERE c.bounty_id = $1 AND c.status = 'submitted'
     GROUP BY c.user_id, c.result, c.submitted_at
     ORDER BY c.submitted_at ASC`,
    [bounty.id]
  );
  const scored = await scoreSubmissions(bounty, claims);
  const awards = allocateReward(
    bounty.reward,
    scored.map((claim) => ({ ...claim, submittedAt: claim.submitted_at }))
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `UPDATE bounties SET status = 'settled' WHERE id = $1 AND status = 'open' RETURNING id`,
      [bounty.id]
    );
    if (!locked.rows.length) {
      await client.query("ROLLBACK");
      return;
    }
    for (const award of awards) {
      await client.query(
        `UPDATE bounty_claims SET quality = $3, awarded = $4 WHERE bounty_id = $1 AND user_id = $2`,
        [bounty.id, award.user_id, award.quality, award.awarded]
      );
      if (award.awarded > 0) {
        await applyPoints(client, {
          userId: award.user_id,
          delta: award.awarded,
          reason: "bounty",
          refId: bounty.id,
        });
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function settleDueBounties(pool) {
  const { rows } = await pool.query(
    `SELECT id, body, reward
     FROM bounties
     WHERE status = 'open' AND created_at <= now() - make_interval(hours => $1::int)`,
    [ttlHours()]
  );
  for (const bounty of rows) {
    try {
      await settleOne(pool, bounty);
    } catch (error) {
      console.error(error);
    }
  }
}

let settling = null;

export function kickSettle(pool) {
  if (settling) return settling;
  settling = settleDueBounties(pool)
    .catch((error) => console.error(error))
    .finally(() => {
      settling = null;
    });
  return settling;
}
