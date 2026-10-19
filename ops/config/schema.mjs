// Knot 配置的唯一事实来源。
//
// 这里登记每一个配置键：类型、默认值、是否必填、属于哪台机器、是不是密钥。
// 其余东西都从这里派生，不要另手写一份：
//
//   ops/deploy.env.example               <- config.mjs template
//   ops/env/knot-platform.env.example    <- config.mjs runtime-template
//   docs/CONFIG.md                       <- config.mjs docs
//   ops/env/knot-platform.local.env      <- config.mjs env
//
// 为什么这样分：
//   * ops/deploy.env  站点拓扑：域名、主机、端口、路径。不含密码，可以进运维流程。
//   * 运行时环境文件   平台主机自己的东西：SMTP 密码、价格初值。只留在这台机器上。
//   * 代码            真正的行为。环境变量只是覆盖，键在这里登记过才算数。
//
// 加一个配置项的步骤：
//   1. 在这里加一条；
//   2. 在代码里读 process.env 并给同样的默认值；
//   3. 跑 `npm run config -- template --write` 重新生成示例文件和文档；
//   4. 跑测试。示例文件、文档、代码默认值任何一处漂移都会直接失败。

export const GROUPS = [
  { id: "site", label: "站点" },
  { id: "platform", label: "平台主机" },
  { id: "publish", label: "从开发机发布" },
  { id: "edge", label: "云端边缘" },
  { id: "tunnel", label: "回源隧道" },
  { id: "mail", label: "邮件" },
  { id: "economy", label: "经济" },
  { id: "coupon", label: "消费券" },
  { id: "storage", label: "存储" },
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

export function truthy(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return !["0", "false", "no", "off"].includes(text);
}

export function isBlank(value) {
  return value == null || String(value).trim() === "";
}

// 部署键：写在 ops/deploy.env。
//   runtime  运行时环境里的名字；为空表示这个键只给脚本用，不进 Backend
//   scope    运行时谁需要它。用于按机器裁剪配置和检查跨机泄露
//   derive   留空时的推导值，和 ops/scripts/lib/deploy-config.sh 保持一致
const DEPLOY_KEYS = [
  // ---- 站点 ----
  {
    key: "KNOT_SITE_NAME",
    runtime: "KNOT_SITE_NAME",
    group: "site",
    type: "string",
    default: "Knot",
    desc: "站点名。WebUI 顶栏正中、浏览器标题、分享图落款都用它。",
    example: "海风情报站",
  },
  {
    key: "KNOT_SITE_TAGLINE",
    runtime: "KNOT_SITE_TAGLINE",
    group: "site",
    type: "string",
    default: "面向 AI 时代、服务于 Agent 的信息交换网。",
    desc: "一句话介绍。未登录首页和分享图用。",
  },
  {
    key: "KNOT_SITE_LOGO",
    runtime: "KNOT_SITE_LOGO",
    group: "site",
    type: "string",
    default: "",
    pattern: /^(https?:\/\/|\/|data:image\/)/i,
    desc: "站点自己的 logo，登录卡和未登录首页用。可填 https 地址、站内路径或 data:image/...；留空显示站点名首字。顶栏左上角的 XKnot 标识不读这一项。",
    example: "/logo.png",
  },
  {
    key: "KNOT_PUBLIC_ORIGIN",
    runtime: "PUBLIC_WEB_ORIGIN",
    group: "site",
    type: "url",
    default: "http://127.0.0.1:8080",
    desc: "对外访问地址。局域网直连写 http://192.168.1.10:8080；有域名写 https://knot.example.com。",
    example: "https://knot.example.com",
  },
  {
    key: "KNOT_DOMAIN",
    group: "site",
    type: "string",
    default: "",
    derive: (env) => hostOf(env.KNOT_PUBLIC_ORIGIN),
    scope: ["dev", "edge"],
    desc: "云端域名。留空时从 KNOT_PUBLIC_ORIGIN 取主机名。",
    example: "knot.example.com",
  },
  {
    key: "KNOT_PORT",
    runtime: "PORT",
    group: "site",
    type: "port",
    default: 8080,
    desc: "平台主机上 Backend 监听的端口。",
  },
  {
    key: "KNOT_BIND_HOST",
    runtime: "BIND_HOST",
    group: "site",
    type: "string",
    default: "0.0.0.0",
    desc: "Backend 绑定地址。只给本机 nginx 用就写 127.0.0.1。",
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

  // ---- 平台主机 ----
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
    derive: (env, ctx) => `${ctx.root}/var/uploads`,
    desc: "上传目录。留空用 <仓库>/var/uploads。",
  },
  {
    key: "KNOT_BACKUP_DIR",
    runtime: "KNOT_BACKUP_DIR",
    group: "platform",
    type: "path",
    default: "",
    desc: "备份目录。留空不备份；配置后 deploy-site.sh 装每天 04:15 的 LaunchAgent。",
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
    desc: "平台主机的 ssh 目标，形如 user@host。留空表示就在平台主机上直接跑 deploy-site.sh。",
    example: "deploy@192.168.1.10",
  },
  {
    key: "KNOT_DEPLOY_DIR",
    group: "publish",
    type: "path",
    default: "~/knot/AgentLink",
    scope: ["dev"],
    desc: "平台主机上的仓库目录。",
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
    desc: "部署后探活的地址。留空按 http://<平台主机>:<KNOT_PORT>/api/health 推导。",
  },

  // ---- 云端边缘 ----
  {
    key: "KNOT_EDGE",
    group: "edge",
    type: "bool",
    default: 0,
    desc: "1 表示另把 WebUI 和 nginx 配置推到 KNOT_EDGE_SSH；0 只部署平台主机的站点，不碰边缘。和 KNOT_TUNNEL 相互独立。",
  },
  {
    key: "KNOT_EDGE_SSH",
    group: "edge",
    type: "string",
    default: "",
    scope: ["dev", "platform"],
    desc: "云端边缘的 ssh 目标。",
    example: "ec2-user@203.0.113.10",
  },
  {
    key: "KNOT_EDGE_SSH_KEY",
    group: "edge",
    type: "path",
    default: "$HOME/.ssh/id_rsa",
    scope: ["dev"],
    desc: "在开发机上推页面用的私钥。",
  },
  {
    key: "KNOT_EDGE_PUSH_KEY",
    runtime: "KNOT_EDGE_PUSH_KEY",
    group: "edge",
    type: "path",
    default: "$HOME/.ssh/knot-edge-publish",
    scope: ["platform"],
    desc: "在平台主机上推公开快照用的私钥，可以和 KNOT_EDGE_SSH_KEY 不是同一把。",
  },
  {
    key: "KNOT_EDGE_WEB_ROOT",
    group: "edge",
    type: "path",
    default: "/var/www/knot",
    scope: ["edge"],
    desc: "边缘上放 WebUI 的目录。",
  },
  {
    key: "KNOT_EDGE_CONF",
    group: "edge",
    type: "path",
    default: "/etc/nginx/conf.d/knot.conf",
    scope: ["edge"],
    desc: "边缘上的 nginx 站点配置路径。",
  },
  {
    key: "KNOT_EDGE_WEB_OWNER",
    group: "edge",
    type: "string",
    default: "nginx:nginx",
    scope: ["edge"],
    desc: "WebUI 目录的属主。",
  },
  {
    key: "KNOT_EDGE_CACHE_DIR",
    group: "edge",
    type: "path",
    default: "/var/cache/nginx/knot_uploads",
    scope: ["edge"],
    desc: "上传文件的反向代理缓存目录。",
  },
  {
    key: "KNOT_EDGE_CACHE_ZONE",
    group: "edge",
    type: "string",
    default: "knot_uploads",
    scope: ["edge"],
    desc: "nginx proxy_cache 区名。",
  },
  {
    key: "KNOT_EDGE_CACHE_SIZE",
    group: "edge",
    type: "size",
    default: "2g",
    scope: ["edge"],
    desc: "缓存上限，nginx 写法，如 2g。",
  },
  {
    key: "KNOT_EDGE_MAX_BODY",
    group: "edge",
    type: "size",
    default: "52m",
    scope: ["edge"],
    desc: "边缘接受的请求体上限。必须大于后端附件上限，否则大文件在 nginx 就被截断。",
  },
  {
    key: "KNOT_EDGE_PROXY_PORT",
    group: "edge",
    type: "port",
    default: 18080,
    scope: ["edge", "platform"],
    desc: "边缘回源端口。nginx 把 /api 和 /help 转到这里，隧道再转回平台主机。",
  },
  {
    key: "KNOT_EDGE_SSL",
    group: "edge",
    type: "bool",
    default: 1,
    scope: ["edge"],
    desc: "1 监听 443 并配证书；0 只监听 80，证书还没签好时用。",
  },
  {
    key: "KNOT_EDGE_CERT",
    group: "edge",
    type: "path",
    default: "",
    scope: ["edge"],
    derive: (env) => (hostOf(env.KNOT_PUBLIC_ORIGIN) ? `/etc/letsencrypt/live/${hostOf(env.KNOT_PUBLIC_ORIGIN)}/fullchain.pem` : ""),
    desc: "证书链。留空由 KNOT_DOMAIN 推导。",
  },
  {
    key: "KNOT_EDGE_KEY",
    group: "edge",
    type: "path",
    default: "",
    scope: ["edge"],
    derive: (env) => (hostOf(env.KNOT_PUBLIC_ORIGIN) ? `/etc/letsencrypt/live/${hostOf(env.KNOT_PUBLIC_ORIGIN)}/privkey.pem` : ""),
    desc: "证书私钥。留空由 KNOT_DOMAIN 推导。",
  },
  {
    key: "KNOT_EDGE_RELOAD_CMD",
    group: "edge",
    type: "string",
    default: "sudo systemctl reload nginx",
    scope: ["edge"],
    desc: "改完 nginx 配置后的 reload 命令。非 systemd 的机器改成自己的。",
  },

  // ---- 回源隧道 ----
  {
    key: "KNOT_TUNNEL",
    group: "tunnel",
    type: "bool",
    default: 1,
    scope: ["platform"],
    desc: "1 表示平台主机主动连出建隧道，让边缘能回源。和 KNOT_EDGE 相互独立：不推边缘也可以保留隧道。",
  },
  {
    key: "KNOT_TUNNEL_SSH",
    group: "tunnel",
    type: "string",
    default: "",
    scope: ["platform"],
    derive: (env) => {
      const host = String(env.KNOT_EDGE_SSH || "").split("@").pop();
      return host ? `knot-tunnel@${host}` : "";
    },
    desc: "隧道账号。留空是 knot-tunnel@<KNOT_EDGE_SSH 的主机>。",
  },
  {
    key: "KNOT_TUNNEL_KEY",
    group: "tunnel",
    type: "path",
    default: "$HOME/.ssh/knot-edge",
    scope: ["platform"],
    desc: "平台主机上建隧道用的私钥。",
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
    derive: (env) => env.KNOT_EDGE_PROXY_PORT || 18080,
    desc: "隧道在边缘上占用的端口。留空等于 KNOT_EDGE_PROXY_PORT。",
  },
];

// 运行时种子键：只写在平台主机的 ops/env/knot-platform.local.env。
// 文件里已经有这个键就不覆盖，运维改过的值必须留住。
const RUNTIME_KEYS = [
  {
    key: "DATABASE_URL",
    group: "platform",
    type: "string",
    default: "",
    secret: true,
    computed: true,
    desc: "由部署脚本写入：local 模式是 postgres://knot@127.0.0.1:<KNOT_PGPORT>/knot，external 模式取 KNOT_DATABASE_URL。",
  },
  {
    key: "STATIC_WEB_DIR",
    group: "platform",
    type: "path",
    default: "",
    computed: true,
    desc: "由部署脚本写入：<仓库>/apps/web/dist。",
  },
  {
    key: "KNOT_AGENT_ENV_DIR",
    group: "platform",
    type: "path",
    default: "",
    computed: true,
    desc: "由部署脚本写入：<仓库>/ops/env。智能体的账号文件放这里。",
  },
  {
    key: "KNOT_DISCOVER_PUSH_CMD",
    group: "edge",
    type: "string",
    default: "",
    computed: true,
    desc: "由部署脚本写入：开启边缘时是 push-discover.sh，关闭时为空。",
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
    desc: "出售帖有效期（小时）。到期自动下架，作者可再次开放。",
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
    derive: (env) => (isBlank(env.KNOT_DEFAULT_PRICE) ? 10 : Number(env.KNOT_DEFAULT_PRICE) || 0),
    desc: "券面值（积分）。留空等于 KNOT_DEFAULT_PRICE。",
  },
  { key: "KNOT_COUPON_TTL_DAYS", group: "coupon", type: "int", default: 30, min: 0, desc: "券有效期（天）。" },
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
    desc: "单张图片上限。同时要小于 KNOT_EDGE_MAX_BODY。",
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
    desc: "单个附件上限。必须小于 KNOT_EDGE_MAX_BODY。",
  },
  {
    key: "DISCOVER_BOARD_DIR",
    group: "storage",
    type: "path",
    default: "",
    desc: "公开快照目录。留空用 <UPLOAD_DIR>/board。",
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
    desc: "本机管理接口的令牌。由 ensure-openclaw.sh 写入，运维不要手改。",
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
  ...DEPLOY_KEYS.map((entry) => normalize(entry, "deploy")),
  ...RUNTIME_KEYS.map((entry) => normalize(entry, "runtime")),
];

const BY_KEY = new Map(KEYS.map((entry) => [entry.key, entry]));

export function keyEntry(key) {
  return BY_KEY.get(key) || null;
}

// 运行时键名 -> 定义。部署键允许改名为别的运行时名（KNOT_PORT -> PORT）。
const BY_RUNTIME = new Map();
for (const entry of KEYS) {
  if (entry.file === "deploy" && entry.runtime) BY_RUNTIME.set(entry.runtime, entry);
  if (entry.file === "runtime") BY_RUNTIME.set(entry.key, entry);
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
  if (entry.file !== "deploy") return entry.key;
  return entry.runtime || "";
}

export function expandPath(value, home = process.env.HOME || "") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text === "~") return home;
  if (text.startsWith("~/")) return `${home}${text.slice(1)}`;
  return text.replace(/^\$HOME(?=\/|$)/, home);
}

