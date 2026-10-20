// XKnot 审核台。
//
// 无构建步骤：浏览器直接加载这个模块。所有文本用 textContent 写入，
// 申请内容不会当成 HTML 执行。

const app = document.getElementById("app");

const STATUS_LABEL = {
  pending: "待确认",
  verified: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  hold: "搁置",
  withdrawn: "已撤回",
  expired: "已过期",
};

// 总览里的实例状态。paused 是清单里的 status 不是 active，unprobed 是还没配 healthUrl。
const HEALTH_LABEL = {
  up: "在线",
  degraded: "降级",
  down: "离线",
  unknown: "未知",
  unprobed: "未探测",
  paused: "已暂停",
};

const TIER_LABEL = {
  founder: "创始",
  partner: "伙伴",
  community: "社区",
  demo: "示例",
};

const ERROR_LABEL = {
  timeout: "超时",
  unresolvable: "域名解析失败",
  redirect: "跳转被拒",
  bad_payload: "响应不符合契约",
};

const EVENT_LABEL = {
  "application.submitted": "新申请",
  "application.verified": "邮箱已确认",
  "application.contact_verified": "联系邮箱已确认",
  "application.public_key": "已保存公钥",
  "application.approved": "审核通过",
  "application.rejected": "审核拒绝",
  "application.hold": "搁置待补",
  "application.withdrawn": "申请撤回",
  "application.expired": "申请过期",
  "verify.issued": "发出验证信",
  "claim.issued": "发出交付资料",
  "claim.consumed": "领取交付资料",
  "relay.token_created": "签发发信凭据",
  "relay.token_revoked": "吊销发信凭据",
  "admin.created": "建管理员",
  "admin.deleted": "删管理员",
  "admin.password_reset": "重设口令",
};

// 落点只有两种选择：自己给地址，或走边缘隧道。
const ACCESS_LABEL = {
  direct: "自有域名 / 固定公网 IP",
  tunnel: "动态 IP · 边缘隧道",
  unknown: "未选择",
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
  filter: "pending",
  applications: [],
  counts: { pending: 0, verified: 0, approved: 0, rejected: 0, hold: 0, withdrawn: 0, expired: 0 },
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
  manifest: null,
  manifestId: null,
  copied: false,
};

// 每次读取带一个序号。晚到的旧响应直接丢掉，避免它把刚点开的分类又重绘回去。
let overviewSeq = 0;
let applicationsSeq = 0;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
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
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
    ...options,
  });
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
  return data;
}

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function regionLabel(code) {
  const group = code === "GLOBAL" ? "global" : COUNTRY_GROUP[code] || "other";
  return `${REGION_LABEL[group]} · ${code}`;
}

function relativeLabel(value) {
  const at = Date.parse(value || "");
  if (Number.isNaN(at)) return "—";
  const minutes = Math.round((Date.now() - at) / 60000);
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

function healthNote(row) {
  const health = row.health || {};
  if (health.status === "paused") return "清单里状态不是 active，不探测";
  if (health.status === "unprobed") return "未配置 healthUrl，等接通验收";
  if (health.status === "down") {
    return health.downSince ? `自 ${relativeLabel(health.downSince)} 起断连` : "探测失败";
  }
  if (health.latencyMs != null) return `${health.latencyMs} ms`;
  if (health.lastOkAt) return `上次正常 ${relativeLabel(health.lastOkAt)}`;
  return "没有探测记录";
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
      el("h1", {}, "联邦审核台"),
      el("p", {}, "审核加入申请，通过后生成实例清单条目。"),
      form,
    ]),
  ]);
}

function renderConsole() {
  return el("div", {}, [
    renderTop(),
    state.view === "overview" ? renderOverview() : renderApplications(),
  ]);
}

