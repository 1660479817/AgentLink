// Knot 配置的唯一事实来源。
//
// 这里登记每一个配置键：类型、默认值、是否必填、属于哪台机器、是不是密钥。
// 其余东西都从这里派生，不要另手写一份：
//
//   sites/_template/site.env             <- ops/scripts/config.mjs template
//   sites/_template/platform.env         <- ops/scripts/config.mjs platform-template
//   docs/CONFIG.md                       <- ops/scripts/config.mjs docs
//   sites/<站点>/platform.env             <- ops/scripts/config.mjs env
//
// 这份登记表同时被三处读取：
//   * 代码   backend/src/config.js 从这里取默认值，backend/src/runtimeConfig.js 在启动时校验；
//   * 部署   ops/scripts/* 从这里生成配置、校验站点；
//   * 文档   docs/CONFIG.md 与两个模板由 config.mjs 生成。
// 所以它放在 packages/ 里，属于代码层，不归部署层。
//
// 三层边界：
//   * 代码      backend/ web/ packages/  真正的行为。环境变量只是覆盖，键在这里登记过才算数。
//   * 部署      ops/                     脚本、模板、LaunchAgent。不写任何站点取值。
//   * 配置      sites/<站点>/             站点档案、拓扑、密钥。一个目录就是一份完整配置。
//
// 站点配置分五个文件：
//   * site.env      站点拓扑：域名、主机、端口、路径、入口。不含密码。
//   * profile.json  自述区：名称、默认语种、一句话介绍、详细介绍、logo、主理人、联系方式、地区、时区、标签（十项扁平字段）。
//                   主理人在 /admin 编辑，不进版本库。
//   * platform.env  实例主机自己的运行时值：SMTP 密码、价格初值、管理令牌。部署脚本生成，权限 600。
//   * xknot.env     接入 XKnot 联邦：实例 id、中枢地址、签发日期、委托发信凭据。由中枢签发，不由部署推导。
//   * tunnel.env    回源隧道：账号、私钥文件名、本机与入口端口。由 /admin 的 XKnot 栏写入，
//                   与 site.env 的隧道组是同一批键；界面维护的那一份优先。
//
// 部署与接入是两条独立的线：不接联邦的实例照样能部署、能跑；接入只往 xknot.env 写，
// 不回头改 site.env 或 platform.env。反过来，换机器重部署也不该动接入凭据。
//
// 加一个配置项的步骤：
//   1. 在这里加一条；
//   2. 在代码里读 process.env 并给同样的默认值；
//   3. 跑 `npm run config -- template --write`、`platform-template --write`、`xknot-template --write`、`entry-template --write`；
//   4. 跑 `npm run config -- docs --write` 重新生成文档；
//   5. 跑测试。模板文件、文档、代码默认值任何一处漂移都会直接失败。

export const GROUPS = [
  { id: "site", label: "站点" },
  { id: "platform", label: "实例主机" },
  { id: "publish", label: "从开发机发布" },
  { id: "entry", label: "公网入口" },
  { id: "tunnel", label: "回源隧道" },
  { id: "xknot", label: "XKnot 接入" },
  { id: "mail", label: "邮件" },
  { id: "economy", label: "经济" },
  { id: "coupon", label: "消费券" },
  { id: "storage", label: "存储" },
  { id: "search", label: "检索" },
  { id: "agent", label: "智能体" },
  { id: "admin", label: "管理令牌" },
];

const MiB = 1024 * 1024;

function hostOf(value) {
  try {
    return new URL(String(value || "")).hostname;
  } catch {
    return "";
  }
}

// 对外地址里的端口。没写端口时按协议取默认值，别把 https 的 443 当成 0。
function urlPort(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.port) return Number(url.port);
    return url.protocol === "https:" ? 443 : 80;
  } catch {
    return 0;
  }
}

// 官方只部署 xknot.si 签发的二级子域：<标签>.xknot.si。
const XKNOT_SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.xknot\.si$/;

export function truthy(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return !["0", "false", "no", "off"].includes(text);
}

export function isBlank(value) {
  return value == null || String(value).trim() === "";
}

// 经济键的夹取口径与 backend/src/points.js 一致：非法或缺失取代码默认值，
// 再把默认价夹进 [min, max]。两处算同一个东西时必须用同一套规则。
function nonNegativeInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function clampedDefaultPrice(env) {
  const min = nonNegativeInt(env.KNOT_PRICE_MIN, 0);
  const max = Math.max(nonNegativeInt(env.KNOT_PRICE_MAX, 100), min);
  return Math.min(Math.max(nonNegativeInt(env.KNOT_DEFAULT_PRICE, 10), min), max);
}

