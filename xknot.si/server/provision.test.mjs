// 自动接通的步骤与渲染。
//
// 这层不碰 HTTP、不读时钟；测试里给一个假 host，就能检查每一步命令与落盘内容，
// 也可以重复跑同一步，确认它不会重复建账号、重复写配置。

import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTRY_ACCESS_LOG,
  ENTRY_PROXIED_MARK,
  ProvisionError,
  createRun,
  logFormatName,
  keyChanged,
  nextPort,
  pendingStep,
  reconcileTunnel,
  refreshKeySteps,
  reloadNginx,
  renderHttpVhost,
  renderPlaceholder,
  renderSshdMatch,
  renderVhost,
  switchEntry,
  runStep,
  stepDone,
  stepRetry,
  tunnelFor,
} from "./provision.mjs";

const APP = {
  id: "XK-2026-M5CMKG",
  name: "cpswang",
  subdomain: "cpswang",
  url: "https://cpswang.xknot.si",
  email: "manwjh@126.com",
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB cpswang",
};

function fakeHost(overrides = {}) {
  const calls = [];
  const fileWrites = [];
  const run = async (argv, options = {}) => {
    calls.push({ argv, input: options.input ?? null });
    if (overrides.onCall) {
      const custom = overrides.onCall(argv);
      if (custom) return custom;
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return {
    calls,
    fileWrites,
    sudo: run,
    async readRootFile(file) {
      return overrides.files?.[file] ?? null;
    },
    async writeRootFile(file, text, mode, extra) {
      fileWrites.push({ file, text, mode, ...extra });
      calls.push({ argv: ["write", file], input: text });
    },
    async resolve4() {
      return overrides.addresses ?? ["54.169.33.64"];
    },
  };
}

const roster = {
  members: [
    { id: "wang", tunnel: { account: "knot-tunnel", port: 18080 } },
    { id: "cpswang", tunnel: { account: "knot-tunnel-cpswang", port: 18090 } },
  ],
};

test("run: starts at the first pending step and reports done steps as skipped", () => {
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  assert.equal(run.state, "provisioning");
  assert.equal(run.host, "cpswang.xknot.si");
  assert.equal(pendingStep(run).id, "allocate");

  const allocateDone = stepDone(run, "allocate", "knot-tunnel-cpswang / 18090");
  assert.equal(pendingStep(allocateDone).id, "publish");
  assert.equal(allocateDone.steps[0].state, "done");
});

test("run: a failed step goes back to pending but keeps the error code", () => {
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  const retried = stepRetry(run, "dns", "dns_missing");
  const step = retried.steps.find((item) => item.id === "dns");
  assert.equal(step.state, "pending");
  assert.equal(step.error, "dns_missing");
  assert.equal(retried.lastError, "dns_missing");
});

test("port: first free port after the founder's 18080", () => {
  assert.equal(nextPort([]), 18090);
  assert.equal(nextPort([{ tunnel: { port: 18090 } }]), 18091);
  assert.equal(tunnelFor({ instanceId: "example", members: [] }).port, 18090);
});

test("port: a port handed out earlier in the same round is skipped", () => {
  // 同一轮里两条新申请都从同一份名册快照算端口：前一条分到 18090 还没落盘，
  // 后一条只能靠 reserved 避开它，否则两条 run 拿到同一个端口。
  const members = [{ tunnel: { port: 18090 } }];
  assert.equal(tunnelFor({ instanceId: "aaa", members }).port, 18091);
  assert.equal(tunnelFor({ instanceId: "bbb", members, reserved: [18091] }).port, 18092);
  assert.equal(nextPort(members, [18091, 18092]), 18093);
});

test("port: a run takes the roster's word when its own port is already taken", () => {
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });

  // 名册里另一个成员先占住了 18090：run 里的旧值已经不能用了，重算到下一个空闲端口。
  const taken = reconcileTunnel({ run, members: [{ id: "other", tunnel: { account: "knot-tunnel-other", port: 18090 } }] });
  assert.equal(taken.port, 18091);
  assert.equal(taken.account, "knot-tunnel-cpswang");

  // 名册里已有本实例时沿用名册的端口，重试不能换掉正在用的隧道。
  const listed = reconcileTunnel({
    run,
    members: [{ id: "cpswang", tunnel: { account: "knot-tunnel-cpswang", port: 18093 } }],
  });
  assert.equal(listed.port, 18093);

  // 已经一致时原样返回，不多写一次库。
  assert.equal(reconcileTunnel({ run, members: [] }), run);
});

