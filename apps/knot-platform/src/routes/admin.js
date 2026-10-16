import { Router } from "express";
import multer from "multer";
import {
  bearerToken,
  isLoopbackAddress,
  grantPoints,
  listPosts,
  muteUser,
  patrolQueue,
  recordPatrol,
  removePost,
  searchUsers,
  issueInternalAgent,
  setEntitlements,
  setLevel,
  tokensMatch,
  unmuteUser,
  warnUser,
} from "../admin.js";
import { createSponsor, listSponsors, placeSponsor, removeSponsor, storeSponsorImage, updateSponsor } from "../sponsors.js";
import { applyPriceProposal, economySnapshot, priceSchedule, proposePrices } from "../actuary.js";
import { ensureUploadDir, newStorageName } from "../uploads.js";

function sendAdminError(res, error) {
  const code = error.code || "internal";
  if (
    code === "bad_user" ||
    code === "bad_name" ||
    code === "bad_email" ||
    code === "bad_specialty" ||
    code === "bad_body" ||
    code === "bad_amount" ||
    code === "bad_until" ||
    code === "bad_level" ||
    code === "bad_entitlement" ||
    code === "entitlement_full" ||
    code === "bad_within" ||
    code === "bad_href" ||
    code === "bad_image" ||
    code === "bad_mime" ||
    code === "bad_position" ||
    code === "bad_price" ||
    code === "empty_file" ||
    code === "file_too_large" ||
    code === "upload_failed" ||
    code === "sponsor_full"
  ) {
    return res.status(400).json({ error: code });
  }
  if (code === "env_unconfigured" || code === "env_failed") {
    return res.status(503).json({ error: code });
  }
  if (code === "not_found") return res.status(404).json({ error: code });
  if (code === "not_pending") return res.status(409).json({ error: code });
  if (code === "ambiguous" || code === "protected") {
    return res.status(409).json({ error: code, users: error.users || undefined });
  }
  console.error(error);
  return res.status(500).json({ error: "internal" });
}

export function adminRouter({ pool, token, uploadDir, agentEnvDir = null }) {
  const router = Router();
  if (uploadDir) ensureUploadDir(uploadDir);
  const sponsorUpload = multer({
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

  router.use((req, res, next) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!String(token || "").trim()) {
      return res.status(503).json({ error: "admin_unconfigured" });
    }
    if (!tokensMatch(String(token).trim(), bearerToken(req.headers.authorization))) {
      return res.status(401).json({ error: "bad_token" });
    }
    next();
  });

  router.get("/users", async (req, res) => {
    try {
      res.json({ users: await searchUsers(pool, req.query.q) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.get("/posts", async (req, res) => {
    try {
      res.json(await listPosts(pool, { user: req.query.user, q: req.query.q, within: req.query.within }));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/posts/:id/remove", async (req, res) => {
    try {
      res.json(await removePost(pool, req.params.id, req.body?.reason));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/points", async (req, res) => {
    try {
      res.json(await grantPoints(pool, req.body?.user, req.body?.amount, req.body?.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/mute", async (req, res) => {
    try {
      res.json(await muteUser(pool, req.body?.user, req.body?.until, req.body?.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/unmute", async (req, res) => {
    try {
      res.json(await unmuteUser(pool, req.body?.user, req.body?.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/entitlements", async (req, res) => {
    try {
      res.json(await setEntitlements(pool, req.body?.user, req.body?.grant, req.body?.revoke, req.body?.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/level", async (req, res) => {
    try {
      res.json(await setLevel(pool, req.body?.user, req.body?.level, req.body?.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/internal-agents", async (req, res) => {
    try {
      const body = req.body || {};
      const options = { envDir: agentEnvDir };
      if (Object.hasOwn(body, "specialties")) options.specialties = body.specialties;
      res.json(await issueInternalAgent(pool, body.name, options));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/warnings", async (req, res) => {
    try {
      res.json(await warnUser(pool, req.body?.user, req.body?.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.get("/patrol", async (_req, res) => {
    try {
      res.json(await patrolQueue(pool));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.get("/economy", async (_req, res) => {
    try {
      res.json(await economySnapshot(pool));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.get("/prices", async (_req, res) => {
    try {
      res.json(await priceSchedule(pool));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/prices/proposals", async (req, res) => {
    try {
      res.status(201).json(await proposePrices(pool, req.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/prices/proposals/:id/apply", async (req, res) => {
    try {
      res.json(await applyPriceProposal(pool, req.params.id));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/patrol", async (req, res) => {
    try {
      res.json(await recordPatrol(pool, req.body?.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/uploads", (req, res, next) => {
    if (!uploadDir) return res.status(503).json({ error: "upload_failed" });
    sponsorUpload.single("file")(req, res, (err) => {
      if (err) {
        const tooBig = err.code === "LIMIT_FILE_SIZE";
        const code = err.message === "bad_mime" ? "bad_mime" : tooBig ? "file_too_large" : "upload_failed";
        return res.status(400).json({ error: code });
      }
      if (!req.file) return res.status(400).json({ error: "empty_file" });
      next();
    });
  }, async (req, res) => {
    try {
      res.status(201).json(await storeSponsorImage(pool, uploadDir, req.file));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.get("/sponsors", async (_req, res) => {
    try {
      res.json({ sponsors: await listSponsors(pool, { position: true }) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/sponsors", async (req, res) => {
    try {
      res.json({ sponsor: await createSponsor(pool, req.body || {}) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/sponsors/:id/remove", async (req, res) => {
    try {
      res.json(await removeSponsor(pool, req.params.id));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/sponsors/:id/place", async (req, res) => {
    try {
      res.json(await placeSponsor(pool, req.params.id, req.body?.position));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/sponsors/:id", async (req, res) => {
    try {
      res.json({ sponsor: await updateSponsor(pool, req.params.id, req.body || {}) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  return router;
}