// 站点键：写在 sites/<站点>/site.env。
//   runtime  运行时环境里的名字；为空表示这个键只给脚本用，不进 Backend
//   scope    运行时谁需要它。用于按机器裁剪配置和检查跨机泄露
//   derive   留空时的推导值，和 ops/scripts/lib/site-config.sh 保持一致
const SITE_KEYS = [
  // ---- 站点 ----
  {
    key: "KNOT_PUBLIC_ORIGIN",
    runtime: "PUBLIC_WEB_ORIGIN",
    group: "site",
    type: "url",
    default: "http://127.0.0.1:8080",
    desc: "对外访问地址。只在本机时写 http://127.0.0.1:<KNOT_PORT>；接 xknot.si 子域后写中枢签发的 https://<标签>.xknot.si。",
    example: "https://wang.xknot.si",
  },
  {
    key: "KNOT_DOMAIN",
    group: "site",
    type: "string",
    default: "",
    scope: ["dev", "entry"],
    desc: "xknot.si 签发的二级子域，形如 <标签>.xknot.si。只在本机访问时留空；接子域时与入口文件名一致。",
    example: "wang.xknot.si",
  },
  {
    key: "KNOT_HUB_ORIGIN",
    runtime: "KNOT_HUB_ORIGIN",
    group: "site",
    type: "url",
    default: "https://xknot.si",
    desc: "第一次接入时把申请提交到哪个中枢。默认联邦入口 xknot.si；本机联调可以指向 dev 中枢。",
    example: "https://xknot.si",
  },
  {
    key: "KNOT_PORT",
    runtime: "PORT",
    group: "site",
    type: "port",
    default: 8080,
    desc: "实例主机上 Backend 监听的端口。",
  },
  {
    key: "KNOT_BIND_HOST",
    runtime: "BIND_HOST",
    group: "site",
    type: "string",
    default: "127.0.0.1",
    desc: "Backend 绑定地址。本机与入口回源都只走本机，保持 127.0.0.1；要让同一内网的机器打开管理后台 /admin，站点把它设为 0.0.0.0。绑回环时「我的」页生成的管理后台链接一定以 127.0.0.1 开头，复制到别的设备上打不开；对外是域名却只绑回环时，部署脚本会提醒一次。",
  },
  {
    key: "KNOT_SESSION_COOKIE_NAME",
    runtime: "SESSION_COOKIE_NAME",
    group: "site",
    type: "string",
    default: "knot_sid",
    desc: "会话 Cookie 名。同一个域名下跑多个站点时要各不相同。",
  },
  {
    key: "KNOT_ADMIN_EMAIL",
    runtime: "KNOT_ADMIN_EMAIL",
    group: "site",
    type: "email",
    required: true,
    default: "",
    desc: "站点管理员邮箱。必填；用这个邮箱登录后拥有平台管理权限，建议与投诉也寄到这里。",
    example: "admin@example.com",
  },
  {
    key: "KNOT_SESSION_TTL_DAYS",
    runtime: "KNOT_SESSION_TTL_DAYS",
    group: "site",
    type: "int",
    default: 30,
    min: 1,
    max: 365,
    desc: "登录会话有效期（天）。Cookie 和 sessions.expires_at 用同一个值。",
  },

  // ---- 实例主机 ----
  {
    key: "KNOT_DB_MODE",
    group: "platform",
    type: "enum",
    values: ["local", "external"],
    default: "local",
    desc: "local 用本机 Homebrew Postgres；external 用 KNOT_DATABASE_URL，不启动本机库。",
  },
  {
    key: "KNOT_DATABASE_URL",
    group: "platform",
    type: "string",
    default: "",
    secret: true,
    // 写错协议或漏了主机时，进程照样起得来，第一条 SQL 才失败——那时已经分不清
    // 是库没起还是串写错了。所以连接串在这里就要求长得像个 postgres 地址。
    pattern: /^postgres(?:ql)?:\/\/[^\s]+$/,
    desc: "KNOT_DB_MODE=external 时的连接串。可能含密码，按密钥对待。",
    example: "postgres://knot:密码@db.example.com:5432/knot",
  },
  {
    key: "KNOT_PGPORT",
    group: "platform",
    type: "port",
    default: 5433,
    desc: "本机 Postgres 端口。和系统默认的 5432 错开。",
  },
  {
    key: "KNOT_PGDATA",
    group: "platform",
    type: "path",
    default: "$HOME/knot/pgdata",
    desc: "本机 Postgres 数据目录。",
  },
  {
    key: "KNOT_PGLOG",
    group: "platform",
    type: "path",
    default: "$HOME/knot/pg.log",
    desc: "本机 Postgres 日志文件。",
  },
  {
    key: "KNOT_PG_BIN",
    group: "platform",
    type: "path",
    default: "/opt/homebrew/opt/postgresql@16/bin",
    desc: "PostgreSQL 16 的 bin 目录。Apple Silicon Homebrew 是 /opt/homebrew，Intel 改成 /usr/local/opt/postgresql@16/bin。",
  },
  {
    key: "KNOT_UPLOAD_DIR",
    runtime: "UPLOAD_DIR",
    group: "platform",
    type: "path",
    default: "",
    // 拿不到部署根时返回空，不要拼出一个 /var/uploads：那是个合法但几乎一定错的路径，
    // 调用方看不出它是猜的。
    derive: (env, ctx) => (ctx.deployRoot || ctx.root ? `${ctx.deployRoot || ctx.root}/var/uploads` : ""),
    desc: "上传目录。留空用 <部署根目录>/var/uploads；放在发布包外，升级和回滚都不动它。",
  },
  {
    key: "KNOT_BACKUP_DIR",
    runtime: "KNOT_BACKUP_DIR",
    group: "platform",
    type: "path",
    default: "",
    desc: "备份目录。留空是还没决定（公网站点会提醒）；写 `null` 表示明确不备份，不再提醒；两者都不装备份任务。填目录后 deploy-site.sh 装每天 04:15 的备份任务（launchd 或 systemd timer）。",
  },
  {
    key: "KNOT_BACKUP_KEEP",
    runtime: "KNOT_BACKUP_KEEP",
    group: "platform",
    type: "int",
    default: 7,
    min: 1,
    max: 3650,
    desc: "保留最近几份备份。",
  },
  {
    key: "KNOT_BACKUP_SITES",
    runtime: "KNOT_BACKUP_SITES",
    group: "platform",
    type: "bool",
    default: 1,
    desc: "1 表示备份也收 sites/<站点>/：platform.env（SMTP 密码、管理令牌）、agents/（智能体凭据）。只备份数据库的话，换台机器邮件登录和智能体就都没了。",
  },
  {
    key: "KNOT_BACKUP_OPENCLAW",
    runtime: "KNOT_BACKUP_OPENCLAW",
    group: "platform",
    type: "enum",
    values: ["auto", "1", "0"],
    default: "auto",
    desc: "OpenClaw 状态目录的备份。auto 表示 $HOME/.openclaw 存在就收；1 必须收；0 跳过。只收配置、凭据和 agent 工作区，不含 cache/browser/npm。",
  },
  {
    key: "KNOT_OPENCLAW",
    group: "platform",
    type: "enum",
    values: ["auto", "1", "0"],
    default: "auto",
    desc: "auto 表示装了 openclaw 才同步；1 必须同步；0 跳过。",
  },

  // ---- 从开发机发布 ----
  {
    key: "KNOT_DEPLOY_SSH",
    group: "publish",
    type: "string",
    default: "",
    scope: ["dev"],
    desc: "实例主机的 ssh 目标，形如 user@host。留空表示目标就是这台机器，直接就地跑 deploy-site.sh。",
    example: "deploy@<实例主机>",
  },
  {
    key: "KNOT_DEPLOY_DIR",
    group: "publish",
    type: "path",
    default: "",
    // 部署根按站点分。写成一个与站点无关的固定值（以前是 ~/knot/site）时，
    // 两个站点照模板复制就共用 releases/ current deployed.json，部署与回滚会串站。
    derive: (env, ctx) => (ctx.site ? `~/knot/${ctx.site}` : ""),
    scope: ["dev", "platform"],
    desc: "实例主机上的部署根目录。sites/、releases/、current、var/ 都在这里，代码在 releases/<版本> 下。留空按站点名推导为 ~/knot/<站点>；一个部署根只放一个站点，不要和源码仓库或用另一站点的目录。",
  },
  {
    key: "KNOT_DEPLOY_SSH_KEY",
    group: "publish",
    type: "path",
    default: "",
    scope: ["dev"],
    desc: "发布用的私钥。留空用 ssh 默认身份。",
  },
  {
    key: "KNOT_DEPLOY_VERIFY_URL",
    group: "publish",
    type: "url",
    default: "",
    scope: ["dev"],
    derive: (env) => {
      const host = String(env.KNOT_DEPLOY_SSH || "").split("@").pop();
      const port = env.KNOT_PORT || 8080;
      return host ? `http://${host}:${port}/api/health` : "";
    },
    desc: "部署后探活的地址。留空按 http://<实例主机>:<KNOT_PORT>/api/health 推导。",
  },
  {
    key: "KNOT_DEPLOY_KEEP",
    group: "publish",
    type: "int",
    default: 5,
    min: 1,
    max: 50,
    desc: "实例主机上保留几个历史发布包。当前版本和回滚目标永远保留，多的按时间清掉。",
  },
  {
    key: "KNOT_ARTIFACT_DIR",
    group: "publish",
    type: "path",
    default: "",
    scope: ["dev"],
    derive: (env, ctx) => (ctx.root ? `${ctx.root}/artifacts` : ""),
    desc: "开发机上构建产物（发布包和校验和）的输出目录。留空用 <knot-platform>/artifacts。",
  },
  {
    key: "KNOT_SYSTEMD_DIR",
    group: "platform",
    type: "path",
    default: "/etc/systemd/system",
    scope: ["platform"],
    desc: "Linux 实例主机上 systemd unit 的安装目录。",
  },
  {
    key: "KNOT_SERVICE_USER",
    group: "platform",
    type: "string",
    default: "knot",
    scope: ["platform"],
    desc: "Linux 实例主机上跑 Knot Backend 的系统账号。需对该读的目录有权限。",
  },

  // ---- 公网入口 ----
  {
    key: "KNOT_ENTRY_ENABLED",
    group: "entry",
    type: "bool",
    default: 0,
    desc: "1 表示部署时由这台机器把 WebUI 与 nginx 配置推到 KNOT_ENTRY_SSH；0 表示不碰入口主机（只在本机，或入口已由中枢自动接通）。",
  },
  {
    key: "KNOT_ENTRY_SSH",
    group: "entry",
    type: "string",
    default: "",
    scope: ["dev", "platform"],
    desc: "入口主机的 ssh 目标。",
    example: "ec2-user@<入口主机>",
  },
  {
    key: "KNOT_ENTRY_SSH_KEY",
    group: "entry",
    type: "path",
    default: "",
    scope: ["dev"],
    desc: "在开发机上推页面用的私钥。留空用 ssh 默认身份或 ssh-agent；入口主机通常不认 id_rsa，要用专用的部署钥，例如 $HOME/.ssh/<专用部署钥>。",
  },
  {
    key: "KNOT_ENTRY_PUSH_KEY",
    runtime: "KNOT_ENTRY_PUSH_KEY",
    group: "entry",
    type: "path",
    default: "$HOME/.ssh/knot-entry-publish",
    scope: ["platform"],
    desc: "在实例主机上推公开快照用的私钥，可以和 KNOT_ENTRY_SSH_KEY 不是同一把。",
  },
  {
    key: "KNOT_ENTRY_WEB_ROOT",
    group: "entry",
    type: "path",
    default: "/var/www/knot",
    scope: ["entry"],
    desc: "入口主机上放 WebUI 的目录。",
  },
  {
    key: "KNOT_ENTRY_CONF",
    group: "entry",
    type: "path",
    default: "/etc/nginx/conf.d/knot.conf",
    scope: ["entry"],
    desc: "入口主机上的 nginx 站点配置路径。",
  },
  {
    key: "KNOT_ENTRY_WEB_OWNER",
    group: "entry",
    type: "string",
    default: "nginx:nginx",
    scope: ["entry"],
    desc: "WebUI 目录的属主。",
  },
  {
    key: "KNOT_ENTRY_CACHE_DIR",
    group: "entry",
    type: "path",
    default: "/var/cache/nginx/knot_uploads",
    scope: ["entry"],
    desc: "上传文件的反向代理缓存目录。",
  },
  {
    key: "KNOT_ENTRY_CACHE_ZONE",
    group: "entry",
    type: "string",
    default: "knot_uploads",
    scope: ["entry"],
    desc: "nginx proxy_cache 区名。",
  },
  {
    key: "KNOT_ENTRY_CACHE_SIZE",
    group: "entry",
    type: "size",
    default: "2g",
    scope: ["entry"],
    desc: "缓存上限，nginx 写法，如 2g。",
  },
  {
    key: "KNOT_ENTRY_MAX_BODY",
    group: "entry",
    type: "size",
    default: "52m",
    scope: ["entry"],
    desc: "入口主机接受的请求体上限。必须大于后端附件上限，否则大文件在 nginx 就被截断。",
  },
  {
    key: "KNOT_ENTRY_ACCESS_LOG",
    group: "entry",
    type: "path",
    default: "/var/log/nginx/knot-access.log",
    scope: ["entry"],
    desc: "入口访问日志。同一台入口主机上的子域共用一个文件，按 $host 分；中枢的流量聚合读它。",
  },
  {
    key: "KNOT_ENTRY_PROXY_PORT",
    group: "entry",
    type: "port",
    default: 18080,
    scope: ["entry", "platform"],
    desc: "入口回源端口。nginx 把 /api 转到这里，隧道再转回实例主机。",
  },
  {
    key: "KNOT_ENTRY_SSL",
    group: "entry",
    type: "bool",
    default: 1,
    scope: ["entry"],
    desc: "1 监听 443 并配证书；0 只监听 80，证书还没签好时用。",
  },
  {
    key: "KNOT_ENTRY_CERT",
    group: "entry",
    type: "path",
    default: "",
    scope: ["entry"],
    derive: (env) => {
      // 官方只支持一个入口，证书跟着这个入口的域名走。
      const host = String(env.KNOT_DOMAIN || "").trim() || hostOf(env.KNOT_PUBLIC_ORIGIN);
      return host ? `/etc/letsencrypt/live/${host}/fullchain.pem` : "";
    },
    desc: "证书链。留空由 KNOT_DOMAIN 推导。",
  },
  {
    key: "KNOT_ENTRY_KEY",
    group: "entry",
    type: "path",
    default: "",
    scope: ["entry"],
    derive: (env) => {
      const host = String(env.KNOT_DOMAIN || "").trim() || hostOf(env.KNOT_PUBLIC_ORIGIN);
      return host ? `/etc/letsencrypt/live/${host}/privkey.pem` : "";
    },
    desc: "证书私钥。留空由 KNOT_DOMAIN 推导。",
  },
  {
    key: "KNOT_ENTRY_RELOAD_CMD",
    group: "entry",
    type: "string",
    default: "sudo systemctl reload nginx",
    scope: ["entry"],
    desc: "改完 nginx 配置后的 reload 命令。非 systemd 的机器改成自己的。",
  },

  // ---- 回源隧道 ----
  {
    key: "KNOT_TUNNEL",
    group: "tunnel",
    type: "bool",
    default: 0,
    scope: ["platform"],
    desc: "1 表示实例主机主动连出建隧道，让 xknot.si 子域入口能回源。没有入口时留 0；本机也接了子域时由 sites/<站点>/tunnel.env 写 1。",
  },
  {
    key: "KNOT_TUNNEL_SSH",
    group: "tunnel",
    type: "string",
    default: "",
    scope: ["platform"],
    derive: (env) => {
      const host = String(env.KNOT_ENTRY_SSH || "").split("@").pop();
      return host ? `knot-tunnel@${host}` : "";
    },
    desc: "隧道账号。留空是 knot-tunnel@<KNOT_ENTRY_SSH 的主机>。",
  },
  {
    key: "KNOT_TUNNEL_KEY",
    group: "tunnel",
    type: "path",
    default: "$HOME/.ssh/knot-entry",
    scope: ["platform"],
    desc: "实例主机上建隧道用的私钥。相对路径按站点目录（sites/<站点>/）解析；自动接通写的 tunnel.env 用 tunnel_ed25519。",
  },
  {
    key: "KNOT_TUNNEL_LOCAL_PORT",
    group: "tunnel",
    type: "port",
    default: "",
    scope: ["platform"],
    derive: (env) => env.KNOT_PORT || 8080,
    desc: "隧道落回本机的端口。留空等于 KNOT_PORT。",
  },
  {
    key: "KNOT_TUNNEL_REMOTE_PORT",
    group: "tunnel",
    type: "port",
    default: "",
    scope: ["platform"],
    derive: (env) => env.KNOT_ENTRY_PROXY_PORT || 18080,
    desc: "隧道在入口主机上占用的端口。留空等于 KNOT_ENTRY_PROXY_PORT。",
  },
];