test("tunnel: reuses the roster entry instead of allocating a new port", () => {
  assert.deepEqual(tunnelFor({ instanceId: "cpswang", members: roster.members }), {
    account: "knot-tunnel-cpswang",
    port: 18090,
  });
  // 名册里的账号在、端口坏了，就重算端口，不沿用坏值。
  const broken = tunnelFor({ instanceId: "example", members: [{ id: "example", tunnel: { account: "knot-tunnel-example", port: 80 } }] });
  assert.equal(broken.account, "knot-tunnel-example");
  assert.equal(broken.port, 18090);
});

test("render: the HTTP stage has ACME but no 443, so nginx -t passes before certbot", () => {
  const conf = renderHttpVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang" });
  assert.match(conf, /listen 80;/);
  assert.doesNotMatch(conf, /listen 443/);
  assert.match(conf, /\.well-known\/acme-challenge\//);
});

test("render: the full vhost proxies /api to the tunnel's loopback port", () => {
  const conf = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090 });
  assert.match(conf, /upstream knot_entry_18090 \{\n\s+server 127\.0\.0\.1:18090;/);
  assert.match(conf, /proxy_pass http:\/\/knot_entry_18090;/);
  assert.match(conf, /ssl_certificate \/etc\/letsencrypt\/live\/cpswang\.xknot\.si\/fullchain\.pem;/);
  assert.match(conf, /client_max_body_size 52m;/);
});

test("render: compression, HTTP/2 and tunnel keepalive do not depend on static serving", () => {
  // 整站反代也要有传输层的底配：首页从隧道回，不代表一个 109KB 的主包就该按原文发、
  // 也不代表每个资源都该重建一条穿隧道的 TCP。
  for (const entry of [false, true]) {
    const conf = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090, entry });
    assert.match(conf, /^ {4}gzip on;$/m);
    assert.match(conf, /gzip_proxied any;/);
    assert.match(conf, /application\/javascript/);
    assert.match(conf, /^ {4}http2 on;$/m);
    assert.match(conf, /keepalive 16;/);
    assert.match(conf, /keepalive_timeout 4s;/);
    // 有 upstream 还必须配 Connection ""，否则 nginx 给上游发 close，keepalive 形同虚设。
    // entry 阶段多三处：`/assets/`、`/api/web/uploads/` 与 `location /`。
    assert.equal((conf.match(/proxy_set_header Connection "";/g) || []).length, entry ? 4 : 1);
    // 一个 conf 里 upstream 只能声明一次，否则 nginx -t 直接失败。
    assert.equal((conf.match(/^upstream /gm) || []).length, 1);
  }
});

test("render: the admin surface never rides the public subdomain", () => {
  // 隧道的对端是实例上的回环，Backend 的「只信内网」分不出来源，
  // 入口这一层必须自己挡住管理页与管理接口。
  for (const entry of [false, true]) {
    const conf = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090, entry });
    assert.match(conf, /location \^~ \/api\/admin \{\n\s+default_type application\/json;\n\s+return 404 '\{"error":"not_found"\}';/);
    assert.match(conf, /location \^~ \/admin \{\n\s+default_type application\/json;\n\s+return 404 '\{"error":"not_found"\}';/);
    // 挡住的两段都不许带反代：写了 proxy_pass 就等于没挡。
    const blocked = conf.slice(conf.indexOf("location ^~ /api/admin"), conf.indexOf("location /api/ {"));
    assert.doesNotMatch(blocked, /proxy_pass/);
  }
});

