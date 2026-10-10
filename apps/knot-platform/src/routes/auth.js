import { Router } from "express";
import {
  CODE_TTL_MS,
  SESSION_TTL_MS,
  decideSend,
  decideVerify,
  hashLoginCode,
  newLoginCode,
  newSessionId,
} from "../lib/auth-codes.js";
import { isPlausibleEmail, normalizeEmail } from "../lib/email.js";
import { issueAgentToken } from "../lib/agent-tokens.js";
import { sendLoginCodeMail } from "../mail/send.js";
import { requireUser } from "../middleware/auth.js";
import {
  clearSessionCookie,
  setSessionCookie,
} from "../middleware/session.js";
import { loadPlatformSettings, smtpFromPlatform } from "../system-config.js";

export function authRouter({ pool, sessionCookieName }) {
  const router = Router();

  router.post("/request", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!isPlausibleEmail(email)) {
      return res.status(400).json({ error: "bad_email" });
    }
    const now = Date.now();
    const { rows } = await pool.query("SELECT * FROM auth_codes WHERE email = $1", [
      email,
    ]);
    const row = rows[0];
    const send = decideSend(row, now);
    if (!send.ok) {
      return res.status(429).json({ error: send.reason });
    }
    const code = newLoginCode();
    const expiresAt = now + CODE_TTL_MS;
    await pool.query(
      `INSERT INTO auth_codes (email, code_hash, expires_at, attempts, sent_at, send_count_hour, hour_started_at)
       VALUES ($1, $2, $3, 0, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         sent_at = EXCLUDED.sent_at,
         send_count_hour = EXCLUDED.send_count_hour,
         hour_started_at = EXCLUDED.hour_started_at`,
      [
        email,
        hashLoginCode(email, code),
        expiresAt,
        now,
        send.sendCountHour,
        send.hourStartedAt,
      ]
    );
    const platform = req.platform || (await loadPlatformSettings(pool));
    const smtp = smtpFromPlatform(platform);
    try {
      await sendLoginCodeMail({ smtp, to: email, code });
    } catch (e) {
      console.error("[knot-mail:smtp]", e.message);
      return res.status(502).json({ error: "smtp_failed" });
    }
    res.json({ ok: true, dev: !smtp.host });
  });

  router.post("/verify", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = req.body?.code;
    if (!isPlausibleEmail(email)) {
      return res.status(400).json({ error: "bad_email" });
    }
    const now = Date.now();
    const { rows } = await pool.query("SELECT * FROM auth_codes WHERE email = $1", [
      email,
    ]);
    const row = rows[0];
    const verdict = decideVerify(row, email, code, now);
    if (!verdict.ok) {
      if (verdict.bump) {
        await pool.query(
          "UPDATE auth_codes SET attempts = attempts + 1 WHERE email = $1",
          [email]
        );
      }
      const status = verdict.reason === "expired" ? 410 : 401;
      return res.status(status).json({ error: verdict.reason });
    }
    await pool.query("DELETE FROM auth_codes WHERE email = $1", [email]);

    let userId;
    const userRes = await pool.query("SELECT id, status FROM users WHERE email = $1", [
      email,
    ]);
    if (userRes.rows[0]) {
      userId = userRes.rows[0].id;
      await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [userId]);
    } else {
      const ins = await pool.query(
        "INSERT INTO users (email, status) VALUES ($1, 'active') RETURNING id",
        [email]
      );
      userId = ins.rows[0].id;
    }

    const sid = newSessionId();
    const expiresAt = now + SESSION_TTL_MS;
    await pool.query(
      "INSERT INTO sessions (sid, user_id, expires_at) VALUES ($1, $2, $3)",
      [sid, userId, expiresAt]
    );
    setSessionCookie(res, sessionCookieName, sid, expiresAt);
    res.json({ ok: true, user: { id: userId, email } });
  });

  router.post("/logout", async (req, res) => {
    const sid = req.cookies?.[sessionCookieName];
    if (sid) {
      await pool.query("DELETE FROM sessions WHERE sid = $1", [sid]);
    }
    clearSessionCookie(res, sessionCookieName);
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: req.user });
  });

  router.get("/tokens", requireUser, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT token_id, label, status, token_last4, created_at, last_used_at
       FROM agent_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ tokens: rows });
  });

  router.post("/tokens", requireUser, async (req, res) => {
    const label = req.body?.label ? String(req.body.label).slice(0, 80) : null;
    const issued = await issueAgentToken(pool, req.user.id, req.user.email, label);
    res.status(201).json({
      token: issued.token,
      tokenId: issued.tokenId,
      tokenLast4: issued.tokenLast4,
    });
  });

  async function revokeToken(req, res) {
    const tokenId = req.params.tokenId;
    const { rowCount } = await pool.query(
      `UPDATE agent_tokens SET status = 'revoked'
       WHERE token_id = $1 AND user_id = $2 AND status = 'active'`,
      [tokenId, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  }

  router.delete("/tokens/:tokenId", requireUser, revokeToken);
  router.post("/tokens/:tokenId/revoke", requireUser, revokeToken);

  return router;
}