// 实例运行时键：只写在实例主机的 sites/<站点>/platform.env。
// 文件里已经有这个键就不覆盖，运维改过的值必须留住。
const PLATFORM_KEYS = [
  {
    key: "KNOT_SITE",
    group: "site",
    type: "string",
    default: "",
    computed: true,
    desc: "由部署脚本写入：站点目录名（sites/<站点>）。实例主机上的脚本靠它找到这份配置。",
  },
  {
    key: "DATABASE_URL",
    group: "platform",
    type: "string",
    default: "",
    secret: true,
    computed: true,
    // 启动闸口读的是这个运行时名字。外部库连接串写错（缺主机、拼错端口）时
    // 以前一路放行，进程带着错串跑起来，报错落在第一条 SQL 上。
    pattern: /^postgres(?:ql)?:\/\/[^\s]+$/,
    desc: "由部署脚本写入：local 模式是 postgres://knot@127.0.0.1:<KNOT_PGPORT>/knot，external 模式取 KNOT_DATABASE_URL。",
  },
  {
    key: "STATIC_WEB_DIR",
    group: "platform",
    type: "path",
    default: "",
    computed: true,
    desc: "由部署脚本写入：<knot-platform>/web/dist。",
  },
  {
    key: "KNOT_AGENT_ENV_DIR",
    group: "platform",
    type: "path",
    default: "",
    computed: true,
    desc: "由部署脚本写入：<knot-platform>/sites/<站点>/agents。智能体的账号文件放这里。",
  },
  {
    key: "KNOT_PROFILE_FILE",
    group: "platform",
    type: "path",
    default: "",
    computed: true,
    desc: "由部署脚本写入：<knot-platform>/sites/<站点>/profile.json。站点档案（自述区）在这里，主理人在 /admin 里编辑。",
  },
  {
    key: "KNOT_DISCOVER_PUSH_CMD",
    group: "entry",
    type: "string",
    default: "",
    computed: true,
    desc: "由部署脚本写入：开启入口时是 push-discover.sh，关闭时为空。",
  },

  // ---- 邮件 ----
  {
    key: "SMTP_HOST",
    group: "mail",
    type: "string",
    default: "",
    desc: "SMTP 主机。未配置时登录接口返回 mail_unavailable，登录密钥寄不出去。",
    example: "smtp.example.com",
  },
  { key: "SMTP_PORT", group: "mail", type: "port", default: 587, desc: "SMTP 端口。" },
  {
    key: "SMTP_SECURE",
    group: "mail",
    type: "bool",
    default: 0,
    desc: "465 端口从第一包就要 TLS，写 1；587 用 STARTTLS 时保持 0。",
  },
  { key: "SMTP_USER", group: "mail", type: "string", default: "", desc: "SMTP 用户名。" },
  { key: "SMTP_PASS", group: "mail", type: "string", default: "", secret: true, desc: "SMTP 密码。" },
  { key: "SMTP_FROM", group: "mail", type: "string", default: "", desc: "发信地址。" },
  { key: "MAIL_FROM", group: "mail", type: "string", default: "", desc: "发信地址，优先于 SMTP_FROM。" },

  // ---- 经济 ----
  { key: "KNOT_DEFAULT_PRICE", group: "economy", type: "int", default: 10, min: 0, desc: "默认标价（积分）。" },
  { key: "KNOT_PRICE_MIN", group: "economy", type: "int", default: 0, min: 0, desc: "作者可标的最低积分。" },
  { key: "KNOT_PRICE_MAX", group: "economy", type: "int", default: 100, min: 0, desc: "作者可标的最高积分。" },
  {
    key: "KNOT_PUBLISH_SERVICE_FEE_PER_MB",
    group: "economy",
    type: "int",
    default: 1,
    min: 0,
    desc: "发布服务费：每 MB 附件收多少积分，向上取整。",
  },
  {
    key: "KNOT_DOWNLOAD_SERVICE_FEE_PER_MB",
    group: "economy",
    type: "int",
    default: 1,
    min: 0,
    desc: "下载服务费：每 MB 附件收多少积分，加在作者标价之上。",
  },
  {
    key: "KNOT_SERVICE_FEE_CAP",
    group: "economy",
    type: "int",
    default: 10,
    min: 0,
    desc: "单次服务费上限。0 表示不封顶。",
  },
  {
    key: "KNOT_SALE_TTL_HOURS",
    group: "economy",
    type: "int",
    default: 72,
    min: 1,
    desc: "出售帖有效期（小时）。出售帖 = 有可下载附件且有标价的 post/fastpost；零价附件帖不算出售帖，不过期。到期自动下架，作者可再次开放。",
  },
  { key: "KNOT_SIGNUP_GRANT", group: "economy", type: "int", default: 100, min: 0, desc: "新账户注册赠送积分。" },
  { key: "KNOT_GRANT_MAX", group: "economy", type: "int", default: 100000, min: 0, desc: "单次赠送上限。" },
  {
    key: "KNOT_POINT_USD_CENTS",
    group: "economy",
    type: "int",
    default: 1,
    min: 0,
    desc: "每积分的美元价，用美分表示（1 = 0.01 美元）。",
  },
  {
    key: "KNOT_RETRIEVAL_PRICE",
    group: "economy",
    type: "int",
    default: 10,
    min: 0,
    desc: "信息检索价：每次检索的统一定价，下载检索结果时收。",
  },
  { key: "KNOT_RECHARGE_USD", group: "economy", type: "int", default: 0, min: 0, desc: "累计充值（美元）。本期占位 0。" },
  {
    key: "KNOT_MONTHLY_OPEX_USD",
    group: "economy",
    type: "int",
    default: 10000,
    min: 0,
    desc: "月运营开支（美元），用于盈亏平衡测算。",
  },

  // ---- 消费券 ----
  {
    key: "KNOT_COUPON_FACE",
    group: "coupon",
    type: "int",
    default: "",
    min: 0,
    // 与 backend/src/points.js 的夹取保持同一口径：先夹价目区间，再取默认价。
    // 直接用未夹取的 KNOT_DEFAULT_PRICE 时，schema 算出的券面值和代码发出去的券不一样。
    derive: (env) => clampedDefaultPrice(env),
    desc: "券面值（积分）。留空等于夹进 [KNOT_PRICE_MIN, KNOT_PRICE_MAX] 之后的 KNOT_DEFAULT_PRICE。",
  },
  // 0 天的券等于「发了就过期」，没人能领到；要关掉发券用 KNOT_COUPON_SIGNUP=0。
  { key: "KNOT_COUPON_TTL_DAYS", group: "coupon", type: "int", default: 30, min: 1, desc: "券有效期（天）。" },
  { key: "KNOT_COUPON_MAX", group: "coupon", type: "int", default: 1, min: 0, desc: "每个账户持有的未使用券上限。" },
  {
    key: "KNOT_COUPON_SIGNUP",
    group: "coupon",
    type: "int",
    default: 1,
    min: 0,
    max: 1,
    desc: "新注册自动发一张：1 开，0 关。",
  },

  // ---- 存储 ----
  {
    key: "KNOT_UPLOAD_QUOTA_BYTES",
    group: "storage",
    type: "bytes",
    default: 1024 * MiB,
    desc: "每人上传字节上限。0 表示不限。",
  },
  { key: "KNOT_GC_GRACE_HOURS", group: "storage", type: "int", default: 24, min: 0, desc: "回收无引用上传的宽限期（小时）。" },
  {
    key: "KNOT_UPLOAD_IMAGE_MAX_BYTES",
    group: "storage",
    type: "bytes",
    default: 8 * MiB,
    desc: "单张图片上限。同时要小于 KNOT_ENTRY_MAX_BODY。",
  },
  {
    key: "KNOT_UPLOAD_AUDIO_MAX_BYTES",
    group: "storage",
    type: "bytes",
    default: 8 * MiB,
    desc: "单条音频上限。",
  },
  {
    key: "KNOT_UPLOAD_ATTACHMENT_MAX_BYTES",
    group: "storage",
    type: "bytes",
    default: 50 * MiB,
    desc: "单个附件上限。必须小于 KNOT_ENTRY_MAX_BODY。",
  },
  {
    key: "DISCOVER_BOARD_DIR",
    group: "storage",
    type: "path",
    default: "",
    desc: "公开快照目录。留空用 <UPLOAD_DIR>/board。",
  },

  // ---- 检索 ----
  {
    key: "KNOT_SEARCH_CANDIDATES",
    group: "search",
    type: "int",
    default: 2000,
    min: 1,
    max: 50000,
    desc: "一次检索最多收进内存打分的候选行数。索引先挡掉不可能命中的行，这里是内存墙。",
  },
  {
    key: "KNOT_SEARCH_RESULTS",
    group: "search",
    type: "int",
    default: 30,
    min: 1,
    max: 200,
    desc: "一次检索最多返回几条。",
  },
  {
    key: "KNOT_SEARCH_Q_MAX",
    group: "search",
    type: "int",
    default: 120,
    min: 1,
    max: 2000,
    desc: "检索词长度上限（字符）。超出的部分截断，不报错。",
  },
  {
    key: "KNOT_SEARCH_CACHE_TTL",
    group: "search",
    type: "int",
    default: 30,
    min: 0,
    max: 3600,
    desc: "检索结果缓存时长（秒）。0 表示不缓存。内容有变更时会立即作废。",
  },
  {
    key: "KNOT_SEARCH_RATE_PER_MIN",
    group: "search",
    type: "int",
    default: 120,
    min: 0,
    desc: "同一身份每分钟的检索次数上限。0 表示不限。",
  },
  {
    key: "KNOT_RETRIEVAL_RATE_PER_HOUR",
    group: "search",
    type: "int",
    default: 10,
    min: 0,
    desc: "单个账号每小时能提交多少次信息检索。0 表示不限。",
  },
  {
    key: "KNOT_RETRIEVAL_CONCURRENCY",
    group: "search",
    type: "int",
    default: 2,
    min: 1,
    max: 32,
    desc: "信息检索员同时处理几个任务。",
  },
  {
    key: "KNOT_RETRIEVAL_MAX_ATTEMPTS",
    group: "search",
    type: "int",
    default: 3,
    min: 1,
    max: 10,
    desc: "单个检索任务最多尝试几次。次数随任务落库，重启不清零。",
  },
  {
    key: "KNOT_REVIEW_CONCURRENCY",
    group: "search",
    type: "int",
    default: 2,
    min: 1,
    max: 32,
    desc: "终审队列同时处理几条。检索会同时产生 wish 与 wishRespond 两条待审记录。",
  },
  {
    key: "KNOT_SEARCH_EVENT_RETENTION_DAYS",
    group: "search",
    type: "int",
    default: 90,
    min: 0,
    desc: "检索打点 search_events 保留天数。0 表示永久保留。",
  },

  // ---- 智能体 ----
  { key: "OPENCLAW_BIN", group: "agent", type: "string", default: "openclaw", desc: "openclaw 可执行文件。" },
  { key: "OPENCLAW_PROCESS_TIMEOUT", group: "agent", type: "int", default: 120, min: 1, desc: "单次智能体调用的超时（秒）。" },
  {
    key: "OPENCLAW_RETRIEVAL_TIMEOUT",
    group: "agent",
    type: "int",
    default: 300,
    min: 1,
    desc: "信息检索调用的超时（秒）。",
  },
  { key: "OPENCLAW_INTEL_AGENT", group: "agent", type: "string", default: "knot-intel", desc: "情报智能体名。" },
  { key: "OPENCLAW_RETRIEVAL_AGENT", group: "agent", type: "string", default: "knot-retrieval", desc: "检索智能体名。" },

  // ---- 管理令牌 ----
  {
    key: "KNOT_ADMIN_TOKEN",
    group: "admin",
    type: "string",
    default: "",
    secret: true,
    desc: "内网管理接口 /api/admin 和管理后台 /admin 的令牌。由 ensure-openclaw.sh 写入，运维不要手改。",
  },
  {
    key: "KNOT_ADMIN_ORIGIN",
    group: "admin",
    type: "url",
    default: "",
    desc: "管理后台链接里写死的内网地址，例如 http://192.0.2.10:8080。留空时按 KNOT_BIND_HOST 与网卡推断；多网卡或隧道拓扑下可以用它写死，绑回环时也能给出内网链接。",
    example: "http://192.0.2.10:8080",
  },
];