function renderTop() {
  const counts = (state.overview && state.overview.applications.counts) || state.counts;
  const waiting = (counts.pending || 0) + (counts.verified || 0) + (counts.hold || 0);
  const viewTab = (key, label, badge) =>
    el(
      "button",
      {
        type: "button",
        class: `view-tab${state.view === key ? " active" : ""}`,
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
      "/ 联邦审核台",
    ]),
    el("nav", { class: "views", "aria-label": "审核台视图" }, [
      viewTab("overview", "总览"),
      viewTab("applications", "申请审核", waiting),
    ]),
    el("div", { class: "top-user" }, [
      el("span", {}, state.admin.username),
      el("button", {
        type: "button",
        class: "btn",
        onclick: async () => {
          await api("/api/admin/logout", { method: "POST" }).catch(() => {});
          state.admin = null;
          state.applications = [];
          state.overview = null;
          state.selected = null;
          render();
        },
      }, "退出"),
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
            el("button", { type: "button", class: "btn", onclick: () => loadOverview() }, "重试"),
          ])
        : el("p", { class: "empty" }, "正在读取总览…"),
    ]);
  }

  const inst = ov.instances;
  const apps = ov.applications;
  const mail = ov.mail;
  const relay = ov.relay;
  const online = inst.up + inst.degraded;
  const verifiedWaiting = (apps.counts.verified || 0) + (apps.counts.hold || 0);
  const unconfirmed = apps.counts.pending || 0;
  const waiting = verifiedWaiting + unconfirmed;

  const kpi = (label, value, note, tone = "") =>
    el("article", { class: `kpi${tone ? ` ${tone}` : ""}` }, [
      el("p", { class: "kpi-label" }, label),
      el("p", { class: "kpi-value" }, value),
      el("p", { class: "kpi-note" }, note),
    ]);

  const instanceRows = inst.rows.length
    ? inst.rows.map((row) =>
        el("div", { class: "inst-row" }, [
          el("div", { class: "inst-what" }, [
            el(
              "a",
              { class: "inst-name", href: row.url, target: "_blank", rel: "noopener noreferrer" },
              row.name
            ),
            el("p", { class: "inst-url" }, `${row.id} · ${row.url || "未填地址"}`),
            el("div", { class: "inst-tags" }, [
              el("span", { class: "pill" }, TIER_LABEL[row.tier] || row.tier),
              ...(row.services.cards ? [el("span", { class: "pill" }, "橱窗")] : []),
              ...(row.services.stats ? [el("span", { class: "pill" }, "统计")] : []),
              row.health.hidden ? el("span", { class: "pill warn" }, "已隐藏") : null,
            ]),
          ]),
          el("div", { class: "inst-state" }, [
            el("span", { class: `dot ${row.health.status}` }),
            el("span", {}, HEALTH_LABEL[row.health.status] || row.health.status),
          ]),
          el("div", { class: "inst-note" }, [
            el("span", {}, healthNote(row)),
            row.health.error
              ? el("span", { class: "inst-error" }, ERROR_LABEL[row.health.error] || row.health.error)
              : null,
          ]),
        ])
      )
    : el("p", { class: "empty" }, "清单里还没有实例。");

  const queueKeys = ["verified", "hold", "pending", "approved", "rejected", "withdrawn", "expired"];
  const queue = el(
    "div",
    { class: "queue" },
    queueKeys.map((key) =>
      el("button", { type: "button", class: "queue-row", onclick: () => openApplications(key) }, [
        el("span", {}, STATUS_LABEL[key]),
        el("strong", {}, String(apps.counts[key] || 0)),
      ])
    )
  );

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
        `在线 ${online} · 离线 ${inst.down} · 其他 ${inst.unknown + inst.unprobed + inst.paused}`,
        inst.down ? "bad" : ""
      ),
      kpi(
        "待处理申请",
        String(waiting),
        `待审核 ${verifiedWaiting} · 待确认 ${unconfirmed} · 已通过 ${apps.counts.approved || 0}`,
        waiting ? "warn" : ""
      ),
      kpi(
        "24 小时发信",
        mail.enabled ? String(mail.sent) : "未配置",
        mail.enabled ? `失败 ${mail.failed} · 限流 ${mail.throttled}` : "设置 SMTP_* 后启用",
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
          el("div", { class: "panel-head" }, [
            el("h2", {}, "实例与探测"),
            el("span", { class: "meta" }, inst.checkedAt ? `上次探测 ${relativeLabel(inst.checkedAt)}` : "未探测"),
          ]),
          el("div", { class: "inst-list" }, instanceRows),
        ]),
      ]),
      el("div", { class: "ov-col" }, [
        el("section", { class: "panel" }, [
          el("div", { class: "panel-head" }, [
            el("h2", {}, "申请队列"),
            el("button", { type: "button", class: "link-btn", onclick: () => openApplications("all") }, "查看全部"),
          ]),
          queue,
          apps.oldestOpenAt
            ? el("p", { class: "panel-note" }, `最久一条在队列里 ${relativeLabel(apps.oldestOpenAt)}。`)
            : null,
          apps.approvedNotListed.length
            ? el(
                "p",
                { class: "panel-note warn" },
                `已通过但未写进清单：${apps.approvedNotListed
                  .map((item) => item.subdomain || item.id)
                  .join("、")}`
              )
            : null,
        ]),
        el("section", { class: "panel" }, [
          el("div", { class: "panel-head" }, [el("h2", {}, "发信")]),
          el("div", { class: "mail-line" }, [
            el("span", {}, "伙伴与内部信"),
            el("span", { class: "mono" }, mail.enabled ? "SMTP 已配置" : "未配置"),
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
          el("div", { class: "panel-head" }, [el("h2", {}, "最近事件")]),
          events,
        ]),
      ]),
    ]),
  ]);
}

