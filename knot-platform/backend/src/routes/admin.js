import { Router } from "express";
import path from "node:path";
import multer from "multer";
import {
  adminDoorAddress,
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
  listAccountRoster,
  listAgents,
  readManagedAgentToken,
  retireManagedAgent,
  rotateManagedAgentToken,
  setEntitlements,
  setLevel,
  tokensMatch,
  unmuteUser,
  updateManagedAccount,
  warnUser,
  writeAction,
} from "../admin.js";
import { parseLocale } from "@knot/locale";
import { createSponsor, listSponsors, placeSponsor, removeSponsor, storeSponsorImage, updateSponsor } from "../sponsors.js";
import { federationStatus } from "../federation.js";
import { joinStatePath, readJoinState, saveJoinState } from "../joinState.js";
import { checkSubdomain, hubOriginOf, pinnedCaseUrl, submitApplication } from "../xknotJoin.js";
import {
  applyManagedBlock,
  ensureTunnelKey,
  fetchProgress,
  handoffValid,
  renderManagedBlock,
  scheduleTunnelRestart,
  submitPublicKey,
  tunnelEnvPath,
  tunnelKeyPath,
  tunnelUnitInstalled,
} from "../tunnel.js";
import {
  backendUnit,
  issuedValid,
  joinEnvPath,
  joinValues,
  readRelayValues,
  scheduleRestart,
  writeJoinEnv,
} from "../issued.js";
import { applyPriceProposal, economySnapshot, priceSchedule, proposePrices } from "../actuary.js";
import { attentionSnapshot } from "../attention.js";
import { touchDiscoverBoard } from "../discoverPublish.js";
import { createInvite, disableInvite, listInvites } from "../invites.js";
import { installSystemPolicy, saveSystemPolicy, systemPolicyView } from "../system.js";
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
    code === "bad_bio" ||
    code === "empty_body" ||
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
  if (code === "env_unconfigured" || code === "env_failed" || code === "owner_unconfigured") {
    return res.status(503).json({ error: code });
  }
  if (code === "profile_unconfigured") return res.status(503).json({ error: "profile_unconfigured" });
  if (code === "not_found") return res.status(404).json({ error: code });
  if (code === "not_pending") return res.status(409).json({ error: code });
  if (code === "name_taken") return res.status(409).json({ error: code });
  // 令牌只在授权码文件里；文件不在了就只有重新签发一条路可走。
  if (code === "token_unavailable") return res.status(409).json({ error: code });
  if (code === "agent_slots_full" || code === "users_full") {
    return res.status(409).json({ error: code });
  }
  // not_internal 是越权：外部 Agent 的码归它的主人，管理端不读。
  if (code === "not_internal" || code === "bad_owner" || code === "not_account") {
    return res.status(code === "not_internal" ? 403 : 400).json({ error: code });
  }
  // 内部 Agent 自己拿着令牌不能改称呼；外部账号的资料只读。
  if (code === "name_locked" || code === "not_editable") return res.status(403).json({ error: code });
  if (code === "code_taken") return res.status(409).json({ error: code });
  if (code === "ambiguous" || code === "protected") {
    return res.status(409).json({ error: code, users: error.users || undefined });
  }
  console.error(error);
  return res.status(500).json({ error: "internal" });
}

