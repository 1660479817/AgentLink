#!/usr/bin/env node
// 管理员与申请的命令行。
//
//   node server/admin-cli.mjs create-admin <username>      密码从 XKNOT_ADMIN_PASSWORD 读，或交互输入
//   node server/admin-cli.mjs list-admins
//   node server/admin-cli.mjs delete-admin <username>
//   node server/admin-cli.mjs reset-password <username>    密码同样从 XKNOT_ADMIN_PASSWORD 读，或交互输入
//   node server/admin-cli.mjs list [pending|approved|rejected|hold]
//   node server/admin-cli.mjs show <id>
//   node server/admin-cli.mjs manifest <id>                打印可直接粘贴的清单条目
//   node server/admin-cli.mjs publish <id> [--id slug]     把已通过的申请写进 instances.json
//   node server/admin-cli.mjs relay-token <instance> [--label text] [--daily 50]
//                                                          签一份委托发信凭据，明文只打印这一次
//   node server/admin-cli.mjs relay-tokens                 列出凭据（不含明文）
//   node server/admin-cli.mjs relay-revoke <tokenId|instance>
//                                                          吊销一份凭据，或整个实例的全部凭据
//   node server/admin-cli.mjs relay-log [n]                最近 n 条发信记录（只有域名，没有地址和正文）
//
// 示例：
//   XKNOT_ADMIN_PASSWORD='...' node server/admin-cli.mjs create-admin paul

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { checkManifestEntry, suggestId, toManifestEntry } from "./manifest.mjs";
import { openStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDir = process.env.XKNOT_DATA_DIR || path.join(root, "var");
// 与接口共用同一个开关：本地联调/端到端可以指向一份测试清单，
// publish 也会写回那份文件，不动仓库里的实例表。
const manifestFile = process.env.XKNOT_INSTANCES_FILE
  ? path.resolve(process.env.XKNOT_INSTANCES_FILE)
  : path.join(root, "instances.json");
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
        `${item.id}  ${item.status.padEnd(8)} ${item.createdAt.slice(0, 10)}  ${item.name}  <${item.url}>  ${item.email}`
      );
    }
    const counts = store.countsByStatus();
    console.log(
      `\n待审 ${counts.pending} · 已通过 ${counts.approved} · 已拒绝 ${counts.rejected} · 搁置 ${counts.hold}`
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

    const entry = toManifestEntry(application, { id: wantedId || suggestId(application.url) });
    if (manifest.instances.some((item) => item.id === entry.id)) {
      return fail(`id "${entry.id}" 已被占用，用 --id 指定另一个`);
    }
    const problems = checkManifestEntry(entry);
    if (problems.length) {
      for (const problem of problems) console.error(`- ${problem}`);
      return fail("生成的条目过不了清单校验");
    }

    manifest.instances.push(entry);
    manifest.updatedAt = new Date().toISOString().slice(0, 10);
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`已写入 instances.json：${entry.id} → ${entry.url}`);
    console.log("下一步：npm run build，重新构建后再部署。");
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

  fail(`未知命令：${command ?? "(空)"}`);
}

main(process.argv.slice(2))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => store.close());
