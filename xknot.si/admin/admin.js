// XKnot 控制台。
//
// 申请提交即通过，这里不再有审核动作：看申请记录、改实例配置、看探测与发信。
// 无构建步骤：浏览器直接加载这个模块。所有文本用 textContent 写入，
// 申请内容不会当成 HTML 执行。

const app = document.getElementById("app");

// 单次接口调用的上限。控制台只读小 JSON，十几秒还没回来说明链路已经坏了。
const API_TIMEOUT_MS = 15000;

const STATUS_LABEL = {
  approved: "已通过",
  withdrawn: "已撤回",
  // 自动通过之前的历史状态。
  pending: "待确认（历史）",
  verified: "待审核（历史）",
  hold: "搁置（历史）",
  rejected: "已拒绝（历史）",
  expired: "已过期（历史）",
};

// 总览里的实例状态。pending 是已收录、未通过 /api/health 验收；paused 是暂停或退役。
const HEALTH_LABEL = {
  up: "在线",
  degraded: "降级",
  down: "离线",
  unknown: "未知",
  unprobed: "未探测",
  pending: "待验收",
  paused: "已暂停",
};

const TIER_LABEL = {
  demo: "示例",
  free: "免费",
  paid: "收费",
};

// 申请里可勾选的三项。relay 等于发信凭据，cards 是橱窗数据，stats 是活动计数。
const SERVICE_LABEL = {
  relay: "委托发信",
  cards: "橱窗",
  stats: "统计",
};

const ERROR_LABEL = {
  timeout: "超时",
  unresolvable: "域名解析失败",
  redirect: "跳转被拒",
  bad_payload: "响应不符合契约",
};

const EVENT_LABEL = {
  // 服务端目前只记这两种实例事件，也是最该被看懂的两条：谁改了什么、谁上线了。
  "instance.updated": "改了实例配置",
  "instance.active": "实例通过验收",
  "application.submitted": "新申请",
  "application.contact_verified": "联系邮箱已确认",
  "application.public_key": "已保存公钥",
  "application.withdrawn": "申请撤回",
  "claim.issued": "发出交付资料",
  "claim.consumed": "领取交付资料",
  "relay.token_created": "签发发信凭据",
  "relay.token_revoked": "吊销发信凭据",
  "relay.disabled": "暂停某实例代发",
  "relay.enabled": "恢复某实例代发",
  "setting.changed": "改了运行期开关",
  "setting.cleared": "清掉运行期开关",
  "admin.created": "建管理员",
  "admin.deleted": "删管理员",
  "admin.password_reset": "重设口令",
};

const REGION_LABEL = {
  "east-asia": "东亚",
  "southeast-asia": "东南亚",
  "south-asia": "南亚",
  "central-asia": "中亚",
  "middle-east": "中东",
  europe: "欧洲",
  "north-america": "北美",
  "latin-america": "拉美",
  africa: "非洲",
  oceania: "大洋洲",
  global: "全球",
  other: "其他",
};

const COUNTRY_GROUP = {
  CN: "east-asia", HK: "east-asia", MO: "east-asia", TW: "east-asia", JP: "east-asia",
  KR: "east-asia", MN: "east-asia",
  SG: "southeast-asia", MY: "southeast-asia", TH: "southeast-asia", VN: "southeast-asia",
  ID: "southeast-asia", PH: "southeast-asia", BN: "southeast-asia", KH: "southeast-asia",
  LA: "southeast-asia", MM: "southeast-asia", TL: "southeast-asia",
  IN: "south-asia", PK: "south-asia", BD: "south-asia", LK: "south-asia", NP: "south-asia",
  BT: "south-asia", MV: "south-asia", AF: "south-asia",
  KZ: "central-asia", UZ: "central-asia", KG: "central-asia", TJ: "central-asia", TM: "central-asia",
  AE: "middle-east", SA: "middle-east", QA: "middle-east", KW: "middle-east", BH: "middle-east",
  OM: "middle-east", IL: "middle-east", TR: "middle-east", IR: "middle-east", IQ: "middle-east",
  JO: "middle-east", LB: "middle-east", EG: "middle-east", YE: "middle-east", SY: "middle-east",
  PS: "middle-east",
  AT: "europe", BE: "europe", BG: "europe", HR: "europe", CY: "europe", CZ: "europe",
  DK: "europe", EE: "europe", FI: "europe", FR: "europe", DE: "europe", GR: "europe",
  HU: "europe", IE: "europe", IT: "europe", LV: "europe", LT: "europe", LU: "europe",
  MT: "europe", NL: "europe", PL: "europe", PT: "europe", RO: "europe", SK: "europe",
  SI: "europe", ES: "europe", SE: "europe", GB: "europe", CH: "europe", NO: "europe",
  IS: "europe", RS: "europe", UA: "europe", MD: "europe", BA: "europe", MK: "europe",
  AL: "europe", ME: "europe", AD: "europe", MC: "europe", SM: "europe", LI: "europe",
  VA: "europe",
  US: "north-america", CA: "north-america", MX: "north-america", GL: "north-america",
  BM: "north-america",
  AR: "latin-america", BO: "latin-america", BR: "latin-america", CL: "latin-america",
  CO: "latin-america", CR: "latin-america", CU: "latin-america", DO: "latin-america",
  EC: "latin-america", SV: "latin-america", GT: "latin-america", HT: "latin-america",
  HN: "latin-america", NI: "latin-america", PA: "latin-america", PY: "latin-america",
  PE: "latin-america", PR: "latin-america", UY: "latin-america", VE: "latin-america",
  BZ: "latin-america", JM: "latin-america", TT: "latin-america", BB: "latin-america",
  BS: "latin-america", GD: "latin-america",
  DZ: "africa", AO: "africa", BJ: "africa", BW: "africa", BF: "africa", BI: "africa",
  CM: "africa", CV: "africa", CF: "africa", TD: "africa", KM: "africa", CG: "africa",
  CD: "africa", CI: "africa", DJ: "africa", GQ: "africa", ER: "africa", SZ: "africa",
  ET: "africa", GA: "africa", GM: "africa", GH: "africa", GN: "africa", GW: "africa",
  KE: "africa", LS: "africa", LR: "africa", LY: "africa", MG: "africa", MW: "africa",
  ML: "africa", MR: "africa", MU: "africa", MA: "africa", MZ: "africa", NA: "africa",
  NE: "africa", NG: "africa", RW: "africa", ST: "africa", SN: "africa", SC: "africa",
  SL: "africa", SO: "africa", ZA: "africa", SS: "africa", SD: "africa", TZ: "africa",
  TG: "africa", TN: "africa", UG: "africa", ZM: "africa", ZW: "africa",
  AU: "oceania", NZ: "oceania", PG: "oceania", FJ: "oceania", SB: "oceania", VU: "oceania",
  WS: "oceania", TO: "oceania", KI: "oceania", FM: "oceania", MH: "oceania", PW: "oceania",
  NR: "oceania", TV: "oceania", NC: "oceania", PF: "oceania",
};

const state = {
  admin: null,
  view: "overview",
  filter: "approved",
  applications: [],
  // state.applications 里的行属于哪一个分类。切分类后请求失败时，旧分类的行不能
  // 留在新标签下面冒充新分类的记录；对不上就不渲染这些行。
  applicationsFilter: "approved",
  // 列表读取失败的原因。它与 state.error 分开：state.error 只在详情面板里渲染，
  // 而列表读失败时通常没有选中项，那条提示永远不会出现，运维只看到空态。
  applicationsError: "",
  counts: { approved: 0, withdrawn: 0 },
  selected: null,
  busy: false,
  error: "",
  overview: null,
  overviewBusy: false,
  overviewError: "",
  // 申请列表是否正在读取。读取中列表行不可点：写入数据会重绘，
  // 点在一半的行会被换掉，用户那一下就没有落到任何申请上。
  // 只有最新一次读取能清除这个状态；旧响应直接丢掉，不参与重绘。
  applicationsBusy: false,
  // 总览里点开的实例。只展开这一行，不跳站点。
  instanceOpen: null,
  // 正在编辑的实例配置。草稿在 state 里，保存失败重绘时不丢用户输入。
  editing: null,
  manifest: null,
  manifestId: null,
  // 生成清单条目是独立的一个请求：它不该占用登录按钮的 state.busy，
  // 否则请求挂住时退出再登录会看到一个禁用的「登录」。置位后立刻重绘，
  // 按钮在请求期间就是禁用的，双击不会发两次。
  manifestBusy: false,
  copied: false,
  // 控制台级提示：退出没送达这类与某条记录无关的错误。
  topError: "",
  // 发信总闸的一次切换。与 state.busy 分开：它不该禁用整页的按钮，
  // 也不该让「退出」在切换期间失灵。
  mailBusy: false,
  mailError: "",
};