// 把 deploy.env 里的值和默认值合成一个完整视图。不改写文件，只用于校验和生成运行时配置。
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
      return null;
    default:
      if (entry.pattern && !entry.pattern.test(value)) return `${entry.key} 格式不对："${value}"。`;
      return null;
  }
}

export const RULES = [
  {
    id: "edge-ssh",
    when: (env) => truthy(env.KNOT_EDGE),
    need: ["KNOT_EDGE_SSH"],
    message: "KNOT_EDGE=1 时必须配置 KNOT_EDGE_SSH。只部署局域网站点请写 KNOT_EDGE=0。",
  },
  {
    id: "external-db",
    when: (env) => env.KNOT_DB_MODE === "external",
    need: ["KNOT_DATABASE_URL"],
    message: "KNOT_DB_MODE=external 时必须配置 KNOT_DATABASE_URL。",
  },
];

export const WARNINGS = [
  {
    id: "tunnel-same-port",
    when: (env) =>
      truthy(env.KNOT_EDGE) &&
      truthy(env.KNOT_TUNNEL) &&
      String(env.KNOT_EDGE_PROXY_PORT || 18080) === String(env.KNOT_PORT || 8080),
    message: "回源端口和 Backend 端口相同。边缘如果和平台同机，会撞端口。",
  },
  {
    id: "backup-off",
    when: (env) => isBlank(env.KNOT_BACKUP_DIR),
    message: "KNOT_BACKUP_DIR 为空，不会做备份。上线前建议指到外接盘或另一台机器。",
  },
  {
    id: "body-limit",
    when: (env) => {
      const body = sizeToBytes(env.KNOT_EDGE_MAX_BODY || "52m");
      const attachment = Number(env.KNOT_UPLOAD_ATTACHMENT_MAX_BYTES || 50 * MiB);
      return body > 0 && attachment > 0 && attachment >= body;
    },
    message: "附件上限不小于边缘请求体上限，大文件会在 nginx 被截断。调大 KNOT_EDGE_MAX_BODY。",
  },
];

