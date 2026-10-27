#!/usr/bin/env node
// 探一次数据库：只连一次、只跑 SELECT 1，把失败翻译成一句能照做的说明。
//
// 目标机不需要装 psql：这里用的是发布包自带的生产依赖（node_modules/pg）。
// external 模式的硬门禁就靠它——部署脚本在解包之前先连一次，连不上就停下，
// 而不是等停完服务、切完 current、跑迁移时才失败、再回滚一次。
//
// 输出只有一行，前缀是 ok: 或 fail:，口令一律打码。
// 退出码：0 可达，1 不可达，2 用法错误。

import pg from "pg";

const RAW = String(process.argv[2] || "").trim();

// 连接串里可能带口令：a) 用 URL 解析后只打印 user@host/db；b) 解析不了时按
// scheme://user:secret@host 的形状做一次掩码，宁可少打印也不要漏出去。
function masked(target) {
  try {
    const url = new URL(target);
    const user = decodeURIComponent(url.username || "");
    const db = url.pathname.replace(/^\//, "");
    const auth = user ? `${encodeURIComponent(user)}@` : "";
    return `${url.protocol}//${auth}${url.host}${db ? `/${db}` : ""}`;
  } catch {
    return String(target).replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/@\s]*:)([^@\s]*)(@)/gi, "$1***$3");
  }
}

// pg 的错误码比 message 稳定：同一个「连不上」在不同平台上 message 不一样。
function classify(error) {
  const code = String(error?.code || "");
  const known = {
    ENOTFOUND: "域名解析不到：核对主机名与 DNS",
    EAI_AGAIN: "DNS 暂时解析失败：核对网络与 DNS",
    ECONNREFUSED: "连接被拒绝：库没起，或端口 / 防火墙不对",
    ECONNRESET: "连接被对端重置：可能是 SSL 模式或中间设备",
    ETIMEDOUT: "连接超时：地址不可达，或防火墙挡了这个端口",
    EHOSTUNREACH: "网络不可达：核对路由与内网连通性",
    ENETUNREACH: "网络不可达：核对路由与内网连通性",
    "28P01": "认证失败：用户名或口令不对",
    "28000": "认证失败：pg_hba.conf 不允许这个来源",
    "3D000": "库不存在：先 createdb，或改连接串里的库名",
    "42501": "权限不足：这个账号连得上，但没有这个库的权限",
    "57P03": "数据库正在启动或已经关闭",
    "53300": "连接数已满：先释放连接，或调大 max_connections",
  };
  if (known[code]) return known[code];
  const message = String(error?.message || "").split("\n")[0].trim();
  if (/timeout/i.test(message)) return "连接超时：地址不可达，或防火墙挡了这个端口";
  return message || "未知错误";
}

function fail(detail) {
  process.stdout.write(`fail: ${detail}\n`);
  process.exitCode = 1;
}

async function main() {
  if (!RAW) {
    process.stdout.write("fail: 没有给出连接串。\n");
    process.exitCode = 2;
    return;
  }
  if (!/^postgres(ql)?:\/\//i.test(RAW)) {
    return fail(`连接串要以 postgres:// 或 postgresql:// 开头：${masked(RAW)}`);
  }

  const target = masked(RAW);
  const client = new pg.Client({
    connectionString: RAW,
    // 部署是串行的：连不上就尽快报出来，不让人对着一个没有输出的终端等。
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 5000,
  });
  // 建连失败会同时触发 client 的 error 事件，没有监听者时 Node 会把它升级成
  // 未捕获异常，把这一行诊断变成一段堆栈。
  client.on("error", () => {});

  try {
    await client.connect();
    await client.query("SELECT 1");
    process.stdout.write(`ok: ${target} 可读\n`);
  } catch (error) {
    fail(`${target} 连不上 —— ${classify(error)}`);
  } finally {
    try {
      await client.end();
    } catch {
      // 连接本来就没建起来，end 失败不影响结论。
    }
  }
}

main().catch((error) => {
  fail(classify(error));
});
