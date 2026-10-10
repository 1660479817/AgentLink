import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import multer from "multer";
import { advance } from "../launch.js";
import { recordMessage } from "../messages.js";
import { adjustPoints, getBalance } from "../points.js";
import { scoreInformation } from "../search.js";
import { clearSessionCookie, setSessionCookie, SESSION_TTL_MS } from "../middleware/session.js";
import { expressionResult, RESULT_COLUMNS, RESULT_FROM } from "../expression-result.js";
import { ensureUploadDir, newStorageName, publicUploadUrl, storagePath } from "../uploads.js";

const EXPRESSION_COLUMNS = `id, role, body, feedback, created_at, review_status, reject_reason, processed, intel_reward`;

function publicCard(row) {
  const body = typeof row.body === "string" ? row.body.trim() : "";
  return {
    id: row.id,
    role: row.role,
    body,
    imageUrls: row.imageUrls || [],
    category: row.intel_category || null,
  };
}

async function withUploads(pool, rows) {
  if (!rows.length) return rows;
  const { rows: images } = await pool.query(
    `SELECT expression_id, upload_id
     FROM expression_images
     WHERE expression_id = ANY($1::uuid[])
     ORDER BY sort_order ASC, upload_id ASC`,
    [rows.map((row) => row.id)]
  );
  const byId = new Map();
  for (const image of images) {
    const list = byId.get(image.expression_id) || [];
    list.push(publicUploadUrl(image.upload_id));
    byId.set(image.expression_id, list);
  }
  return rows.map((row) => ({ ...row, imageUrls: byId.get(row.id) || [] }));
}

