// 「已上线」那封信：节点验收通过后，让伙伴知道站已经通了。
//
// 独立成一份而不是塞进 worker，为了让 worker 的那份模块级 store 不跟着被 import
// 进来：这里只做「组装 → 记账 → 投递」，全程依赖注入，测试里给假 store 就行。
//
// 三条约束：
//  1. 没有 SMTP 配置只返回 skipped，不抛错：信是通知，不该让验收失败；
//  2. 用 notify_log 去重（事件 + 申请号唯一），systemd 重启不会补发第二封；
//  3. 投递失败标 failed，本次进程不重试。这不是「永远不发」：下面的去重只看
//     sent 与 pending，failed 的行下一轮 timer 会重新进到这里再发一次。
//     进程内不退避是有意的——这是个定时任务，await 36 分钟的退避会让下一轮
//     timer 叠上来，还占着 SSH 和 systemd 的时限。


import { createHash, randomBytes } from "node:crypto";

import { mailConfigFromEnv, mailErrorCode, sendMail } from "../server/mail.mjs";
import { buildMail } from "../server/notify.mjs";
import { domainOf } from "../server/relay.mjs";

/**
 * @returns {Promise<{ sent?: true, id?: number, skipped?: string, failed?: string }>}
 */
export async function notifyLive({
  store,
  application,
  origin = process.env.XKNOT_PUBLIC_ORIGIN || "https://xknot.si",
  env = process.env,
  deliver = sendMail,
} = {}) {
  if (!application) return { skipped: "no_application" };
  const config = mailConfigFromEnv(env);
  if (!config) return { skipped: "no_smtp" };

  // 先看这张单有没有发过：notify_once 的唯一索引是 (event, case_id, state_version)，
  // state_version 为 NULL 在 SQLite 里不算重复——只靠索引挡不住第二次。运营手打
  // 过 `admin-cli live` 的那一行也是 NULL，所以按事件查一遍而不是按版本号。
  const already = store
    .listNotifyLog(50, application.id || null)
    .find((row) => row.event === "partner.live" && (row.status === "sent" || row.status === "pending"));
  if (already) return { skipped: "already_sent" };

  const message = buildMail("partner.live", application, {
    origin: config.origin || origin,
    adminEmail: config.adminEmail,
    statusLabel: "up",
  });
  if (!message?.to) return { skipped: "no_recipient" };

  // Message-ID 要进 notify_log：收信端事后退信时，这是唯一能对回这件事件的线索。
  message.messageId = randomBytes(12).toString("hex");

  // 固定用 1：让唯一索引也真的起到二次保险的作用。
  const reserved = store.beginNotify({
    event: "partner.live",
    caseId: application.id || null,
    stateVersion: 1,
    locale: message.locale,
    toDomain: domainOf(message.to),
    toHash: createHash("sha256").update(message.to.toLowerCase()).digest("hex").slice(0, 16),
    templateVersion: message.templateVersion,
    messageId: message.messageId,
  });
  if (reserved.duplicate) return { skipped: "already_sent" };

  try {
    await deliver(config, {
      to: message.to,
      subject: message.subject,
      text: message.text,
      replyTo: message.replyTo,
      messageId: message.messageId,
    });
    store.finishNotify(reserved.id, { status: "sent" });
    return { sent: true, id: reserved.id };
  } catch (error) {
    // 记码不记原话：这张表不存完整地址，原话在进程日志里另有一行。
    store.finishNotify(reserved.id, { status: "failed", error: mailErrorCode(error) });
    return { failed: mailErrorCode(error) };
  }
}
