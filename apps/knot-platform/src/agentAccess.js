import { normalizeEmail } from "./login.js";

export function suppliedAgentEmail(emailRaw) {
  if (emailRaw == null) return { email: "" };
  const text = String(emailRaw).trim();
  if (!text) return { email: "" };
  const email = normalizeEmail(text);
  if (!email) return { error: "bad_email", status: 400 };
  return { email };
}

export function decideAgentAccess(account, email) {
  if (!account?.id) return { error: "bad_token", status: 401 };
  const accountEmail = normalizeEmail(account.email) || "";
  if (account.side === "internal") {
    if (email && email !== accountEmail) return { error: "bad_token", status: 401 };
    return { userId: account.id, email: accountEmail };
  }
  if (!email) return { error: "bad_email", status: 400 };
  if (email !== accountEmail) return { error: "bad_token", status: 401 };
  return { userId: account.id, email: accountEmail };
}
