import { Router } from "express";
import { createHash } from "node:crypto";
import { expressionResult, RESULT_COLUMNS, RESULT_FROM } from "../expression-result.js";
import { advance } from "../launch.js";
import { recordMessage } from "../messages.js";

async function personFromToken(pool, header) {
  const token = String(header || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows } = await pool.query(`SELECT person_id FROM delegations WHERE token_hash = $1`, [tokenHash]);
  return rows[0]?.person_id || null;
}

export function agentRouter({ pool }) {
  const router = Router();

  router.post("/expressions", async (req, res) => {
    const personId = await personFromToken(pool, req.headers.authorization);
    if (!personId) return res.status(401).json({ error: "bad_token" });
    const role = req.body?.role;
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (role !== "demand" && role !== "supply" && role !== "intel") {
      return res.status(400).json({ error: "bad_role" });
    }
    if (!body) return res.status(400).json({ error: "empty_body" });
    const inserted = await pool.query(
      `INSERT INTO expressions (person_id, actor, door, role, body)
       VALUES ($1, 'personal_agent', 'agent_api', $2, $3)
       RETURNING id`,
      [personId, role, body]
    );
    await recordMessage(pool, {
      personId,
      expressionId: inserted.rows[0].id,
      door: "agent_api",
      direction: "out",
      body,
    });
    try {
      await advance(pool, inserted.rows[0].id);
    } catch (err) {
      console.error(err);
      return res.status(503).json({ error: "process_unavailable" });
    }
    const { rows } = await pool.query(
      `SELECT ${RESULT_COLUMNS} FROM ${RESULT_FROM} WHERE e.id = $1`,
      [inserted.rows[0].id]
    );
    res.status(201).json({ expression: expressionResult(rows[0]) });
  });

  router.get("/messages", async (req, res) => {
    const personId = await personFromToken(pool, req.headers.authorization);
    if (!personId) return res.status(401).json({ error: "bad_token" });
    const { rows } = await pool.query(
      `SELECT m.id, m.expression_id, m.direction, m.body, m.read_at, m.created_at, e.role
       FROM messages m
       JOIN expressions e ON e.id = m.expression_id
       WHERE m.person_id = $1 AND m.door = 'agent_api'
       ORDER BY m.created_at DESC`,
      [personId]
    );
    res.json({
      unread: rows.filter((row) => row.direction === "in" && !row.read_at).length,
      messages: rows.map((row) => ({
        id: row.id,
        expressionId: row.expression_id,
        role: row.role,
        direction: row.direction,
        body: row.body,
        read: Boolean(row.read_at),
        createdAt: row.created_at,
      })),
    });
  });

  router.get("/feedback", async (req, res) => {
    const personId = await personFromToken(pool, req.headers.authorization);
    if (!personId) return res.status(401).json({ error: "bad_token" });
    const { rows } = await pool.query(
      `SELECT ${RESULT_COLUMNS}, e.feedback, e.created_at FROM ${RESULT_FROM}
       WHERE e.person_id = $1 AND e.door = 'agent_api' AND e.feedback IS NOT NULL
       ORDER BY e.created_at DESC`,
      [personId]
    );
    res.json({
      feedback: rows.map((row) => ({
        ...expressionResult(row),
        feedback: row.feedback,
        createdAt: row.created_at,
      })),
    });
  });

  return router;
}
