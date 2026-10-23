// 签发之后的自动接通：中枢在入口主机上把前置一次做完。
//
// 这里只做三件事：算出这一步要做什么、把它渲染成确定的文本、执行一步。
// 不做 HTTP、不读时钟、不碰数据库；worker 负责轮询与记录，CLI 负责手动补跑。
//
// 每一步都必须是幂等的：重跑一次的结果与第一次相同，已有的账号、目录、配置不重建。
// 所以所有写入都用「先看再写」，所有系统命令都用参数数组，不拼 shell 字符串。
//
// 顺序是按依赖排的，不是按时间：
//   allocate → publish → account → sshd → static → dns → vhost → tls
// 收尾的 two 步（探测 / 改 active）在 worker 里，因为它们要等伙伴起隧道。

import { createHash } from "node:crypto";

import { normalizePublicKey } from "./validate.mjs";

export const STEP_ORDER = ["allocate", "publish", "account", "sshd", "static", "dns", "vhost", "tls"];

const FIRST_PORT = 18090;
const LAST_PORT = 18190;

export class ProvisionError extends Error {
  constructor(code, detail = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

export function freshSteps() {
  return STEP_ORDER.map((id) => ({ id, state: "pending", at: null, error: null, note: null }));
}

/** 公钥换了就要重装。只存短指纹：够判等，不需要在 run 里留一份公钥。 */
export function keyFingerprint(publicKey) {
  const value = String(publicKey || "").trim();
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function createRun({ application, tunnel, entryHost, now = new Date() }) {
  const host = new URL(application.url).hostname;
  const stamp = now.toISOString();
  return {
    applicationId: application.id,
    instanceId: application.subdomain || host.split(".")[0],
    host,
    account: tunnel.account,
    port: tunnel.port,
    entryHost,
    publicKeyHash: keyFingerprint(application.publicKey),
    state: "provisioning",
    steps: freshSteps(),
    attempts: 0,
    lastError: null,
    tunnelConfirmedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** 伙伴在案例页重新贴了公钥：账号里那份旧的就作废了，从 account 起重跑。 */
export function refreshKeySteps(run, application, now = new Date()) {
  const from = STEP_ORDER.indexOf("account");
  return {
    ...run,
    publicKeyHash: keyFingerprint(application.publicKey),
    state: "provisioning",
    steps: run.steps.map((step, index) =>
      index >= from ? { ...step, state: "pending", at: null, error: null, note: null } : step
    ),
    updatedAt: now.toISOString(),
  };
}

export function keyChanged(run, application) {
  const next = keyFingerprint(application.publicKey);
  return Boolean(next) && next !== run.publicKeyHash;
}

/** 下一个还没完成的步骤；全部完成时返回 null。 */
export function pendingStep(run) {
  return (run.steps || []).find((step) => step.state !== "done" && step.state !== "skipped") || null;
}

export function stepDone(run, id, note = null, now = new Date()) {
  const step = run.steps.find((item) => item.id === id);
  if (!step) return run;
  return {
    ...run,
    steps: run.steps.map((item) =>
      item.id === id ? { ...item, state: "done", at: now.toISOString(), error: null, note } : item
    ),
    // 这一步成功了，上一次的错误码就不该继续挂在 run 上：
    // 否则面板会把「已进入下一步」也标成红的。
    lastError: null,
    updatedAt: now.toISOString(),
  };
}

export function stepFailed(run, id, code, now = new Date()) {
  return {
    ...run,
    steps: run.steps.map((item) =>
      item.id === id ? { ...item, state: "failed", at: now.toISOString(), error: code } : item
    ),
    lastError: code,
    updatedAt: now.toISOString(),
  };
}

/** 失败的一步回到待办：下一次轮询再试，面板上保留上一次的错误码。 */
export function stepRetry(run, id, code, now = new Date()) {
  return {
    ...run,
    steps: run.steps.map((item) =>
      item.id === id ? { ...item, state: "pending", error: code } : item
    ),
    lastError: code,
    updatedAt: now.toISOString(),
  };
}

export function nextPort(members = [], reserved = []) {
  const used = new Set(
    members.map((member) => Number(member?.tunnel?.port)).filter((port) => Number.isInteger(port))
  );
  // 名册是一份磁盘快照：同一轮里刚分给前一个申请的端口还没落盘。
  // 调用方把本轮已经分出去的端口放进 reserved，两条新申请才不会拿到同一个。
  for (const port of reserved) used.add(Number(port));
  for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new ProvisionError("port_exhausted", `${FIRST_PORT}-${LAST_PORT} 已用满`);
}

export function accountOf(instanceId) {
  return `knot-tunnel-${instanceId}`;
}

/** 名册里已有这个实例就沿用它的账号与端口，避免重试时换掉正在用的隧道。 */
export function tunnelFor({ instanceId, members = [], reserved = [] }) {
  const member = members.find((item) => item.id === instanceId);
  const port = Number(member?.tunnel?.port);
  const account = String(member?.tunnel?.account || "").trim();
  if (account && Number.isInteger(port) && port >= 1024 && port <= 65535) return { account, port };
  return { account: accountOf(instanceId), port: nextPort(members, reserved) };
}

/**
 * 每轮按当前名册重算隧道参数。
 *
 * run 里的账号与端口只是上一次分配的结果，名册才是权威。同一轮里两个新申请
 * 都从同一份快照算端口，先落盘的那个占住它；后者若继续信 run 里的旧值，
 * 每次发布都会被判重复，永远停在 roster_invalid。按名册重算一次就换到空闲端口。
 */
export function reconcileTunnel({ run, members = [], now = new Date() }) {
  const tunnel = tunnelFor({ instanceId: run.instanceId, members });
  if (tunnel.account === run.account && tunnel.port === run.port) return run;
  return { ...run, account: tunnel.account, port: tunnel.port, updatedAt: now.toISOString() };
}

// ---- 渲染：入口主机上要落的那几份文件 ----

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function renderPlaceholder({ instanceId, name }) {
  const title = escapeHtml(name || instanceId);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f0f2f5; color: #050505;
         font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 36rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: #65676b; margin: .25rem 0; }
  code { font-size: .9em; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>子域已签发，入口正在接通。</p>
  <p>This subdomain is issued; the entry is being connected.</p>
  <p><code>${escapeHtml(instanceId)}.xknot.si</code></p>
</main>
</body>
</html>
`;
}

/** 只有 80：够 certbot 做 HTTP-01，证书拿到之前不写 443，免得 nginx -t 失败。 */
export function renderHttpVhost({ domain, root }) {
  return `# ${domain}：签发阶段的 HTTP 入口，由 auto-connect 生成，请勿手改。
# 证书签发成功后会被同一份生成器改写成 443 + /api 反代的完整版本。

server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root ${root};
    }

    location / {
        root ${root};
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
`;
}

export const ENTRY_PROXIED_MARK = "# 入口已接通：整站反代到隧道";

// 入口这一层不做压缩，JS/CSS/JSON 就按原文发出去：WebUI 主包 109KB，压完约 68KB。
// 同一个 http 块里别的 vhost 各写各的，所以只能写在这份 conf 的 server 里。
// gzip_proxied any 让穿过隧道的 /api 响应也压——JSON 收益最大。
// 不放图片/字体：jpeg、png、woff2 本来就压过了；不放 markdown：入口只出 WebUI 与快照。
const GZIP_BLOCK = `    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 5;
    gzip_proxied any;
    gzip_types text/plain text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml application/xml text/xml;
`;

/**
 * 443 的完整入口 conf。
 *
 * 两个阶段：
 *   entry: false —— 隧道还没通。`/` 发静态占位页（"子域已签发，入口正在接通"），
 *                   只有 /api 预先接到回环端口上，用来做健康探测。
 *   entry: true  —— 探测通过，整站反代：`/` 也走隧道，访客看到的是实例自己的 WebUI。
 *                   占位页不再有人访问，静态 root 只剩 ACME 校验在用。
 *
 * 同一条腿只认一个事实：隧道没通就发占位页，通了就整站过隧道。不做「/ 看静态、
 * 其他看隧道」那种混合，否则首页永远停在占位页（0.1 的真实事故就是这一条）。
 *
 * 整站反代也要拿到和 static 投放同档的传输层：HTTP/2、gzip、隧道连接复用。
 * 这三项与「页面从磁盘出还是从隧道回」无关；少了它们，每个静态文件都要多穿一次
 * 跨境往返、按原文传，109KB 的主包会当 109KB 发出去。
 */
export function renderVhost({ domain, root, port, entry = false }) {
  const proxied = Boolean(entry);
  const upstream = `knot_entry_${port}`;
  const header = proxied
    ? `# ${domain}：入口 conf，由 auto-connect 生成，请勿手改。\n${ENTRY_PROXIED_MARK}\n# 整站经本机回环端口 ${port} 回到实例（SSH 反向隧道）。`
    : `# ${domain}：入口 conf，由 auto-connect 生成，请勿手改。\n# 静态页落在 ${root}；/api 经本机回环端口 ${port} 回到实例（SSH 反向隧道）。`;

  // 回源统一走 upstream 才能复用连接：一条新 TCP 要穿隧道重建一次 channel，
  // 跨境多一个 RTT。keepalive_timeout 压在 Backend 的 keepAliveTimeout（Node 默认 5s）之下。
  const upstreamBlock = `upstream ${upstream} {
    server 127.0.0.1:${port};
    keepalive 16;
    keepalive_timeout 4s;
}
`;

  const rootLocation = proxied
    ? `    location / {
        proxy_pass http://${upstream};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_request_buffering off;
    }`
    : `    location = /index.html {
        root ${root};
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
    }

    location / {
        root ${root};
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
    }`;

  return `${header}

${upstreamBlock}
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root ${root};
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 52m;

${GZIP_BLOCK}
    location /.well-known/acme-challenge/ {
        root ${root};
    }

    # 管理面只在实例自己的机器与内网开：整站反代之后，隧道的对端是实例上的回环，
    # Backend 分不出「本机来的」和「经隧道从公网来的」，所以必须在入口先挡住。
    location ^~ /api/admin {
        default_type application/json;
        return 404 '{"error":"not_found"}';
    }

    location ^~ /admin {
        default_type application/json;
        return 404 '{"error":"not_found"}';
    }

    location /api/ {
        proxy_pass http://${upstream};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_request_buffering off;
    }

${rootLocation}
}
`;
}

/** 每个成员一段 Match：只允许把入口的回环端口转到实例，不给 shell、不许开别的端口。 */
export function renderSshdMatch({ members = [] }) {
  const blocks = members
    .filter((member) => member?.tunnel?.account && Number.isInteger(Number(member.tunnel.port)))
    .map(
      (member) => `Match User ${member.tunnel.account}
    AllowTcpForwarding remote
    PermitListen 127.0.0.1:${member.tunnel.port}
    PermitOpen none
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    GatewayPorts no
    ClientAliveInterval 30
    ClientAliveCountMax 3
    ForceCommand /usr/bin/sleep infinity`
    );
  return `# 入口主机上的回源隧道账号，由 auto-connect 按名册整份生成，请勿手改。
# 名册是唯一事实来源：成员增减后重跑签发步骤即可。
${blocks.join("\n\n")}
`;
}

// ---- 执行一步 ----

/**
 * 执行一个步骤。host 是入口主机的能力接口，便于测试时替换：
 *   sudo(argv, { input })          → { code, stdout, stderr }
 *   writeRootFile(path, text, mode)
 *   resolve4(hostname)             → string[]
 *   readRootFile(path)             → string | null
 */
export async function runStep({
  step,
  run,
  application,
  host,
  entry,
  roster,
  publish,
}) {
  const domain = run.host;
  const root = `/var/www/${run.instanceId}`;

  if (step === "allocate") {
    return { note: `${run.account} / ${run.port}` };
  }

  if (step === "publish") {
    const result = await publish({
      application,
      tunnelAccount: run.account,
      tunnelPort: run.port,
    });
    if (result.error) throw new ProvisionError(result.error, JSON.stringify(result.details || null));
    return { note: result.skipped ? "已在清单与名册里" : "已写入清单与名册" };
  }

  if (step === "account") {
    const home = `/home/${run.account}`;
    const exists = await host.sudo(["id", "-u", run.account]);
    if (exists.code !== 0) {
      const created = await host.sudo([
        "useradd",
        "--create-home",
        "--home-dir",
        home,
        "--shell",
        "/bin/bash",
        run.account,
      ]);
      if (created.code !== 0) throw new ProvisionError("account_failed", created.stderr);
    }
    // 最后一道：这里是要写进 root 属主文件的文本。库里存的历史值可能是
    // 收紧校验之前写进去的，所以到了这一层仍要再验一次——一行公钥变两行，
    // 等于给入口主机加了第二把钥匙。
    //
    // 两种失败分开报：没填是用户还没做这一步（可重试），填错说明库里是脏值
    // （要人工看），让面板能说清是哪一种。
    if (!String(application.publicKey || "").trim()) throw new ProvisionError("public_key_missing");
    const key = normalizePublicKey(application.publicKey);
    if (!key) throw new ProvisionError("public_key_invalid");
    await host.sudo(["install", "-d", "-m", "700", "-o", run.account, "-g", run.account, `${home}/.ssh`]);
    await host.writeRootFile(`${home}/.ssh/authorized_keys`, `${key}\n`, "600", {
      owner: `${run.account}:${run.account}`,
    });
    return { note: "公钥已装" };
  }

  if (step === "sshd") {
    const includeLine = "Include /etc/ssh/sshd_config.d/*.conf";
    const main = (await host.readRootFile("/etc/ssh/sshd_config")) || "";
    if (!main.includes(includeLine)) {
      await host.writeRootFile("/etc/ssh/sshd_config", `${main.trimEnd()}\n\n${includeLine}\n`, "600");
    }
    await host.writeRootFile("/etc/ssh/sshd_config.d/knot-tunnels.conf", renderSshdMatch({ members: roster.members || [] }), "644");
    const tested = await host.sudo(["/usr/sbin/sshd", "-t"]);
    if (tested.code !== 0) throw new ProvisionError("sshd_config_invalid", tested.stderr);
    const reloaded = await host.sudo(["systemctl", "reload", "sshd"]);
    if (reloaded.code !== 0) await host.sudo(["systemctl", "reload", "ssh"]);
    return { note: "sshd 已按名册重载" };
  }

  if (step === "static") {
    await host.sudo(["install", "-d", "-m", "755", root]);
    await host.writeRootFile(`${root}/index.html`, renderPlaceholder({ instanceId: run.instanceId, name: application.name }), "644");
    return { note: root };
  }

  if (step === "dns") {
    const addresses = await host.resolve4(domain);
    if (!addresses.length) {
      throw new ProvisionError(
        "dns_missing",
        `解析不到 ${domain}；入口域名需要一条泛解析 *.xknot.si → ${run.entryHost}`
      );
    }
    return { note: addresses.join(", ") };
  }

  if (step === "vhost") {
    await host.writeRootFile(`/etc/nginx/conf.d/${domain}.conf`, renderHttpVhost({ domain, root }), "644");
    const tested = await host.sudo(["nginx", "-t"]);
    if (tested.code !== 0) throw new ProvisionError("nginx_config_invalid", tested.stderr);
    await host.sudo(["systemctl", "reload", "nginx"]);
    return { note: "HTTP 入口已生效" };
  }

  if (step === "tls") {
    const issued = await host.sudo(
      [
        "/usr/bin/certbot",
        "certonly",
        "--webroot",
        "-w",
        root,
        "-d",
        domain,
        "--cert-name",
        domain,
        "--non-interactive",
        "--agree-tos",
        "-m",
        entry.adminEmail,
        "--keep-until-expiring",
      ],
      { timeoutMs: 180_000 }
    );
    if (issued.code !== 0) throw new ProvisionError("tls_failed", tail(issued.stderr));
    await host.writeRootFile(`/etc/nginx/conf.d/${domain}.conf`, renderVhost({ domain, root, port: run.port }), "644");
    const tested = await host.sudo(["nginx", "-t"]);
    if (tested.code !== 0) throw new ProvisionError("nginx_config_invalid", tested.stderr);
    await host.sudo(["systemctl", "reload", "nginx"]);
    return { note: "证书已签发，/api 反代已接上" };
  }

  throw new ProvisionError("unknown_step", step);
}

/**
 * 把入口在「占位页」与「整站反代」之间切换。
 *
 * 探测通过时切成反代，访客看到实例自己的 WebUI；之后再跑一次只是核对
 * （conf 一致就什么都不做），所以部署覆盖、conf 被删都能自愈。
 *
 * 先 nginx -t 再 reload；不通过就把旧内容写回去，不能让一次写坏的 conf
 * 把已经接通的站打掉。
 */
export async function switchEntry({ host, run, entry = true }) {
  const domain = run.host;
  const root = `/var/www/${run.instanceId}`;
  const file = `/etc/nginx/conf.d/${domain}.conf`;
  const conf = renderVhost({ domain, root, port: run.port, entry });
  const current = await host.readRootFile(file);
  if (current === conf) return { changed: false };

  await host.writeRootFile(file, conf, "644");
  const tested = await host.sudo(["nginx", "-t"]);
  if (tested.code !== 0) {
    if (current != null) await host.writeRootFile(file, current, "644");
    throw new ProvisionError("nginx_config_invalid", tail(tested.stderr));
  }
  const reloaded = await host.sudo(["systemctl", "reload", "nginx"]);
  if (reloaded.code !== 0) throw new ProvisionError("nginx_reload_failed", tail(reloaded.stderr));
  return { changed: true };
}

function tail(text, limit = 300) {
  const value = String(text || "").trim();
  return value.length > limit ? value.slice(-limit) : value;
}
