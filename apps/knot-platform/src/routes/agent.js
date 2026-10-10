import { Router } from "express";
import { createHash } from "node:crypto";
import { createDemand, createIntel, listDemands } from "../market.js";

async function userFromToken(pool, header) {
  const token = String(header || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows } = await pool.query(`SELECT user_id FROM delegations WHERE token_hash = $1`, [tokenHash]);
  return rows[0]?.user_id || null;
}

export function agentRouter({ pool }) {
  const router = Router();

  router.post("/intel", async (req, res) => {
    const userId = await userFromToken(pool, req.headers.authorization);
    if (!userId) return res.status(401).json({ error: "bad_token" });
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) return res.status(400).json({ error: "empty_body" });
    try {
      const intel = await createIntel(pool, {
        userId,
        actor: "personal_agent",
        door: "agent_api",
        body,
      });
      res.status(201).json({ intel });
    } catch (error) {
      console.error(error);
      res.status(503).json({ error: "process_unavailable" });
    }
  });

  router.post("/demands", async (req, res) => {
    const userId = await userFromToken(pool, req.headers.authorization);
    if (!userId) return res.status(401).json({ error: "bad_token" });
    const brief = typeof req.body?.brief === "string" ? req.body.brief.trim() : "";
    if (!brief) return res.status(400).json({ error: "empty_body" });
    try {
      const demand = await createDemand(pool, {
        userId,
        actor: "personal_agent",
        door: "agent_api",
        brief,
        citationLimit: req.body?.citationLimit,
      });
      res.status(201).json({ demand });
    } catch (error) {
      console.error(error);
      res.status(503).json({ error: "process_unavailable" });
    }
  });

  router.get("/demands", async (req, res) => {
    const userId = await userFromToken(pool, req.headers.authorization);
    if (!userId) return res.status(401).json({ error: "bad_token" });
    res.json({ demands: await listDemands(pool, userId, "agent_api") });
  });

  return router;
}