test("render: every entry vhost writes the access log the traffic aggregator reads", () => {
  // 没有这一行，控制台里这个节点的「入口流量」永远是「未采集」：
  // 聚合端只读 /var/log/nginx/knot-access.log 里按 host 分开的记录。
  for (const entry of [false, true]) {
    const conf = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090, entry });
    assert.match(conf, new RegExp(`^ {4}access_log ${ENTRY_ACCESS_LOG} knot_json_cpswang_xknot_si;$`, "m"));
  }
});

test("render: the log format is declared in the same file, under a per-domain name", () => {
  // conf.d/*.conf 按文件名 include。共享的 knot-log.conf 排在 cpswang 之后，
  // 那里声明的 knot_json 在这个文件里还不存在，nginx -t 会报 unknown log format。
  const conf = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090 });
  assert.match(conf, /^log_format knot_json_cpswang_xknot_si escape=json$/m);
  // 聚合端按这些键读；少一个就是少一列数据。
  for (const key of ["at", "host", "status", "method", "uri", "bytes", "requestTime", "upstreamTime", "cache", "ip", "ua", "ref"]) {
    assert.match(conf, new RegExp(`"${key}":`));
  }
  // 自己声明，绝不与别的子域重名——重名在同一个 nginx 里是致命错误。
  assert.notEqual(
    logFormatName("cpswang.xknot.si"),
    logFormatName("zhoujj.xknot.si")
  );
  assert.match(logFormatName("a-b.xknot.si"), /^[a-z0-9_]+$/);
});

test("render: sshd gives every member exactly one listen port and no shell", () => {
  const conf = renderSshdMatch({ members: roster.members });
  assert.match(conf, /Match User knot-tunnel\n/);
  assert.match(conf, /PermitListen 127\.0\.0\.1:18080/);
  assert.match(conf, /Match User knot-tunnel-cpswang\n/);
  assert.match(conf, /PermitListen 127\.0\.0\.1:18090/);
  assert.equal((conf.match(/PermitOpen none/g) || []).length, 2);
  assert.equal((conf.match(/ForceCommand/g) || []).length, 2);
});

test("render: the placeholder escapes the site name", () => {
  const html = renderPlaceholder({ instanceId: "cpswang", name: "<script>x</script>" });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("step account: creates the user once and installs the submitted key", async () => {
  const host = fakeHost({
    onCall: (argv) => (argv[0] === "id" ? { code: 1, stdout: "", stderr: "" } : null),
  });
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });

  const note = await runStep({ step: "account", run, application: APP, host, entry: {}, roster });
  assert.equal(note.note, "公钥已装");
  const created = host.calls.find((call) => call.argv[0] === "useradd");
  assert.ok(created, "useradd should run");
  assert.ok(created.argv.includes("knot-tunnel-cpswang"));

  const keys = host.fileWrites.find((write) => write.file.endsWith("authorized_keys"));
  assert.match(keys.text, /^ssh-ed25519 /);
  assert.equal(keys.mode, "600");
  assert.equal(keys.owner, "knot-tunnel-cpswang:knot-tunnel-cpswang");
});

test("step account: an existing user is not created again", async () => {
  const host = fakeHost();
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  await runStep({ step: "account", run, application: APP, host, entry: {}, roster });
  assert.equal(host.calls.some((call) => call.argv[0] === "useradd"), false);
});

