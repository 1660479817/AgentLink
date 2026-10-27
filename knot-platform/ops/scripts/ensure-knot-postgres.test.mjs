import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 0.9.0 之前的 ensure-knot-postgres.sh 写的是 `psql -h "$PGD"`：libpq 的 -h 传路径
// 指的是 **socket 目录**，不是数据目录，而服务端把 socket 建在编译默认的 /tmp。
// 于是「库起来了、psql 却说连不上」，部署卡在切 current 之前，而且没有开关能绕过。
//
// 这里用一个真的临时集群来盯着：脚本必须连得上，且 socket 目录与数据目录是两个
// 概念。没有 PostgreSQL 二进制时跳过，不让别的平台上的 npm test 变红。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "ensure-knot-postgres.sh");

function pgBin() {
  const candidates = [
    process.env.KNOT_PG_BIN,
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/postgresql@15/bin",
    "/opt/homebrew/opt/postgresql@14/bin",
    "/usr/local/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@14/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "initdb")) && existsSync(path.join(dir, "pg_ctl"))) return dir;
  }
  return "";
}

const BIN = pgBin();
const skip = BIN ? false : "这台机器上没有 PostgreSQL 二进制（initdb/pg_ctl）";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// 造一个最小部署根：脚本要读 sites/<站点>/site.env，口令写在同一目录。
async function siteRoot({ port, socketDir }) {
  const root = await mkdtemp(path.join(tmpdir(), "knot-pg-"));
  const siteDir = path.join(root, "sites", "demo");
  await mkdir(siteDir, { recursive: true });
  await writeFile(
    path.join(siteDir, "site.env"),
    [
      "KNOT_ADMIN_EMAIL=admin@example.com",
      "KNOT_PUBLIC_ORIGIN=http://127.0.0.1:8099",
      "KNOT_BACKUP_DIR=/tmp/knot-backups",
      `KNOT_PGPORT=${port}`,
      `KNOT_PGDATA=${path.join(root, "pgdata")}`,
      `KNOT_PGLOG=${path.join(root, "pg.log")}`,
      `KNOT_PG_BIN=${BIN}`,
      ...(socketDir ? [`KNOT_PG_SOCKET_DIR=${socketDir}`] : []),
      "",
    ].join("\n")
  );
  return { root, siteDir };
}