// 每次读取带一个序号。晚到的旧响应直接丢掉，避免它把刚点开的分类又重绘回去。
let overviewSeq = 0;
let applicationsSeq = 0;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    // 没有 html 通道：申请内容与站点自述都是外部输入，一旦有条路径能把字符串
    // 变成 HTML，文件头那句「所有文本用 textContent 写入」就不再成立。
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(path, options = {}) {
  const { signal = null, ...rest } = options;
  // 一个卡住的请求会让 busy 永不复位，整页按钮跟着一起禁用。给每次请求一个上限：
  // 超时当失败处理，至少运维能看到「失败」与「重试」，而不是一直转圈。
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(API_TIMEOUT_MS) : null;
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { accept: "application/json", ...(rest.body ? { "content-type": "application/json" } : {}) },
      ...rest,
      signal: signal || timeout,
    });
  } catch (error) {
    // 超时、断网、被拦都一样：调用方只需要知道「没拿到响应」。
    const failure = new Error(error?.name === "TimeoutError" ? "timeout" : "network");
    failure.status = 0;
    failure.timeout = error?.name === "TimeoutError";
    throw failure;
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error((data && data.error) || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  // 200 但响应体不是 JSON（被反代换成 SPA 兜底、body 被截断）：这是接口坏了，
  // 不是「成功的空结果」。当成 null 返回会让页面停在「正在读取…」且没有重试。
  if (data === null) {
    const error = new Error("invalid_response");
    error.status = response.status;
    error.invalidResponse = true;
    throw error;
  }
  return data;
}

// 时间一律带时区渲染：控制台的读者和申请单不在同一个时区时，
// 一个不带时区的「10月19日 08:00」会被当成自己那边的钟点。
// timezone 来自记录本身（申请单的 timezone），控制台只负责按它显示。
function safeTimeZone(value) {
  const text = String(value || "").trim();
  if (!text) return "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: text });
    return text;
  } catch {
    // 记录里的时区名不认识（旧数据、手填错了）就按控制台默认时区显示，不抛错。
    return "Asia/Shanghai";
  }
}

function formatWhen(value, timeZone = "Asia/Shanghai") {
  if (!value) return "—";
  const text = String(value).trim();
  // 只有日期的字段（例如 since）没有钟点。按 UTC 解析再渲染会凭空多出 08:00，
  // 所以按日期本身格式化，不带时间。
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) {
    const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    if (Number.isNaN(date.getTime())) return text;
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date);
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: safeTimeZone(timeZone),
  }).format(date);
}

