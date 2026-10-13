import { Router } from "express";
import {
  bearerToken,
  isLoopbackAddress,
  listPosts,
  patrolQueue,
  recordPatrol,
  removePost,
  searchUsers,
  tokensMatch,
  warnUser,
} from "../admin.js";

function sendAdminError(res, error) {
  const code = error.code || "internal";
  if (code === "bad_user" || code === "bad_body" || code === "bad_within") return res.status(400).json({ error: code });
  if (code === "not_found") return res.status(404).json({ error: code });
  if (code === "ambiguous") return res.status(409).json({ error: code, users: error.users || [] });
  console.error(error);
  return res.status(500).json({ error: "internal" });
}

export function adminRouter({ pool, token }) {
  const router = Router();

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

  router.post("/patrol", async (req, res) => {
    try {
      res.json(await recordPatrol(pool, req.body?.body));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  return router;
}