test("step account: a missing public key stops before touching the host", async () => {
  const host = fakeHost();
  const run = createRun({
    application: { ...APP, publicKey: "" },
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  await assert.rejects(
    runStep({ step: "account", run, application: { ...APP, publicKey: "" }, host, entry: {}, roster }),
    (error) => error instanceof ProvisionError && error.code === "public_key_missing"
  );
  assert.equal(host.calls.some((call) => call.argv[0] === "useradd"), false);
});

test("step dns: no answer fails with a code the panel can show", async () => {
  const host = fakeHost({ addresses: [] });
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  await assert.rejects(
    runStep({ step: "dns", run, application: APP, host, entry: {}, roster }),
    (error) => error instanceof ProvisionError && error.code === "dns_missing"
  );
});

test("step dns: an address that is not the entry host fails with dns_mismatch", async () => {
  // 有这个域名、A 记录也解析得出来，但指向别人的机器：vhost 装上也没人访问得到，
  // 证书也签不下来。必须在这里停住，不能把「解析得到」当成「指向我们」。
  const host = fakeHost({ addresses: ["1.2.3.4"] });
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  await assert.rejects(
    runStep({ step: "dns", run, application: APP, host, entry: {}, roster }),
    (error) => error instanceof ProvisionError && error.code === "dns_mismatch"
  );
});

test("step dns: one matching address among several is enough", async () => {
  // 双栈或轮询解析时一次会拿到多个地址，只要有一个落到入口主机就算接通。
  const host = fakeHost({ addresses: ["2606:4700::1", "54.169.33.64"] });
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  const result = await runStep({ step: "dns", run, application: APP, host, entry: {}, roster });
  assert.match(result.note, /54\.169\.33\.64/);
});

test("step vhost: writes HTTP-only conf, then tests and reloads nginx", async () => {
  const host = fakeHost();
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  await runStep({ step: "vhost", run, application: APP, host, entry: {}, roster });

  const conf = host.fileWrites.find((write) => write.file === "/etc/nginx/conf.d/cpswang.xknot.si.conf");
  assert.ok(conf);
  assert.doesNotMatch(conf.text, /listen 443/);
  assert.ok(host.calls.some((call) => call.argv.join(" ") === "nginx -t"));
  assert.ok(host.calls.some((call) => call.argv.join(" ") === "systemctl reload nginx"));
});

test("step sshd: generates the file from the roster and keeps the Include line once", async () => {
  const host = fakeHost({ files: { "/etc/ssh/sshd_config": "Port 22\nInclude /etc/ssh/sshd_config.d/*.conf\n" } });
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  await runStep({ step: "sshd", run, application: APP, host, entry: {}, roster });

  const conf = host.fileWrites.find((write) => write.file === "/etc/ssh/sshd_config.d/knot-tunnels.conf");
  assert.match(conf.text, /PermitListen 127\.0\.0\.1:18090/);
  assert.equal(host.fileWrites.some((write) => write.file === "/etc/ssh/sshd_config"), false);
  assert.ok(host.calls.some((call) => call.argv.join(" ") === "/usr/sbin/sshd -t"));
});

test("step tls: writes the full vhost only after certbot succeeds", async () => {
  const host = fakeHost({
    onCall: (argv) => (argv[0] === "/usr/bin/certbot" ? { code: 1, stdout: "", stderr: "rate limited" } : null),
  });
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });

  await assert.rejects(
    runStep({ step: "tls", run, application: APP, host, entry: { adminEmail: "a@b.c" }, roster }),
    (error) => error instanceof ProvisionError && error.code === "tls_failed"
  );
  assert.equal(host.fileWrites.some((write) => write.file.endsWith(".conf")), false);
});

test("key: a new public key rolls the host steps back to account", () => {
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  const halfway = ["allocate", "publish", "account", "sshd", "static"].reduce(
    (acc, id) => stepDone(acc, id),
    run
  );
  assert.equal(keyChanged(halfway, APP), false);

  const rotated = { ...APP, publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINew cpswang" };
  assert.equal(keyChanged(halfway, rotated), true);

  const fresh = refreshKeySteps(halfway, rotated);
  assert.equal(fresh.state, "provisioning");
  assert.deepEqual(
    fresh.steps.map((step) => step.state),
    ["done", "done", "pending", "pending", "pending", "pending", "pending", "pending"]
  );
  assert.equal(pendingStep(fresh).id, "account");
});

test("run: a successful step clears the previous error code", () => {
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });
  const failed = stepRetry(run, "dns", "dns_missing");
  assert.equal(failed.lastError, "dns_missing");
  assert.equal(stepDone(failed, "dns", "54.169.33.64").lastError, null);
});

