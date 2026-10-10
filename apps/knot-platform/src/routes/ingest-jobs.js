import { Router } from "express";
import { requireRegistered } from "../middleware/auth.js";

export function ingestJobsRouter({ pool }) {
  const router = Router();
  router.use(requireRegistered);

  router.get("/", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT j.id, j.upload_id, j.status, j.error, j.created_at, j.updated_at,
              u.storage_key, u.mime
       FROM ingest_jobs j
       JOIN uploads u ON u.id = j.upload_id
       WHERE j.user_id = $1
       ORDER BY j.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ jobs: rows });
  });

  return router;
}
