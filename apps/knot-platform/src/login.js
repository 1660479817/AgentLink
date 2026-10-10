import { createHash, randomInt } from "node:crypto";
import nodemailer from "nodemailer";

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  return email;
}

export function normalizeLoginKey(value) {
  const key = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z2-9]{8}$/.test(key)) return null;
  return key;
}

export function newLoginKey() {
  let key = "";
  for (let i = 0; i < 8; i += 1) key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  return key;
}

export function hashLoginKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function mailTransport() {
  const host = process.env.SMTP_HOST || "";
  const from = process.env.MAIL_FROM || process.env.SMTP_FROM || "";
  if (!host || !from) return null;
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "1",
      auth: user ? { user, pass } : undefined,
    }),
  };
}

export async function sendLoginKey(email, key) {
  const mail = mailTransport();
  if (!mail) {
    const error = new Error("mail_unavailable");
    error.code = "mail_unavailable";
    throw error;
  }
  await mail.transport.sendMail({
    from: mail.from,
    to: email,
    subject: "Knot 登录密钥",
    text: `登录密钥：${key}\n\n十分钟内有效。登录和注册用的是同一把密钥。`,
  });
}