export function webRouter({ pool, sessionCookieName, uploadDir }) {
  ensureUploadDir(uploadDir);
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => cb(null, newStorageName(file.originalname)),
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) cb(null, true);
      else cb(new Error("bad_mime"));
    },
  });

  const router = Router();

  router.post("/session", async (_req, res) => {
    const person = await pool.query(`INSERT INTO persons DEFAULT VALUES RETURNING id`);
    const personId = person.rows[0].id;
    const sid = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query(`INSERT INTO sessions (sid, person_id, expires_at) VALUES ($1, $2, $3)`, [
      sid,
      personId,
      expires,
    ]);
    setSessionCookie(res, sessionCookieName, sid);
    res.status(201).json({ personId });
  });

  router.get("/session", (req, res) => {
    if (!req.person) return res.json({ person: null });
    res.json({ person: { id: req.person.id } });
  });

  router.delete("/session", async (req, res) => {
    const sid = req.cookies?.[sessionCookieName];
    if (sid) await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
    clearSessionCookie(res, sessionCookieName);
    res.json({ ok: true });
  });

  router.post("/uploads", (req, res, next) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message === "bad_mime" ? "bad_mime" : "upload_failed" });
      if (!req.file) return res.status(400).json({ error: "empty_file" });
      next();
    });
  }, async (req, res) => {
    const { rows } = await pool.query(
      `INSERT INTO uploads (person_id, storage_name, mime) VALUES ($1, $2, $3) RETURNING id`,
      [req.person.id, req.file.filename, req.file.mimetype]
    );
    res.status(201).json({ id: rows[0].id, url: publicUploadUrl(rows[0].id) });
  });

  router.get("/uploads/:id", async (req, res) => {
    const { rows } = await pool.query(`SELECT storage_name, mime FROM uploads WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).end();
    const filePath = storagePath(uploadDir, rows[0].storage_name);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.type(rows[0].mime);
    fs.createReadStream(filePath).pipe(res);
  });

  router.post("/expressions", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const role = req.body?.role;
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const contact = typeof req.body?.contact === "string" ? req.body.contact.trim() : "";
    const imageIds = Array.isArray(req.body?.imageIds)
      ? req.body.imageIds.filter((id) => typeof id === "string")
      : [];
    if (role !== "demand" && role !== "supply" && role !== "intel") {
      return res.status(400).json({ error: "bad_role" });
    }
    if (!body && !imageIds.length) return res.status(400).json({ error: "empty_body" });
    const inserted = await pool.query(
      `INSERT INTO expressions (person_id, actor, door, role, body, contact)
       VALUES ($1, 'person', 'webui', $2, $3, $4)
       RETURNING id`,
      [req.person.id, role, body, contact || null]
    );
    const expressionId = inserted.rows[0].id;
    if (imageIds.length) {
      const { rows: owned } = await pool.query(
        `SELECT id FROM uploads WHERE person_id = $1 AND id = ANY($2::uuid[])`,
        [req.person.id, imageIds]
      );
      for (let i = 0; i < owned.length; i += 1) {
        await pool.query(
          `INSERT INTO expression_images (expression_id, upload_id, sort_order) VALUES ($1, $2, $3)`,
          [expressionId, owned[i].id, i]
        );
      }
    }
    await recordMessage(pool, {
      personId: req.person.id,
      expressionId,
      door: "webui",
      direction: "out",
      body,
    });
    try {
      await advance(pool, expressionId);
    } catch (err) {
      console.error(err);
      return res.status(503).json({ error: "process_unavailable" });
    }
    const { rows } = await pool.query(`SELECT ${RESULT_COLUMNS} FROM ${RESULT_FROM} WHERE e.id = $1`, [expressionId]);
    res.status(201).json({ expression: expressionResult(rows[0]) });
  });

  router.get("/submissions", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT e.id, e.role, e.body, e.review_status, e.reject_code, e.reject_reason, e.processed, e.evaluation, e.intel_reward, e.created_at,
              c.category AS intel_category, c.fact AS intel_fact, c.basis AS intel_basis
       FROM expressions e
       LEFT JOIN intel_classes c ON c.expression_id = e.id
       WHERE e.person_id = $1 AND e.door = 'webui'
       ORDER BY e.created_at DESC`,
      [req.person.id]
    );
    const submissions = [];
    for (const row of rows) {
      const imgs = await pool.query(
        `SELECT upload_id FROM expression_images WHERE expression_id = $1 ORDER BY sort_order`,
        [row.id]
      );
      submissions.push({
        id: row.id,
        role: row.role,
        body: row.body,
        reviewStatus: row.review_status,
        rejectReason: row.reject_reason,
        rejectCode: row.reject_code,
        summary: row.processed,
        evaluation: row.evaluation
          ? { score: row.evaluation.score, reason: row.evaluation.reason || "" }
          : null,
        intelClass: row.intel_category
          ? { category: row.intel_category, fact: row.intel_fact, basis: row.intel_basis }
          : null,
        intelReward: row.intel_reward,
        imageIds: imgs.rows.map((r) => r.upload_id),
        createdAt: row.created_at,
      });
    }
    res.json({ submissions });
  });

  router.get("/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ information: [] });
    const { rows } = await pool.query(
      `SELECT e.id, e.role, e.body, e.processed, e.card, e.created_at,
              c.category AS intel_category, c.fact AS intel_fact
       FROM expressions e
       LEFT JOIN intel_classes c ON c.expression_id = e.id
       WHERE e.review_status = 'published' AND e.processed IS NOT NULL
       ORDER BY e.created_at DESC
       LIMIT 500`
    );
    const matched = rows
      .map((row) => ({ ...row, score: scoreInformation(q, row) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 30);
    res.json({ information: (await withUploads(pool, matched)).map(publicCard) });
  });

  router.get("/information", async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT e.id, e.role, e.body, e.created_at, c.category AS intel_category
       FROM expressions e
       LEFT JOIN intel_classes c ON c.expression_id = e.id
       WHERE e.review_status = 'published' AND e.processed IS NOT NULL
       ORDER BY e.created_at DESC
       LIMIT 30`
    );
    res.json({ information: (await withUploads(pool, rows)).map(publicCard) });
  });

  router.get("/expressions", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT ${EXPRESSION_COLUMNS} FROM expressions
       WHERE person_id = $1 AND door = 'webui'
       ORDER BY created_at DESC`,
      [req.person.id]
    );
    res.json({ expressions: rows });
  });

  router.get("/points", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const balance = await getBalance(pool, req.person.id);
    res.json({ balance });
  });

  router.get("/notifications", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT id, kind, title, body, href, read_at, created_at
       FROM notifications
       WHERE person_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.person.id]
    );
    const unread = rows.filter((row) => !row.read_at).length;
    res.json({
      unread,
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        href: row.href,
        read: Boolean(row.read_at),
        createdAt: row.created_at,
      })),
    });
  });

  router.post("/notifications/read", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    await pool.query(
      `UPDATE notifications SET read_at = now()
       WHERE person_id = $1 AND read_at IS NULL`,
      [req.person.id]
    );
    res.json({ ok: true });
  });

  router.get("/messages", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT m.id, m.expression_id, m.direction, m.body, m.read_at, m.created_at, m.match_id,
              e.role, ma.status AS match_status
       FROM messages m
       JOIN expressions e ON e.id = m.expression_id
       LEFT JOIN matches ma ON ma.id = m.match_id
       WHERE m.person_id = $1 AND m.door = 'webui'
       ORDER BY m.created_at DESC`,
      [req.person.id]
    );
    const unread = rows.filter((row) => row.direction === "in" && !row.read_at).length;
    res.json({
      unread,
      messages: rows.map((row) => ({
        id: row.id,
        expressionId: row.expression_id,
        role: row.role,
        direction: row.direction,
        body: row.body,
        read: Boolean(row.read_at),
        createdAt: row.created_at,
        matchId: row.match_id,
        canConnect: Boolean(row.match_id && row.match_status === "pending"),
        connected: row.match_status === "connected",
      })),
    });
  });

  router.post("/messages/read", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    await pool.query(
      `UPDATE messages SET read_at = now()
       WHERE person_id = $1 AND door = 'webui' AND direction = 'in' AND read_at IS NULL`,
      [req.person.id]
    );
    res.json({ ok: true });
  });

  router.post("/matches/:matchId/connect", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT m.id, m.status, m.connect_cost, m.demand_expression_id, m.supply_expression_id,
              d.body AS demand_body, d.contact AS demand_contact, d.person_id AS demand_person,
              s.body AS supply_body, s.contact AS supply_contact, s.person_id AS supply_person,
              pd.contact AS demand_person_contact, ps.contact AS supply_person_contact
       FROM matches m
       JOIN expressions d ON d.id = m.demand_expression_id
       JOIN expressions s ON s.id = m.supply_expression_id
       JOIN persons pd ON pd.id = d.person_id
       JOIN persons ps ON ps.id = s.person_id
       WHERE m.id = $1`,
      [req.params.matchId]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const match = rows[0];
    if (match.status === "connected") {
      return res.json({
        alreadyConnected: true,
        rawSelf: req.person.id === match.demand_person ? match.demand_body : match.supply_body,
        rawPeer: req.person.id === match.demand_person ? match.supply_body : match.demand_body,
        contact:
          req.person.id === match.demand_person
            ? match.supply_contact || match.supply_person_contact || "未提供"
            : match.demand_contact || match.demand_person_contact || "未提供",
      });
    }
    const isParty =
      req.person.id === match.demand_person || req.person.id === match.supply_person;
    if (!isParty) return res.status(403).json({ error: "forbidden" });
    const balance = await getBalance(pool, req.person.id);
    if (balance < match.connect_cost) return res.status(402).json({ error: "insufficient_points" });
    await adjustPoints(pool, {
      personId: req.person.id,
      delta: -match.connect_cost,
      reason: "connect",
      refId: match.id,
    });
    await pool.query(
      `UPDATE matches SET status = 'connected', connected_at = now() WHERE id = $1`,
      [match.id]
    );
    const rawSelf = req.person.id === match.demand_person ? match.demand_body : match.supply_body;
    const rawPeer = req.person.id === match.demand_person ? match.supply_body : match.demand_body;
    const contact =
      req.person.id === match.demand_person
        ? match.supply_contact || match.supply_person_contact || "未提供"
        : match.demand_contact || match.demand_person_contact || "未提供";
    res.json({ rawSelf, rawPeer, contact, cost: match.connect_cost });
  });

  router.get("/feedback", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT ${EXPRESSION_COLUMNS} FROM expressions
       WHERE person_id = $1 AND door = 'webui' AND feedback IS NOT NULL
       ORDER BY created_at DESC`,
      [req.person.id]
    );
    res.json({ feedback: rows });
  });

  router.post("/delegation", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await pool.query(
      `INSERT INTO delegations (person_id, token_hash)
       VALUES ($1, $2)
       ON CONFLICT (person_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()`,
      [req.person.id, tokenHash]
    );
    res.status(201).json({ token });
  });

  router.get("/delegation", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(`SELECT 1 FROM delegations WHERE person_id = $1`, [req.person.id]);
    res.json({ delegated: rows.length > 0 });
  });

  router.delete("/delegation", async (req, res) => {
    if (!req.person) return res.status(401).json({ error: "no_session" });
    await pool.query(`DELETE FROM delegations WHERE person_id = $1`, [req.person.id]);
    res.json({ ok: true });
  });

  return router;
}
