import { Router } from "express";

export function demandsRouter({ pool }) {
  const router = Router();

  router.post("/", async (req, res) => {
    const body = String(req.body?.body || "").trim();
    if (body.length < 4) {
      return res.status(400).json({ error: "body_too_short" });
    }
    if (body.length > 4000) {
      return res.status(400).json({ error: "body_too_long" });
    }
    const contactHint = req.body?.contact_hint
      ? String(req.body.contact_hint).trim().slice(0, 200)
      : null;
    const { rows } = await pool.query(
      `INSERT INTO demands (body, contact_hint) VALUES ($1, $2)
       RETURNING id, created_at`,
      [body, contactHint]
    );
    res.status(201).json({ demand: rows[0] });
  });

  return router;
}
