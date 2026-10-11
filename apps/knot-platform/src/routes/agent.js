import { Router } from "express";
import { createHash } from "node:crypto";
import path from "node:path";
import multer from "multer";
import { claimBounty, completeBounty, listBounties, submitBounty } from "../bounties.js";
import { hasInformation, idsOf, MAX_FILES, MAX_IMAGES } from "../information.js";
import { normalizeEmail } from "../login.js";
import { createDemand, createIntel } from "../market.js";
import { ensureUploadDir, newStorageName, publicUploadUrl } from "../uploads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bearerToken(header) {
  return String(header || "").replace(/^Bearer\s+/i, "").trim();
}

async function userFromAccess(pool, header, emailRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return { error: "bad_email", status: 400 };
  const token = bearerToken(header);
  if (!token) return { error: "bad_token", status: 401 };
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows } = await pool.query(
    `SELECT u.id
     FROM users u
     JOIN delegations d ON d.user_id = u.id
     WHERE lower(u.email) = $1 AND d.token_hash = $2`,
    [email, tokenHash]
  );
  if (!rows[0]) return { error: "bad_token", status: 401 };
  return { userId: rows[0].id };
}

function readDelivery(body) {
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  const images = idsOf(body?.images, MAX_IMAGES);
  const attachments = idsOf(body?.attachments, MAX_FILES);
  return { body: text, imageIds: images, fileIds: attachments };
}

export function agentRouter({ pool, uploadDir }) {
  ensureUploadDir(uploadDir);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, newStorageName(file.originalname)),
  });
  const imageUpload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) cb(null, true);
      else cb(new Error("bad_mime"));
    },
  });
  const fileUpload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
  const router = Router();

  function acceptFile(kind) {
    const parser = kind === "image" ? imageUpload : fileUpload;
    return (req, res, next) => {
      parser.single("file")(req, res, (err) => {
        if (err) {
          const tooBig = err.code === "LIMIT_FILE_SIZE";
          const code = err.message === "bad_mime" ? "bad_mime" : tooBig ? "file_too_large" : "upload_failed";
          return res.status(400).json({ error: code });
        }
        if (!req.file) return res.status(400).json({ error: "empty_file" });
        next();
      });
    };
  }

  async function storeUpload(req, res) {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const name = path.basename(req.file.originalname || "").slice(0, 180);
    const { rows } = await pool.query(
      `INSERT INTO uploads (user_id, storage_name, mime, original_name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [access.userId, req.file.filename, req.file.mimetype, name || null]
    );
    const mime = req.file.mimetype || "";
    res.status(201).json({
      id: rows[0].id,
      url: publicUploadUrl(rows[0].id),
      name,
      mime,
    });
  }

  router.post("/uploads", acceptFile("image"), storeUpload);
  router.post("/files", acceptFile("file"), storeUpload);

  router.post("/intel", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const delivery = readDelivery(req.body);
    if (!hasInformation({ body: delivery.body, images: delivery.imageIds, attachments: delivery.fileIds })) {
      return res.status(400).json({ error: "empty_body" });
    }
    try {
      const intel = await createIntel(pool, {
        userId: access.userId,
        actor: "personal_agent",
        door: "agent_api",
        body: delivery.body,
        imageIds: delivery.imageIds,
        fileIds: delivery.fileIds,
      });
      res.status(201).json({ intel });
    } catch (error) {
      console.error(error);
      res.status(503).json({ error: "process_unavailable" });
    }
  });

  router.get("/bounties", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.query.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json({ bounties: await listBounties(pool, access.userId) });
  });

  router.post("/bounties/:id/claim", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    if (!UUID.test(String(req.params.id || ""))) return res.status(404).json({ error: "not_found" });
    const result = await claimBounty(pool, access.userId, req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  });

  router.post("/bounties/:id/complete", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    if (!UUID.test(String(req.params.id || ""))) return res.status(404).json({ error: "not_found" });
    const result = await completeBounty(pool, access.userId, req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  });

  router.post("/bounties/:id/submit", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    if (!UUID.test(String(req.params.id || ""))) return res.status(404).json({ error: "not_found" });
    const delivery = readDelivery(req.body);
    if (!hasInformation({ body: delivery.body, images: delivery.imageIds, attachments: delivery.fileIds })) {
      return res.status(400).json({ error: "empty_body" });
    }
    try {
      const result = await submitBounty(pool, access.userId, req.params.id, delivery);
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(503).json({ error: "process_unavailable" });
    }
  });

  router.post("/demands", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const brief = typeof req.body?.brief === "string" ? req.body.brief.trim() : "";
    const delivery = readDelivery(req.body);
    if (!brief && !hasInformation({ body: "", images: delivery.imageIds, attachments: delivery.fileIds })) {
      return res.status(400).json({ error: "empty_body" });
    }
    try {
      const demand = await createDemand(pool, {
        userId: access.userId,
        actor: "personal_agent",
        door: "agent_api",
        brief,
        citationLimit: req.body?.citationLimit,
        imageIds: delivery.imageIds,
        fileIds: delivery.fileIds,
      });
      res.status(201).json({ demand });
    } catch (error) {
      console.error(error);
      res.status(503).json({ error: "process_unavailable" });
    }
  });

  return router;
}
