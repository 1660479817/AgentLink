import { Router } from "express";

const PUBLIC_FIELDS = `id, ingest_job_id, title, summary, thumb_url, visibility, created_at`;

function visibleToViewer(visibility, hasUser) {
  if (visibility === "public") return true;
  if (!hasUser) return false;
  if (visibility === "registered") return true;
  if (visibility === "verified") return true;
  return false;
}

export function cardsRouter({ pool }) {
  const router = Router();

  /** 找信息：匿名可看 public；登录后可看 public + registered（verified 档 Phase 0 同注册） */
  router.get("/", async (req, res) => {
    const mine = req.query.mine === "1" || req.query.mine === "true";
    if (mine) {
      if (!req.user) {
        return res.status(403).json({ error: "REGISTER_REQUIRED" });
      }
      const { rows } = await pool.query(
        `SELECT id, ingest_job_id, title, summary, thumb_url, visibility, payload, created_at
         FROM information_cards
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [req.user.id]
      );
      return res.json({ cards: rows });
    }

    const q = String(req.query.q || "").trim().slice(0, 80);
    const hasUser = Boolean(req.user);
    let sql = `SELECT ${PUBLIC_FIELDS} FROM information_cards WHERE 1=1`;
    const params = [];
    if (!hasUser) {
      sql += ` AND visibility = 'public'`;
    } else {
      sql += ` AND visibility IN ('public', 'registered', 'verified')`;
    }
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (title ILIKE $${params.length} OR summary ILIKE $${params.length})`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 80`;
    const { rows } = await pool.query(sql, params);
    res.json({ cards: rows });
  });

  router.get("/:id", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, user_id, title, summary, thumb_url, visibility, payload, created_at
       FROM information_cards WHERE id = $1`,
      [req.params.id]
    );
    const card = rows[0];
    if (!card) return res.status(404).json({ error: "not_found" });
    if (!visibleToViewer(card.visibility, Boolean(req.user))) {
      return res.status(403).json({ error: "REGISTER_REQUIRED" });
    }
    const out = {
      id: card.id,
      title: card.title,
      summary: card.summary,
      thumb_url: card.thumb_url,
      visibility: card.visibility,
      created_at: card.created_at,
    };
    if (req.user) {
      out.payload = redactPayload(card.payload);
    }
    res.json({ card: out });
  });

  return router;
}

function redactPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  const copy = { ...payload };
  delete copy.contact;
  delete copy.phone;
  delete copy.email;
  return copy;
}
