#!/usr/bin/env node
// 管理员与申请的命令行。
//
//   node server/admin-cli.mjs create-admin <username>      密码从 XKNOT_ADMIN_PASSWORD 读，或交互输入
//   node server/admin-cli.mjs list-admins
//   node server/admin-cli.mjs delete-admin <username>
//   node server/admin-cli.mjs reset-password <username>    密码同样从 XKNOT_ADMIN_PASSWORD 读，或交互输入
//   node server/admin-cli.mjs list [approved|withdrawn]
//   node server/admin-cli.mjs show <id>
//   node server/admin-cli.mjs manifest <id>                打印可直接粘贴的清单条目
//   node server/admin-cli.mjs publish <id> [--id slug] [--tunnel-account acct --tunnel-port port]
//                                                          写清单；给了隧道参数时同时写 federation.json
//   node server/admin-cli.mjs relay-token <instance> [--label text] [--daily 50]
//                                                          签一份委托发信凭据，明文只打印这一次
//   node server/admin-cli.mjs access <id> [--id slug] [--with-relay] [--daily 50] [--out 文件]
//                                                          生成实例的接入件（env 格式，见 docs/FEDERATION.md 7.4）
//   node server/admin-cli.mjs backfill <实例 id> [--email 邮箱] [--admin 操作者]
//                                                          给清单里已有、库里没有申请单的实例补一张已通过的申请
//   node server/admin-cli.mjs relay-tokens                 列出凭据（不含明文）
//   node server/admin-cli.mjs relay-revoke <tokenId|instance>
//                                                          吊销一份凭据，或整个实例的全部凭据
//   node server/admin-cli.mjs relay-log [n]                最近 n 条发信记录（只有域名，没有地址和正文）
//   node server/admin-cli.mjs notify <id> <event> [--url URL]
//                                                          补发/重发一封伙伴信；event 见 docs/PARTNER-MAIL.md
//   node server/admin-cli.mjs handoff <id> --payload <file> [--ttl 72]
//                                                          生成一次性领取令牌并寄交付信，同时打印领取地址
//   node server/admin-cli.mjs live <id> [--status up|down] 通知伙伴实例已上线
//   node server/admin-cli.mjs contact-revalidate <id>      发联系人复验信
//   node server/admin-cli.mjs suspend <id> [--condition 文案]
//                                                          发暂停收录信（清单状态仍需自己改）
//   node server/admin-cli.mjs retire <id> [--reclaim 日期] [--export 日期]
//                                                          发退出联邦信（清单状态仍需自己改）
//   node server/admin-cli.mjs notify-log [n] [--case id]   发信日志
//
// 发信命令需要 SMTP_HOST / MAIL_FROM，读法与接口进程一致（见 server/mail.mjs）。
//
// 示例：
//   XKNOT_ADMIN_PASSWORD='...' node server/admin-cli.mjs create-admin paul

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { backfillApplication } from "./backfill.mjs";
import { createMailer, mailConfigFromEnv } from "./mail.mjs";
import { checkManifestEntry, suggestId, toManifestEntry, toRosterMember } from "./manifest.mjs";
import { validateRoster } from "../ops/validate-federation.mjs";
import { ALL_EVENTS, TEMPLATE_VERSION, buildMail } from "./notify.mjs";
import { openStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDir = process.env.XKNOT_DATA_DIR || path.join(root, "var");
// 与接口共用同一个开关：本地联调/端到端可以指向一份测试清单，
// publish 也会写回那份文件，不动仓库里的实例表。
const manifestFile = process.env.XKNOT_INSTANCES_FILE
  ? path.resolve(process.env.XKNOT_INSTANCES_FILE)
  : path.join(root, "instances.json");
const rosterFile = process.env.XKNOT_FEDERATION_FILE
  ? path.resolve(process.env.XKNOT_FEDERATION_FILE)
  : path.join(root, "federation.json");
const store = openStore(path.join(dataDir, "xknot.db"));

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function askPassword() {
  if (process.env.XKNOT_ADMIN_PASSWORD) return process.env.XKNOT_ADMIN_PASSWORD;
  if (!stdin.isTTY) return "";
  const rl = createInterface({ input: stdin, output: stdout });
  const value = await rl.question("password (>= 10 chars): ");
  rl.close();
  return value;
}

async function readManifest() {
  return JSON.parse(await readFile(manifestFile, "utf8"));
}

async function readRoster() {
  return JSON.parse(await readFile(rosterFile, "utf8"));
}

// 先写临时文件再 rename：写到一半失败时，原来的 JSON 还是完整的。
async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

function flag(rest, name, fallback = null) {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] ?? fallback : fallback;
}