// XKnot 接入：写在 sites/<站点>/xknot.env。
//
// 这些值只有一个来源——中枢（xknot.si）在审核通过或交接时签发，键名与语义见
// xknot.si/docs/FEDERATION.md 第 7.4 节。部署脚本不推导、不猜、不改写它们；
// 运维也不该手填。拿到中枢给的接入件后跑
//   ./ops/scripts/join-xknot.sh --payload <文件>
// 只写这一个文件，不重部署；重启 Backend 后读取。
//
// 文件名与位置是本实现的约定，不是联邦契约：中枢只规定键名和语义。
// 不接入联邦的实例不需要这个文件：部署、登录、发帖、积分全部照常。
const XKNOT_KEYS = [
  {
    key: "XKNOT_INSTANCE_ID",
    group: "xknot",
    type: "string",
    default: "",
    required: true,
    pattern: /^[a-z0-9][a-z0-9-]{1,31}$/,
    desc: "中枢清单里的实例 id（小写字母、数字、短横线）。会写进 /api/health 的 instance，供中枢核对身份。",
    example: "wang",
  },
  {
    key: "XKNOT_HUB_ORIGIN",
    group: "xknot",
    type: "url",
    default: "https://xknot.si",
    desc: "接入的中枢地址。委托发信地址由它推导。",
    example: "https://xknot.si",
  },
  {
    key: "XKNOT_HUB_RELAY_URL",
    group: "xknot",
    type: "url",
    default: "",
    desc: "委托发信的完整地址。留空时按 XKNOT_HUB_ORIGIN 推导，只在换入口时手写。",
    example: "https://xknot.si/api/federation/mail",
  },
  {
    key: "XKNOT_HUB_RELAY_TOKEN",
    group: "xknot",
    type: "string",
    default: "",
    secret: true,
    pattern: /^xkr_[A-Za-z0-9_-]{8,}$/,
    desc: "中枢签发的委托发信凭据。只存在于 xknot.env；不进邮件、不进版本库、不进发布包。",
  },
  {
    key: "XKNOT_ISSUED_URL",
    group: "xknot",
    type: "url",
    default: "",
    desc: "中枢签发的对外地址。签发区的一部分，与清单里的 url 一致；节点只读。",
    example: "https://wang.xknot.si",
  },
  {
    key: "XKNOT_ISSUED_AT",
    group: "xknot",
    type: "string",
    default: "",
    desc: "签发日期（YYYY-MM-DD）。签发区的一部分，对外报作 since。",
    example: "2026-10-20",
  },
  {
    key: "XKNOT_TIER",
    group: "xknot",
    type: "enum",
    // free / paid 是现在中枢签发的两档；demo / partner / community 是早期名单，
    // 仍认它们，免得老实例把接入件拿过来重启就起不来。
    values: ["free", "paid", "demo", "partner", "community"],
    default: "",
    desc: "中枢签发的层级：free 或 paid（早期的 demo / partner / community 仍可读）。签发区的一部分；留空时对外不报这一项。",
  },
  {
    key: "XKNOT_STATUS",
    group: "xknot",
    type: "enum",
    values: ["pending", "active", "suspended", "retired"],
    default: "",
    desc: "中枢签发的状态。签发区的一部分；留空时对外不报这一项。",
  },
];

// 公网入口键：一个站点一份 sites/<站点>/entry.<标签>.xknot.si.env。
//
// 官方只支持一个入口，域名必须是 xknot.si 签发的二级子域（<标签>.xknot.si）。
// 入口文件是叠加层：只写与 site.env 不同的项，其余沿用；KNOT_DOMAIN 必须写，且要与文件名一致。
const ENTRY_KEYS = [
  {
    key: "KNOT_ENTRY_SERVE",
    group: "entry",
    type: "enum",
    values: ["static", "proxy"],
    default: "static",
    scope: ["entry"],
    desc: "static：首页与 /assets 从入口主机上的磁盘出，只有动态走隧道；proxy：连首页也回源到实例。",
  },
];

function normalize(entry, file) {
  return {
    file,
    scope: entry.scope || ["platform"],
    required: entry.required ?? false,
    secret: entry.secret ?? false,
    computed: entry.computed ?? false,
    ...entry,
  };
}

export const KEYS = [
  ...SITE_KEYS.map((entry) => normalize(entry, "site")),
  ...PLATFORM_KEYS.map((entry) => normalize(entry, "platform")),
  ...XKNOT_KEYS.map((entry) => normalize(entry, "xknot")),
  ...ENTRY_KEYS.map((entry) => normalize(entry, "entry")),
];

const BY_KEY = new Map(KEYS.map((entry) => [entry.key, entry]));

export function keyEntry(key) {
  return BY_KEY.get(key) || null;
}

// 运行时键名 -> 定义。部署键允许改名为别的运行时名（KNOT_PORT -> PORT）。
const BY_RUNTIME = new Map();
for (const entry of KEYS) {
  if (entry.file === "site" && entry.runtime) BY_RUNTIME.set(entry.runtime, entry);
  if (entry.file === "platform" || entry.file === "xknot") BY_RUNTIME.set(entry.key, entry);
}

export function runtimeEntry(runtimeKey) {
  return BY_RUNTIME.get(runtimeKey) || null;
}

export function runtimeKeySet() {
  return new Set(BY_RUNTIME.keys());
}

export function isRequired(entry, env) {
  return typeof entry.required === "function" ? Boolean(entry.required(env)) : Boolean(entry.required);
}

export function runtimeName(entry) {
  if (entry.file !== "site") return entry.key;
  return entry.runtime || "";
}

export function expandPath(value, home = process.env.HOME || "") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text === "~") return home;
  if (text.startsWith("~/")) return `${home}${text.slice(1)}`;
  return text.replace(/^\$HOME(?=\/|$)/, home);
}

// 把 site.env 里的值和默认值合成一个完整视图。不改写文件，只用于校验和生成运行时配置。
// expand: 只有真正写进运行时文件时才展开 ~ 和 $HOME；展示远端路径时保持字面量。
export function resolve(entry, env, ctx = {}) {
  const context = { root: "", home: process.env.HOME || "", expand: false, ...ctx };
  const raw = env[entry.key];
  let value = !isBlank(raw) ? String(raw).trim() : "";
  if (!value && typeof entry.derive === "function") {
    const derived = entry.derive(env, context);
    if (!isBlank(derived)) value = String(derived).trim();
  }
  if (!value && !isBlank(entry.default)) value = String(entry.default);
  if (entry.type === "path" && context.expand) value = expandPath(value, context.home);
  return value;
}

function sizeToBytes(value) {
  const match = /^(\d+(?:\.\d+)?)\s*([kmg])?$/i.exec(String(value ?? "").trim());
  if (!match) return 0;
  const n = Number(match[1]);
  const unit = (match[2] || "").toLowerCase();
  const scale = unit === "g" ? 1024 ** 3 : unit === "m" ? 1024 ** 2 : unit === "k" ? 1024 : 1;
  return Math.round(n * scale);
}

const TRUE_WORDS = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS = new Set(["0", "false", "no", "off", ""]);