test("render: before the tunnel is up, / is the placeholder and only /api is proxied", () => {
  const conf = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090 });
  assert.doesNotMatch(conf, new RegExp(ENTRY_PROXIED_MARK));
  assert.match(conf, /try_files \$uri \$uri\/ \/index\.html;/);
  // /api 之外，443 上只有静态 root。
  assert.equal((conf.match(/proxy_pass http:\/\/knot_entry_18090;/g) || []).length, 1);
});

test("render: once the tunnel is up, / proxies to the instance so the WebUI shows", () => {
  const conf = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090, entry: true });
  assert.match(conf, new RegExp(ENTRY_PROXIED_MARK));
  // `location /`、`/assets/`、`/api/web/uploads/` 与 `/api/` 各一条。
  assert.equal((conf.match(/proxy_pass http:\/\/knot_entry_18090;/g) || []).length, 4);
  // 占位页不再有人访问：静态 root 只剩下 ACME 校验在用。
  assert.doesNotMatch(conf, /try_files/);
  assert.doesNotMatch(conf, /location = \/index\.html/);
  // 安全头交给 Backend（它每个响应都发），入口不再叠一行同名头。
  assert.doesNotMatch(conf, /add_header X-Content-Type-Options/);
});

test("render: the proxied entry caches /assets/ so a partner node is not re-drilled per file", () => {
  // 伙伴节点的静态资源要穿隧道回源，一页 4–6 个文件就是 4–6 次跨境往返。
  // 文件名带内容哈希，可以长期缓存；占位页阶段没有 /assets/ 可缓存，不该声明 zone。
  const proxied = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090, entry: true });
  assert.match(proxied, /^proxy_cache_path \/var\/cache\/nginx\/knot_cache_cpswang_xknot_si /m);
  assert.match(proxied, /keys_zone=knot_cache_cpswang_xknot_si:10m/);
  assert.match(proxied, /location \^~ \/assets\/ \{/);
  assert.match(proxied, /proxy_cache knot_cache_cpswang_xknot_si;/);
  assert.match(proxied, /proxy_cache_valid 200 30d;/);
  // 隧道抖动时发已缓存的资源，而不是把整页打空。
  assert.match(proxied, /proxy_cache_use_stale .*http_502/);
  assert.match(proxied, /add_header Cache-Control "public, max-age=31536000, immutable" always;/);

  const placeholder = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090 });
  assert.doesNotMatch(placeholder, /proxy_cache_path/);
  assert.doesNotMatch(placeholder, /location \^~ \/assets\//);

  // zone 名在同一台 nginx 里必须唯一：重名是致命错误。
  const other = renderVhost({ domain: "zhoujj.xknot.si", root: "/var/www/zhoujj", port: 18091, entry: true });
  assert.match(other, /keys_zone=knot_cache_zhoujj_xknot_si:10m/);
});

test("render: the page shell is cached briefly so a tunnel blip opens a shell instead of a blank page", () => {
  // 静态投放时 index.html 在入口磁盘上，隧道全断也能画出骨架；整站反代没有这一步。
  // 10 秒缓存 + use_stale 把这一档补回来：命中不必穿隧道，断了发上一次的壳。
  const conf = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090, entry: true });
  // 从最后那个 `location /` 开始：前面 80 端口那份是 301 跳转。
  const shell = conf.slice(conf.lastIndexOf("location / {"));
  assert.match(shell, /proxy_cache knot_cache_cpswang_xknot_si;/);
  assert.match(shell, /proxy_cache_valid 200 10s;/);
  assert.match(shell, /proxy_cache_background_update on;/);
  assert.match(shell, /proxy_cache_use_stale error timeout updating/);
  // 上游对 index.html 发 no-cache，不忽略就一条都存不下。
  assert.match(shell, /proxy_ignore_headers Cache-Control Expires;/);
  // 带 Set-Cookie 的响应仍然不进缓存：宁可不缓存，也不把别人的会话发出去。
  assert.doesNotMatch(shell, /proxy_ignore_headers [^;]*Set-Cookie/);
});

