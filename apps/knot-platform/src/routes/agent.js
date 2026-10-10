import { Router } from "express";
import { authorizeAgent } from "../lib/agent-tokens.js";

function parseBearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : "";
}

async function agentAuth(pool, req) {
  const email = req.headers["x-knot-email"] || req.query.email || req.body?.email;
  const token = parseBearer(req);
  return authorizeAgent(pool, email, token);
}

export function agentRouter({ pool }) {
  const router = Router();

  router.use(async (req, res, next) => {
    try {
      req.agent = await agentAuth(pool, req);
      next();
    } catch (e) {
      res.status(e.status || 401).json({ error: e.code || "unauthorized" });
    }
  });

  router.get("/ingest-jobs", async (req, res) => {
    const status = String(req.query.status || "pending");
    if (status !== "pending") {
      return res.status(400).json({ error: "status_must_be_pending" });
    }
    const claim = await pool.query(
      `UPDATE ingest_jobs j
       SET status = 'processing', updated_at = now()
       FROM (
         SELECT id FROM ingest_jobs
         WHERE status = 'pending' AND user_id = $1
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       ) pick
       WHERE j.id = pick.id
       RETURNING j.id, j.user_id, j.upload_id, j.status, j.created_at`,
      [req.agent.userId]
    );
    const job = claim.rows[0];
    if (!job) return res.json({ job: null });

    const up = await pool.query(
      "SELECT storage_key, mime FROM uploads WHERE id = $1",
      [job.upload_id]
    );
    const storageKey = up.rows[0]?.storage_key;
    res.json({
      job: {
        ...job,
        storage_key: storageKey,
        mime: up.rows[0]?.mime,
        image_url: storageKey
          ? `/uploads/${storageKey.split(pathSep()).join("/")}`
          : null,
      },
    });
  });

  router.patch("/ingest-jobs/:id", async (req, res) => {
    const { status, error } = req.body || {};
    const allowed = new Set(["processing", "done", "failed", "pending"]);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: "bad_status" });
    }
    const { rowCount } = await pool.query(
      `UPDATE ingest_jobs SET status = $1, error = $2, updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      [status, error || null, req.params.id, req.agent.userId]
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  });

  router.post("/cards", async (req, res) => {
    const {
      ingest_job_id: ingestJobId,
      title,
      summary,
      thumb_url: thumbUrl,
      payload,
      visibility,
    } = req.body || {};
    const vis = ["public", "registered", "verified"].includes(visibility)
      ? visibility
      : "public";
    if (!ingestJobId) {
      return res.status(400).json({ error: "missing_ingest_job_id" });
    }
    const jobCheck = await pool.query(
      "SELECT id, user_id, status FROM ingest_jobs WHERE id = $1",
      [ingestJobId]
    );
    const job = jobCheck.rows[0];
    if (!job || job.user_id !== req.agent.userId) {
      return res.status(404).json({ error: "job_not_found" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO information_cards (user_id, ingest_job_id, title, summary, thumb_url, payload, visibility)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, summary, visibility, created_at`,
        [
          req.agent.userId,
          ingestJobId,
          title || null,
          summary || null,
          thumbUrl || null,
          payload && typeof payload === "object" ? payload : {},
          vis,
        ]
      );
      await client.query(
        `UPDATE ingest_jobs SET status = 'done', error = NULL, updated_at = now()
         WHERE id = $1`,
        [ingestJobId]
      );
      await client.query("COMMIT");
      res.status(201).json({ card: ins.rows[0] });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  return router;
}

function pathSep() {
  return process.platform === "win32" ? "\\" : "/";
}