function validateValue(entry, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  switch (entry.type) {
    case "int":
    case "port":
    case "bytes": {
      if (!/^\d+$/.test(value)) return `${entry.key} 要是整数，现在是 "${value}"。`;
      const n = Number(value);
      // 金额、TTL、日期都要拿它做算术：超出安全整数的值能过正则，却会在
      // 求和/加时间时悄悄丢精度（Date 直接变 Invalid Date）。
      if (!Number.isSafeInteger(n)) return `${entry.key} 超出安全整数范围：${value}。`;
      if (entry.type === "port" && (n < 1 || n > 65535)) return `${entry.key} 要是 1-65535 的端口，现在是 ${n}。`;
      if (entry.min != null && n < entry.min) return `${entry.key} 不能小于 ${entry.min}，现在是 ${n}。`;
      if (entry.max != null && n > entry.max) return `${entry.key} 不能大于 ${entry.max}，现在是 ${n}。`;
      return null;
    }
    case "bool": {
      const word = value.toLowerCase();
      if (!TRUE_WORDS.has(word) && !FALSE_WORDS.has(word)) return `${entry.key} 只接受 1/0/true/false/yes/no，现在是 "${value}"。`;
      return null;
    }
    case "enum":
      if (!entry.values.includes(value)) return `${entry.key} 只能是 ${entry.values.join(" / ")}，现在是 "${value}"。`;
      return null;
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `${entry.key} 不是邮箱地址："${value}"。`;
      return null;
    case "url":
      if (!/^https?:\/\/[^\s]+$/i.test(value)) return `${entry.key} 要以 http:// 或 https:// 开头："${value}"。`;
      return null;
    case "size":
      if (!/^\d+(?:\.\d+)?[kmg]?$/i.test(value)) return `${entry.key} 要写成 nginx 的大小，如 52m："${value}"。`;
      // nginx 把 0 解释成「不限制」，而这个类型在别处被当成「实际字节数」用：
      // 0 会被跨键检查跳过，看起来像「没设」。两种含义混在一个值上，宁可写错就报。
      if (sizeToBytes(value) <= 0) return `${entry.key} 不能是 0：0 在 nginx 里表示不限制，不是一个字节数。`;
      return null;
    default:
      if (entry.pattern && !entry.pattern.test(value)) return `${entry.key} 格式不对："${value}"。`;
      return null;
  }
}

export const RULES = [
  {
    id: "entry-ssh",
    when: (env) => truthy(env.KNOT_ENTRY_ENABLED),
    need: ["KNOT_ENTRY_SSH"],
    message: "KNOT_ENTRY_ENABLED=1 时必须配置 KNOT_ENTRY_SSH。不自己推入口时写 KNOT_ENTRY_ENABLED=0。",
  },
  {
    id: "external-db",
    when: (env) => env.KNOT_DB_MODE === "external",
    need: ["KNOT_DATABASE_URL"],
    message: "KNOT_DB_MODE=external 时必须配置 KNOT_DATABASE_URL。",
  },
];

