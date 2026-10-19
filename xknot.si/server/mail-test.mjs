#!/usr/bin/env node
// 发一封测试信，确认 SMTP 主机、端口、密码和发信地址都能用。
//
//   npm run mail:test                 # 发给 XKNOT_ADMIN_EMAIL
//   npm run mail:test -- you@example.com
//
// 只读环境变量，不打印密码。退出码 0 表示 SMTP 服务器收下了这封信。

import { createMailer, mailConfigFromEnv } from "./mail.mjs";

const config = mailConfigFromEnv();
if (!config) {
  console.error("未配置 SMTP_HOST 或 MAIL_FROM，先填 /opt/xknot/var/mail.env。");
  process.exit(1);
}

const to = process.argv[2] || config.adminEmail;
if (!to) {
  console.error("没有收件人：传一个地址，或配置 XKNOT_ADMIN_EMAIL。");
  process.exit(1);
}

const mailer = createMailer(config);
console.log(`host ${config.host}:${config.port}  secure=${config.secure ? 1 : 0}`);
console.log(`from ${config.from}`);
console.log(`to   ${to}`);

try {
  await mailer.send({
    to,
    subject: "xknot.si SMTP 测试",
    text: [
      "这是一封 xknot.si 中枢的 SMTP 测试信。",
      "",
      `时间：${new Date().toISOString()}`,
      `发信地址：${config.from}`,
      `门户：${config.origin}`,
      "",
      "收到即说明 SMTP 主机、端口、认证和发信地址都通了；SPF/DKIM/DMARC 还要看收件方原始邮件头。",
    ].join("\n"),
  });
  console.log("已交给 SMTP 服务器，检查收件箱与垃圾箱。");
} catch (error) {
  console.error(`发送失败：${error.message}`);
  process.exitCode = 1;
}
