import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import multer from "multer";
import { listBounties, openBounty } from "../bounties.js";
import { hasInformation, idsOf, MAX_FILES, MAX_IMAGES } from "../information.js";
import { normalizeEmail, normalizeLoginKey, redeemLoginKey, requestLoginKey } from "../login.js";
import { createDemand, createIntel, downloadPacket } from "../market.js";
import { ensureUploadDir, newStorageName, publicUploadUrl } from "../uploads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function agentFail(res, error) {
  const code = error.code || error.message;
  if (code === "insufficient_points") return res.status(402).json({ error: "insufficient_points" });
  if (code === "bad_state") return res.status(409).json({ error: "bad_state" });
  if (code === "not_found") return res.status(404).json({ error: "not_found" });
  console.error(error);
  return res.status(503).json({ error: "process_unavailable" });
}

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

  router.post("/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "bad_email" });
    const sent = await requestLoginKey(pool, email);
    if (sent.error) return res.status(sent.status).json({ error: sent.error });
    res.json({ ok: true });
  });

  router.post("/register/key", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const key = normalizeLoginKey(req.body?.key);
    if (!email) return res.status(400).json({ error: "bad_email" });
    if (!key) return res.status(400).json({ error: "bad_key" });
    const redeemed = await redeemLoginKey(pool, email, key);
    if (redeemed.error) return res.status(redeemed.status).json({ error: redeemed.error });
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { rows } = await pool.query(
      `INSERT INTO delegations (user_id, token_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()
       RETURNING created_at`,
      [redeemed.userId, tokenHash]
    );
    res.status(201).json({
      token,
      email,
      pointsBalance: redeemed.pointsBalance,
      createdAt: rows[0].created_at,
    });
  });

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
        price: req.body?.price,
        bountyId: typeof req.body?.bountyId === "string" ? req.body.bountyId : null,
      });
      res.status(201).json({ intel });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.post("/intel/:id/download", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    if (!UUID.test(String(req.params.id || ""))) return res.status(404).json({ error: "not_found" });
    try {
      const intel = await downloadPacket(pool, access.userId, req.params.id);
      res.json({ intel: { ...intel, granted: true } });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.get("/bounties", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.query.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json({ bounties: await listBounties(pool) });
  });

  router.post("/bounties", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    try {
      const result = await openBounty(pool, {
        userId: access.userId,
        body: req.body?.body,
        hours: req.body?.hours,
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.status(201).json(result);
    } catch (error) {
      agentFail(res, error);
    }
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
      const intel = await createIntel(pool, {
        userId: access.userId,
        actor: "personal_agent",
        door: "agent_api",
        body: delivery.body,
        imageIds: delivery.imageIds,
        fileIds: delivery.fileIds,
        price: req.body?.price,
        bountyId: req.params.id,
      });
      res.status(201).json({ intel });
    } catch (error) {
      agentFail(res, error);
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
      agentFail(res, error);
    }
  });

  return router;
}