// 只在本机访问、也没有域名的站点：开发者自己跑的那种，不装备份任务是对的。
function isLocalOnlySite(env) {
  if (!isBlank(env.KNOT_DOMAIN)) return false;
  const origin = String(env.KNOT_PUBLIC_ORIGIN || "");
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export const WARNINGS = [
  {
    id: "tunnel-same-port",
    // 端口比较必须按数值：0o18080、18080 都是合法端口写法，字符串比较却说它们不等。
    when: (env) =>
      truthy(env.KNOT_ENTRY_ENABLED) &&
      truthy(env.KNOT_TUNNEL) &&
      Number(env.KNOT_ENTRY_PROXY_PORT || 18080) === Number(env.KNOT_PORT || 8080),
    message: "回源端口和 Backend 端口相同。入口如果和平台同机，会撞端口。",
  },
  {
    id: "backup-off",
    // 留空是「还没决定」，公网站点提醒一句；写 null / none / off 是「决定了不备份」，不再提醒。
    // 三者效果一样：都不装备份任务，脚本也不会去建目录。
    when: (env) => isBlank(env.KNOT_BACKUP_DIR) && !isLocalOnlySite(env),
    message: "KNOT_BACKUP_DIR 为空，不会做备份。上线前建议指到外接盘或另一台机器；确定不备份就写 null。",
  },
  {
    id: "body-limit",
    when: (env) => {
      const body = sizeToBytes(env.KNOT_ENTRY_MAX_BODY || "52m");
      const attachment = Number(env.KNOT_UPLOAD_ATTACHMENT_MAX_BYTES || 50 * MiB);
      return body > 0 && attachment > 0 && attachment >= body;
    },
    message: "附件上限不小于入口请求体上限，大文件会在 nginx 被截断。调大 KNOT_ENTRY_MAX_BODY。",
  },
];

// 跨文件校验：几条规则的左右两边分属不同文件。
//
// 「附件上限必须小于入口请求体上限」读的是 platform.env 与 entry 文件，
// 「隧道端口不能和 Backend 端口相同」读的是 site.env、entry 与 tunnel.env。
// 只在某一份的视图里求值时，另一半永远取不到，条件恒为假——这两条以前就是这样
// 静默失效的。这里把三份配置合成一个视图再跑，只在部署前的 check 里调用。
export function checkCrossFile({ site = {}, platform = {}, entry = {}, tunnel = {} } = {}) {
  const view = { ...site, ...tunnel, ...platform, ...entry };
  const errors = [];
  const warnings = [];
  for (const rule of RULES) {
    if (!rule.when(view)) continue;
    for (const key of rule.need) {
      if (!isBlank(view[key])) continue;
      const message = `${rule.message}（${key}）`;
      if (!errors.includes(message)) errors.push(message);
    }
  }
  for (const warning of WARNINGS) {
    if (warning.when(view) && !warnings.includes(warning.message)) warnings.push(warning.message);
  }
  return { errors, warnings };
}

// sites/<站点>/tunnel.env 是第五份配置：由 /admin 的 XKnot 栏写入，键都在登记表里，
// 但以前没有任何校验器读它。账号或端口写错只能等 ssh -R 失败，那时已经部署完了。
// 这里只做单份文件的校验（键属于隧道组、取值类型对），与另三份的一致性由 checkCrossFile 管。
export function checkTunnelFile(text) {
  const env = parseEnv(text);
  const errors = [];
  const warnings = [];
  for (const [key, value] of Object.entries(env)) {
    const entry = BY_KEY.get(key);
    if (!entry) {
      warnings.push(`${key} 不在 packages/knot-config/src/schema.mjs 里，可能拼错了，或者已经废弃。`);
      continue;
    }
    if (entry.file !== "site" || entry.group !== "tunnel") {
      errors.push(`${key} 不属于回源隧道，写在 sites/<站点>/site.env 或 platform.env，不要写进 tunnel.env。`);
      continue;
    }
    const message = validateValue(entry, value);
    if (message) errors.push(message);
  }
  return { errors, warnings };
}

// 站点文件校验：类型、必填、跨键规则、未知键。
export function checkSite(env) {
  const errors = [];
  const warnings = [];
  for (const entry of KEYS) {
    if (entry.file !== "site") continue;
    const value = String(env[entry.key] ?? "").trim();
    if (!value) {
      if (isRequired(entry, env)) errors.push(`缺少 ${entry.key}。${entry.desc}`);
      continue;
    }
    const message = validateValue(entry, value);
    if (message) errors.push(message);
  }
  // 两种对外形态：只在本机，或接 xknot.si 签发的子域。实例主机是本机还是另一台机器不改变判定：
  // 开发机同样可以领子域，「local」只说明整套系统在一台机器上。
  const domain = String(env.KNOT_DOMAIN || "").trim();
  const origin = String(env.KNOT_PUBLIC_ORIGIN || "").trim();
  if (domain) {
    if (!XKNOT_SUBDOMAIN.test(domain)) {
      errors.push(`KNOT_DOMAIN 必须是 <标签>.xknot.si，现在是 "${domain}"。`);
    }
    const originHost = hostOf(env.KNOT_PUBLIC_ORIGIN);
    if (!originHost) {
      errors.push("接 xknot.si 子域时必须写 KNOT_PUBLIC_ORIGIN=https://<标签>.xknot.si。");
    } else if (!/^https:\/\//i.test(origin)) {
      errors.push("接 xknot.si 子域时 KNOT_PUBLIC_ORIGIN 必须走 https://。");
    } else if (originHost !== domain) {
      errors.push(`KNOT_PUBLIC_ORIGIN 的主机名 ${originHost} 与 KNOT_DOMAIN=${domain} 不一致。`);
    }
    // 自己推入口的站点在这里建隧道。入口由中枢自动接通时，隧道写在 sites/<站点>/tunnel.env，
    // site.env 里保持 0 也不报错——cpswang 就是这种形态。
    if (truthy(env.KNOT_ENTRY_ENABLED) && !truthy(env.KNOT_TUNNEL)) {
      errors.push("KNOT_ENTRY_ENABLED=1 时必须设 KNOT_TUNNEL=1，由实例主机主动连出回源隧道。");
    }
  } else {
    if (truthy(env.KNOT_ENTRY_ENABLED)) {
      errors.push("KNOT_ENTRY_ENABLED=1 是「自己推入口」，必须写 KNOT_DOMAIN=<标签>.xknot.si。");
    }
    if (origin && !isLocalOnlySite(env)) {
      errors.push("不接子域时 KNOT_PUBLIC_ORIGIN 必须是 http://127.0.0.1:<端口> 或 http://localhost:<端口>；独立域名或内网公开部署属于用户改造范围。");
    } else if (origin) {
      // 对外地址和监听端口是两行，改端口时最容易只改一处。写错时本机探活不看公网，
      // 错的地址会一路进分享链接、登录邮件和 sitemap，直到有人点不开才发现。
      const port = urlPort(origin);
      const backendPort = Number(env.KNOT_PORT || 8080);
      if (port && backendPort && port !== backendPort) {
        errors.push(`KNOT_PUBLIC_ORIGIN 的端口 ${port} 与 KNOT_PORT=${backendPort} 不一致，改端口时两处要一起改。`);
      }
    }
    if (truthy(env.KNOT_TUNNEL)) {
      errors.push("不接子域时不建回源隧道；请设 KNOT_TUNNEL=0。");
    }
  }
  for (const rule of RULES) {
    if (!rule.when(env)) continue;
    for (const key of rule.need) {
      if (!isBlank(env[key])) continue;
      const message = `${rule.message}（${key}）`;
      if (!errors.includes(message)) errors.push(message);
    }
  }
  for (const warning of WARNINGS) {
    if (warning.when(env)) warnings.push(warning.message);
  }
  const known = new Set(SITE_KEYS.map((entry) => entry.key));
  for (const key of Object.keys(env)) {
    if (known.has(key)) continue;
    const entry = BY_KEY.get(key);
    if (entry?.file === "xknot") {
      errors.push(`${key} 是 XKnot 接入项，写在 sites/<站点>/xknot.env，不要写进 site.env。`);
      continue;
    }
    if (entry?.file === "platform") {
      errors.push(`${key} 是实例运行时项，写在 sites/<站点>/platform.env，不要写进 site.env。`);
      continue;
    }
    if (entry?.file === "entry") {
      errors.push(`${key} 是公网入口项，写在 sites/<站点>/entry.<标签>.xknot.si.env，不要写进 site.env。`);
      continue;
    }
    warnings.push(`${key} 不在 packages/knot-config/src/schema.mjs 里，可能拼错了，或者已经废弃。`);
  }
  return { errors, warnings };
}

// 公网入口文件校验：一个文件描述一个公网入口。
//
// 不在这里查「入口文件是否与 site.env 一致」——那要看目录，由部署脚本做。
// 这里只保证单份文件自身成立：域名写了、类型对、没写错作用域的键。
export function checkEntryFile(env, { file = "" } = {}) {
  const errors = [];
  const warnings = [];

  // 入口文件是叠加层：site.env 里的键在这里都能覆盖。所以站点键写进来是合法的，
  // 但同样要按类型校验——KNOT_PORT=eighty 写在这里，部署脚本会照着渲染 nginx。
  for (const entry of [...ENTRY_KEYS, ...SITE_KEYS]) {
    const value = String(env[entry.key] ?? "").trim();
    if (!value) continue;
    const message = validateValue(entry, value);
    if (message) errors.push(message);
  }

  const host = String(env.KNOT_DOMAIN || "").trim();
  if (!host) {
    errors.push("公网入口文件必须写 KNOT_DOMAIN=<这个入口的域名>，它决定 server_name、证书路径与清单条目。");
  } else if (!XKNOT_SUBDOMAIN.test(host)) {
    errors.push(`KNOT_DOMAIN 必须是 xknot.si 签发的二级子域（<标签>.xknot.si），现在是 "${host}"。`);
  } else if (file) {
    // 文件名就是域名，改域名时最容易只改一处。
    const expected = `entry.${host}.env`;
    const base = String(file).split("/").pop();
    if (base !== expected) {
      errors.push(`文件名与 KNOT_DOMAIN 不一致：KNOT_DOMAIN=${host}，文件名应为 ${expected}。`);
    }
  }

  // 不在这里判断证书与静态根「取不取得到」：SSL 只能是 1/0，证书与私钥都能由 KNOT_DOMAIN
  // 推导，静态根也有非空默认值，任何「解析后为空」的分支都不可达——写成校验只会让人
  // 以为查过了。真正的检查在入口主机上：push-entry.sh 先落站再跑 nginx -t，
  // ssl_certificate 指向不存在的文件会当场失败并整组还原。

  const known = new Set([...ENTRY_KEYS.map((entry) => entry.key)]);
  // 入口文件是叠加层，可以覆盖 site.env 的键，所以登记的站点键都算已知。
  for (const entry of SITE_KEYS) known.add(entry.key);
  for (const key of Object.keys(env)) {
    if (known.has(key)) continue;
    const entry = BY_KEY.get(key);
    if (entry?.file === "platform") {
      errors.push(`${key} 是实例运行时项，写在 sites/<站点>/platform.env，不要写进公网入口文件。`);
      continue;
    }
    if (entry?.file === "xknot") {
      errors.push(`${key} 是 XKnot 接入项，写在 sites/<站点>/xknot.env，不要写进公网入口文件。`);
      continue;
    }
    warnings.push(`${key} 不在 packages/knot-config/src/schema.mjs 里，可能拼错了，或者已经废弃。`);
  }

  return { errors, warnings };
}

// 这些键只属于开发机或入口，实例主机的运行时文件里出现就是配错了。
export const FORBIDDEN_PLATFORM_KEYS = [
  "KNOT_ENTRY_SSH_KEY",
  "KNOT_DEPLOY_SSH",
  "KNOT_DEPLOY_SSH_KEY",
  "KNOT_ENTRY_CERT",
  "KNOT_ENTRY_KEY",
];

// 实例运行时文件校验：类型、未知键、跨机泄露、权限。
export function checkPlatform(text, { mode = null } = {}) {
  const env = parseEnv(text);
  const errors = [];
  const warnings = [];
  const known = runtimeKeySet();

  const forbidden = new Set(FORBIDDEN_PLATFORM_KEYS);
  for (const [key, value] of Object.entries(env)) {
    if (forbidden.has(key)) {
      errors.push(`${key} 是开发机或入口的键，不该写进实例主机的运行时配置。`);
      continue;
    }
    if (!known.has(key)) {
      warnings.push(`${key} 不在实例运行时配置的登记表里，可能拼错了，或者已经废弃。`);
      continue;
    }
    const entry = runtimeEntry(key);
    if (!entry) continue;
    if (entry.file === "site" && !entry.scope.includes("platform")) {
      errors.push(`${key} 只给开发机用，不该出现在实例主机的运行时配置里。`);
      continue;
    }
    if (entry.file === "xknot") {
      errors.push(`${key} 是 XKnot 接入项，写在 sites/<站点>/xknot.env，不要写进 platform.env。`);
      continue;
    }
    const message = validateValue(entry, value);
    if (message) errors.push(message);
  }

  // 价格三元组：三个键各自只有下限，顺序错了不报错，代码侧再悄悄夹一次。
  // 两边夹的口径一旦不同（券面值用的是未夹取的默认价），发出去的券就和配置对不上。
  const priceMin = Number(env.KNOT_PRICE_MIN ?? 0) || 0;
  const priceMax = Number(env.KNOT_PRICE_MAX ?? 100) || 0;
  const defaultPrice = Number(env.KNOT_DEFAULT_PRICE ?? 10) || 0;
  if (priceMin > priceMax) {
    errors.push(`KNOT_PRICE_MIN=${priceMin} 大于 KNOT_PRICE_MAX=${priceMax}；作者可标的区间是空的。`);
  } else if (defaultPrice < priceMin || defaultPrice > priceMax) {
    errors.push(
      `KNOT_DEFAULT_PRICE=${defaultPrice} 不在 [KNOT_PRICE_MIN=${priceMin}, KNOT_PRICE_MAX=${priceMax}] 之间；标价会被静默夹到区间里。`
    );
  }

  // 两个发信地址都填且不同时，实际用的是 MAIL_FROM。心里填的是 SMTP_FROM 的人会以为生效了。
  const smtpFrom = String(env.SMTP_FROM ?? "").trim();
  const mailFrom = String(env.MAIL_FROM ?? "").trim();
  if (smtpFrom && mailFrom && smtpFrom !== mailFrom) {
    warnings.push(`SMTP_FROM=${smtpFrom} 与 MAIL_FROM=${mailFrom} 不同，实际用 MAIL_FROM；把不用的那行删掉。`);
  }

  if (mode != null && (mode & 0o077) !== 0) {
    const hasSecret = Object.keys(env).some((key) => runtimeEntry(key)?.secret);
    if (hasSecret) warnings.push(`运行时配置权限是 0${(mode & 0o777).toString(8)}，里面有密钥，建议 chmod 600。`);
  }
  return { errors, warnings };
}

// XKnot 接入文件校验。
//
// 这个文件生来就带着凭据，所以规则比另外两份更紧：
//   * 写了文件就要有实例 id，否则不知道这份接入属于谁；
//   * 委托发信只要凭据就能用，地址可以按中枢地址推导；写了地址却没凭据是配错了；
//   * 部署键、平台键混进来一律报错，避免又回到「凭据淹在 platform.env 里」。
// 文件不存在是合法的：没接入联邦的实例照样能跑。
export function checkJoin(text, { mode = null, site = null } = {}) {
  const env = parseEnv(text);
  const errors = [];
  const warnings = [];
  const known = new Set(XKNOT_KEYS.map((entry) => entry.key));

  for (const [key, value] of Object.entries(env)) {
    if (!known.has(key)) {
      const entry = BY_KEY.get(key);
      if (entry?.file === "site") {
        errors.push(`${key} 是部署项，写在 sites/<站点>/site.env，不要写进 xknot.env。`);
      } else if (entry?.file === "platform") {
        errors.push(`${key} 是实例运行时项，写在 sites/<站点>/platform.env，不要写进 xknot.env。`);
      } else {
        warnings.push(`${key} 不在 packages/knot-config/src/schema.mjs 里，可能拼错了，或者已经废弃。`);
      }
      continue;
    }
    const message = validateValue(BY_KEY.get(key), value);
    if (message) errors.push(message);
  }

  if (Object.keys(env).length) {
    if (isBlank(env.XKNOT_INSTANCE_ID)) {
      errors.push("缺少 XKNOT_INSTANCE_ID。接入件至少要写明中枢清单里的实例 id。");
    }
    const url = !isBlank(env.XKNOT_HUB_RELAY_URL);
    const token = !isBlank(env.XKNOT_HUB_RELAY_TOKEN);
    if (url && !token) {
      errors.push("写了 XKNOT_HUB_RELAY_URL 却没有 XKNOT_HUB_RELAY_TOKEN，发不出去；要么补凭据，要么删掉地址。");
    }
  }

  if (mode != null && (mode & 0o077) !== 0) {
    warnings.push(`接入配置权限是 0${(mode & 0o777).toString(8)}，里面有委托发信凭据，建议 chmod 600。`);
  }

  // 同一件事有两个中枢地址：KNOT_HUB_ORIGIN（申请去哪个中枢，写在 site.env）与
  // XKNOT_HUB_ORIGIN（联邦与委托发信用哪个中枢，写在 xknot.env）。两者默认值相同，
  // 掩盖了「申请在 A、发信去 B」的错配，所以显式比较一次主机名。
  const siteHub = String(site?.KNOT_HUB_ORIGIN ?? "").trim();
  const joinHub = String(env.XKNOT_HUB_ORIGIN ?? "").trim();
  if (siteHub && joinHub && hostOf(siteHub) && hostOf(joinHub) && hostOf(siteHub) !== hostOf(joinHub)) {
    warnings.push(
      `XKNOT_HUB_ORIGIN=${joinHub} 与 site.env 的 KNOT_HUB_ORIGIN=${siteHub} 不是同一个中枢：申请与委托发信会打到两台机器上。`
    );
  }
  return { errors, warnings };
}

// Backend 启动时校验进程环境。
//   * 值不合法：errors，调用方应直接退出，不要带着错的配置跑；
//   * 必填项缺失：warnings，站点还能跑，只是相关功能不可用（例如没有管理员邮箱）；
// 与 checkSite 的区别：这里读的是 Backend 实际拿到的环境，不是 site.env 文件。
// 未登记的键不在这里查：Backend 的进程环境里还有部署脚本导出的 KNOT_DEPLOY_ROOT、
// KNOT_APP_DIR 等非 schema 变量，逐个报警只会淹没真正的问题。文件由 checkSite /
// checkPlatform 在部署时严格校验。
export function checkRuntime(env = process.env) {
  const errors = [];
  const warnings = [];

  for (const entry of KEYS) {
    const name = runtimeName(entry);
    if (!name) continue;
    const raw = String(env[name] ?? "").trim();
    if (!raw) {
      // 接入项是可选的：没有 xknot.env 就不接联邦。文件存在时是否齐全由 checkJoin 管。
      if (isRequired(entry, env) && entry.file !== "xknot") warnings.push(`缺少 ${name}。${entry.desc}`);
      continue;
    }
    const message = validateValue(entry, raw);
    if (message) errors.push(message);
  }

  return { errors, warnings };
}

// 解析 KEY=value。支持单双引号、行内注释和空行，不做变量展开。
export function parseEnv(text) {
  const env = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    let quote = "";
    let out = "";
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (quote) {
        if (ch === "\\" && quote === '"' && i + 1 < value.length) {
          out += value[i + 1];
          i += 1;
        } else if (ch === quote) {
          quote = "";
        } else {
          out += ch;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "#" && (i === 0 || /\s/.test(value[i - 1]))) {
        break;
      } else {
        out += ch;
      }
    }
    env[match[1]] = out.trim();
  }
  return env;
}