function switchView(view) {
  if (view === state.view) return;
  state.view = view;
  state.error = "";
  render();
  if (view === "overview") loadOverview();
  else loadApplications();
}

function openApplications(status) {
  state.filter = status;
  state.selected = null;
  state.manifest = null;
  state.view = "applications";
  state.error = "";
  render();
  loadApplications();
}

function renderApplications() {
  const loading = state.applicationsBusy;
  const tabs = ["pending", "verified", "hold", "approved", "rejected", "all"].map((key) => {
    const count = key === "all" ? Object.values(state.counts).reduce((a, b) => a + b, 0) : state.counts[key] || 0;
    return el(
      "button",
      {
        type: "button",
        class: `tab${state.filter === key ? " active" : ""}`,
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

  const list = state.applications.length
    ? el(
        "div",
        { class: "list", "aria-busy": loading ? "true" : null },
        state.applications.map((item) =>
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
              el("span", { class: `badge ${item.status}` }, STATUS_LABEL[item.status] || item.status),
              el("span", { class: "item-url" }, item.url),
              el("span", { class: "item-meta" }, [
                item.id,
                "·",
                regionLabel(item.region),
                "·",
                formatWhen(item.createdAt),
              ]),
            ]
          )
        )
      )
    : el("p", { class: "empty" }, state.filter === "pending" ? "没有待审申请。" : "这个分类下没有记录。");

  return el("div", { class: "layout" }, [
    el("section", { class: "panel" }, [el("div", { class: "tabs" }, tabs), list]),
    el("aside", { class: "panel" }, [
      state.selected
        ? renderDetail(state.selected)
        : el("p", { class: "detail-empty" }, "从左侧选一条申请查看详情。"),
    ]),
  ]);
}

const HOLD_OPTIONS = [
  ["site_unreachable", "站点从公网打不开"],
  ["health_missing", "没有可用的 /api/health"],
  ["intro_unclear", "简介与实际内容不符"],
  ["name_conflict", "名称或标识可能冲突"],
  ["contact_invalid", "联系邮箱无法送达"],
  ["region_mismatch", "区域或时区不符"],
  ["other", "材料不足"],
];

const REJECT_OPTIONS = [
  ["incomplete", "材料不足"],
  ["unreachable", "站点不可达"],
  ["policy", "不符合联邦约定"],
];

function renderDetail(item) {
  const note = el("textarea", { rows: "2", placeholder: "审核备注（可选，只有内部可见，不会寄给申请人）" });
  note.value = item.reviewNote || "";

  // 补材料只认条目码：勾选结果随 review 一起提交，信中只出现这些条目。
  const boxes = HOLD_OPTIONS.map(([code, label]) => {
    const box = el("input", { type: "checkbox", value: code });
    box.checked = Array.isArray(item.holdItems) && item.holdItems.includes(code);
    return { code, box, label };
  });
  const reason = el("select", {});
  for (const [code, label] of REJECT_OPTIONS) {
    const option = el("option", { value: code }, label);
    if ((item.rejectReason || "incomplete") === code) option.selected = true;
    reason.append(option);
  }

  const blocked = state.busy;
  const review = (decision, label, extraClass = "") =>
    el(
      "button",
      {
        type: "button",
        class: `btn ${extraClass}`,
        disabled: blocked,
        onclick: async () => {
          state.busy = true;
          render();
          try {
            const data = await api(`/api/admin/applications/${item.id}/review`, {
              method: "POST",
              body: JSON.stringify({
                decision,
                note: note.value,
                items: boxes.filter((entry) => entry.box.checked).map((entry) => entry.code),
                reason: reason.value,
              }),
            });
            state.selected = data.application;
            state.manifest = null;
            // 审核成功后必须解除忙碌态，否则「生成」与审核键会一直是灰的。
            state.busy = false;
            await loadApplications();
          } catch (error) {
            state.error =
              error.status === 409
                ? "这条申请已经不在可审核状态，刷新后重试。"
                : "审核没有保存，请重试。";
            state.busy = false;
            render();
          }
        },
      },
      label
    );

  const canApprove = ["verified", "hold"].includes(item.status);
  const canReject = ["verified", "hold"].includes(item.status);
  const canHold = item.status === "verified";
  const canResume = item.status === "hold";
  const actions = [
    canApprove ? review("approve", "通过", "btn-ok") : null,
    canReject ? review("reject", "拒绝", "btn-bad") : null,
    canHold ? review("hold", "搁置") : null,
    canResume ? review("resume", "恢复审核") : null,
  ].filter(Boolean);

  const resend = item.status === "pending"
    ? el("button", {
        type: "button",
        class: "btn",
        disabled: blocked,
        onclick: async () => {
          state.busy = true;
          state.error = "";
          try {
            const data = await api(`/api/admin/applications/${item.id}/notify`, {
              method: "POST",
              body: JSON.stringify({ event: "partner.received" }),
            });
            state.error = data.verifyUrl
              ? `已重新发送。验证地址：${data.verifyUrl}`
              : "已重新发送验证信。";
          } catch {
            state.error = "验证信没有发出去，请检查 SMTP 配置。";
          }
          state.busy = false;
          render();
        },
      }, "补发验证信")
    : null;

  const manifest = state.manifest && state.manifestId === item.id ? state.manifest : null;

  return el("div", { class: "detail" }, [
    el("div", { class: "detail-head" }, [
      el("div", {}, [
        el("h2", {}, item.name),
        el("p", { class: "detail-id" }, `${item.id} · 提交于 ${formatWhen(item.createdAt)}`),
      ]),
      el("span", { class: `badge ${item.status}` }, STATUS_LABEL[item.status] || item.status),
    ]),

    el("dl", { class: "dl" }, [
      el("dt", {}, "子域"),
      el("dd", {}, item.subdomain ? `${item.subdomain}.xknot.si` : "—"),
      el("dt", {}, "站点"),
      el("dd", {}, el("a", { href: item.url, target: "_blank", rel: "noopener noreferrer" }, item.url)),
      el("dt", {}, "运营者"),
      el("dd", {}, item.operator),
      el("dt", {}, "邮箱"),
      el("dd", {}, el("a", { href: `mailto:${item.email}` }, item.email)),
      el("dt", {}, "区域"),
      el("dd", {}, regionLabel(item.region)),
      el("dt", {}, "时区"),
      el("dd", {}, item.timezone),
      el("dt", {}, "简介"),
      el("dd", {}, item.intro),
      el("dt", {}, "标签"),
      el("dd", {}, item.tags.length ? item.tags.map((tag) => `#${tag}`).join(" ") : "—"),
      el("dt", {}, "落点"),
      el("dd", {}, ACCESS_LABEL[item.requestAccess] || item.requestAccess || "unknown"),
      el("dt", {}, "邮箱确认"),
      el("dd", {}, item.verifiedAt ? formatWhen(item.verifiedAt) : "未确认"),
      item.holdItems?.length ? el("dt", {}, "待补") : null,
      item.holdItems?.length ? el("dd", {}, item.holdItems.join(" / ")) : null,
      item.rejectReason ? el("dt", {}, "拒绝类别") : null,
      item.rejectReason ? el("dd", {}, item.rejectReason) : null,
      item.publicKey ? el("dt", {}, "公钥") : null,
      item.publicKey ? el("dd", {}, item.publicKey) : null,
      item.reviewedBy ? el("dt", {}, "审核") : null,
      item.reviewedBy ? el("dd", {}, `${item.reviewedBy} · ${formatWhen(item.reviewedAt)}`) : null,
      item.reviewNote ? el("dt", {}, "备注") : null,
      item.reviewNote ? el("dd", {}, item.reviewNote) : null,
    ]),

    item.status === "pending" || item.status === "verified" || item.status === "hold"
      ? el("div", { class: "note" }, [
          el("p", { class: "hint" }, "搁置时勾选需要申请人补的内容；这些条目会原样出现在信里。"),
          el("div", { class: "checks" }, boxes.map(({ box, label }) =>
            el("label", { class: "check" }, [box, el("span", {}, label)])
          )),
          el("p", { class: "hint" }, "拒绝时只给类别，审核备注不会外发。"),
          el("div", { class: "checks" }, [reason]),
        ])
      : null,

    el("div", { class: "note" }, [note]),

    actions.length
      ? el("div", { class: "actions" }, actions)
      : el("p", { class: "hint" }, item.status === "pending" ? "等待申请人确认邮箱。" : "这份申请已经结束，不能再审核。"),

    resend ? el("div", { class: "actions" }, [resend]) : null,

    item.status === "approved"
      ? el("div", { class: "snippet" }, [
          el("div", { class: "snippet-head" }, [
            el("span", {}, "清单条目"),
            el("button", {
              type: "button",
              class: "btn",
              disabled: state.busy,
              onclick: async () => {
                state.busy = true;
                state.error = "";
                try {
                  const data = await api(`/api/admin/applications/${item.id}/manifest`);
                  state.manifest = JSON.stringify(data.entry, null, 2);
                  state.manifestId = item.id;
                } catch {
                  state.error = "生成清单条目失败。";
                }
                state.busy = false;
                render();
              },
            }, manifest ? "重新生成" : "生成"),
          ]),
          manifest
            ? el("div", {}, [
                el("pre", { tabindex: "0" }, manifest),
                el("button", {
                  type: "button",
                  // 审核台 CSP 是 style-src 'self'，行内 style 会被拦，样式放 CSS 里。
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
      : null,

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
    state.overview = data;
  } catch (error) {
    if (seq !== overviewSeq) return;
    if (error.status === 401) {
      state.admin = null;
      state.overview = null;
      return;
    }
    state.overviewError = "总览加载失败，请检查接口是否在运行。";
  } finally {
    if (seq === overviewSeq) {
      state.overviewBusy = false;
      // 用户已经切到申请列表时不再整棵重绘，否则会把他正点着的那一行换掉。
      if (state.view === view) render();
    }
  }
}

async function loadApplications() {
  const seq = ++applicationsSeq;
  const view = state.view;
  state.applicationsBusy = true;
  render();
  try {
    const query = state.filter && state.filter !== "all" ? `?status=${state.filter}` : "";
    const data = await api(`/api/admin/applications${query}`);
    if (seq !== applicationsSeq) return;
    state.applications = data.applications;
    state.counts = data.counts;
    if (state.selected) {
      const fresh = state.applications.find((item) => item.id === state.selected.id);
      if (fresh) state.selected = fresh;
    }
  } catch (error) {
    if (seq !== applicationsSeq) return;
    if (error.status === 401) {
      state.admin = null;
      return;
    }
    state.error = "列表加载失败。";
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