// 隧道落回本机的端口：入口的回环端口转到这里，所以它必须是 Backend 自己监听的端口。
// 不能从 PUBLIC_WEB_ORIGIN 猜：接上 XKnot 之后那个 origin 是入口上的 https 地址，
// 没有端口，猜出来只会是 443，而实例这一侧 443 上什么都没有。
export function tunnelLocalPort(port, env = process.env) {
  const listen = Number(port);
  if (Number.isInteger(listen) && listen > 0) return listen;
  const fromEnv = Number(env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return 8080;
}

// 没有常驻单元时给管理员照抄的一条命令。
const TUNNEL_MANUAL_COMMAND = "bash ops/scripts/run-entry-tunnel.sh";

// 生成（或复用）隧道密钥并把公钥交到案例页。私钥留在 sites/<站点>/，权限 600。
// hubOrigin 用来钉住案例地址：只对配置的那一个中枢发请求。
async function deliverPublicKey({ profile, application, hubOrigin = "" }) {
  const siteDir = profile?.file ? path.dirname(profile.file) : null;
  if (!siteDir || !application?.caseUrl) return null;
  const key = await ensureTunnelKey({
    file: tunnelKeyPath(siteDir),
    comment: `knot-tunnel-${process.env.KNOT_SITE || "site"}`,
  });
  if (key.error) return key;
  const submitted = await submitPublicKey({ caseUrl: application.caseUrl, publicKey: key.publicKey, hubOrigin });
  return { ...submitted, created: key.created };
}

// 公钥这一步的结果压成三个字段：交没交上、是不是新生成的、失败原因。
function keyStatus(result) {
  if (!result) return { delivered: false, created: false, error: "no_application" };
  return { delivered: !result.error, created: Boolean(result.created), error: result.error || "" };
}

export function adminRouter({
  pool,
  token,
  handoff = null,
  uploadDir,
  agentEnvDir = null,
  publicWebOrigin = "",
  profile = null,
  port = 0,
}) {
  const router = Router();
  const localPort = tunnelLocalPort(port);
  if (uploadDir) ensureUploadDir(uploadDir);
  const sponsorUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, tmpDir(uploadDir)),
      filename: (_req, file, cb) => cb(null, newStorageName(file.originalname)),
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 10, parts: 20 },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) cb(null, true);
      else cb(new Error("bad_mime"));
    },
  });

  // 票据兑换：主理人在站点域名上已经登录，从「我的」页拿到一枚一次性票据，
  // 到这里换成这枚 30 天的管理凭据。它必须注册在下面的令牌中间件之前——
  // 它就是「还没有凭据」的那一步。内网检查与其余端点一致；公网入口那一段
  // nginx 本来就不会把 /api/admin 送到实例，所以这里只是第二道相同的门。
  router.post("/handoff/claim", (req, res) => {
    if (!isIntranetAddress(adminDoorAddress(req))) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!handoff?.configured) return res.status(503).json({ error: "admin_unconfigured" });
    const claimed = handoff.claim(req.body?.ticket);
    if (!claimed) return res.status(401).json({ error: "bad_ticket" });
    res.set("Cache-Control", "no-store");
    res.json(claimed);
  });

  router.use((req, res, next) => {
    if (!isIntranetAddress(adminDoorAddress(req))) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!String(token || "").trim()) {
      return res.status(503).json({ error: "admin_unconfigured" });
    }
    // 两种凭据：从 WebUI 换来的 30 天管理凭据（只有这里认），或原来的主令牌
    // （OpenClaw 的 knot-admin 技能与应急 SSH 都还在用）。主令牌始终不出服务器。
    const presented = bearerToken(req.headers.authorization);
    if (handoff && handoff.verifyAdminSession(presented)) return next();
    if (!tokensMatch(String(token).trim(), presented)) {
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

  // 已经交过哪一张单：编号与案例链接只在中枢的 201 响应里出现一次，
  // 记在站点目录里，刷新页面后还能接着看进度。邮件只是通知。
  router.get("/xknot/application", async (_req, res) => {
    const file = joinStatePath(profile?.file);
    const state = await readJoinState(file);
    res.json({ application: state?.application || null, file });
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
        // 中枢用这一项选邮件语言。界面不传时用站点自己的默认语种，不另猜。
        locale: parseLocale(req.body?.locale) || state.site?.locale,
        hubOrigin: hubOriginOf({ status }),
      });

      if (result.ok) {
        // 底账写失败不影响这次申请：中枢那边已经受理，页面仍要拿到编号。
        const file = joinStatePath(profile?.file);
        // caseUrl 只留指向这个中枢的：远端把它改成内网地址时，本地不认（S12-02）。
        const hub = hubOriginOf({ status });
        const application = result.application
          ? { ...result.application, caseUrl: pinnedCaseUrl(result.application.caseUrl, hub) }
          : result.application;
        await saveJoinState(file, application).catch((error) => {
          console.error("join state:", error.message);
        });
        // 公钥是前置阶段唯一的输入：提交成功就顺手生成并交上去，
        // 这一步失败不回滚申请（案例页仍可手工补交），进度里会显示缺什么。
        // 结果一并回给界面：申请被受理、公钥却没收下时，人要知道该补哪一步，
        // 不能只留一行日志等人去翻（S12-08）。
        const key = await deliverPublicKey({ profile, application, hubOrigin: hub }).catch((error) => {
          console.error("tunnel key:", error.message);
          return { error: "keygen_failed" };
        });
        return res.status(201).json({ application: result.application, key: keyStatus(key) });
      }
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

  // ---- 自动接通（端侧） ----
  //
  // 中枢拨不进 NAT 后的实例，所以这里每一个动作都由实例主动发起：
  // 交公钥、读进度、拿到账号与端口后写隧道配置并重启。

  router.post("/xknot/tunnel-key", async (_req, res) => {
    try {
      const file = joinStatePath(profile?.file);
      const state = await readJoinState(file);
      if (!state?.application?.caseUrl) return res.status(409).json({ error: "no_application" });
      const status = federationStatus({ agentEnvDir, publicWebOrigin });
      const result = await deliverPublicKey({
        profile,
        application: state.application,
        hubOrigin: hubOriginOf({ status }),
      });
      if (!result) return res.status(503).json({ error: "profile_unconfigured" });
      if (result.error) return res.status(502).json({ error: result.error, status: result.status });
      res.json({ ok: true, created: Boolean(result.created) });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.get("/xknot/progress", async (_req, res) => {
    try {
      const state = await readJoinState(joinStatePath(profile?.file));
      if (!state?.application?.caseUrl) {
        return res.json({ application: null, run: null, handoff: null });
      }
      // 只向配置的中枢读进度：join.json 里的 caseUrl 可能是被改过的（S12-02）。
      const hubOrigin = hubOriginOf({ status: federationStatus({ agentEnvDir, publicWebOrigin }) });
      const result = await fetchProgress({ caseUrl: state.application.caseUrl, hubOrigin });
      if (result.error) {
        return res.status(502).json({ error: result.error, application: state.application });
      }

      const local = {
        tunnelEnv: profile?.file ? tunnelEnvPath(path.dirname(profile.file)) : null,
        keyFile: profile?.file ? tunnelKeyPath(path.dirname(profile.file)) : null,
        changed: false,
        restart: null,
        error: null,
      };

      // 中枢把账号、端口、入口主机给出来之后，不必等人再点一次：
      // 这一步是幂等的，写进去的内容一样时 changed 为 false，不会反复重启隧道。
      const handoff = result.data?.handoff;
      if (handoffValid(handoff) && local.tunnelEnv) {
        const block = renderManagedBlock({
          account: handoff.account,
          host: handoff.host,
          port: Number(handoff.port),
          localPort,
        });
        const applied = await applyManagedBlock({ file: local.tunnelEnv, block });
        if (applied.error) local.error = applied.error;
        else {
          local.changed = applied.changed;
          if (applied.changed) {
            // 这一页很可能就是经隧道打开的：在这里重启等于把回包一起掐掉。
            scheduleTunnelRestart();
            const installed = await tunnelUnitInstalled();
            local.restart = { ok: installed, deferred: true, command: TUNNEL_MANUAL_COMMAND };
          }
        }
      }

      // 验收通过之后，把接入件写到站点目录：/api/federation/profile 与门户上的档案
      // 都靠它。写进去还要重启 Backend 才生效，所以只在内容真的变了时重启一次。
      if (result.data?.run?.state === "active" && issuedValid(result.data.issued) && profile?.file) {
        const siteDir = path.dirname(profile.file);
        // 接入件里的中枢地址用校验过的那个，不从 caseUrl 现算：它可能是被改过的数据。
        // 自动接通不签发委托发信凭据：文件里已有的那两项原样带过去，别抹掉。
        const relay = await readRelayValues(joinEnvPath(siteDir));
        const written = await writeJoinEnv({
          file: joinEnvPath(siteDir),
          values: joinValues({ issued: result.data.issued, hubOrigin, ...relay }),
        });
        if (written.error) local.joinError = written.detail || written.error;
        else if (written.changed) {
          local.joined = true;
          // 进程里的值是启动时读的，接入件要生效必须重启。
          // 但别在这里等它：重启会掐断这次响应，面板只会看到断线。
          const unit = await backendUnit();
          local.restart = { ok: unit.installed, command: unit.command, deferred: true };
          if (unit.installed) scheduleRestart();
        }
      }

      res.json({ ...result.data, local });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  // 中枢给出账号、端口与入口主机之后，写托管段并重启隧道。
  // 只写 tunnel.env：那里的键固定几个、值都过格式校验；site.env 仍归 deploy-site.sh。
  router.post("/xknot/connect", async (_req, res) => {
    try {
      const state = await readJoinState(joinStatePath(profile?.file));
      if (!state?.application?.caseUrl) return res.status(409).json({ error: "no_application" });
      const siteDir = profile?.file ? path.dirname(profile.file) : null;
      if (!siteDir) return res.status(503).json({ error: "profile_unconfigured" });

      const hubOrigin = hubOriginOf({ status: federationStatus({ agentEnvDir, publicWebOrigin }) });
      const result = await fetchProgress({ caseUrl: state.application.caseUrl, hubOrigin });
      if (result.error) return res.status(502).json({ error: result.error });
      const handoff = result.data?.handoff;
      if (!handoffValid(handoff)) return res.status(409).json({ error: "not_ready", run: result.data?.run || null });

      const block = renderManagedBlock({
        account: handoff.account,
        host: handoff.host,
        port: Number(handoff.port),
        localPort,
      });
      const applied = await applyManagedBlock({ file: tunnelEnvPath(siteDir), block });
      if (applied.error) return res.status(500).json({ error: applied.error });
      // 内容没变就别重启：重启会掐断这一页（它可能正走这条隧道）。
      if (!applied.changed) return res.json({ ok: true, changed: false, restart: null });
      scheduleTunnelRestart();
      const installed = await tunnelUnitInstalled();
      res.json({
        ok: true,
        changed: true,
        restart: { ok: installed, deferred: true, command: TUNNEL_MANUAL_COMMAND },
      });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  // 站点档案：签发区只读、来自接入件；自述区可编辑，写 sites/<站点>/profile.json。
  // 两个方法回同一份视图：保存之后表单要立刻拿到签发区，不能等下一次 GET。
  function profileView() {
    const status = federationStatus({ agentEnvDir, publicWebOrigin });
    const state = profile?.view() || { site: null, updatedAt: null, problems: [] };
    return {
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
    };
  }

  router.get("/profile", (_req, res) => {
    res.json(profileView());
  });

  router.put("/profile", async (req, res) => {
    try {
      if (!profile) return res.status(503).json({ error: "profile_unconfigured" });
      await profile.save({ site: req.body?.site });
      res.json(profileView());
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

  // 管理端用户栏的默认视图：平台账号、内部账号、外部账号，各自带着名下的 Agent。
  router.get("/accounts", async (_req, res) => {
    try {
      res.json(await listAccountRoster(pool));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  // 改主理人与内部 Agent 的身份资料。外部账号与外部 Agent 在这里一律 403。
  router.post("/accounts/:id/profile", async (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};
      if (Object.hasOwn(body, "displayName")) patch.displayName = body.displayName;
      if (Object.hasOwn(body, "bio")) patch.bio = body.bio;
      if (Object.hasOwn(body, "specialties")) patch.specialties = body.specialties;
      res.json(await updateManagedAccount(pool, req.params.id, patch, { envDir: agentEnvDir }));
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

  router.get("/agents", async (_req, res) => {
    try {
      res.json(await listAgents(pool));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  // 明文令牌只在授权码文件里：选中内部 Agent 时读这一份，给管理员复制。
  // 回的是明文，不让浏览器或中间代理留下这份响应。
  router.get("/agents/:id/token", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const found = await readManagedAgentToken(pool, req.params.id, { envDir: agentEnvDir });
      // 明文等于那把 30 天有效的管理凭据：每读一次记一条流水，
      // 真泄漏时至少能看出谁在什么时候把它取走了（S13-10）。
      // 记不下来就不给：没有痕迹的读取比读不到更糟。
      await writeAction(pool, {
        action: "config",
        accountId: found.id,
        body: `读取内部 Agent「${found.id}」的明文令牌`,
      });
      res.json(found);
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  // 重新签发：旧码作废，新码写回授权文件。
  router.post("/agents/:id/token/rotate", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await rotateManagedAgentToken(pool, req.params.id, { envDir: agentEnvDir }));
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/agents/:id/retire", async (req, res) => {
    try {
      res.json(await retireManagedAgent(pool, req.params.id, req.body?.body, { envDir: agentEnvDir }));
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
      res.json(await recordPatrol(pool, req.body?.body, req.body?.through));
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

  // 业务变更与 admin_actions 在同一事务里提交：审计写失败时不能留下已经生效的
  // 配置或邀请码，还让管理端以为没成功（S12-11）。
  async function auditedWrite(action, work, bodyText) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      const body = bodyText(result);
      if (body) await client.query(`INSERT INTO admin_actions (action, body) VALUES ($1, $2)`, [action, body]);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  router.get("/system", (_req, res) => {
    res.json({ system: systemPolicyView() });
  });

  router.patch("/system", async (req, res) => {
    const before = systemPolicyView();
    try {
      let changed = [];
      // saveSystemPolicy 只认 query，事务客户端也一样用；配置与流水一起提交。
      const system = await auditedWrite(
        "config",
        async (client) => {
          const saved = await saveSystemPolicy(client, req.body || {});
          changed = [
            before.guestBrowsing !== saved.guestBrowsing ? "站内浏览" : "",
            before.registrationMode !== saved.registrationMode ? `注册=${saved.registrationMode}` : "",
            before.publicBoard !== saved.publicBoard ? "公开快照" : "",
          ].filter(Boolean);
          return saved;
        },
        () => (changed.length ? changed.join("、") : "")
      );
      // 事务回滚过就说明配置没落下，touchDiscoverBoard 也不能跑。
      if (changed.length && (before.guestBrowsing !== system.guestBrowsing || before.publicBoard !== system.publicBoard)) {
        touchDiscoverBoard();
      }
      res.json({ system });
    } catch (error) {
      // saveSystemPolicy 已经改过进程里的那份，回滚后要改回去。
      installSystemPolicy(before);
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
      const invite = await auditedWrite(
        "invite",
        (client) => createInvite(client, req.body || {}),
        (result) => `签发邀请码 ${result.code}`
      );
      res.status(201).json({ invite });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post("/invites/:id/disable", async (req, res) => {
    try {
      const result = await auditedWrite(
        "invite",
        (client) => disableInvite(client, req.params.id),
        (value) => `停用邀请码 ${value.invite.code}`
      );
      res.json(result);
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  return router;
}