// 生成 .env 时先判断能不能不加引号。这里刻意把 $ ( ) | ` ; & < > " 都放在集合外：
// 它们在 source 时有含义——$(...) 执行命令、$NAME 展开、| ; & 断句。
// 唯一放行的扩展是 $HOME：schema 的默认值（$HOME/.ssh/...）靠它，也是站点配置里
// 唯一用过的一种。其余带 $ 的值会被加引号并把 $ 转义，写进去是什么就读出什么。
const SAFE_UNQUOTED = /^[A-Za-z0-9_@%+.,:/=~^-]+$/;
const DOLLAR_HOME = /\$HOME(?![A-Za-z0-9_])/g;

export function formatValue(value) {
  const text = value == null ? "" : String(value);
  if (!text) return "";
  // 换行会把一行拆成两行写进 .env：读回来时值被截断，后半行成了另一个键。
  // 引号救不了它（parseEnv 按行解析），所以只能拒绝——写盘前就知道，比部署后取值不对好查。
  if (/[\r\n]/.test(text)) throw new Error(`配置值里不能有换行：${JSON.stringify(text)}`);
  const rest = text.replace(DOLLAR_HOME, "");
  if (!text.includes("#") && (rest === "" || SAFE_UNQUOTED.test(rest))) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
}

function commentLines(entry, indent = "") {
  const lines = [`${indent}# ${entry.desc}`];
  if (entry.example) lines.push(`${indent}# 例：${entry.example}`);
  return lines;
}

const SITE_HEADER = `# Knot 站点配置。
#
# 用法：
#   mkdir -p sites/<站点>
#   cp sites/_template/site.env sites/<站点>/site.env
#   按自己的站点改 sites/<站点>/site.env
#
# 站点目录不进版本库（sites/_template 除外）。部署脚本只从这里读站点、主机、路径和端口。
# 这份文件由 packages/knot-config/src/schema.mjs 生成，不要手改；改配置项请改 schema 后跑
#   node ops/scripts/config.mjs template --write
#
# 同一个文件既给 local 部署用，也给 xknot.si 子域部署用。
# 一个站点目录只描述一种部署方式：local 用 KNOT_ENTRY_ENABLED=0，
# 接入 xknot.si 子域用 KNOT_ENTRY_ENABLED=1。`;

const PLATFORM_HEADER = `# 实例运行时配置模板。由 packages/knot-config/src/schema.mjs 生成。
#
# 实例主机上的 sites/<站点>/platform.env 由 deploy-site.sh 写入：
#   * 站点与端口从 sites/<站点>/site.env 来；
#   * 下面的邮件、价格、存储键只在文件里还没有时写入初值，之后归运维。
#
# 这个文件不含站点拓扑；域名、主机、入口、端口写 site.env。
# 也不含任何 XKnot 接入凭据；委托发信与实例 id 写在 xknot.env。`;

const XKNOT_HEADER = `# XKnot 接入配置模板。由 packages/knot-config/src/schema.mjs 生成。
#
# 这份文件不属于部署。它只装中枢（xknot.si）签发的东西：
# 实例 id、中枢地址、签发日期，以及委托发信凭据。键名与语义是联邦契约，
# 见 xknot.si/docs/FEDERATION.md 第 7.4 节；文件名与位置是本实现的约定。
# 由 join-xknot.sh 写入，权限 600。
#
#   ./ops/scripts/join-xknot.sh --payload ~/xknot-access.env
#   ./ops/scripts/join-xknot.sh --status
#
# 不要手填，也不要把它并进 site.env 或 platform.env：
# 部署脚本只读那两份，接入换机器重部署也不用重签。
# 不接入联邦的实例不需要这个文件。
#
# 下面除了中枢地址，都留空——没有接入件就没有接入。`;

// 生成 sites/_template/entry.example.env。
//
// 入口文件是 site.env 的叠加层：写在这里的键会盖掉站点默认值，所以模板只列
// 每个入口必须自己决定的项（域名、静态根、nginx 配置路径、证书、出页方式），
// 其余沿用 site.env。键与说明都从登记表来，别手写第二份——手写的那份一旦
// 落后于 ENTRY_KEYS，改键时不会有人发现。
export const ENTRY_TEMPLATE_KEYS = [
  "KNOT_DOMAIN",
  "KNOT_ENTRY_WEB_ROOT",
  "KNOT_ENTRY_CONF",
  "KNOT_ENTRY_CERT",
  "KNOT_ENTRY_KEY",
  "KNOT_ENTRY_SERVE",
];

const ENTRY_HEADER = `# 一个 xknot.si 子域入口。由 packages/knot-config/src/schema.mjs 生成，不要手改。
#
# 复制成 sites/<站点>/entry.<标签>.xknot.si.env，再把 <标签>.xknot.si 换成下面的 KNOT_DOMAIN。
#
# 官方只支持一个入口，域名必须是 xknot.si 签发的二级子域（<标签>.xknot.si）。
# 它是叠加层：site.env 里的键在这里都能覆盖，没写的沿用 site.env。
#
# 只写「这个入口和站点默认值不一样」的项。KNOT_ENTRY_WEB_ROOT 与 KNOT_ENTRY_CONF
# 必须按这个子域写清，留空等于和别的子域共用同一个静态根与 nginx 配置；
# config.mjs check 会拦住缺失或写错的域名。
#
# 改配置项请改 schema 后跑 node ops/scripts/config.mjs entry-template --write。`;

export function renderEntryExample() {
  const parts = [ENTRY_HEADER];
  for (const key of ENTRY_TEMPLATE_KEYS) {
    const entry = BY_KEY.get(key);
    if (!entry) continue;
    parts.push("");
    parts.push(...commentLines(entry));
    // 这几个按子域决定，模板里留空逼着填：证书由 KNOT_DOMAIN 推导，
    // 静态根与 nginx 配置留空就会和别的子域共用，S20-01 就是这么出的事。
    const perSite = ["KNOT_ENTRY_CERT", "KNOT_ENTRY_KEY", "KNOT_ENTRY_WEB_ROOT", "KNOT_ENTRY_CONF"];
    const value = perSite.includes(key) ? "" : entry.default;
    parts.push(`${key}=${formatValue(value)}`);
  }
  parts.push("");
  return `${parts.join("\n")}\n`;
}

// 生成 sites/_template/site.env。
export function renderSiteExample() {
  const parts = [SITE_HEADER];
  for (const group of GROUPS) {
    const entries = SITE_KEYS.filter((entry) => entry.group === group.id);
    if (!entries.length) continue;
    parts.push(`\n# ---- ${group.label} ----`);
    for (const entry of entries) {
      parts.push(...commentLines(entry));
      const value = entry.secret ? "" : entry.default;
      parts.push(`${entry.key}=${formatValue(value)}`);
    }
  }
  parts.push("");
  return `${parts.join("\n")}\n`;
}

// 生成 sites/_template/platform.env。
export function renderPlatformExample() {
  const parts = [PLATFORM_HEADER];
  for (const group of GROUPS) {
    const entries = PLATFORM_KEYS.filter((entry) => entry.group === group.id && !entry.computed);
    if (!entries.length) continue;
    parts.push(`\n# ---- ${group.label} ----`);
    for (const entry of entries) {
      parts.push(...commentLines(entry));
      const value = entry.secret ? "" : entry.default;
      const line = `${entry.key}=${formatValue(value)}`;
      parts.push(value === "" ? `# ${line}` : line);
    }
  }
  parts.push("");
  return `${parts.join("\n")}\n`;
}

// 生成 sites/_template/xknot.env。
//
// 与另两份模板不同：这份不是「复制去填」，而是「由中枢的接入件写入」。
// 所以除中枢地址外一律留空，写成注释，免得有人照着模板手填一个假 id。
export function renderJoinExample() {
  const parts = [XKNOT_HEADER];
  for (const group of GROUPS) {
    const entries = XKNOT_KEYS.filter((entry) => entry.group === group.id);
    if (!entries.length) continue;
    parts.push(`\n# ---- ${group.label} ----`);
    for (const entry of entries) {
      parts.push(...commentLines(entry));
      const value = entry.key === "XKNOT_HUB_ORIGIN" ? entry.default : "";
      const line = `${entry.key}=${formatValue(value)}`;
      parts.push(value === "" ? `# ${line}` : line);
    }
  }
  parts.push("");
  return `${parts.join("\n")}\n`;
}

// 首次写接入文件。values 来自中枢接入件，未给的键留空并注释掉。
export function renderJoinFile(values = {}) {
  const parts = [
    "# XKnot 接入文件。由 ops/scripts/join-xknot.sh 或管理界面的 XKnot 栏写入，权限 600。",
    "# 键名与语义见联邦契约 xknot.si/docs/FEDERATION.md 第 7.4 节；不要增删键名。",
    "# 值来自中枢签发，不要手改；换实例请重新领一份。",
  ];
  for (const group of GROUPS) {
    const entries = XKNOT_KEYS.filter((entry) => entry.group === group.id);
    if (!entries.length) continue;
    parts.push(`\n# ---- ${group.label} ----`);
    for (const entry of entries) {
      parts.push(`# ${entry.desc}`);
      const value = values[entry.key] ?? "";
      const line = `${entry.key}=${formatValue(value)}`;
      parts.push(value === "" ? `# ${line}` : line);
    }
  }
  parts.push("");
  return `${parts.join("\n")}\n`;
}

