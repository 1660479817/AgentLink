import { Router } from "express";
import multer from "multer";
import {
  bearerToken,
  isIntranetAddress,
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
import { federationStatus } from "../federation.js";
import { checkSubdomain, hubOriginOf, submitApplication } from "../xknotJoin.js";
import { applyPriceProposal, economySnapshot, priceSchedule, proposePrices } from "../actuary.js";
import { attentionSnapshot } from "../attention.js";
import { touchDiscoverBoard } from "../discoverPublish.js";
import { createInvite, disableInvite, listInvites } from "../invites.js";
import { saveSystemPolicy, systemPolicyView } from "../system.js";
import { ensureUploadDir, newStorageName } from "../uploads.js";
import { tmpDir } from "../storage.js";

function sendAdminError(res, error) {
  const code = error.code || "internal";
  if (code === "bad_profile") {
    return res.status(400).json({ error: code, problems: error.problems || [] });
  }
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
    code === "sponsor_full" ||
    code === "bad_args" ||
    code === "bad_switch" ||
    code === "bad_registration_mode" ||
    code === "bad_invite_code" ||
    code === "bad_invite_uses" ||
    code === "bad_invite_expiry" ||
    code === "bad_invite_note"
  ) {
    return res.status(400).json({ error: code });
  }
  if (code === "env_unconfigured" || code === "env_failed") {
    return res.status(503).json({ error: code });
  }
  if (code === "profile_unconfigured") return res.status(503).json({ error: "profile_unconfigured" });
  if (code === "not_found") return res.status(404).json({ error: code });
  if (code === "not_pending") return res.status(409).json({ error: code });
  if (code === "name_taken") return res.status(409).json({ error: code });
  if (code === "code_taken") return res.status(409).json({ error: code });
  if (code === "ambiguous" || code === "protected") {
    return res.status(409).json({ error: code, users: error.users || undefined });
  }
  console.error(error);
  return res.status(500).json({ error: "internal" });
}

export function adminRouter({ pool, token, uploadDir, agentEnvDir = null, publicWebOrigin = "", profile = null }) {
  const router = Router();
  if (uploadDir) ensureUploadDir(uploadDir);
  const sponsorUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, tmpDir(uploadDir)),
      filename: (_req, file, cb) => cb(null, newStorageName(file.originalname)),
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) cb(null, true);
      else cb(new Error("bad_mime"));
    },
  });

  router.use((req, res, next) => {
    if (!isIntranetAddress(req.socket?.remoteAddress)) {
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

  router.get("/federation", (_req, res) => {
    try {
      res.json(federationStatus({ agentEnvDir, publicWebOrigin }));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  // 第一次接入：先问中枢一个子域能不能签。规则与结论都在中枢，
  // 这里不判断，只把请求转过去；端侧显示的文字也来自同一份结论。
  router.get("/xknot/subdomain", async (req, res) => {
    try {
      const status = federationStatus({ agentEnvDir, publicWebOrigin });
      const checked = await checkSubdomain({
        label: req.query.label,
        hubOrigin: hubOriginOf({ status }),
      });
      if (checked.error) {
        const code = checked.error;
        return res.status(code === "hub_rate_limited" ? 429 : 502).json({ error: code });
      }
      res.json(checked.result);
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  // 把自述区与选定的子域交给中枢。第一次接入与补交用的是同一个入口；
  // 已经是成员时中枢会按地址判重，这里不另做判断。
  router.post("/xknot/apply", async (req, res) => {
    try {
      const status = federationStatus({ agentEnvDir, publicWebOrigin });
      const state = profile?.view() || { site: null };
      const result = await submitApplication({
        site: state.site || {},
        subdomain: req.body?.subdomain,
        email: req.body?.email,
        locale: req.body?.locale,
        hubOrigin: hubOriginOf({ status }),
      });

      if (result.ok) return res.status(201).json({ application: result.application });
      if (result.error === "incomplete") {
        return res.status(400).json({ error: "incomplete", fields: result.fields });
      }
      if (result.error === "invalid") {
        return res.status(400).json({ error: "invalid", fields: result.fields });
      }
      if (result.error === "duplicate") return res.status(409).json({ error: "duplicate" });
      if (result.error === "rate_limited") return res.status(429).json({ error: "rate_limited" });
      return res.status(502).json({ error: result.error });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  // 站点档案：签发区只读、来自接入件；自述区可编辑，写 sites/<站点>/profile.json。
  router.get("/profile", (_req, res) => {
    const status = federationStatus({ agentEnvDir, publicWebOrigin });
    const state = profile?.view() || { site: null, updatedAt: null, problems: [] };
    res.json({
      issued: {
        id: status.running.instanceId || "",
        url: status.running.issuedUrl || String(publicWebOrigin || "").replace(/\/+$/, ""),
        since: status.running.issuedAt || "",
        tier: status.running.tier || "",
        status: status.running.status || "",
      },
      site: state.site,
      updatedAt: state.updatedAt,
      problems: state.problems,
      file: profile?.file || null,
    });
  });

  router.put("/profile", async (req, res) => {
    try {
      const state = await profile.save({ site: req.body?.site });
      res.json({
        site: state.site,
        updatedAt: state.updatedAt,
        problems: state.problems,
        file: profile.file || null,
      });
    } catch (error) {
      sendAdminError(res, error);
    }
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
      const [snapshot, attention] = await Promise.all([economySnapshot(pool), attentionSnapshot(pool)]);
      res.json({ ...snapshot, attention });
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

  router.get("/system", (_req, res) => {
    res.json({ system: systemPolicyView() });
  });

  router.patch("/system", async (req, res) => {
    try {
      const before = systemPolicyView();
      const system = await saveSystemPolicy(pool, req.body || {});
      const changed = [
        before.guestBrowsing !== system.guestBrowsing ? "站内浏览" : "",
        before.registrationMode !== system.registrationMode ? `注册=${system.registrationMode}` : "",
        before.publicBoard !== system.publicBoard ? "公开快照" : "",
      ].filter(Boolean);
      if (changed.length) {
        await pool.query(`INSERT INTO admin_actions (action, body) VALUES ('config', $1)`, [changed.join("、")]);
        if (before.guestBrowsing !== system.guestBrowsing || before.publicBoard !== system.publicBoard) {
          touchDiscoverBoard();
        }
      }
      res.json({ system });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.get("/invites", async (_req, res) => {
    try {
      res.json({ invites: await listInvites(pool) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/invites", async (req, res) => {
    try {
      const invite = await createInvite(pool, req.body || {});
      await pool.query(`INSERT INTO admin_actions (action, body) VALUES ('invite', $1)`, [`签发邀请码 ${invite.code}`]);
      res.status(201).json({ invite });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/invites/:id/disable", async (req, res) => {
    try {
      const result = await disableInvite(pool, req.params.id);
      await pool.query(`INSERT INTO admin_actions (action, body) VALUES ('invite', $1)`, [`停用邀请码 ${result.invite.code}`]);
      res.json(result);
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  return router;
}