function mailerFromEnv() {
  const config = mailConfigFromEnv();
  if (!config) return { error: "没有 SMTP 配置：需要 SMTP_HOST 与 MAIL_FROM" };
  return {
    config,
    mailer: createMailer(config),
    origin: config.origin,
    adminEmail: config.adminEmail,
    replyTo: String(process.env.XKNOT_MAIL_REPLY_TO || config.from).trim(),
    supportUrl: String(process.env.XKNOT_SUPPORT_URL || "").trim(),
  };
}

// 命令行发信与接口走同一套模板和同一张日志表，区别只是同步等待结果。
async function sendEvent(eventName, application, extra = {}, { dedupeVersion = null } = {}) {
  if (!ALL_EVENTS.includes(eventName)) return fail(`未知事件：${eventName}`);
  const env = mailerFromEnv();
  if (env.error) return fail(env.error);

  const message = buildMail(eventName, application, {
    origin: env.origin,
    adminEmail: env.adminEmail,
    replyTo: env.replyTo,
    supportUrl: env.supportUrl,
    ...extra,
  });
  if (!message) return fail("这封信没有收件人：检查 XKNOT_ADMIN_EMAIL 或申请单的邮箱");

  const reserved = store.beginNotify({
    event: eventName,
    caseId: application.id,
    stateVersion: dedupeVersion,
    locale: message.locale,
    toDomain: String(message.to).split("@").pop(),
    templateVersion: message.templateVersion || TEMPLATE_VERSION,
  });
  if (reserved.duplicate) {
    console.log(`同一版本已经发过 ${eventName}，跳过。`);
    return null;
  }

  try {
    await env.mailer.send(message);
    store.finishNotify(reserved.id, { status: "sent" });
    console.log(`已发送 ${eventName} → ${message.to}  《${message.subject}》`);
    return message;
  } catch (error) {
    store.finishNotify(reserved.id, { status: "failed", error: error.message });
    return fail(`发送失败：${error.message}`);
  }
}