// 首次生成实例主机的运行时文件。之后由 updateEnvText 就地改写，保留注释和运维改过的值。
export function renderPlatformFile(values) {
  const parts = [
    "# 实例运行时配置。由 ops/scripts/deploy-site.sh 写入，权限 600。",
    "# 站点拓扑在 site.env；这里只放实例主机自己的值。",
  ];
  for (const group of GROUPS) {
    const mapped = KEYS.filter((entry) => entry.file === "site" && entry.runtime && entry.group === group.id);
    const own = KEYS.filter((entry) => entry.file === "platform" && entry.group === group.id);
    if (!mapped.length && !own.length) continue;
    parts.push(`\n# ---- ${group.label} ----`);
    for (const entry of mapped) {
      parts.push(`${entry.runtime}=${formatValue(values[entry.runtime] ?? "")}`);
    }
    for (const entry of own) {
      const value = values[entry.key] ?? "";
      const line = `${entry.key}=${formatValue(value)}`;
      parts.push(value === "" ? `# ${line}` : line);
    }
  }
  parts.push("");
  return `${parts.join("\n")}\n`;
}

function defaultCell(entry) {  if (entry.secret && entry.default !== "") return "（密钥）";
  if (entry.file === "platform" && entry.computed) return "部署脚本写入";
  const value = entry.default;
  if (value == null || value === "") return entry.derive ? "见说明" : "（空）";
  if (entry.type === "bytes") return `${value}（${Math.round(value / MiB)} MiB）`;
  return `\`${String(value)}\``;
}

// 生成 docs/CONFIG.md。
export function renderDocs() {
  const lines = [
    "# Knot 配置项",
    "",
    "这份文档由 `packages/knot-config/src/schema.mjs` 生成，不要手改。改配置项请改 schema，再跑：",
    "",
    "```bash",
    "node ops/scripts/config.mjs template --write           # sites/_template/site.env",
    "node ops/scripts/config.mjs platform-template --write  # sites/_template/platform.env",
    "node ops/scripts/config.mjs xknot-template --write     # sites/_template/xknot.env",
    "node ops/scripts/config.mjs entry-template --write      # sites/_template/entry.example.env",
    "node ops/scripts/config.mjs docs --write               # 重新生成本文",
    "```",
    "",
    "## 官方部署方式",
    "",
    "只看对外形态，有两种：**只在本机**（`KNOT_DOMAIN=` 留空、`KNOT_ENTRY_ENABLED=0`、只绑回环地址）和",
    "**xknot.si 二级子域**（`KNOT_DOMAIN=<标签>.xknot.si`，走回源隧道）。实例主机是本机还是另一台机器，两种都成立：",
    "开发机接子域时 `KNOT_ENTRY_ENABLED` 可以是 `0`，入口由中枢自动接通写好，本机只跑隧道与内容。",
    "独立域名、内网公开、固定公网 IP 直连都不在官方范围内，属于用户改造。",
    "",
    "## 三个边界",
    "",
    "| 边界 | 位置 | 放什么 | 能不能进版本库 |",
    "| --- | --- | --- | --- |",
    "| 代码 | `backend/` `web/` `packages/` | 真正的默认行为 | 进 |",
    "| 部署 | `ops/` | 脚本、模板、LaunchAgent、systemd unit。不写站点取值 | 进 |",
    "| 配置 | `sites/<站点>/` | 站点档案、拓扑、密钥 | 不进（`sites/_template/` 除外） |",
    "",
    "环境变量只覆盖代码里的默认值。一个键要么在 `packages/knot-config/src/schema.mjs` 里登记，要么就别读。",
    "Backend 启动时按同一份登记表校验环境：值不合法直接退出，必填项缺失时管理功能不可用；文件在部署前严格校验未知键。",
    "",
    "一个站点一个目录：",
    "",
    "| 文件 | 放什么 | 谁写 |",
    "| --- | --- | --- |",
    "| `sites/<站点>/site.env` | 域名、主机、端口、路径、入口、隧道。不含密码 | 运维 |",
    "| `sites/<站点>/profile.json` | 自述区：名称、默认语种、一句话介绍、详细介绍、logo、主理人、联系方式、地区、时区、标签（十项扁平字段）。不进版本库 | 主理人，在 `/admin` 的 XKnot 栏编辑 |",
    "| `sites/<站点>/platform.env` | SMTP 密码、价格初值、管理令牌。权限 600 | 部署脚本 |",
    "| `sites/<站点>/xknot.env` | 实例 id、中枢地址、签发日期与委托发信凭据。权限 600 | 中枢签发，`join-xknot.sh` 写入 |",
    "| `sites/<站点>/tunnel.env` | 回源隧道的账号、私钥文件名与本机/入口端口（`KNOT_TUNNEL` 一组）。权限 600 | `/admin` 的 XKnot 栏自动接通时写入 |",
    "| `sites/<站点>/entry.<标签>.xknot.si.env` | 接入 xknot.si 子域时的入口：域名、静态根、conf、证书。一个站点一份 | 运维 |",
    "| `sites/<站点>/agents/` | Internal Personal Agent 的授权码，权限 700 | 脚本 |",
    "",
    "**部署与接入是两条独立的线。** `deploy-site.sh` 只读 `site.env` 与 `platform.env`；",
    "`xknot.env` 只在运行时交给 Backend，缺了它站点照样部署和运行，只是不接联邦。",
    "反过来，重新部署、换机器、回滚都不会动接入凭据。",
    "",
    "## 站点配置（`sites/<站点>/site.env`）",
    "",
  ];
  for (const group of GROUPS) {
    const entries = SITE_KEYS.filter((entry) => entry.group === group.id);
    if (!entries.length) continue;
    lines.push(`### ${group.label}`, "", "| 变量 | 默认 | 必填 | 说明 |", "| --- | --- | --- | --- |");
    for (const entry of entries) {
      const required = isRequired(entry, {}) ? "是" : entry.required === true ? "是" : "";
      lines.push(`| \`${entry.key}\` | ${defaultCell(entry)} | ${required} | ${entry.desc} |`);
    }
    lines.push("");
  }
  lines.push("## 实例运行时配置（`sites/<站点>/platform.env`）", "");
  for (const group of GROUPS) {
    const entries = PLATFORM_KEYS.filter((entry) => entry.group === group.id);
    if (!entries.length) continue;
    lines.push(`### ${group.label}`, "", "| 变量 | 默认 | 说明 |", "| --- | --- | --- |");
    for (const entry of entries) {
      lines.push(`| \`${entry.key}\` | ${defaultCell(entry)} | ${entry.desc} |`);
    }
    lines.push("");
  }
  lines.push(
    "## XKnot 接入配置（`sites/<站点>/xknot.env`）",
    "",
    "只放中枢签发的东西，不参与部署推导。文件可以不存在。",
    "",
    "键名与语义是联邦契约，见 `xknot.si/docs/FEDERATION.md` 第 7.4 节；`xknot.env` 这个文件名与位置",
    "是本实现的约定，换个实现只要读同样这几个键即可。",
    "",
    "```bash",
    "./ops/scripts/join-xknot.sh --payload ~/xknot-access.env   # 写入并校验",
    "./ops/scripts/join-xknot.sh --status                       # 看当前接入状态",
    "node ops/scripts/config.mjs check --xknot --site <站点>     # 只校验这一个文件",
    "```",
    "",
    "| 变量 | 默认 | 必填 | 说明 |",
    "| --- | --- | --- | --- |"
  );
  for (const entry of XKNOT_KEYS) {
    lines.push(`| \`${entry.key}\` | ${defaultCell(entry)} | ${entry.required ? "是" : ""} | ${entry.desc} |`);
  }
  lines.push("");
  lines.push(
    "## 校验",
    "",
    "部署前会跑 `node ops/scripts/config.mjs check`，发现问题直接停下，不会部署一半。",
    "手动检查：",
    "",
    "```bash",
    "node ops/scripts/config.mjs check --site <站点>              # 查 site.env",
    "node ops/scripts/config.mjs check --platform --site <站点>   # 查实例主机的 platform.env",
    "node ops/scripts/config.mjs check --xknot --site <站点>      # 查接入用的 xknot.env",
    "node ops/scripts/config.mjs sites                            # 列出已有站点",
    "```",
    "",
    "必填与跨键规则：",
    "",
    "| 规则 | 条件 |",
    "| --- | --- |"
  );
  for (const rule of RULES) {
    const condition =
      rule.id === "entry-ssh" ? "`KNOT_ENTRY_ENABLED=1`" : rule.id === "external-db" ? "`KNOT_DB_MODE=external`" : "—";
    lines.push(`| ${rule.message} | ${condition} |`);
  }
  lines.push("| 接子域时必须写 KNOT_PUBLIC_ORIGIN=https://<标签>.xknot.si，且主机名与 KNOT_DOMAIN 一致。 | `KNOT_DOMAIN` 非空 |");
  lines.push("| 自己推入口（`KNOT_ENTRY_ENABLED=1`）时必须设 KNOT_TUNNEL=1；入口由中枢自动接通时隧道写在 `tunnel.env`，这里不强制。 | `KNOT_DOMAIN` 非空 |");
  lines.push("| 不接子域时 KNOT_PUBLIC_ORIGIN 只认回环地址，也不建隧道。 | `KNOT_DOMAIN` 为空 |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// 把一批键写回已有的运行时文件：保留注释和顺序，只替换值；缺的键追加到末尾。
export function updateEnvText(text, values) {
  const seen = new Set();
  const lines = String(text ?? "").split("\n").map((line) => {
    const active = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    const commented = /^(\s*)#\s*([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    const match = active || commented;
    if (!match) return line;
    const [, indent, key] = match;
    if (!Object.hasOwn(values, key)) return line;
    seen.add(key);
    return `${indent}${key}=${formatValue(values[key])}`;
  });
  const missing = Object.entries(values).filter(([key]) => !seen.has(key));
  if (missing.length) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push("# ---- 由部署脚本写入 ----");
    for (const [key, value] of missing) lines.push(`${key}=${formatValue(value)}`);
  }
  // 追加段只保留一个标题；旧文件里重复过的在这里收拢。
  const marker = "# ---- 由部署脚本写入 ----";
  let sectionSeen = false;
  const compact = lines.filter((line) => {
    if (line.trim() !== marker) return true;
    if (sectionSeen) return false;
    sectionSeen = true;
    return true;
  });
  return `${compact.join("\n").replace(/\n+$/, "")}\n`;
}

// 从运行时文件里删掉不属于这台机器的键。返回 { text, removed }。
export function removeEnvKeys(text, keys) {
  const drop = new Set(keys);
  const removed = [];
  const lines = String(text ?? "").split("\n").filter((line) => {
    const match = /^\s*(?:#\s*)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match || !drop.has(match[1])) return true;
    removed.push(match[1]);
    return false;
  });
  return { text: lines.join("\n"), removed };
}
