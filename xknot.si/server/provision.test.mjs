// 自动接通的步骤与渲染。
//
// 这层不碰 HTTP、不读时钟；测试里给一个假 host，就能检查每一步命令与落盘内容，
// 也可以重复跑同一步，确认它不会重复建账号、重复写配置。

import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTRY_PROXIED_MARK,
  ProvisionError,
  createRun,
  keyChanged,
  nextPort,
  pendingStep,
  reconcileTunnel,
  refreshKeySteps,
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
    assert.equal((conf.match(/proxy_set_header Connection "";/g) || []).length, entry ? 2 : 1);
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
  assert.equal((conf.match(/proxy_pass http:\/\/knot_entry_18090;/g) || []).length, 2);
  // 占位页不再有人访问：静态 root 只剩下 ACME 校验在用。
  assert.doesNotMatch(conf, /try_files/);
  assert.doesNotMatch(conf, /location = \/index\.html/);
  // 安全头交给 Backend（它每个响应都发），入口不再叠一行同名头。
  assert.doesNotMatch(conf, /add_header X-Content-Type-Options/);
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

  assert.deepEqual(await switchEntry({ host: fake, run, entry: true }), { changed: true });
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