// 地址只放行 https 与 mailto。申请单里的 url 在 2.0 之前由提交者自带，
// 旧行没有再校验过；把 javascript: 之类的东西写进 href 只靠 CSP 兜着不够。
function safeHref(value, protocols) {
  try {
    const url = new URL(String(value || ""));
    return protocols.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function mailtoHref(value) {
  const text = String(value || "").trim();
  // 锚定的邮箱判断：不锚定时 "a@b.c?subject=..." 也会通过，等于把信头塞进链接。
  if (!/^[^\s@?]+@[^\s@?]+\.[^\s@?]+$/.test(text)) return null;
  return `mailto:${text}`;
}

// 不合格的地址不渲染成链接，退化成纯文本：读得到，点不了。
function safeLink(value, label, className = "cfg-link") {
  const href = safeHref(value, ["https:"]);
  if (!href) return el("span", { class: "cfg-link-plain" }, label || value || "—");
  return el("a", { class: className, href, target: "_blank", rel: "noopener noreferrer" }, label || value);
}

function regionLabel(code) {
  const group = code === "GLOBAL" ? "global" : COUNTRY_GROUP[code] || "other";
  return `${REGION_LABEL[group]} · ${code}`;
}

function relativeLabel(value) {
  const at = Date.parse(value || "");
  if (Number.isNaN(at)) return "—";
  const minutes = Math.round((Date.now() - at) / 60000);
  // 未来时间（时钟偏了、记录里写错了）不能落进「刚刚」：那是一句假的现状。
  if (minutes < 0) return `${formatWhen(value)}（未来时间）`;
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatWhen(value);
}

function formatUptime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (total < 60) return `${total} 秒`;
  if (total < 3600) return `${Math.floor(total / 60)} 分钟`;
  if (total < 86400) return `${Math.floor(total / 3600)} 小时 ${Math.floor((total % 3600) / 60)} 分`;
  return `${Math.floor(total / 86400)} 天 ${Math.floor((total % 86400) / 3600)} 小时`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// 档案里的 region 与中枢观测到的国家不同：说明这台机器已经搬了，或者档案没改。
// 只在两个值都在、且确实不同时才算漂移；没有观测值时谈不上漂移。
function locationDrift(row) {
  const declared = Array.isArray(row.regions) ? row.regions[0] : null;
  const seen = row.location?.country || null;
  return Boolean(declared && seen && declared !== seen);
}

function healthNote(row) {
  const health = row.health || {};
  if (health.status === "pending") return "已收录，待 /api/health 验收，暂不探测也不上门户";
  if (health.status === "paused") return "清单里状态不是 active，不探测";
  if (health.status === "unprobed") return "缺对外地址，推不出探测地址";
  if (health.status === "down") {
    // 隧道没连时探测必然失败：先说清是哪一段断的，别让人去查实例的接口。
    if (row.tunnel?.checkedAt && !row.tunnel.connected) return "隧道未连，探测必然失败";
    return health.downSince ? `自 ${relativeLabel(health.downSince)} 起断连` : "探测失败";
  }
  if (health.latencyMs != null) return `${health.latencyMs} ms`;
  if (health.lastOkAt) return `上次正常 ${relativeLabel(health.lastOkAt)}`;
  return "没有探测记录";
}

// 入口 nginx 观测到的流量。没有采集过就整行不出现，不写 0 冒充数据。
function trafficNote(row) {
  const traffic = row.traffic;
  if (!traffic || !traffic.requests) return null;
  const day = traffic.date ? `${traffic.date} ` : "";
  return `${day}${traffic.requests} 次 · ${formatBytes(traffic.bytes)}`;
}

// 名册字段的中文说法。缺一个说法时直接显示原值，不吞掉。
const ROLE_LABEL = {
  founder: "创始",
  partner: "伙伴",
  community: "社区",
  demo: "示例",
};

const STANDING_LABEL = {
  permanent: "永久席位",
  regular: "常规席位",
};

function toggleInstance(id) {
  state.instanceOpen = state.instanceOpen === id ? null : id;
  render();
}

// 退出或会话失效时一次性清掉本地状态，别让上一个账号的数据留在下一个人的屏幕上。
function clearSessionState() {
  state.admin = null;
  state.applications = [];
  state.applicationsFilter = "approved";
  state.applicationsError = "";
  state.overview = null;
  state.selected = null;
  state.editing = null;
  state.instanceOpen = null;
  state.manifest = null;
  state.manifestId = null;
  state.error = "";
  state.topError = "";
}

// 点开实例看到的是这个账号的配置：名册里的身份与隧道，加上清单里的对外地址。
// 地址一律写成可点文本，跳站是明确动作，不靠点整行带走。
function renderInstanceConfig(row, id) {
  const config = row.config || {};

  if (state.editing && state.editing.id === row.id) return renderInstanceForm(row, config, id);

  // 站点的对外地址、取回地址、探测地址都来自数据，统一过一遍协议白名单。
  const link = (value, label) => safeLink(value, label);
  const line = (term, value) =>
    el("div", { class: "cfg-row" }, [el("dt", {}, term), el("dd", {}, value)]);

  const tunnel = config.tunnel
    ? `${config.tunnel.account || "—"}${config.tunnel.port ? ` · :${config.tunnel.port}` : ""}`
    : null;

  return el("div", { class: "inst-config", id }, [
    el("div", { class: "cfg-head" }, [
      el("p", { class: "cfg-title" }, [
        `账号 ${config.account || row.id}`,
        config.host ? el("span", { class: "cfg-host" }, config.host) : null,
      ]),
      el(
        "button",
        { type: "button", class: "btn", "data-action": "edit", onclick: () => startEditing(row) },
        "编辑"
      ),
    ]),
    config.listed == null
      ? el("p", { class: "cfg-hint warn" }, "名册里还没有这个账号，保存时会补一条。")
      : null,
    el("dl", { class: "cfg-grid" }, [
      line("名册身份", config.role ? ROLE_LABEL[config.role] || config.role : "未进名册"),
      line("席位", config.standing ? STANDING_LABEL[config.standing] || config.standing : "—"),
      line("隧道", tunnel || "未分配"),
      line(
        "清单列出",
        config.listed == null ? "—" : config.listed ? "是" : "否（只留名册）"
      ),
      line("加入时间", config.since ? formatWhen(config.since) : "—"),
      line(
        "自述档案",
        config.profileFetchedAt
          ? el("span", {}, [
              link(config.profileUrl || `${String(row.url || "").replace(/\/$/, "")}/api/federation/profile`),
              `　最近取回 ${formatWhen(config.profileFetchedAt)}`,
            ])
          : el("span", { class: "cfg-missing" }, "还没取回过：内容由主理人在实例的 /admin 里写")
      ),
      line("对外地址", row.url ? link(row.url) : "未填地址"),
      line(
        "观测位置",
        row.location
          ? el("span", {}, [
              `${row.location.country}`,
              el(
                "span",
                { class: "cfg-missing" },
                `　隧道出口 IP 判定${row.location.at ? `，${formatWhen(row.location.at)}` : ""}`
              ),
            ])
          : el("span", { class: "cfg-missing" }, "未采集：隧道未连，或中枢不在入口主机")
      ),
      line(
        "隧道对端",
        row.tunnel?.checkedAt
          ? el("span", {}, [
              `${row.tunnel.connected ? "连着" : "不在"}　账号 ${row.tunnel.account || "—"} · 端口 ${row.tunnel.port ?? "—"}`,
              el("span", { class: "cfg-missing" }, `　${formatWhen(row.tunnel.checkedAt)} 采集`),
            ])
          : el("span", { class: "cfg-missing" }, "未采集：中枢不在入口主机，或 provision worker 没跑")
      ),
      line(
        "入口流量",
        row.traffic
          ? el("span", {}, [
              `${row.traffic.date} · ${row.traffic.requests} 次 · ${formatBytes(row.traffic.bytes)}`,
              el("span", { class: "cfg-missing" }, "　入口 nginx 观测，不含实例自己记的站内行为"),
            ])
          : el("span", { class: "cfg-missing" }, "未采集：入口还没装 knot-log.conf")
      ),
      line(
        "探测地址",
        config.probeUrl
          ? el("span", {}, [
              link(config.probeUrl),
              row.status === "pending"
                ? el("span", { class: "cfg-missing" }, "　状态还是 pending，待验收后再探")
                : null,
            ])
          : el("span", { class: "cfg-missing" }, "缺对外地址，推不出探测地址")
      ),
      line("橱窗数据", config.cardsUrl ? link(config.cardsUrl) : "未接入"),
      line("活动统计", config.statsUrl ? link(config.statsUrl) : "未接入"),
    ]),
    config.note ? el("p", { class: "cfg-note" }, config.note) : null,
  ]);
}

// 旧档位只在 LABELS 里留了说法；表单的可选项以新档位为准。
const TIER_OPTIONS = ["demo", "free", "paid"];
const INSTANCE_STATUS_OPTIONS = ["pending", "active", "suspended", "retired"];

// 读到旧值时先归一到新档位再交给下拉：归一放在草稿里，才能保证提交的是合法值，
// 也不会出现「界面显示示例、提交的是 partner」这种界面与请求不一致的情况。
const TIER_ALIAS = { partner: "paid", community: "free" };
// 旧角色的 community 落在伙伴这一档，而不是表单第一项 founder：把人提成创始是
// 名册里一条改不回来的身份。
const ROLE_ALIAS = { community: "partner", demo: "partner" };

function tierValue(value) {
  const text = String(value || "").trim();
  return TIER_ALIAS[text] || text;
}

function roleValue(value) {
  const text = String(value || "").trim();
  return ROLE_ALIAS[text] || text;
}

const LABELS = {
  demo: TIER_LABEL.demo,
  free: TIER_LABEL.free,
  paid: TIER_LABEL.paid,
  // 自动通过之前登记的旧档位，读到就按新档位显示。
  partner: TIER_LABEL.paid,
  community: TIER_LABEL.free,
  pending: "待验收",
  active: "在用",
  suspended: "暂停",
  retired: "退役",
  founder: ROLE_LABEL.founder,
  permanent: STANDING_LABEL.permanent,
  regular: STANDING_LABEL.regular,
};

// 失败提示按类型分开：超时、断网、接口返回坏了、校验不过，运维要做的动作不同。
function saveFailureText(error) {
  if (error?.status === 0) {
    return error.timeout ? "保存没有送达（请求超时），请稍后重试。" : "保存没有送达（网络不通），请检查连接。";
  }
  if (error?.status === 401) return "登录已过期，请重新登录之后再保存。";
  if (error?.invalidResponse) return "接口返回的不是 JSON，这次保存没有确认，请刷新后重试。";
  if (error?.status) return `保存没有成功（HTTP ${error.status}）。`;
  return "保存没有成功，请检查接口是否在运行。";
}

function hostFromUrl(value) {
  try {
    return new URL(String(value || "")).host;
  } catch {
    return "";
  }
}

// 草稿放在 state 里，而不是从输入框现读：保存失败重绘时，用户改过的值还在。
// inRoster 记住「保存前名册里有没有这个账号」：没有的话，提交名册字段等于新建一条
// 成员，这件事必须显式告诉运维，不能夹在改备注里顺手做掉。
function draftFrom(row, config) {
  return {
    instance: {
      url: row.url || "",
      tier: tierValue(row.tier) || "free",
      status: row.status || "active",
      since: config.since || "",
      cardsUrl: config.cardsUrl || "",
      statsUrl: config.statsUrl || "",
    },
    member: {
      host: config.host || hostFromUrl(row.url),
      role: roleValue(config.role) || "partner",
      standing: config.standing || "regular",
      listed: config.listed == null ? true : Boolean(config.listed),
      tunnelAccount: config.tunnel?.account || "",
      tunnelPort: config.tunnel?.port || "",
      note: config.note || "",
    },
  };
}

function cloneDraft(draft) {
  return JSON.parse(JSON.stringify(draft));
}

function startEditing(row) {
  if (!confirmDiscardEditing()) return;
  const draft = draftFrom(row, row.config || {});
  state.editing = {
    id: row.id,
    draft,
    // 打开表单那一刻的值。保存只发改过的字段，也靠它判断「有没有未保存的改动」。
    baseline: cloneDraft(draft),
    inRoster: (row.config || {}).listed != null,
    busy: false,
    errors: [],
  };
  render();
}

function cancelEditing() {
  state.editing = null;
  render();
}

function configInput(value, props = {}, onInput) {
  const input = el("input", { type: "text", autocomplete: "off", ...props });
  input.value = value == null ? "" : String(value);
  if (onInput) input.addEventListener("input", () => onInput(input.value));
  return input;
}

function configSelect(value, options, props = {}, onChange) {
  const select = el("select", props);
  const choices = [...options];
  // 值不在可选项里时不要默默回落到第一项：浏览器会把它显示成第一项，用户于是
  // 以为当前值就是那个，存一次就把真实值改掉了。把未知值原样放进列表并标出来。
  if (value != null && value !== "" && !choices.includes(value)) choices.push(value);
  for (const option of choices) {
    const node = el(
      "option",
      { value: option },
      LABELS[option] || (options.includes(option) ? option : `${option}（旧值）`)
    );
    if (option === value) node.selected = true;
    select.append(node);
  }
  if (onChange) select.addEventListener("change", () => onChange(select.value));
  return select;
}

function formField(term, control, hint) {
  return el("label", { class: "cfg-field" }, [
    el("span", { class: "cfg-field-label" }, term),
    control,
    hint ? el("span", { class: "cfg-hint" }, hint) : null,
  ]);
}

// 草稿与打开表单时的快照逐字段比较，只把真正改过的字段交给接口。
// 整份提交等于把「页面加载那一刻的快照」写回文件：两个人先后改同一个实例，
// 后保存者会静默覆盖先保存者的改动。
const INSTANCE_PATCH_FIELDS = ["url", "tier", "status", "since", "cardsUrl", "statsUrl"];
const MEMBER_PATCH_FIELDS = ["host", "role", "standing", "note"];
const FIELD_LABEL = {
  url: "对外地址",
  tier: "分级",
  status: "状态",
  since: "加入时间",
  cardsUrl: "橱窗数据",
  statsUrl: "活动统计",
  host: "域名",
  role: "角色",
  standing: "席位",
  listed: "写进清单",
  note: "备注",
};

function normalizeField(value) {
  if (value == null) return "";
  return String(value).trim();
}

function diffPatch(before, after, fields) {
  const patch = {};
  for (const key of fields) {
    const from = normalizeField(before[key]);
    const to = normalizeField(after[key]);
    if (from !== to) patch[key] = to;
  }
  return patch;
}

function draftChanges(editing) {
  const { draft, baseline } = editing;
  const instance = diffPatch(baseline.instance, draft.instance, INSTANCE_PATCH_FIELDS);
  const member = diffPatch(baseline.member, draft.member, MEMBER_PATCH_FIELDS);
  if (Boolean(draft.member.listed) !== Boolean(baseline.member.listed)) {
    member.listed = Boolean(draft.member.listed);
  }
  const tunnelFrom = `${normalizeField(baseline.member.tunnelAccount)}|${normalizeField(baseline.member.tunnelPort)}`;
  const tunnelTo = `${normalizeField(draft.member.tunnelAccount)}|${normalizeField(draft.member.tunnelPort)}`;
  if (tunnelFrom !== tunnelTo) {
    member.tunnel = {
      account: normalizeField(draft.member.tunnelAccount),
      port: normalizeField(draft.member.tunnelPort),
    };
  }
  return { instance, member };
}

function editingDirty(editing) {
  const changes = draftChanges(editing);
  return Object.keys(changes.instance).length > 0 || Object.keys(changes.member).length > 0;
}

// 切视图、换实例都会丢掉草稿：先问一句，别让人填到一半的东西悄悄消失。
function confirmDiscardEditing() {
  if (!state.editing || !editingDirty(state.editing)) return true;
  return window.confirm("正在编辑的实例配置还没保存，确定离开？");
}

// 保存前回读当前配置，确认这次要写的字段从打开表单到现在没被别人改过。
// 服务端是读-改-写且没有版本号，这里是唯一的乐观锁。
async function changedElsewhere(editing, instancePatch, memberPatch) {
  let data;
  try {
    data = await api("/api/admin/overview");
  } catch {
    // 回读失败不拦保存：可能只是临时抖动，真正的保存会自己报错。
    return [];
  }
  const rows = Array.isArray(data?.instances?.rows) ? data.instances.rows : [];
  const row = rows.find((item) => item.id === editing.id);
  if (!row) return [];
  const live = draftFrom(row, row.config || {});
  const changed = [];
  for (const key of Object.keys(instancePatch)) {
    if (normalizeField(live.instance[key]) !== normalizeField(editing.baseline.instance[key])) {
      changed.push(key);
    }
  }
  for (const key of Object.keys(memberPatch)) {
    // tunnel 与 since 没有对应的表单控件，不在「别人改过」的判断里。
    if (key === "tunnel" || key === "since") continue;
    const liveValue = key === "listed" ? Boolean(live.member.listed) : normalizeField(live.member[key]);
    const baseValue = key === "listed" ? Boolean(editing.baseline.member.listed) : normalizeField(editing.baseline.member[key]);
    if (liveValue !== baseValue) changed.push(key);
  }
  return [...new Set(changed)];
}

// 表单只收运营自己维护的字段。没有名册项时，新建成员这件事必须在保存前说清；
// 接入形态恒为 subdomain，隧道账号与端口跟着成员一起提交。
function renderInstanceForm(row, config, id) {
  const editing = state.editing;
  const draft = editing.draft;
  const inst = draft.instance;
  const member = draft.member;

  const url = configInput(inst.url, {}, (value) => (inst.url = value));
  const tier = configSelect(inst.tier, TIER_OPTIONS, {}, (value) => (inst.tier = value));
  const status = configSelect(inst.status, INSTANCE_STATUS_OPTIONS, {}, (value) => (inst.status = value));
  const since = configInput(inst.since, { placeholder: "YYYY-MM-DD" }, (value) => (inst.since = value));
  const cardsUrl = configInput(inst.cardsUrl, {}, (value) => (inst.cardsUrl = value));
  const statsUrl = configInput(inst.statsUrl, {}, (value) => (inst.statsUrl = value));

  const host = configInput(member.host, {}, (value) => (member.host = value));
  const role = configSelect(member.role, ["founder", "partner"], {}, (value) => (member.role = value));
  const standing = configSelect(member.standing, ["permanent", "regular"], {}, (value) => (member.standing = value));
  const tunnelAccount = configInput(
    member.tunnelAccount,
    { placeholder: "knot-tunnel" },
    (value) => (member.tunnelAccount = value)
  );
  const tunnelPort = configInput(
    member.tunnelPort,
    { placeholder: "1024-65535", inputmode: "numeric" },
    (value) => (member.tunnelPort = value)
  );
  const note = configInput(member.note, {}, (value) => (member.note = value));
  const listed = el("input", { type: "checkbox" });
  listed.checked = member.listed;
  listed.addEventListener("change", () => (member.listed = listed.checked));

  const errors = editing.errors.length
    ? el(
        "ul",
        { class: "cfg-errors", role: "alert" },
        editing.errors.map((message) => el("li", {}, message))
      )
    : null;

  const save = el("button", { type: "submit", class: "btn btn-ok", "data-action": "save" }, editing.busy ? "保存中…" : "保存");
  save.disabled = editing.busy;
  const cancel = el(
    "button",
    { type: "button", class: "btn", disabled: editing.busy, onclick: () => cancelEditing() },
    "取消"
  );

  const form = el(
    "form",
    {
      class: "cfg-form",
      onsubmit: async (event) => {
        event.preventDefault();
        if (editing.busy) return;
        const changes = draftChanges(editing);
        const instancePatch = changes.instance;
        const memberPatch = changes.member;
        let memberChanged = Object.keys(memberPatch).length > 0;

        // 实例还不在名册里：这次提交任何名册字段都会新建一条成员。服务端从空白
        // 开始补，所以必须整份提交；同时把「将新建成员」写在确认里，不替人默认。
        if (memberChanged && !editing.inRoster) {
          Object.assign(memberPatch, {
            host: normalizeField(member.host),
            role: member.role,
            standing: member.standing,
            listed: Boolean(member.listed),
            note: normalizeField(member.note),
            tunnel: {
              account: normalizeField(member.tunnelAccount),
              port: normalizeField(member.tunnelPort),
            },
          });
          // 新成员的加入时间取清单那一格：名册没有单独的输入框。
          memberPatch.since = normalizeField(inst.since);
          memberChanged = true;
        }

        if (!Object.keys(instancePatch).length && !memberChanged) {
          // 没有任何改动就不发请求。
          state.editing = null;
          render();
          return;
        }

        // 状态与「写进清单」会直接改门户上的可见性，改这两项要一次明确确认。
        const warnings = [];
        if ("status" in instancePatch) {
          const from = LABELS[editing.baseline.instance.status] || editing.baseline.instance.status;
          const to = LABELS[instancePatch.status] || instancePatch.status;
          warnings.push(`状态：${from} → ${to}（暂停与退役会让实例从门户消失）`);
        }
        if ("listed" in memberPatch) {
          const from = editing.baseline.member.listed ? "是" : "否";
          const to = memberPatch.listed ? "是" : "否";
          warnings.push(`写进清单：${from} → ${to}（不写进清单就不再出现在门户）`);
        }
        if (!editing.inRoster && memberChanged) {
          warnings.push("名册里还没有这个账号：保存会新建一条成员");
        }
        if (warnings.length && !window.confirm(`${warnings.join("\n")}\n\n确定保存？`)) return;

        editing.busy = true;
        editing.errors = [];
        render();
        try {
          const changed = await changedElsewhere(editing, instancePatch, memberPatch);
          if (changed.length) {
            editing.busy = false;
            editing.errors = [
              `这些字段在你打开表单之后已被别处改过：${changed
                .map((key) => FIELD_LABEL[key] || key)
                .join("、")}。请取消后重新打开这个实例再改。`,
            ];
            render();
            return;
          }
          const payload = {};
          if (Object.keys(instancePatch).length) payload.instance = instancePatch;
          if (memberChanged) payload.member = memberPatch;
          await api(`/api/admin/instances/${encodeURIComponent(row.id)}/config`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          state.editing = null;
          state.instanceOpen = row.id;
          await loadOverview();
        } catch (error) {
          const fields = error.data && Array.isArray(error.data.fields) ? error.data.fields : null;
          state.editing.errors =
            error.status === 400 && fields && fields.length
              ? fields
              : [saveFailureText(error)];
          state.editing.busy = false;
          render();
        }
      },
    },
    [
      el("div", { class: "cfg-form-head" }, [
        el("p", { class: "cfg-title" }, `编辑 ${config.account || row.id}`),
        el("p", { class: "cfg-hint" }, "清单写到 instances.json，身份写到 federation.json；校验不过不会落盘。"),
      ]),
      errors,
      el("fieldset", { class: "cfg-group" }, [
        el("legend", {}, "清单 · instances.json"),
        el("div", { class: "cfg-form-grid" }, [
          formField("对外地址", url, "必须 https"),
          formField("分级", tier),
          formField("状态", status),
          formField("加入时间", since, "YYYY-MM-DD"),
          formField("橱窗数据", cardsUrl),
          formField("活动统计", statsUrl),
        ]),
        el("p", { class: "cfg-hint" }, [
          "名称、介绍、联系方式属于自述区，由主理人在实例自己的 /admin 里写；中枢只按 ",
          config.profileUrl || `${String(row.url || "").replace(/\/$/, "")}/api/federation/profile`,
          " 取回副本。最近取回：",
          config.profileFetchedAt || "还没取回过",
          "。",
        ]),
      ]),
      el("fieldset", { class: "cfg-group" }, [
        el("legend", {}, "名册 · federation.json"),
        el("div", { class: "cfg-form-grid" }, [
          formField("域名", host),
          formField("角色", role),
          formField("席位", standing),
          formField("隧道账号", tunnelAccount),
          formField("隧道端口", tunnelPort),
          el("label", { class: "cfg-field cfg-check" }, [
            listed,
            el("span", {}, "写进清单（listed）"),
          ]),
          formField("备注", note),
        ]),
      ]),
      el("div", { class: "cfg-form-actions" }, [save, cancel]),
    ]
  );

  return el("div", { class: "inst-config", id }, [form]);
}

function render() {
  app.replaceChildren(state.admin ? renderConsole() : renderLogin());
}

function renderLogin() {
  const username = el("input", { id: "username", name: "username", autocomplete: "username", required: true });
  const password = el("input", {
    id: "password",
    name: "password",
    type: "password",
    autocomplete: "current-password",
    required: true,
  });
  const submit = el("button", { class: "btn btn-primary btn-block", type: "submit" }, state.busy ? "正在登录…" : "登录");
  submit.disabled = state.busy;

  const form = el(
    "form",
    {
      onsubmit: async (event) => {
        event.preventDefault();
        state.busy = true;
        state.error = "";
        render();
        try {
          const data = await api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({ username: username.value, password: password.value }),
          });
          state.admin = data.admin;
          state.busy = false;
          state.view = "overview";
          await loadOverview();
        } catch (error) {
          state.busy = false;
          state.error = error.status === 401 ? "账号或密码不对。" : error.status === 429 ? "尝试过于频繁，请稍后再试。" : "登录失败，请检查接口是否在运行。";
          render();
        }
      },
    },
    [
      el("div", { class: "field" }, [el("label", { for: "username" }, "管理员账号"), username]),
      el("div", { class: "field" }, [el("label", { for: "password" }, "密码"), password]),
      state.error ? el("p", { class: "alert", role: "alert" }, state.error) : null,
      submit,
      el("p", { class: "hint" }, "账号由运维用 server/admin-cli.mjs create-admin 建立。"),
    ]
  );

  return el("main", { class: "login" }, [
    el("section", { class: "login-card" }, [
      el("p", { class: "login-mark" }, ["◆", " XKNOT / ADMIN"]),
      el("h1", {}, "联邦控制台"),
      el("p", {}, "看申请记录与实例状态；申请提交即通过，这里不再审核。"),
      form,
    ]),
  ]);
}

function renderConsole() {
  return el("div", {}, [
    renderTop(),
    // 控制台级的提示（退出没送达）：它不是某条记录的错，不能塞进详情面板。
    state.topError ? el("p", { class: "alert top-alert", role: "alert" }, state.topError) : null,
    state.view === "overview" ? renderOverview() : renderApplications(),
  ]);
}

function renderTop() {
  const pendingListing = (state.overview?.applications?.approvedNotListed || []).length;
  const viewTab = (key, label, badge) =>
    el(
      "button",
      {
        type: "button",
        class: `view-tab${state.view === key ? " active" : ""}`,
        // 用例按 data-view 定位，不按显示文案：改一句中文不该回来改测试（S24-10）。
        "data-view": key,
        onclick: () => switchView(key),
      },
      [label, badge ? el("strong", {}, String(badge)) : null]
    );

  return el("header", { class: "top" }, [
    el("div", { class: "top-brand" }, [
      el("strong", { class: "top-brand-mark" }, [
        el("img", {
          src: "/logos/xknot-icon-64.png",
          srcset:
            "/logos/xknot-icon-32.png 1x, /logos/xknot-icon-64.png 2x, /logos/xknot-icon-128.png 3x",
          alt: "",
          width: 18,
          height: 18,
        }),
        el("span", {}, "XKNOT"),
      ]),
      "/ 联邦控制台",
    ]),
    el("nav", { class: "views", "aria-label": "控制台视图" }, [
      viewTab("overview", "总览"),
      viewTab("applications", "申请记录", pendingListing),
    ]),
    el("div", { class: "top-user" }, [
      el("span", {}, state.admin.username),
      el("button",       {
        type: "button",
        class: "btn",
        "data-action": "logout",
        disabled: state.busy,
        onclick: async () => {
          if (state.busy) return;
          state.busy = true;
          state.topError = "";
          render();
          try {
            await api("/api/admin/logout", { method: "POST" });
          } catch (error) {
            // 退出没送达时不能装作已退出：服务端会话与 Cookie 都还在，
            // 刷新一下就回到已登录，共用机器上的人会以为走干净了。
            state.busy = false;
            state.topError = error.status === 401
              ? ""
              : `退出没有送达（${error.timeout ? "请求超时" : "网络或接口异常"}）。服务端会话可能仍然有效，请再试一次，或关闭浏览器。`;
            if (error.status === 401) {
              // 会话在服务端本来就已经无效了，本地状态可以照常清掉。
              clearSessionState();
            }
            render();
            return;
          }
          state.busy = false;
          clearSessionState();
          render();
        },
      }, state.busy ? "正在退出…" : "退出"),
    ]),
  ]);
}

function renderOverview() {
  const ov = state.overview;
  if (!ov) {
    return el("div", { class: "overview" }, [
      state.overviewError
        ? el("div", { class: "ov-empty" }, [
            el("p", { class: "alert", role: "alert" }, state.overviewError),
            el("button", { type: "button", class: "btn", "data-action": "retry", onclick: () => loadOverview() }, "重试"),
          ])
        : el("p", { class: "empty" }, "正在读取总览…"),
    ]);
  }

  const inst = ov.instances;
  const apps = ov.applications;
  const mail = ov.mail;
  const relay = ov.relay;
  const online = inst.up + inst.degraded;

  const kpi = (label, value, note, tone = "") =>
    el("article", { class: `kpi${tone ? ` ${tone}` : ""}` }, [
      el("p", { class: "kpi-label" }, label),
      el("p", { class: "kpi-value" }, value),
      el("p", { class: "kpi-note" }, note),
    ]);

  const instanceRows = inst.rows.length
    ? inst.rows.map((row) => {
        const open = state.instanceOpen === row.id;
        const panelId = `inst-config-${row.id}`;
        return el("div", { class: `inst-item${open ? " open" : ""}` }, [
          el(
            "button",
            {
              type: "button",
              class: "inst-row",
              "aria-expanded": open ? "true" : "false",
              "aria-controls": panelId,
              onclick: () => toggleInstance(row.id),
            },
            [
              el("span", { class: "inst-what" }, [
                el("span", { class: "inst-name" }, row.name),
                el("span", { class: "inst-url" }, `${row.id} · ${row.url || "未填地址"}`),
                el("span", { class: "inst-tags" }, [
                  // 旧档位（partner/community）在 LABELS 里有说法，别把英文原值摆到首页上。
                  el("span", { class: "pill" }, LABELS[row.tier] || row.tier),
                  ...(row.services.cards ? [el("span", { class: "pill" }, "橱窗")] : []),
                  ...(row.services.stats ? [el("span", { class: "pill" }, "统计")] : []),
                  // 对端采集过、但这条隧道不在：与「接口 502」是两种故障。
                  row.tunnel?.checkedAt && !row.tunnel.connected
                    ? el("span", { class: "pill warn" }, "隧道断开")
                    : null,
                  // 位置只在和档案不一致时提醒：一致时多一个胶囊只是噪音。
                  locationDrift(row)
                    ? el(
                        "span",
                        { class: "pill warn", title: "门户显示的是观测位置，不是档案里的 region" },
                        `位置 ${row.location.country}（档案 ${row.regions[0]}）`
                      )
                    : null,
                  row.health.hidden ? el("span", { class: "pill warn" }, "已隐藏") : null,
                ]),
              ]),
              el("span", { class: "inst-state" }, [
                el("span", { class: `dot ${row.health.status}` }),
                el("span", {}, HEALTH_LABEL[row.health.status] || row.health.status),
              ]),
              el("span", { class: "inst-note" }, [
                el("span", {}, healthNote(row)),
                trafficNote(row) ? el("span", {}, trafficNote(row)) : null,
                row.health.error
                  ? el("span", { class: "inst-error" }, ERROR_LABEL[row.health.error] || row.health.error)
                  : null,
              ]),
              el("span", { class: "inst-toggle", "aria-hidden": "true" }, open ? "收起" : "配置"),
            ]
          ),
          open ? renderInstanceConfig(row, panelId) : null,
        ]);
      })
    : el("p", { class: "empty" }, "清单里还没有实例。");

  const queueKeys = ["approved", "withdrawn", "rejected", "expired"];
  const queue = el(
    "div",
    { class: "queue" },
    queueKeys.map((key) =>
      el("button", { type: "button", class: "queue-row", "data-status": key, onclick: () => openApplications(key) }, [
        el("span", {}, STATUS_LABEL[key]),
        el("strong", {}, String(apps.counts[key] || 0)),
      ])
    )
  );

  // 发信总闸：一个按钮。三件事必须说清——现在是开还是关、关掉之后谁会受影响、
  // 以及关的是「发信」不是「配置」。没配 SMTP 时禁用并说明先填什么。
  const mailOn = mail.switch !== "off";
  const mailSwitch = el(
    "div",
    { class: "mail-line" },
    [
      el("span", {}, "发信总闸"),
      el(
        "button",
        {
          type: "button",
          class: "switch",
          role: "switch",
          "aria-checked": mailOn ? "true" : "false",
          "aria-label": mailOn ? "发信已开启，点一下停发" : "发信已停止，点一下开启",
          // 没配 SMTP 时这个开关没有意义（点了也不会有一封信能出去），禁用。
          disabled: !mail.configured || state.mailBusy,
          onclick: () => toggleMail(!mailOn),
        },
        [
          el("span", { class: "switch-track", "aria-hidden": "true" }, [el("span", { class: "switch-thumb" })]),
          el("span", {}, state.mailBusy ? "处理中…" : mailOn ? "ON" : "OFF"),
        ]
      ),
    ]
  );

  const mailSwitchNote = (value) => {
    if (!value.configured) return "还没有配 SMTP：填好 SMTP_HOST 与 MAIL_FROM 之后这个开关才有意义。";
    if (value.switch === "off") {
      return "已停发：伙伴信与内部信不再寄出，/api/federation/mail 返回 503，各节点的登录密钥会跟着寄不出去。凭据、额度与记录都不动，打开即恢复。";
    }
    // 环境变量是另一道闸，只管代发；总闸开着的时候它照样能让节点撞墙，
    // 所以这句必须写出来，否则面板显示「已开启」而节点一直是 503。
    if (relay.envOff) {
      return "发信本身在开；但环境变量 XKNOT_RELAY_ENABLED=0 关掉了委托发信，各节点的代发请求仍返回 503。";
    }
    return "关掉后：伙伴信与内部信不再寄出，各节点提交的代发请求返回 503（它们的登录密钥会寄不出去）。凭据与额度不动，打开即恢复。";
  };
  const mailError = state.mailError;

  const events = ov.events.length
    ? el(
        "div",
        { class: "events" },
        ov.events.map((event) =>
          el("div", { class: "event-row" }, [
            el("div", { class: "event-what" }, [
              el("span", {}, EVENT_LABEL[event.kind] || event.kind),
              event.ref ? el("p", { class: "event-ref" }, event.ref) : null,
            ]),
            el("span", { class: "event-when" }, relativeLabel(event.at)),
          ])
        )
      )
    : el("p", { class: "empty" }, "还没有记录。");

  return el("div", { class: "overview" }, [
    el("section", { class: "ov-hero" }, [
      el("div", {}, [
        el("p", { class: "ov-eyebrow" }, "FEDERATION OVERVIEW"),
        el("h1", { class: "ov-title" }, `${inst.total} 个实例 · ${online} 个在线`),
        el("p", { class: "ov-sub" }, [
          inst.checkedAt ? `探测 ${relativeLabel(inst.checkedAt)}` : "尚未探测",
          " · ",
          `接口 ${ov.runtime.version} 已运行 ${formatUptime(ov.runtime.uptimeSeconds)}`,
          " · ",
          `申请库 ${formatBytes(ov.runtime.dbBytes)}`,
          inst.trafficNodes
            ? ` · 昨日 ${inst.trafficRequests} 次请求 / ${formatBytes(inst.trafficBytes)}`
            : null,
        ]),
      ]),
      el(
        "button",
        {
          type: "button",
          class: "btn",
          disabled: state.overviewBusy,
          onclick: () => loadOverview(),
        },
        state.overviewBusy ? "刷新中…" : "刷新"
      ),
    ]),
    state.overviewError ? el("p", { class: "alert", role: "alert" }, state.overviewError) : null,
    el("div", { class: "ov-cards" }, [
      kpi(
        "实例",
        String(inst.total),
        `在线 ${online} · 离线 ${inst.down} · 待验收 ${inst.pending || 0} · 其他 ${inst.unknown + inst.unprobed + inst.paused}`,
        inst.down ? "bad" : ""
      ),
      kpi(
        "申请",
        String(apps.total),
        `已通过 ${apps.counts.approved || 0} · 已撤回 ${apps.counts.withdrawn || 0} · 待收录 ${apps.approvedNotListed.length}`,
        apps.approvedNotListed.length ? "warn" : ""
      ),
      kpi(
        "24 小时发信",
        mail.configured ? (mail.switch === "off" ? "已停发" : String(mail.sent)) : "未配置",
        mail.configured
          ? `失败 ${mail.failed} · 限流 ${mail.throttled}`
          : "设置 SMTP_* 后启用",
        mail.failed ? "bad" : ""
      ),
      kpi(
        "委托发信",
        relay.enabled ? String(relay.accepted) : "未开启",
        `凭据 ${relay.activeTokens}/${relay.tokens} · 失败 ${relay.failed}`,
        relay.failed ? "bad" : ""
      ),
    ]),
    el("div", { class: "ov-grid" }, [
      el("div", { class: "ov-col" }, [
        el("section", { class: "panel" }, [
          el("div", { class: "panel-head", "data-panel": "instances" }, [
            el("h2", {}, "实例与探测"),
            el("span", { class: "meta" }, inst.checkedAt ? `上次探测 ${relativeLabel(inst.checkedAt)}` : "未探测"),
          ]),
          el("p", { class: "panel-note" }, "点一行展开这个账号的配置，不会跳走。"),
          el("div", { class: "inst-list" }, instanceRows),
        ]),
      ]),
      el("div", { class: "ov-col" }, [
        el("section", { class: "panel" }, [
          el("div", { class: "panel-head", "data-panel": "applications" }, [
            el("h2", {}, "申请记录"),
            el("button", { type: "button", class: "link-btn", onclick: () => openApplications("all") }, "查看全部"),
          ]),
          queue,
          apps.approvedNotListed.length
            ? el(
                "p",
                { class: "panel-note warn" },
                `已通过但未写进清单：${apps.approvedNotListed
                  .map((item) => item.address || item.id)
                  .join("、")}`
              )
            : null,
        ]),
        el("section", { class: "panel" }, [
          el("div", { class: "panel-head", "data-panel": "mail" }, [el("h2", {}, "发信")]),
          mailSwitch,
          el("p", { class: "panel-note switch-note" }, mailSwitchNote(mail)),
          mailError ? el("p", { class: "alert", role: "alert" }, mailError) : null,
          el("div", { class: "mail-line" }, [
            el("span", {}, "SMTP"),
            el("span", { class: "mono" }, mail.configured ? "已配置" : "未配置"),
          ]),
          el("div", { class: "mail-line" }, [
            el("span", {}, "24 小时"),
            el("span", { class: "mono" }, `成功 ${mail.sent} · 失败 ${mail.failed} · 限流 ${mail.throttled}`),
          ]),
          el("div", { class: "mail-line" }, [
            el("span", {}, "委托发信"),
            el("span", { class: "mono" }, relay.enabled ? "已开启" : "未开启"),
          ]),
          el("div", { class: "mail-line" }, [
            el("span", {}, "最近一封"),
            el("span", { class: "mono" }, mail.lastAt ? relativeLabel(mail.lastAt) : "—"),
          ]),
        ]),
        el("section", { class: "panel" }, [
          el("div", { class: "panel-head", "data-panel": "events" }, [el("h2", {}, "最近事件")]),
          events,
        ]),
      ]),
    ]),
  ]);
}

function switchView(view) {
  if (view === state.view) return;
  // 有未保存的草稿就先问一句：切一次视图就把填了一半的配置丢掉，
  // 用户只会以为是自己点错了。
  if (!confirmDiscardEditing()) return;
  state.view = view;
  state.error = "";
  state.topError = "";
  state.editing = null;
  state.instanceOpen = null;
  render();
  if (view === "overview") loadOverview();
  else loadApplications();
}

function openApplications(status) {
  if (!confirmDiscardEditing()) return;
  state.filter = status;
  state.selected = null;
  state.manifest = null;
  state.editing = null;
  state.instanceOpen = null;
  state.view = "applications";
  state.error = "";
  state.topError = "";
  render();
  loadApplications();
}

function renderApplications() {
  const loading = state.applicationsBusy;
  const tabs = ["approved", "withdrawn", "all"].map((key) => {
    const count = key === "all" ? Object.values(state.counts).reduce((a, b) => a + b, 0) : state.counts[key] || 0;
    return el(
      "button",
      {
        type: "button",
        class: `tab${state.filter === key ? " active" : ""}`,
        "data-status": key,
        disabled: loading,
        onclick: () => {
          state.filter = key;
          state.selected = null;
          state.manifest = null;
          render();
          loadApplications();
        },
      },
      [key === "all" ? "全部" : STATUS_LABEL[key], el("strong", {}, String(count))]
    );
  });

  // 只渲染属于当前分类的行。切分类后请求失败时，state.applications 还是上一次
  // 读到的内容（例如「已通过」），标签却已经是「已撤回」，那些行不能继续显示。
  const rows = state.applicationsFilter === state.filter ? state.applications : [];

  let list;
  if (state.applicationsError) {
    // 读取失败时只留错误条与重试。上一次的行属于别的分类（或已经不是当前数据），
    // 继续显示会让运维把它当成这次读到的东西，所以这里一行都不渲染。
    list = el("div", { class: "load-error" }, [
      el("p", { class: "alert", role: "alert" }, state.applicationsError),
      el("button", { type: "button", class: "btn", "data-action": "retry", disabled: loading, onclick: () => loadApplications() }, "重试"),
    ]);
  } else if (rows.length) {
    list = el(
      "div",
      { class: "list", "aria-busy": loading ? "true" : null },
      rows.map((item) =>
        el(
          "button",
          {
            type: "button",
            class: `item${state.selected?.id === item.id ? " selected" : ""}`,
            disabled: loading,
            onclick: () => select(item),
          },
          [
            el("span", { class: "item-name" }, item.name),
            el("span", { class: `badge ${item.status}`, "data-status": item.status }, STATUS_LABEL[item.status] || item.status),
            el("span", { class: "item-url" }, item.url),
            el("span", { class: "item-meta" }, [
              item.id,
              "·",
              regionLabel(item.region),
              "·",
              // 申请单自带时区：按提交者那边的钟点显示，不把时间挪到控制台的时区。
              formatWhen(item.createdAt, item.timezone),
            ]),
          ]
        )
      )
    );
  } else {
    // 读取中的空列表不是「没有记录」：说清楚还在等接口，别让运维以为查过了。
    list = el(
      "p",
      { class: "empty" },
      loading ? "正在读取…" : state.filter === "approved" ? "还没有通过记录。" : "这个分类下没有记录。"
    );
  }

  // 列表接口默认最多回 200 条，顶部计数是库里全量。两者不等时说清「少的那部分」，
  // 否则运维会以为看全了。
  const total = state.filter === "all"
    ? Object.values(state.counts).reduce((sum, value) => sum + (Number(value) || 0), 0)
    : Number(state.counts[state.filter]) || 0;
  const clipped = !loading && !state.applicationsError && total > rows.length;

  return el("div", { class: "layout" }, [
    el("section", { class: "panel" }, [
      el("div", { class: "tabs" }, tabs),
      list,
      clipped
        ? el(
            "p",
            { class: "panel-note warn" },
            `这里只列出最近 ${rows.length} 条，这个分类共 ${total} 条。更早的记录没有翻页入口，需要时按编号查库。`
          )
        : null,
    ]),
    el("aside", { class: "panel" }, [
      state.selected
        ? renderDetail(state.selected)
        : el("p", { class: "detail-empty" }, "从左侧选一条申请查看详情。"),
    ]),
  ]);
}

function renderDetail(item) {
  const manifest = state.manifest && state.manifestId === item.id ? state.manifest : null;
  const notListed = (state.overview?.applications?.approvedNotListed || []).some((row) => row.id === item.id);

  return el("div", { class: "detail" }, [
    el("div", { class: "detail-head" }, [
      el("div", {}, [
        el("h2", {}, item.name),
        el("p", { class: "detail-id" }, `${item.id} · 提交于 ${formatWhen(item.createdAt, item.timezone)}`),
      ]),
      el("span", { class: `badge ${item.status}`, "data-status": item.status }, STATUS_LABEL[item.status] || item.status),
    ]),

    el("dl", { class: "dl" }, [
      el("dt", {}, "站点"),
      // 地址与邮箱都来自申请单：不合格就退化成纯文本，不拼进 href。
      el("dd", {}, safeLink(item.url, item.url, "detail-link")),
      el("dt", {}, "运营者"),
      el("dd", {}, item.operator),
      el("dt", {}, "邮箱"),
      el("dd", {}, mailtoHref(item.email)
        ? el("a", { href: mailtoHref(item.email) }, item.email)
        : item.email || "—"),
      el("dt", {}, "区域"),
      el("dd", {}, regionLabel(item.region)),
      el("dt", {}, "时区"),
      el("dd", {}, item.timezone ? `${item.timezone}（上面的时间按它显示）` : "申请没写"),
      // 申请人勾选的服务决定后面签什么：relay 等于发信凭据，cards/stats 决定要不要接数据。
      el("dt", {}, "申请服务"),
      el("dd", {}, item.requestServices && item.requestServices.length
        ? item.requestServices.map((key) => SERVICE_LABEL[key] || key).join(" · ")
        : "没有勾选"),
      el("dt", {}, "提交语种"),
      el("dd", {}, item.locale || "—"),
      // 案例页上带公钥与交付资料的领取入口，运维判断流程走到哪一步要看它。
      el("dt", {}, "案例页"),
      el("dd", {}, item.caseKey
        ? safeLink(`${window.location.origin}/case/${item.caseKey}`, `/case/${item.caseKey}`, "detail-link")
        : "没有案例页"),
      el("dt", {}, "简介"),
      el("dd", {}, item.intro),
      el("dt", {}, "标签"),
      el("dd", {}, item.tags.length ? item.tags.map((tag) => `#${tag}`).join(" ") : "—"),
      el("dt", {}, "通过"),
      el("dd", {}, item.reviewedAt
        ? `${item.reviewedBy === "auto" || !item.reviewedBy ? "提交即通过" : item.reviewedBy} · ${formatWhen(item.reviewedAt, item.timezone)}`
        : "—"),
      state.overview
        ? el("dt", {}, "收录")
        : null,
      state.overview
        ? el("dd", {}, notListed ? "还没写进清单" : "已写进清单")
        : null,
      el("dt", {}, "公钥"),
      el("dd", {}, item.publicKey || "未提交"),
    ]),

    el("p", { class: "hint" }, "申请提交即通过，这里不再审核。要让一个成员停下来，改它实例的 status（暂停 / 退役）。"),

    item.status === "approved"
      ? el("div", { class: "snippet" }, [
          el("div", { class: "snippet-head" }, [
            el("span", {}, "清单条目"),
            el("button", {
              type: "button",
              class: "btn",
              "data-action": "manifest",
              disabled: state.manifestBusy,
              onclick: async () => {
                if (state.manifestBusy) return;
                state.manifestBusy = true;
                state.error = "";
                state.manifest = null;
                state.manifestId = null;
                // 置位后立刻重绘：按钮在请求期间就是禁用的，双击只发一次。
                render();
                try {
                  const data = await api(`/api/admin/applications/${item.id}/manifest`);
                  state.manifest = JSON.stringify(data.entry, null, 2);
                  state.manifestId = item.id;
                } catch (error) {
                  // 422 会说明具体是哪一项不合规：那是唯一能直接照做的信息，
                  // 不能换成一句「失败」。其余失败也带上状态码与超时原因。
                  const problems = error.data && Array.isArray(error.data.problems) ? error.data.problems : null;
                  state.error = problems && problems.length
                    ? `清单条目不合规：${problems.join("；")}`
                    : error.status === 422
                      ? "清单条目不合规，但接口没有说明是哪一项。"
                      : error.status
                        ? `生成清单条目失败（HTTP ${error.status}）。`
                        : error.timeout
                          ? "生成清单条目超时，请稍后重试。"
                          : "生成清单条目失败，请检查接口是否在运行。";
                }
                state.manifestBusy = false;
                render();
              },
            }, manifest ? "重新生成" : "生成"),
          ]),
          manifest
            ? el("div", {}, [
                el("pre", { tabindex: "0" }, manifest),
                el("button", {
                  type: "button",
                  // 控制台 CSP 是 style-src 'self'，行内 style 会被拦，样式放 CSS 里。
                  class: "btn btn-copy",
                  onclick: async () => {
                    try {
                      await navigator.clipboard.writeText(manifest);
                      state.copied = true;
                      render();
                      setTimeout(() => {
                        state.copied = false;
                        render();
                      }, 1800);
                    } catch {
                      state.error = "浏览器不允许写剪贴板，请手动选择复制。";
                      render();
                    }
                  },
                }, state.copied ? "已复制" : "复制"),
                el("p", { class: "hint" }, "粘贴进 instances.json 后执行 npm run build，条目才会出现在门户上。也可以直接运行 server/admin-cli.mjs publish " + item.id),
              ])
            : null,
        ])
      : el("p", { class: "hint" }, "这份申请已撤回，只在库里留档。"),

    state.error ? el("p", { class: "alert", role: "alert" }, state.error) : null,
  ]);
}

async function select(item) {
  state.selected = item;
  state.error = "";
  state.manifest = null;
  state.copied = false;
  render();
}

async function loadOverview() {
  const seq = ++overviewSeq;
  const view = state.view;
  state.overviewBusy = true;
  state.overviewError = "";
  if (state.view === view) render();
  try {
    const data = await api("/api/admin/overview");
    if (seq !== overviewSeq) return;
    // 总览是几个必要分组的拼装。少一组就别当成可渲染的数据收下：
    // overview 为 null 又没有错误时，页面会永远停在「正在读取总览…」。
    if (!data || !data.instances || !data.applications || !data.runtime) {
      throw Object.assign(new Error("invalid_overview"), { status: 200, invalidResponse: true });
    }
    state.overview = data;
  } catch (error) {
    if (seq !== overviewSeq) return;
    if (error.status === 401) {
      clearSessionState();
      return;
    }
    state.overview = null;
    state.overviewError = error.timeout
      ? "读取总览超时，请重试。"
      : error.invalidResponse
        ? "接口返回的不是控制台认识的数据，请检查入口的反代配置。"
        : "总览加载失败，请检查接口是否在运行。";
  } finally {
    if (seq === overviewSeq) {
      state.overviewBusy = false;
      // 用户已经切到申请列表时不再整棵重绘，否则会把他正点着的那一行换掉。
      if (state.view === view) render();
    }
  }
}

// 发信总闸。成功后重新读一次总览：KPI 与「委托发信」那一行都要跟着变，
// 只改本地一个布尔会和后端的真实状态分叉。
async function toggleMail(next) {
  if (state.mailBusy) return;
  state.mailBusy = true;
  state.mailError = "";
  render();
  try {
    await api("/api/admin/mail", {
      method: "POST",
      body: JSON.stringify({ enabled: next }),
    });
    await loadOverview();
  } catch (error) {
    if (error.status === 401) {
      clearSessionState();
      return;
    }
    state.mailError =
      error.timeout ? "切换超时，请重试。" : "切换失败，请检查接口是否在运行。";
  } finally {
    state.mailBusy = false;
    render();
  }
}

async function loadApplications() {
  const seq = ++applicationsSeq;
  const view = state.view;
  // 这次请求读的是哪个分类。响应回来时 state.filter 可能已经变了（用户又点了一下），
  // 所以记下请求时的值，不按回来时的 state.filter 判断行属于谁。
  const filter = state.filter;
  state.applicationsBusy = true;
  state.applicationsError = "";
  render();
  try {
    const query = filter && filter !== "all" ? `?status=${filter}` : "";
    const data = await api(`/api/admin/applications${query}`);
    if (seq !== applicationsSeq) return;
    if (!data || !Array.isArray(data.applications) || !data.counts) {
      throw Object.assign(new Error("invalid_list"), { status: 200, invalidResponse: true });
    }
    state.applications = data.applications;
    state.applicationsFilter = filter;
    state.counts = data.counts;
    if (state.selected) {
      const fresh = state.applications.find((item) => item.id === state.selected.id);
      if (fresh) state.selected = fresh;
    }
  } catch (error) {
    if (seq !== applicationsSeq) return;
    if (error.status === 401) {
      clearSessionState();
      return;
    }
    // 失败要把失败本身渲染出来（renderApplications 读 applicationsError），
    // 并把旧行清掉：它们属于上一次读的分类，顶着新标签显示就是在冒充当前数据。
    state.applicationsError = error.status
      ? `申请列表加载失败（HTTP ${error.status}）。`
      : error.timeout
        ? "申请列表加载超时，请重试。"
        : "申请列表加载失败，请检查接口是否在运行。";
    state.applications = [];
    state.applicationsFilter = filter;
  } finally {
    if (seq === applicationsSeq) {
      state.applicationsBusy = false;
      // 用户已经切走时不再整棵重绘，否则会把他正点着的那一行换掉。
      if (state.view === view) render();
    }
  }
}

async function boot() {
  try {
    const data = await api("/api/admin/session");
    state.admin = data.admin;
    state.view = "overview";
    await loadOverview();
  } catch {
    state.admin = null;
    render();
  }
}

boot();
