// XKnot 审核台。
//
// 无构建步骤：浏览器直接加载这个模块。所有文本用 textContent 写入，
// 申请内容不会当成 HTML 执行。

const app = document.getElementById("app");

const STATUS_LABEL = {
  pending: "待审",
  approved: "已通过",
  rejected: "已拒绝",
  hold: "搁置",
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
  filter: "pending",
  applications: [],
  counts: { pending: 0, approved: 0, rejected: 0, hold: 0 },
  selected: null,
  busy: false,
  error: "",
  manifest: null,
  manifestId: null,
  copied: false,
};

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
          await loadApplications();
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
  const tabs = ["pending", "hold", "approved", "rejected", "all"].map((key) => {
    const count = key === "all" ? Object.values(state.counts).reduce((a, b) => a + b, 0) : state.counts[key] || 0;
    return el(
      "button",
      {
        type: "button",
        class: `tab${state.filter === key ? " active" : ""}`,
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
        { class: "list" },
        state.applications.map((item) =>
          el(
            "button",
            {
              type: "button",
              class: `item${state.selected?.id === item.id ? " selected" : ""}`,
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

  return el("div", {}, [
    el("header", { class: "top" }, [
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
      el("div", { class: "top-user" }, [
        el("span", {}, state.admin.username),
        el("button", {
          type: "button",
          class: "btn",
          onclick: async () => {
            await api("/api/admin/logout", { method: "POST" }).catch(() => {});
            state.admin = null;
            state.applications = [];
            state.selected = null;
            render();
          },
        }, "退出"),
      ]),
    ]),
    el("div", { class: "layout" }, [
      el("section", { class: "panel" }, [el("div", { class: "tabs" }, tabs), list]),
      el("aside", { class: "panel" }, [state.selected ? renderDetail(state.selected) : el("p", { class: "detail-empty" }, "从左侧选一条申请查看详情。")]),
    ]),
  ]);
}

function renderDetail(item) {
  const note = el("textarea", { rows: "2", placeholder: "审核备注（可选，只有内部可见）" });
  note.value = item.reviewNote || "";

  const blocked = state.busy;
  const review = (decision) =>
    el(
      "button",
      {
        type: "button",
        class: `btn ${decision === "approved" ? "btn-ok" : decision === "rejected" ? "btn-bad" : ""}`,
        disabled: blocked,
        onclick: async () => {
          state.busy = true;
          render();
          try {
            const data = await api(`/api/admin/applications/${item.id}/review`, {
              method: "POST",
              body: JSON.stringify({ decision, note: note.value }),
            });
            state.selected = data.application;
            state.manifest = null;
            await loadApplications();
          } catch {
            state.error = "审核没有保存，请重试。";
            state.busy = false;
            render();
          }
        },
      },
      decision === "approved" ? "通过" : decision === "rejected" ? "拒绝" : "搁置"
    );

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
      item.reviewedBy ? el("dt", {}, "审核") : null,
      item.reviewedBy ? el("dd", {}, `${item.reviewedBy} · ${formatWhen(item.reviewedAt)}`) : null,
      item.reviewNote ? el("dt", {}, "备注") : null,
      item.reviewNote ? el("dd", {}, item.reviewNote) : null,
    ]),

    el("div", { class: "note" }, [note]),

    el("div", { class: "actions" }, [review("approved"), review("rejected"), review("hold")]),

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
                  class: "btn",
                  style: "margin-top:0.5rem",
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

async function loadApplications() {
  try {
    const query = state.filter && state.filter !== "all" ? `?status=${state.filter}` : "";
    const data = await api(`/api/admin/applications${query}`);
    state.applications = data.applications;
    state.counts = data.counts;
    if (state.selected) {
      const fresh = state.applications.find((item) => item.id === state.selected.id);
      if (fresh) state.selected = fresh;
    }
    render();
  } catch (error) {
    if (error.status === 401) {
      state.admin = null;
      render();
      return;
    }
    state.error = "列表加载失败。";
    render();
  }
}

async function boot() {
  try {
    const data = await api("/api/admin/session");
    state.admin = data.admin;
    await loadApplications();
  } catch {
    state.admin = null;
    render();
  }
}

boot();