// 部署文件校验：类型、必填、跨键规则、未知键。
export function checkDeploy(env) {
  const errors = [];
  const warnings = [];
  for (const entry of KEYS) {
    if (entry.file !== "deploy") continue;
    const value = String(env[entry.key] ?? "").trim();
    if (!value) {
      if (isRequired(entry, env)) errors.push(`缺少 ${entry.key}。${entry.desc}`);
      continue;
    }
    const message = validateValue(entry, value);
    if (message) errors.push(message);
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
  const known = new Set(DEPLOY_KEYS.map((entry) => entry.key));
  for (const key of Object.keys(env)) {
    if (known.has(key)) continue;
    warnings.push(`${key} 不在 ops/config/schema.mjs 里，可能拼错了，或者已经废弃。`);
  }
  return { errors, warnings };
}

// 这些键只属于开发机或边缘，平台主机的运行时文件里出现就是配错了。
export const FORBIDDEN_RUNTIME_KEYS = [
  "KNOT_EDGE_SSH_KEY",
  "KNOT_DEPLOY_SSH",
  "KNOT_DEPLOY_SSH_KEY",
  "KNOT_EDGE_CERT",
  "KNOT_EDGE_KEY",
];

// 运行时文件校验：类型、未知键、跨机泄露、权限。
export function checkRuntime(text, { mode = null } = {}) {
  const env = parseEnv(text);
  const errors = [];
  const warnings = [];
  const known = runtimeKeySet();

  const forbidden = new Set(FORBIDDEN_RUNTIME_KEYS);
  for (const [key, value] of Object.entries(env)) {
    if (forbidden.has(key)) {
      errors.push(`${key} 是开发机或边缘的键，不该写进平台主机的运行时配置。`);
      continue;
    }
    if (!known.has(key)) {
      warnings.push(`${key} 不在运行时配置的登记表里，可能拼错了，或者已经废弃。`);
      continue;
    }
    const entry = runtimeEntry(key);
    if (!entry) continue;
    if (entry.file === "deploy" && !entry.scope.includes("platform")) {
      errors.push(`${key} 只给开发机用，不该出现在平台主机的运行时配置里。`);
      continue;
    }
    const message = validateValue(entry, value);
    if (message) errors.push(message);
  }

  if (mode != null && (mode & 0o077) !== 0) {
    const hasSecret = Object.keys(env).some((key) => runtimeEntry(key)?.secret);
    if (hasSecret) warnings.push(`运行时配置权限是 0${(mode & 0o777).toString(8)}，里面有密钥，建议 chmod 600。`);
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

export function formatValue(value) {
  const text = value == null ? "" : String(value);
  if (!text) return "";
  if (/^[A-Za-z0-9_@%+.,:/=~$()|^-]+$/.test(text) && !text.includes("#")) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
}

function commentLines(entry, indent = "") {
  const lines = [`${indent}# ${entry.desc}`];
  if (entry.example) lines.push(`${indent}# 例：${entry.example}`);
  return lines;
}

const DEPLOY_HEADER = `# Knot 部署配置。
#
# 用法：
#   cp ops/deploy.env.example ops/deploy.env
#   按自己的站点改 ops/deploy.env
#
# ops/deploy.env 不进版本库。部署脚本只从这里读站点、主机、路径和端口。
# 这份文件由 ops/config/schema.mjs 生成，不要手改；改配置项请改 schema 后跑
#   node ops/scripts/config.mjs template --write
#
# 同一个文件既给平台主机用，也给从开发机发布和云端边缘用。`;

const RUNTIME_HEADER = `# 运行时环境模板。由 ops/config/schema.mjs 生成。
#
# 平台主机上的 ops/env/knot-platform.local.env 由 deploy-site.sh 写入：
#   * 站点与端口从 ops/deploy.env 来；
#   * 下面的邮件、价格、存储键只在文件里还没有时写入初值，之后归运维。
#
# 这个文件不含站点拓扑；域名、主机、边缘、端口写 ops/deploy.env。`;

// 生成 ops/deploy.env.example。
export function renderDeployExample() {
  const parts = [DEPLOY_HEADER];
  for (const group of GROUPS) {
    const entries = DEPLOY_KEYS.filter((entry) => entry.group === group.id);
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

// 生成 ops/env/knot-platform.env.example。
export function renderRuntimeExample() {
  const parts = [RUNTIME_HEADER];
  for (const group of GROUPS) {
    const entries = RUNTIME_KEYS.filter((entry) => entry.group === group.id && !entry.computed);
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

// 首次生成平台主机的运行时文件。之后由 updateEnvText 就地改写，保留注释和运维改过的值。
export function renderRuntimeFile(values) {
  const parts = [
    "# 运行时环境。由 ops/scripts/deploy-site.sh 写入，权限 600。",
    "# 站点拓扑在 ops/deploy.env；这里只放平台主机自己的值。",
  ];
  for (const group of GROUPS) {
    const mapped = KEYS.filter((entry) => entry.file === "deploy" && entry.runtime && entry.group === group.id);
    const own = KEYS.filter((entry) => entry.file === "runtime" && entry.group === group.id);
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
  if (entry.file === "runtime" && entry.computed) return "部署脚本写入";
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
    "这份文档由 `ops/config/schema.mjs` 生成，不要手改。改配置项请改 schema，再跑：",
    "",
    "```bash",
    "node ops/scripts/config.mjs template --write   # 重新生成两个示例文件",
    "node ops/scripts/config.mjs docs --write       # 重新生成本文",
    "```",
    "",
    "## 三个文件，三种职责",
    "",
    "| 文件 | 放在哪 | 放什么 | 能不能进版本库 |",
    "| --- | --- | --- | --- |",
    "| `ops/deploy.env` | 开发机和平台主机 | 域名、主机、端口、路径、边缘。不含密码 | 不进 |",
    "| `ops/env/knot-platform.local.env` | 只放平台主机 | SMTP 密码、价格初值、管理令牌 | 不进，权限 600 |",
    "| `apps/knot-platform/src` | 仓库 | 真正的默认行为 | 进 |",
    "",
    "环境变量只覆盖代码里的默认值。一个键要么在 schema 里登记，要么就别读。",
    "",
    "## 部署配置（`ops/deploy.env`）",
    "",
  ];
  for (const group of GROUPS) {
    const entries = DEPLOY_KEYS.filter((entry) => entry.group === group.id);
    if (!entries.length) continue;
    lines.push(`### ${group.label}`, "", "| 变量 | 默认 | 必填 | 说明 |", "| --- | --- | --- | --- |");
    for (const entry of entries) {
      const required = isRequired(entry, {}) ? "是" : entry.required === true ? "是" : "";
      lines.push(`| \`${entry.key}\` | ${defaultCell(entry)} | ${required} | ${entry.desc} |`);
    }
    lines.push("");
  }
  lines.push("## 运行时配置（`ops/env/knot-platform.local.env`）", "");
  for (const group of GROUPS) {
    const entries = RUNTIME_KEYS.filter((entry) => entry.group === group.id);
    if (!entries.length) continue;
    lines.push(`### ${group.label}`, "", "| 变量 | 默认 | 说明 |", "| --- | --- | --- |");
    for (const entry of entries) {
      lines.push(`| \`${entry.key}\` | ${defaultCell(entry)} | ${entry.desc} |`);
    }
    lines.push("");
  }
  lines.push(
    "## 校验",
    "",
    "部署前会跑 `node ops/scripts/config.mjs check`，发现问题直接停下，不会部署一半。",
    "手动检查：",
    "",
    "```bash",
    "node ops/scripts/config.mjs check                    # 查 ops/deploy.env",
    "node ops/scripts/config.mjs check --runtime          # 查平台主机的运行时文件",
    "```",
    "",
    "必填与跨键规则：",
    "",
    "| 规则 | 条件 |",
    "| --- | --- |"
  );
  for (const rule of RULES) {
    const condition =
      rule.id === "edge-ssh" ? "`KNOT_EDGE=1`" : rule.id === "external-db" ? "`KNOT_DB_MODE=external`" : "—";
    lines.push(`| ${rule.message} | ${condition} |`);
  }
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
