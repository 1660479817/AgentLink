import nodemailer from "nodemailer";

export async function sendLoginCodeMail({ smtp, to, code }) {
  const subject = "Knot 登录验证码";
  const text = `您的验证码是：${code}\n10 分钟内有效。`;
  const html = `<p>您的 Knot 登录验证码：<strong>${code}</strong></p><p>10 分钟内有效。</p>`;
  if (!smtp.host) {
    console.log("[knot-mail:dev]", { to, code, subject });
    return { ok: true, dev: true };
  }
  const secure =
    smtp.secure === true || (smtp.secure !== false && Number(smtp.port) === 465);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
  });
  await transport.sendMail({ from: smtp.from, to, subject, text, html });
  return { ok: true };
}
