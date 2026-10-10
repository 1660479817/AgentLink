import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { requireRegistered } from "../middleware/auth.js";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function uploadsRouter({ pool, uploadDir }) {
  fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination(req, _file, cb) {
      const dir = path.join(uploadDir, req.user.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || "") || ".bin";
      cb(null, `${randomUUID()}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      if (!ALLOWED.has(file.mimetype)) {
        return cb(new Error("bad_mime"));
      }
      cb(null, true);
    },
  });

  const router = Router();
  router.use(requireRegistered);

  router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "missing_file" });
    const storageKey = path.relative(uploadDir, req.file.path);
    const { rows } = await pool.query(
      `INSERT INTO uploads (user_id, storage_key, mime, size_bytes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, storage_key, mime, size_bytes, created_at`,
      [req.user.id, storageKey, req.file.mimetype, req.file.size]
    );
    const uploadRow = rows[0];
    const job = await pool.query(
      `INSERT INTO ingest_jobs (user_id, upload_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, status, created_at`,
      [req.user.id, uploadRow.id]
    );
    res.status(201).json({
      upload: uploadRow,
      ingestJob: job.rows[0],
    });
  });

  return router;
}