function runEnsure(root, extraEnv = {}) {
  return spawnSync("bash", [SCRIPT], {
    env: {
      ...process.env,
      KNOT_SITE: "demo",
      KNOT_DEPLOY_ROOT: root,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

function stopCluster(pgdata) {
  spawnSync(path.join(BIN, "pg_ctl"), ["-D", pgdata, "-m", "fast", "stop"], { encoding: "utf8" });
}

test("ensure-knot-postgres 起库后用 socket 连得上（socket 目录不是数据目录）", { skip }, async () => {
  const port = await freePort();
  const socketDir = await mkdtemp(path.join(tmpdir(), "knot-pgsock-"));
  const { root } = await siteRoot({ port, socketDir });
  const pgdata = path.join(root, "pgdata");

  try {
    const first = runEnsure(root);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);

    // socket 必须落在配置的目录里，而不是数据目录里。
    assert.ok(existsSync(path.join(socketDir, `.s.PGSQL.${port}`)), `socket 不在 ${socketDir}：${first.stdout}`);
    assert.ok(!existsSync(path.join(pgdata, `.s.PGSQL.${port}`)), "socket 建在了数据目录里");

    // 口令文件是 0600，且 DATABASE_URL 用它连得上（部署脚本就是这么拼的）。
    const pwFile = path.join(root, "sites", "demo", "pg-knot-password");
    assert.ok(existsSync(pwFile), "没有生成口令文件");
    const pw = readFileSync(pwFile, "utf8").trim();
    const viaTcp = execFileSync(
      path.join(BIN, "psql"),
      ["-h", "127.0.0.1", "-p", String(port), "-U", "knot", "-d", "knot", "-qAt", "-c", "SELECT current_user"],
      { env: { ...process.env, PGPASSWORD: pw }, encoding: "utf8" }
    );
    assert.equal(viaTcp.trim(), "knot");

    // 再跑一次：幂等，不重建、不报错。
    const second = runEnsure(root);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);

    // 旧站点的 site.env 里没有 KNOT_PG_SOCKET_DIR：默认必须落到 /tmp，
    // 也就是 PostgreSQL 自己的默认，不能悄悄退回「拿数据目录当 socket 目录」。
    const siteEnv = path.join(root, "sites", "demo", "site.env");
    const withoutKey = readFileSync(siteEnv, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("KNOT_PG_SOCKET_DIR="))
      .join("\n");
    await writeFile(siteEnv, withoutKey);
    const third = runEnsure(root);
    assert.equal(third.status, 0, `${third.stdout}\n${third.stderr}`);
  } finally {
    stopCluster(pgdata);
  }
});

test("库是旧脚本起的、socket 建在别处时也能连上并说清用的是哪个目录", { skip }, async () => {
  const port = await freePort();
  const { root } = await siteRoot({ port, socketDir: "/tmp" });
  const pgdata = path.join(root, "pgdata");
  const elsewhere = await mkdtemp(path.join(tmpdir(), "knot-pgold-"));

  try {
    // 手工起一个 socket 目录与配置不同的集群：模拟升级前用别的 -k 起的实例。
    execFileSync(path.join(BIN, "initdb"), ["-D", pgdata, "-U", "knot", "--auth-local=trust", "--auth-host=trust"], {
      stdio: "pipe",
    });
    execFileSync(
      path.join(BIN, "pg_ctl"),
      ["-D", pgdata, "-l", path.join(root, "pg.log"), "-o", `-p ${port} -h 127.0.0.1 -k ${elsewhere}`, "start"],
      { stdio: "pipe" }
    );

    // 配置写 /tmp，真实 socket 在 elsewhere：脚本要自己找到它，而不是报「连不上」。
    const result = runEnsure(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    stopCluster(pgdata);
  }
});

test("端口被别的程序占着时直说是谁占的，而不是让 pg_ctl 报 bind 失败", { skip }, async () => {
  const port = await freePort();
  const { root } = await siteRoot({ port, socketDir: "/tmp" });

  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(port, "127.0.0.1", resolve));
  try {
    const result = runEnsure(root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, new RegExp(`端口 ${port} 已被`));
    assert.match(result.stderr, /KNOT_PGPORT/);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("脚本不再把数据目录当 socket 目录传给 psql", () => {
  const text = readFileSync(SCRIPT, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(text, /psql"\s+-h\s+"\$PGD"/, "又把数据目录当 socket 目录了");
  // 起服务与连服务必须用同一个目录：起的时候 -k，连的时候 -h。
  assert.match(text, /-k \$SOCK/);
  assert.match(text, /-h "\$1"/);
});

test("端口上是别人的库时拒绝改口令、建库", { skip }, async () => {
  // 「端口通」不等于「这是我们的库」：同一个端口上可能是 brew 的默认实例或别人的集群。
  // 脚本下一步就要对它 ALTER USER / createdb，所以在那里必须比对数据目录。
  const port = await freePort();
  const { root } = await siteRoot({ port, socketDir: "/tmp" });
  const configured = path.join(root, "pgdata"); // 配置指向这里，但端口上是另一个集群
  const real = path.join(root, "someone-else");

  try {
    execFileSync(path.join(BIN, "initdb"), ["-D", real, "-U", "knot", "--auth-local=trust", "--auth-host=trust"], {
      stdio: "pipe",
    });
    execFileSync(
      path.join(BIN, "pg_ctl"),
      ["-D", real, "-l", path.join(root, "pg.log"), "-o", `-p ${port} -h 127.0.0.1 -k /tmp`, "start"],
      { stdio: "pipe" }
    );

    const result = runEnsure(root);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /不是这个站点的/);
    assert.match(result.stderr, /KNOT_PGPORT/);

    // 关键：别人的库里没有被动过——口令仍为空（trust 建库），也没有 knot 库。
    const roles = execFileSync(
      path.join(BIN, "psql"),
      ["-h", "/tmp", "-p", String(port), "-U", "knot", "-d", "postgres", "-qAt", "-c",
        "SELECT count(*) FROM pg_database WHERE datname = 'knot'"],
      { encoding: "utf8" }
    ).trim();
    assert.equal(roles, "0", "别人的库上被建了 knot 库");
  } finally {
    stopCluster(real);
    stopCluster(configured);
  }
});