test("switch: an identical conf is left alone; a failing test restores the old one", async () => {
  const writes = [];
  let testCode = 0;
  let current =
    renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090 });
  const fake = {
    readRootFile: async () => current,
    writeRootFile: async (_file, text) => {
      writes.push(text);
      current = text;
    },
    sudo: async (argv) => ({ code: argv[0] === "nginx" ? testCode : 0, stdout: "", stderr: "boom" }),
  };
  const run = { host: "cpswang.xknot.si", instanceId: "cpswang", port: 18090 };

  assert.deepEqual(await switchEntry({ host: fake, run, entry: true }), { changed: true, restarted: false });
  assert.equal(writes.length, 1);
  // 再来一次：内容一样，不再写、不再 reload。
  assert.deepEqual(await switchEntry({ host: fake, run, entry: true }), { changed: false });
  assert.equal(writes.length, 1);

  writes.length = 0;
  testCode = 1;
  await assert.rejects(() => switchEntry({ host: fake, run, entry: false }), /nginx_config_invalid/);
  // 写坏的 conf 已经被旧内容盖回去了。
  assert.equal(writes.length, 2);
  assert.match(writes[1], new RegExp(ENTRY_PROXIED_MARK));
});
// ---- reload 与 restart ----
//
// reload 被 master 拒绝时命令仍然返回 0：`nginx -s reload` 只负责把 SIGHUP 送出去。
// 所以判据只能是 error.log 里新出现的那几行。

const NOTICE = "2026/10/24 01:45:32 [notice] 580914#580914: signal 1 (SIGHUP) received, reconfiguring\n";
const WORKER = "2026/10/24 01:45:32 [notice] 580914#580914: start worker process 580916\n";
const ZONE_EMERG =
  '2026/10/24 01:45:32 [emerg] 580914#580914: limit_req "xknot_apply" uses the "$xknot_write_key" ' +
  'key while previously it used the "$binary_remote_addr" key\n';