async function main(argv) {
  const [command, ...rest] = argv;

  if (command === "create-admin") {
    const username = rest[0];
    if (!username) return fail("用法：create-admin <username>");
    const result = store.createAdmin({ username, password: await askPassword() });
    if (result.error) return fail(`建号失败：${result.error}`);
    console.log(`已创建管理员 ${result.admin.username}`);
    return;
  }

  if (command === "list-admins") {
    for (const admin of store.listAdmins()) {
      console.log(`${admin.username}\t创建 ${admin.createdAt}\t最近登录 ${admin.lastLoginAt || "—"}`);
    }
    return;
  }

  if (command === "delete-admin") {
    const result = store.deleteAdmin(rest[0]);
    if (result.error) return fail(`删除失败：${result.error}`);
    console.log(`已删除 ${rest[0]}`);
    return;
  }

  if (command === "reset-password") {
    const username = rest[0];
    if (!username) return fail("用法：reset-password <username>");
    const result = store.setPassword(username, await askPassword());
    if (result.error) return fail(`重设失败：${result.error}`);
    console.log(`已重设 ${result.admin.username} 的密码，旧会话已作废`);
    return;
  }

  if (command === "list") {
    const applications = store.listApplications({ status: rest[0] || null });
    if (!applications.length) {
      console.log("没有申请。");
      return;
    }
    for (const item of applications) {
      console.log(
        `${item.id}  ${item.status.padEnd(9)} ${item.createdAt.slice(0, 10)}  ${item.name}  <${item.url}>  ${item.email}`
      );
    }
    const counts = store.countsByStatus();
    console.log(
      `\n已通过 ${counts.approved || 0} · 已撤回 ${counts.withdrawn || 0} · 历史（拒绝/过期）${(counts.rejected || 0) + (counts.expired || 0)}`
    );
    return;
  }

  if (command === "show") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    console.log(JSON.stringify(application, null, 2));
    return;
  }

  if (command === "manifest") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    const entry = toManifestEntry(application);
    const problems = checkManifestEntry(entry);
    if (problems.length) {
      for (const problem of problems) console.error(`- ${problem}`);
      return fail("生成的条目过不了清单校验");
    }
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  if (command === "publish") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    if (application.status !== "approved") return fail("只有已通过的申请才能写进清单");

    const idFlag = rest.indexOf("--id");
    const wantedId = idFlag >= 0 ? rest[idFlag + 1] : undefined;
    const manifest = await readManifest();
    if (manifest.instances.some((item) => item.url === application.url)) {
      return fail("清单里已有同一个站点地址");
    }

    const entry = toManifestEntry(application, { id: wantedId });
    if (manifest.instances.some((item) => item.id === entry.id)) {
      return fail(`id "${entry.id}" 已被占用，用 --id 指定另一个`);
    }
    const problems = checkManifestEntry(entry);
    if (problems.length) {
      for (const problem of problems) console.error(`- ${problem}`);
      return fail("生成的条目过不了清单校验");
    }

    // 名册与清单一一对应：只写清单一半，npm run validate:federation 会立刻报错。
    // 给了隧道账号与端口就两份一起写，校验通过才落盘。
    const tunnelAccount = flag(rest, "tunnel-account");
    const tunnelPort = Number(flag(rest, "tunnel-port") || 0);
    // 旗标出现就要按名册走，不要因为端口写成非数字而静默退成只写清单。
    const withRoster = rest.includes("--tunnel-account") || rest.includes("--tunnel-port");
    let roster = null;
    if (withRoster) {
      if (!tunnelAccount) return fail("要写名册就得同时给 --tunnel-account 与 --tunnel-port。");
      if (!Number.isInteger(tunnelPort) || tunnelPort < 1024 || tunnelPort > 65535) {
        return fail("--tunnel-port 是 1024–65535 的整数。");
      }

      roster = await readRoster();
      if (roster.members.some((member) => member.id === entry.id)) {
        return fail(`名册里已有 "${entry.id}"，不要重复写。`);
      }
      roster.members.push(
        toRosterMember(entry, {
          tunnelAccount,
          tunnelPort,
          role: flag(rest, "role", "partner"),
          standing: flag(rest, "standing") || undefined,
          note: flag(rest, "note") || undefined,
        })
      );
      roster.updatedAt = new Date().toISOString().slice(0, 10);

      const rosterProblems = validateRoster(roster, { ...manifest, instances: [...manifest.instances, entry] });
      if (rosterProblems.length) {
        for (const [label, errors] of rosterProblems) {
          for (const error of errors) console.error(`- ${label || "名册"}: ${error}`);
        }
        return fail("名册校验不过，两份文件都没有改动。");
      }
    }

    manifest.instances.push(entry);
    manifest.updatedAt = new Date().toISOString().slice(0, 10);
    await writeJsonAtomic(manifestFile, manifest);
    if (roster) await writeJsonAtomic(rosterFile, roster);

    console.log(`已写入 instances.json：${entry.id} → ${entry.url}`);
    if (roster) console.log(`已写入 federation.json：${entry.id}（${tunnelAccount} / ${tunnelPort}）`);
    else console.log("名册还没写：补 --tunnel-account 与 --tunnel-port，或在 federation.json 手工加同名成员。");
    console.log("下一步：npm run build，重新构建后再部署。");
    return;
  }

  if (command === "backfill") {
    // 清单里已经有、库里却没有申请单的实例，补一张已通过的申请。
    // 只抄清单与自述区里的事实，不签发东西、不改清单。
    const id = rest[0];
    if (!id || id === "--help" || id === "-h") {
      return fail("用法：backfill <实例 id> [--email 邮箱] [--admin 操作者] [--dry-run]");
    }
    const manifest = await readManifest();
    const entry = (manifest.instances || []).find((item) => item.id === id);
    if (!entry) return fail(`清单里没有实例 "${id}"`);

    const profileFile = path.join(dataDir, "profiles", `${id}.json`);
    let profile = null;
    try {
      profile = JSON.parse(await readFile(profileFile, "utf8"));
    } catch {
      profile = null;
    }

    const email = flag(rest, "email", process.env.XKNOT_ADMIN_EMAIL || "");
    if (!email) return fail("要一个联系邮箱：加 --email，或设 XKNOT_ADMIN_EMAIL。");
    const admin = flag(rest, "admin", process.env.XKNOT_ADMIN_USER || "");

    if (rest.includes("--dry-run")) {
      const existing = store.findByUrl(entry.url);
      console.log(existing ? `已有申请单 ${existing.id}（${existing.status}），不需要补记。` : `会为 ${id} 补一张已通过的申请：${entry.url}`);
      return;
    }

    const result = backfillApplication({ store, manifest, instanceId: id, profile, email, admin });
    if (result.error === "no_instance") return fail(`清单里没有实例 "${id}"`);
    if (result.error === "no_email") return fail("要一个联系邮箱：加 --email，或设 XKNOT_ADMIN_EMAIL。");
    if (result.error === "not_hub_subdomain") return fail(`实例 "${id}" 的地址不是中枢签发的子域，不能补记：${entry.url}`);
    if (result.skipped) {
      console.log(`已有申请单 ${result.application.id}（${result.application.status}），没有改动。`);
      return;
    }
    const { application } = result;
    console.log(`已补记申请 ${application.id}：${application.name} → ${application.url}`);
    console.log(`状态 ${application.status}（按 instances.json 补记于 ${application.reviewedAt?.slice(0, 10)}）`);
    console.log(`下一步：node server/admin-cli.mjs access ${application.id} --id ${id}`);
    return;
  }

  if (command === "access") {
    // 生成伙伴实例要的接入件：只有中枢签发的东西，不含部署拓扑。
    // 格式是 env 文件，键名与语义见 docs/FEDERATION.md 第 7.4 节；
    // 实例把它存进自己的配置即可，用什么文件名、放哪个目录是它自己的事。
    const id = rest[0];
    if (!id || id === "--help" || id === "-h") {
      return fail("用法：access <申请编号> [--id 实例 id] [--with-relay] [--daily 50] [--out 文件]");
    }
    const application = store.getApplication(id);
    if (!application) return fail("没有这条申请");
    if (application.status !== "approved") {
      return fail(`申请当前是 ${application.status}；接入件只发给已通过的申请。`);
    }

    const instanceId = flag(rest, "id", application.subdomain || suggestId(application.url));
    const manifest = await readManifest();
    const instance = manifest.instances.find((item) => item.id === instanceId);
    if (!instance) return fail(`清单里没有实例 "${instanceId}"。先 publish，再发接入件。`);
    // 收录时是 pending，接通验收后才 active：接入件必须在 pending 阶段就能发，
    // 否则伙伴拿不到隧道凭据，永远等不到 active。挂起与退出之后不再签。
    if (!["pending", "active"].includes(instance.status)) {
      return fail(`实例 "${instanceId}" 当前是 ${instance.status}，不再发接入件。`);
    }

    const origin = String(process.env.XKNOT_PUBLIC_ORIGIN || "https://xknot.si").replace(/\/+$/, "");
    const today = new Date().toISOString().slice(0, 10);
    const lines = [
      "# XKnot 接入件。键名与语义见 FEDERATION.md 第 7.4 节；由实例存进自己的配置。",
      `# 实例 ${instanceId} · 申请 ${application.id} · ${today}`,
      `XKNOT_INSTANCE_ID=${instanceId}`,
      `XKNOT_ISSUED_URL=${instance.url}`,
      `XKNOT_ISSUED_AT=${instance.since || today}`,
      `XKNOT_TIER=${instance.tier || "free"}`,
      `XKNOT_STATUS=${instance.status || "active"}`,
      `XKNOT_HUB_ORIGIN=${origin}`,
    ];

    if (rest.includes("--with-relay")) {
      const daily = Number(flag(rest, "daily", 50)) || 50;
      // 重签即作废：每跑一次 access 都会发出去一份新件，旧件留着就是一把没人回收的钥匙。
      // 作废与新签在同一个事务里，见 store.rotateRelayToken。
      const issued = store.rotateRelayToken({
        instanceId,
        label: flag(rest, "label", `partner ${application.id}`),
        dailyLimit: daily,
        createdBy: process.env.XKNOT_ADMIN_USER || null,
      });
      if (issued.error) return fail(`签发委托发信凭据失败：${issued.error}`);
      if (issued.revoked.length) console.error(`已作废旧委托发信凭据 ${issued.revoked.join("、")}。`);
      // 发信地址按契约从中枢地址推导，不写进来：少一项就少一处对不上。
      lines.push(`XKNOT_HUB_RELAY_TOKEN=${issued.token}`);
      console.error(`已签委托发信凭据 ${issued.record.id}，每日上限 ${issued.record.dailyLimit}。`);
    } else {
      lines.push("# 不带 --with-relay 时没有发信凭据。实例可以先用本机 SMTP。", "# XKNOT_HUB_RELAY_TOKEN=");
    }

    const out = flag(rest, "out");
    const text = `${lines.join("\n")}\n`;
    if (out) {
      await writeFile(path.resolve(out), text, { mode: 0o600 });
      console.log(`写入 ${path.resolve(out)}（权限 600）。用一次性领取交给伙伴，不要贴进聊天或邮件。`);
    } else {
      console.log(text.trimEnd());
    }
    return;
  }

  if (command === "relay-token") {
    const instanceId = rest[0];
    if (!instanceId) return fail("用法：relay-token <instance> [--label text] [--daily 50]");
    const manifest = await readManifest();
    const instance = manifest.instances.find((item) => item.id === instanceId);
    if (!instance) return fail(`清单里没有实例 "${instanceId}"`);
    if (instance.status !== "active") return fail(`实例 "${instanceId}" 不是 active，先改清单状态`);

    const labelIndex = rest.indexOf("--label");
    const dailyIndex = rest.indexOf("--daily");
    const result = store.createRelayToken({
      instanceId,
      label: labelIndex >= 0 ? rest[labelIndex + 1] : "",
      dailyLimit: dailyIndex >= 0 ? Number(rest[dailyIndex + 1]) : 50,
      createdBy: process.env.XKNOT_ADMIN_USER || null,
    });
    if (result.error) return fail(`签发失败：${result.error}`);
    console.log(`凭据 ${result.record.id} 已签给 ${instanceId}，每日上限 ${result.record.dailyLimit}`);
    console.log("明文只显示这一次，请直接写进实例的 XKNOT_HUB_RELAY_TOKEN：");
    console.log(result.token);
    console.log("\n吊销：node server/admin-cli.mjs relay-revoke " + result.record.id);
    return;
  }

  if (command === "relay-tokens") {
    const tokens = store.listRelayTokens();
    if (!tokens.length) {
      console.log("还没有委托发信凭据。");
      return;
    }
    for (const token of tokens) {
      const state = token.revokedAt ? `已吊销 ${token.revokedAt.slice(0, 10)}` : "有效";
      console.log(
        `${token.id}  ${token.instanceId.padEnd(16)} ${state.padEnd(16)} 每日 ${token.dailyLimit}  最近使用 ${token.lastUsedAt || "—"}  ${token.label || ""}`
      );
    }
    return;
  }

  if (command === "relay-revoke") {
    const result = store.revokeRelayToken(rest[0]);
    if (result.error) return fail(`吊销失败：${result.error}`);
    console.log(`已吊销 ${result.revoked} 份凭据（${result.instanceId}）`);
    return;
  }

  if (command === "relay-log") {
    const rows = store.listRelayLog(Number(rest[0]) || 50);
    if (!rows.length) {
      console.log("还没有发信记录。");
      return;
    }
    for (const row of rows) {
      console.log(
        `#${String(row.seq).padEnd(6)} ${row.at.slice(0, 19)}  ${row.instanceId.padEnd(16)} ${row.status.padEnd(9)} ${row.toDomain || "—"}${row.error ? `  ${row.error}` : ""}`
      );
    }
    return;
  }

  if (command === "notify") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    const eventName = rest[1];
    if (!eventName) return fail(`用法：notify <id> <event>，可选 ${ALL_EVENTS.join(" / ")}`);

    const links = {};
    if (eventName === "partner.contact_revalidate") {
      const env = mailerFromEnv();
      links.confirmUrl = `${env.origin}/case/${application.caseKey}`;
    }
    await sendEvent(eventName, application, { links }, {});
    return;
  }

  if (command === "handoff") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    if (application.status !== "approved") return fail("只有已通过的申请才能交付");
    const file = flag(rest, "payload");
    if (!file) return fail("用法：handoff <id> --payload <file> [--ttl 72]");
    const payload = (await readFile(path.resolve(file), "utf8")).trim();
    if (!payload) return fail("payload 文件是空的");
    if (payload.length > 8000) return fail("payload 超过 8000 字，请精简后再交付");

    const claim = store.createClaimToken({
      applicationId: application.id,
      payload,
      ttlHours: Math.min(Math.max(Number(flag(rest, "ttl", 72)) || 72, 1), 168),
      createdBy: process.env.XKNOT_ADMIN_USER || null,
    });
    if (claim.error) return fail(`生成领取令牌失败：${claim.error}`);

    const env = mailerFromEnv();
    const claimUrl = `${env.origin}/claim/${claim.token}`;
    const message = await sendEvent("partner.handoff", application, { links: { claimUrl } }, {});
    if (!message) return;
    console.log(`领取地址（只显示这一次，链接 72 小时后失效）：\n${claimUrl}`);
    console.log(`领取记录 ${claim.id}，过期于 ${claim.expiresAt}`);
    return;
  }

  if (command === "live") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    await sendEvent(
      "partner.live",
      application,
      { statusLabel: flag(rest, "status", "up") },
      {}
    );
    return;
  }

  if (command === "contact-revalidate") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    const env = mailerFromEnv();
    await sendEvent(
      "partner.contact_revalidate",
      application,
      { links: { confirmUrl: `${env.origin}/case/${application.caseKey}` } },
      {}
    );
    return;
  }

  if (command === "suspend") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    await sendEvent(
      "partner.suspended",
      application,
      {
        resumeCondition:
          flag(rest, "condition", "按暂停通知里列出的条件整改后，回复复验申请") ||
          "按暂停通知里列出的条件整改后，回复复验申请",
      },
      {}
    );
    console.log("提醒：instances.json 的状态与隧道账号不会自动改，按 ops 的暂停步骤处理。");
    return;
  }

  if (command === "retire") {
    const application = store.getApplication(rest[0]);
    if (!application) return fail("没有这条申请");
    const today = new Date();
    const plus = (days) => new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
    await sendEvent(
      "partner.retired",
      application,
      { reclaimAt: flag(rest, "reclaim", plus(30)), exportUntil: flag(rest, "export", plus(30)) },
      {}
    );
    console.log("提醒：instances.json 的状态、DNS 记录与证书要按退役清单另行处理。");
    return;
  }

  if (command === "notify-log") {
    const rows = store.listNotifyLog(Number(rest[0]) || 50, flag(rest, "case"));
    if (!rows.length) {
      console.log("还没有发信记录。");
      return;
    }
    for (const row of rows) {
      console.log(
        `#${String(row.seq).padEnd(6)} ${row.at.slice(0, 19)}  ${(row.caseId || "—").padEnd(14)} ${row.event.padEnd(
          30
        )} ${row.status.padEnd(9)} ${row.toDomain || "—"}${row.error ? `  ${row.error}` : ""}`
      );
    }
    return;
  }

  fail(`未知命令：${command ?? "(空)"}`);
}

main(process.argv.slice(2))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => store.close());