function reloadHost({ onReload = WORKER, restart = { code: 0, stdout: "", stderr: "" }, active = "active\n", noLog = false } = {}) {
  const calls = [];
  let log = "old line\n";
  return {
    calls,
    async sudo(argv) {
      calls.push(argv);
      const line = argv.join(" ");
      if (line === "systemctl reload nginx") {
        log += onReload;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (line === "systemctl restart nginx") return restart;
      if (line === "systemctl is-active nginx") return { code: 0, stdout: active, stderr: "" };
      if (argv[0] === "stat") {
        return noLog
          ? { code: 1, stdout: "", stderr: "No such file" }
          : { code: 0, stdout: String(log.length), stderr: "" };
      }
      if (argv[0] === "tail") {
        const from = Number(String(argv[2]).slice(1)) - 1;
        return { code: 0, stdout: log.slice(from), stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

test("reload: a reload the master accepted is not restarted", async () => {
  const host = reloadHost();
  const result = await reloadNginx({ host });
  assert.deepEqual(result, { restarted: false, confirmed: true });
  assert.ok(!host.calls.some((argv) => argv.join(" ") === "systemctl restart nginx"));
});

test("reload: an [emerg] the master wrote means the config was rejected, so restart", async () => {
  // 这条正是 2026-10-23 那三天：部署全部「成功」，线上一直跑旧配置。
  const host = reloadHost({ onReload: NOTICE + ZONE_EMERG });
  const result = await reloadNginx({ host });
  assert.equal(result.restarted, true);
  assert.match(result.reason, /xknot_apply/);
  const order = host.calls.map((argv) => argv.join(" "));
  assert.ok(order.indexOf("systemctl restart nginx") > order.indexOf("systemctl reload nginx"));
});

test("reload: a restart that leaves nginx down is a hard failure", async () => {
  const host = reloadHost({
    onReload: NOTICE + ZONE_EMERG,
    restart: { code: 0, stdout: "", stderr: "" },
    active: "failed\n",
  });
  await assert.rejects(() => reloadNginx({ host }), /nginx_restart_failed/);
});

test("reload: no error.log to read means no evidence, and no blind restart", async () => {
  const host = reloadHost({ noLog: true });
  assert.deepEqual(await reloadNginx({ host }), { restarted: false, confirmed: false });
  assert.ok(!host.calls.some((argv) => argv.join(" ") === "systemctl restart nginx"));
});

test("switch: a rejected reload that cannot restart puts the old conf back", async () => {
  const writes = [];
  let current = renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090 });
  const calls = [];
  const host = {
    readRootFile: async () => current,
    writeRootFile: async (_file, text) => {
      writes.push(text);
      current = text;
    },
    sudo: async (argv) => {
      calls.push(argv.join(" "));
      if (argv[0] === "nginx") return { code: 0, stdout: "", stderr: "" };
      if (argv.join(" ") === "systemctl reload nginx") return { code: 0, stdout: "", stderr: "" };
      if (argv.join(" ") === "systemctl restart nginx") return { code: 1, stdout: "", stderr: "Job failed" };
      if (argv[0] === "stat") return { code: 0, stdout: "0", stderr: "" };
      if (argv[0] === "tail") {
        // offset 取的是 reload 前的 0，所以整段都算「新写入的」。
        return { code: 0, stdout: String(argv[2]).startsWith("+1") ? ZONE_EMERG : "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const run = { host: "cpswang.xknot.si", instanceId: "cpswang", port: 18090 };
  await assert.rejects(() => switchEntry({ host, run, entry: true }), /nginx_restart_failed/);
  // 新 conf 写进去过，失败后又把旧内容盖回来了。
  assert.equal(writes.length, 2);
  assert.equal(writes[1], renderVhost({ domain: "cpswang.xknot.si", root: "/var/www/cpswang", port: 18090 }));
});

// ---- 入口能力的一致性 ----
//
// 一段修在一个 location 里、另一段忘了跟，是这边最容易出的错：2026-10-24 之前
// 只有 /assets/ 有缓存、/api/web/uploads/ 每个图都穿隧道，就是「一个症状一套改法」
// 留下的。下面按「每个回源 location 必须具备哪些能力」逐条列，新增 location 时
// 必须同时在清单里补一行，否则这里不会替你检查——清单本身就是这份契约。

const PROXY_LOCATIONS = ["/api/", "/api/web/uploads/", "/assets/", "/"];

function locationsOf(conf) {
  const found = new Map();
  const heads = {
    "/api/": "    location /api/ {",
    "/api/web/uploads/": "    location ^~ /api/web/uploads/ {",
    "/assets/": "    location ^~ /assets/ {",
    "/": "    location / {",
  };
  for (const name of PROXY_LOCATIONS) {
    // `location /` 在 80 端口那份里也有一条（301），取 443 里那条。
    const at = conf.lastIndexOf(heads[name]);
    if (at < 0) continue;
    const end = conf.indexOf("\n    }", at);
    found.set(name, conf.slice(at, end));
  }
  return found;
}

test("render: every proxied location carries the same tunnel plumbing", () => {
  // 少一处 Connection "" 就是那条路径每个请求重开一条穿隧道的 TCP；
  // 少 proxy_send_timeout 就是慢上行发大文件按默认 60 秒被掐。
  const conf = renderVhost({ domain: "zhoujj.xknot.si", root: "/var/www/zhoujj", port: 18091, entry: true });
  const found = locationsOf(conf);
  assert.equal(found.size, PROXY_LOCATIONS.length, `没找到：${PROXY_LOCATIONS.filter((n) => !found.has(n)).join(", ")}`);
  for (const [name, block] of found) {
    for (const directive of [
      "proxy_pass http://knot_entry_18091;",
      "proxy_http_version 1.1;",
      'proxy_set_header Connection "";',
      "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
      "proxy_set_header X-Forwarded-Proto $scheme;",
      "proxy_read_timeout 120s;",
      "proxy_send_timeout 120s;",
    ]) {
      assert.ok(block.includes(directive), `${name} 缺 ${directive}`);
    }
  }
});

test("render: uploads are cached at the entry, but the backend keeps the last word", () => {
  // 上传文件占的字节最多：不缓存就是每张图、每段视频都穿一次隧道。
  // 但「能不能进共享缓存」必须由后端的 Cache-Control 决定（私帖是 private），
  // 所以这里绝不能像 /assets/ 那样 ignore Cache-Control。
  const conf = renderVhost({ domain: "zhoujj.xknot.si", root: "/var/www/zhoujj", port: 18091, entry: true });
  const uploads = locationsOf(conf).get("/api/web/uploads/");
  assert.match(uploads, /proxy_cache knot_cache_zhoujj_xknot_si;/);
  assert.match(uploads, /proxy_cache_key "\$uri";/);
  assert.match(uploads, /proxy_cache_valid 200 1d;/);
  assert.match(uploads, /add_header X-Knot-Cache \$upstream_cache_status;/);
  assert.doesNotMatch(uploads, /proxy_ignore_headers/);

  // /api/ 与 /assets/ 不缓存：前者是动态响应，后者的缓存由自己那条 location 管。
  const api = locationsOf(conf).get("/api/");
  assert.doesNotMatch(api, /proxy_cache /);
});

test("render: a conf someone else wrote is never rewritten", async () => {
  // 伙伴跑 push-entry.sh 推静态入口时写的是另一份模板，开头没有中枢的标记。
  // 中枢每 20 秒核对一次，若照旧覆盖，两边就会互相改写。
  const external = `# Knot 公网入口。由 ops/scripts/render-config.mjs 从 sites/zhoujj/site.env 生成。\nserver { server_name zhoujj.xknot.si; }\n`;
  const writes = [];
  const host = {
    readRootFile: async () => external,
    writeRootFile: async (_file, text) => writes.push(text),
    sudo: async () => ({ code: 0, stdout: "", stderr: "" }),
  };
  const run = { host: "zhoujj.xknot.si", instanceId: "zhoujj", port: 18091 };

  assert.deepEqual(await switchEntry({ host, run, entry: true }), { changed: false, external: true });
  assert.equal(writes.length, 0);
});

test("run: vhost and tls steps leave an externally managed conf alone", async () => {
  const external = "# 由 ops/scripts/render-config.mjs 生成\n";
  const host = fakeHost({ onCall: () => null });
  host.readRootFile = async (file) => (file === "/etc/nginx/conf.d/cpswang.xknot.si.conf" ? external : null);
  const run = createRun({
    application: APP,
    tunnel: { account: "knot-tunnel-cpswang", port: 18090 },
    entryHost: "54.169.33.64",
  });

  const vhost = await runStep({ step: "vhost", run, application: APP, host, entry: {}, roster });
  assert.equal(vhost.external, true);
  assert.equal(host.fileWrites.length, 0);
  assert.ok(!host.calls.some((call) => call.argv.join(" ") === "systemctl reload nginx"));

  // 首次开通（文件不存在）仍然照常写。
  const fresh = fakeHost();
  const written = await runStep({ step: "vhost", run, application: APP, host: fresh, entry: {}, roster });
  assert.equal(written.external, undefined);
  assert.equal(fresh.fileWrites.length, 1);
});
