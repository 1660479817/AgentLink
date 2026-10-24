// Knot 管理后台。纯浏览器模块，不打包，不含任何业务逻辑：
// 所有写操作都走同一条内网 /api/admin，由 Backend 校验令牌、做校验、写库和记账。
//
// 安全约定：
// - 从站点「我的」进入时，换到的是一枚 30 天的管理凭据，存在 localStorage；
//   手动粘的主令牌只留在 sessionStorage，关标签页就没了；
// - 页面只在实例主机自己或同一内网提供；
// - 所有来自接口的文字一律用 textContent 写进 DOM，不拼 innerHTML；
// - 页面不写内联脚本和内联样式，CSP 锁在 'self'。

import { LOCALES, applyI18n, fmtDate, fmtInt, locale, setLocale, t } from "./i18n.js";

const TOKEN_KEY = "knot.admin.token";
// 从 WebUI 换来的 30 天管理凭据。它不是主令牌，只被 /api/admin 认。
const CREDENTIAL_KEY = "knot.admin.credential";

const VIEW_LOADERS = {
  overview: loadOverview,
  content: loadContent,
  users: loadAccounts,
  site: loadSite,
  xknot: loadXknot,
  logs: loadLogs,
};

// 价格字段名只从表单来：框里有几个，就填几个、交几个。
// 名称在语种文件里（price.*），顺序在 index.html 里，两边都不再各记一份清单。
function priceKeys() {
  return [...document.querySelectorAll('input[id^="price-"]')].map((input) =>
    input.id.slice("price-".length)
  );
}

const state = {
  token: "",
  view: "overview",
  system: null,
  economy: null,
  accounts: [],
  quota: null,
  selectedUser: null,
  selectedAgent: null,
  // 资料表单当前填的是哪个身份：用来判断「重绘要不要覆盖用户的草稿」。
  identityFormFor: null,
  agentToken: null,
  tokenBusy: false,
  posts: null,
  reviewFailures: null,
  patrol: [],
  // 本轮巡查实际看到的那一批，最后一条的 id。报告提交时原样回传，
  // 服务端据此推进「看过的边界」，而不是拿提交时刻当水位。
  patrolThrough: null,
  invites: [],
  sponsors: [],
  prices: null,
  editingSponsor: null,
  federation: null,
  profile: null,
  joinApplication: null,
  progress: null,
  toastTimer: null,
};

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = value == null ? "" : String(value);
}

// 列表请求按代次落地：连点刷新、连续改查询条件时只认最后一次发出的响应，
// 否则先发后到的旧结果会盖掉新结果，屏幕上的名单是上一次查询的。
const LOAD_SEQ = new Map();

function nextLoad(name) {
  const seq = (LOAD_SEQ.get(name) || 0) + 1;
  LOAD_SEQ.set(name, seq);
  return seq;
}

function isLatestLoad(name, seq) {
  return LOAD_SEQ.get(name) === seq;
}

// 静态页面与脚本可能不同步（改名、裁剪版页面）。绑定时缺一两个节点不该让整页停住。
function on(id, event, handler) {
  const node = byId(id);
  if (node) node.addEventListener(event, handler);
  return node;
}

function setAlert(node, message, kind = "error") {
  if (!node) return;
  node.textContent = message || "";
  node.hidden = !message;
  node.classList.toggle("is-error", Boolean(message) && kind === "error");
  node.classList.toggle("is-ok", Boolean(message) && kind === "ok");
}

function append(parent, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) {
    for (const item of child) append(parent, item);
    return;
  }
  parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
}

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  const options = props || {};
  for (const [key, value] of Object.entries(options)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value == null ? "" : String(value);
    else if (key === "on") {
      for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    } else if (key === "dataset") {
      for (const [name, item] of Object.entries(value)) node.dataset[name] = String(item);
    } else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

// 界面图标：与 WebUI 的线条图标同一套画法（viewBox 24、1.8 描边、currentColor），
// 页面不打包，所以这些路径直接写在这里。静态标记用 data-icon，渲染后一次性画上。
const GLYPHS = {
  enter: [
    ["path", { d: "M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" }],
    ["path", { d: "m10 8 4 4-4 4" }],
    ["path", { d: "M14 12H4" }],
  ],
  globe: [
    ["circle", { cx: 12, cy: 12, r: 8 }],
    ["path", { d: "M4 12h16" }],
    ["path", { d: "M12 4c2.2 2.4 3.3 5.1 3.3 8s-1.1 5.6-3.3 8c-2.2-2.4-3.3-5.1-3.3-8s1.1-5.6 3.3-8Z" }],
  ],
  refresh: [
    ["path", { d: "M20 12a8 8 0 0 0-8-8 8.7 8.7 0 0 0-6 2.5L4 8" }],
    ["path", { d: "M4 4v4h4" }],
    ["path", { d: "M4 12a8 8 0 0 0 8 8 8.7 8.7 0 0 0 6-2.5L20 16" }],
    ["path", { d: "M16 16h4v4" }],
  ],
  key: [
    ["circle", { cx: 8.5, cy: 12, r: 3.5 }],
    ["path", { d: "M12 12h8" }],
    ["path", { d: "M17 12v3M20 12v2" }],
  ],
  copy: [
    ["rect", { x: 9, y: 9, width: 11, height: 11, rx: 2 }],
    ["path", { d: "M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15" }],
  ],
  overview: [
    ["path", { d: "M4 19.5V4.5" }],
    ["path", { d: "M4 19.5h16" }],
    ["path", { d: "m7.5 15.5 3.5-4.5 3 2.5L19 7" }],
  ],
  content: [
    ["rect", { x: 4, y: 4, width: 16, height: 16, rx: 2.5 }],
    ["path", { d: "M8 9h8M8 12.5h8M8 16h5" }],
  ],
  logs: [
    ["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }],
    ["path", { d: "m7 9 2.5 2.5L7 14" }],
    ["path", { d: "M12 14h5" }],
  ],
  users: [
    ["circle", { cx: 10, cy: 8.5, r: 3.2 }],
    ["path", { d: "M4 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" }],
    ["circle", { cx: 17, cy: 9.6, r: 2.2 }],
    ["path", { d: "M15.8 14.6c1.4.3 2.5 1.4 2.9 2.9" }],
  ],
  site: [
    ["path", { d: "M4 20.2h16" }],
    ["path", { d: "M6.2 20.2V9.4L12 5.2l5.8 4.2v10.8" }],
    ["path", { d: "M10.2 20.2v-4.4h3.6v4.4" }],
    ["path", { d: "M9 11.4h1.7M13.3 11.4H15M9 14.6h1.7M13.3 14.6H15" }],
  ],
  close: [["path", { d: "M7 7 17 17M17 7 7 17" }]],
  search: [
    ["circle", { cx: 11, cy: 11, r: 5.5 }],
    ["path", { d: "M16 16 20 20" }],
  ],
  coin: [
    ["circle", { cx: 12, cy: 12, r: 8 }],
    ["circle", { cx: 12, cy: 12, r: 5.1 }],
    ["path", { d: "M12 8.6v6.8" }],
  ],
  arrows: [
    ["path", { d: "M4 9h13" }],
    ["path", { d: "m14 6 3 3-3 3" }],
    ["path", { d: "M20 15H7" }],
    ["path", { d: "m10 12-3 3 3 3" }],
  ],
  bank: [
    ["path", { d: "M4 9.5 12 4l8 5.5" }],
    ["path", { d: "M6 9.5V19M10 9.5V19M14 9.5V19M18 9.5V19" }],
    ["path", { d: "M4 19h16" }],
  ],
  eye: [
    ["path", { d: "M2.8 12S6.5 6.2 12 6.2 21.2 12 21.2 12 17.5 17.8 12 17.8 2.8 12 2.8 12Z" }],
    ["circle", { cx: 12, cy: 12, r: 2.6 }],
  ],
  check: [["path", { d: "m5 12.5 4.5 4.5L19 6.5" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  edit: [
    ["path", { d: "M4 20h3.2L17.6 9.6a2.2 2.2 0 0 0-3.2-3.2L4 16.8V20Z" }],
    ["path", { d: "m12.8 6.8 3.4 3.4" }],
  ],
  upload: [
    ["path", { d: "M12 16V4" }],
    ["path", { d: "m8 8 4-4 4 4" }],
    ["path", { d: "M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" }],
  ],
  trash: [
    ["path", { d: "M4 7h16" }],
    ["path", { d: "M9.5 7V5h5v2" }],
    ["path", { d: "m6.5 7 .8 12.2h9.4L17.5 7" }],
    ["path", { d: "M10.5 11v5M13.5 11v5" }],
  ],
  alert: [
    ["path", { d: "M12 4.2 20.2 19.2H3.8Z" }],
    ["path", { d: "M12 10v4" }],
    ["circle", { cx: 12, cy: 16.7, r: 0.6, fill: "currentColor", stroke: "none" }],
  ],
  // 名册徽标：人、Agent 各一枚线条图标，形状与 WebUI 的 UserIcon / AgentIcon 一致，
  // 让「这一行是人还是机器人」在名字之前就先看出来。
  person: [
    ["circle", { cx: 12, cy: 8, r: 3.5 }],
    ["path", { d: "M5 19c0-3.5 3-6 7-6s7 2.5 7 6" }],
  ],
  agent: [
    ["path", { d: "M12 7.2V4.6" }],
    ["circle", { cx: 12, cy: 3.8, r: 0.85, fill: "currentColor", stroke: "none" }],
    ["rect", { x: 5.5, y: 7.2, width: 13, height: 10.2, rx: 2.6 }],
    ["circle", { cx: 9.6, cy: 11.6, r: 0.85, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 14.4, cy: 11.6, r: 0.85, fill: "currentColor", stroke: "none" }],
    ["path", { d: "M9.5 14.6h5" }],
  ],
};

function svgNode(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of GLYPHS[name] || GLYPHS.content) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  }
  return svg;
}

function iconEl(name, size = 16) {
  const span = el("span", { class: "icon", "aria-hidden": "true" });
  span.append(svgNode(name, size));
  return span;
}

function paintIcons(root = document) {
  for (const node of root.querySelectorAll("[data-icon]")) {
    if (node.dataset.painted === "1") continue;
    node.append(svgNode(node.dataset.icon, Number(node.dataset.iconSize) || 16));
    node.dataset.painted = "1";
  }
}

function utf8(value) {
  return String(value == null ? "" : value);
}

// 列表空了就这么显示：一枚线图标 + 一句说明，不要一行灰字。
function emptyBlock(key, icon = "content") {
  return el(
    "div",
    { class: "empty-block" },
    el("span", { class: "empty-mark", "aria-hidden": "true" }, svgNode(icon, 22)),
    el("p", { class: "empty-title", text: t(key) })
  );
}

function splitList(value) {
  return String(value || "")
    .split(/[,，、\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 接口给的这两个值会进 class 名：只认白名单，拼不进去就退到中性样式。
const VERDICT_CLASSES = new Set(["passed", "pending", "rejected", "removed"]);

function verdictLabel(verdict) {
  if (verdict === "passed") return t("verdict.passed");
  if (verdict === "pending") return t("verdict.pending");
  if (verdict === "rejected") return t("verdict.rejected");
  if (verdict === "removed") return t("verdict.removed");
  return verdict || t("verdict.unknown");
}

function modeLabel(mode) {
  if (mode === "invite") return t("registration.invite");
  if (mode === "closed") return t("registration.closed");
  return t("registration.open");
}

function toast(message, kind = "ok") {
  const node = byId("toast");
  if (!node) return;
  node.textContent = message;
  node.className = `toast is-${kind}`;
  node.hidden = false;
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    node.hidden = true;
  }, 4200);
}

function showBanner(message) {
  setAlert(byId("banner"), message, "error");
}

function hideBanner() {
  setAlert(byId("banner"), "", "error");
}

function verifyMessage(error) {
  if (!error || error.code === "unreachable") return t("error.unreachable");
  if (error.code === "bad_token" || error.status === 401) return t("error.bad_token");
  if (error.code === "admin_unconfigured") return t("error.admin_unconfigured");
  if (error.status === 404) return t("error.not_json");
  return humanError(error);
}

function errorHint(code) {
  if (!code) return "";
  const text = t(`error.${code}`);
  return text === `error.${code}` ? "" : text;
}

function humanError(error) {
  if (!error) return t("error.request_failed");
  if (error.code === "bad_response") {
    const status = error.status ? ` (HTTP ${error.status})` : "";
    return `${t("error.bad_response")}${status} ${t("error.badResponseHint")}`;
  }
  const hint = errorHint(error.code);
  if (hint) return hint;
  if (error.status === 404) return t("error.not_json");
  return `${t("error.request_failed")} (${error.code || error.message || "unknown"})`;
}

function handleAuth(error) {
  if (error && error.status === 401) {
    showLogin(HINTS.bad_token);
    return true;
  }
  return false;
}

async function guard(fn) {
  try {
    return await fn();
  } catch (error) {
    if (handleAuth(error)) return null;
    toast(humanError(error), "error");
    return null;
  }
}

// 卡片内的错误位：失败要落在按钮下方。toast 会自己飘走，管理员回头找不到刚才那一步错在哪。
function errorSlot(formId, slotId) {
  if (slotId) return byId(slotId);
  const form = byId(formId);
  return form ? form.querySelector(".form-error") : null;
}

function formError(formId, message, slotId) {
  const slot = errorSlot(formId, slotId);
  if (slot) setAlert(slot, message, "error");
  else if (message) toast(message, "error");
}

// 点一下就改库的接口，每成功一次就落一笔账（/points 直接追加一条 point_ledger），
// 双击就是两笔。所有这类表单统一从这里进：请求期间禁用提交键，同一张表单不接受第二次进入。
const BUSY_FORMS = new Set();

async function writeForm(formId, run, slotId) {
  if (!formId || BUSY_FORMS.has(formId)) return null;
  const form = byId(formId);
  const button = form ? form.querySelector('button[type="submit"]') : null;
  // 文案可能挂在按键自身（data-i18n 在 button 上），也可能挂在里面的 span 上，两种都认。
  const label = button
    ? button.querySelector("[data-i18n]") || (button.dataset.i18n ? button : null)
    : null;
  const wasDisabled = button ? button.disabled : false;
  BUSY_FORMS.add(formId);
  formError(formId, "", slotId);
  if (button) {
    button.disabled = true;
    if (label) label.textContent = t("common.sending");
  }
  try {
    return await run();
  } catch (error) {
    if (handleAuth(error)) return null;
    formError(formId, humanError(error), slotId);
    return null;
  } finally {
    BUSY_FORMS.delete(formId);
    if (button) {
      button.disabled = wasDisabled;
      // data-i18n 的键没动过，按它写回去即可；切语种时 applyI18n 也认这个键。
      if (label) label.textContent = t(label.dataset.i18n);
    }
  }
}

async function writeButton(button, run, slotId) {
  if (!button || button.disabled) return null;
  button.disabled = true;
  if (slotId) setAlert(byId(slotId), "", "error");
  try {
    return await run();
  } catch (error) {
    if (handleAuth(error)) return null;
    if (slotId) formError("", humanError(error), slotId);
    else toast(humanError(error), "error");
    return null;
  } finally {
    // 成功后会整块重绘，这颗按键可能已经不在文档里；对游离节点赋值没有副作用。
    button.disabled = false;
  }
}

// 没有上限的请求会把界面吊死：列表的 aria-busy 停在 true，之后再点也没有第二次机会。
const REQUEST_TIMEOUT_MS = 15000;

async function api(pathname, options = {}) {
  const headers = { Authorization: `Bearer ${state.token}` };
  const init = { method: options.method || "GET", headers };
  if (options.form) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  if (controller) init.signal = controller.signal;
  const timer = controller ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  let response;
  let text;
  try {
    response = await fetch(`/api/admin${pathname}`, init);
    // 正文也在这段计时里读：挂住的连接通常在读完状态行之后才卡住。
    text = await response.text();
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = new Error("timeout");
      timeout.code = "timeout";
      throw timeout;
    }
    const unreachable = new Error("unreachable");
    unreachable.code = "unreachable";
    throw unreachable;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // 不是 JSON 就不是 Backend 回的话：多半是入口或隧道给的 502/404 网页。
      // 把状态码带上，别再让人对着「没有返回 JSON」猜。
      const error = new Error("bad_response");
      error.code = "bad_response";
      error.status = response.status;
      throw error;
    }
  } else if (response.ok) {
    // 空体重不算「没有数据」：调用方会把它当成「名册为空」这类结论，把失败说成事实。
    const error = new Error("bad_response");
    error.code = "bad_response";
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || response.statusText || "request_failed");
    error.code = data.error || `http_${response.status}`;
    error.status = response.status;
    // 档案校验失败会带上逐条问题，表单直接照着显示。
    if (Array.isArray(data.problems)) error.problems = data.problems;
    if (response.status === 401) {
      state.token = "";
      forget();
    }
    throw error;
  }
  return data;
}

/* 登录与外壳 */

function showLogin(message = "") {
  byId("admin-view").hidden = true;
  byId("login-view").hidden = false;
  setAlert(byId("login-error"), message, "error");
  const input = byId("token-input");
  input.value = "";
  if (message) input.focus();
}

function showApp() {
  byId("login-view").hidden = true;
  byId("admin-view").hidden = false;
  setText("topbar-note", t("topbar.noteLoaded"));
  setView("overview");
}

// 存储位置决定「保持多久」：
// - persist（从站点「我的」换来的凭据）写 localStorage，下次打开 /admin 直接用；
// - 手动粘的主令牌只写 sessionStorage，关掉标签页就没了，和以前一样。
//
// 明文的 HTTP 局域网部署里凭据不该长住在 localStorage：同网段能嗅探到，留下就是长期风险。
// 只有 https 或本机调试才持久化，其它情况退到 sessionStorage，关掉标签页就失效。
function canPersistCredential() {
  const host = window.location.hostname;
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return Boolean(window.isSecureContext) || loopback;
}

function remember(value, persist) {
  localStorage.removeItem(CREDENTIAL_KEY);
  sessionStorage.removeItem(CREDENTIAL_KEY);
  if (!persist) {
    sessionStorage.setItem(TOKEN_KEY, value);
    return;
  }
  sessionStorage.removeItem(TOKEN_KEY);
  const jar = canPersistCredential() ? localStorage : sessionStorage;
  jar.setItem(CREDENTIAL_KEY, value);
}

function forget() {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CREDENTIAL_KEY);
  sessionStorage.removeItem(CREDENTIAL_KEY);
}

function savedCredential() {
  return (
    localStorage.getItem(CREDENTIAL_KEY) ||
    sessionStorage.getItem(CREDENTIAL_KEY) ||
    sessionStorage.getItem(TOKEN_KEY) ||
    ""
  );
}

async function enter(token, { persist = false } = {}) {
  const value = String(token || "").trim();
  if (!value) {
    setAlert(byId("login-error"), t("login.empty"), "error");
    return false;
  }
  state.token = value;
  remember(value, persist);
  const button = byId("login-submit");
  if (button) button.disabled = true;
  setAlert(byId("login-error"), "", "error");
  try {
    const data = await api("/system");
    state.system = data.system;
    showApp();
    return true;
  } catch (error) {
    // 隧道 502、断网、坏响应都不该作废 30 天的凭据：只有 401（过期或被换掉）才删。
    // 留着它，刷新这一页就能用同一枚凭据重试，不用回 WebUI 重新换票。
    if (error?.status === 401) {
      state.token = "";
      forget();
    }
    showLogin(verifyMessage(error));
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function logout(message = "") {
  state.token = "";
  forget();
  showLogin(message);
}

// 从站点「我的」的「进入管理后台」过来时，地址里带一枚 5 分钟的票据（#t=…）。
// 兑换到的是一枚 30 天的管理凭据：写在这个浏览器上，之后打开 /admin 不用再换。
let ticketFailed = false;

async function claimTicket() {
  const match = /^#t=([A-Za-z0-9._~-]+)$/.exec(window.location.hash || "");
  if (!match) return false;
  // 先把票据从地址栏抹掉，再拿去兑换：它只该活到这一行，不该留在历史记录里。
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  try {
    const response = await fetch("/api/admin/handoff/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: match[1] }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.credential) {
      ticketFailed = true;
      return false;
    }
    const entered = await enter(data.credential, { persist: true });
    if (entered) toast(t("login.saved"));
    return entered;
  } catch {
    ticketFailed = true;
    return false;
  }
}

function setView(name) {
  if (!VIEW_LOADERS[name]) name = "overview";
  state.view = name;
  hideBanner();
  for (const view of document.querySelectorAll(".view")) {
    view.hidden = view.dataset.view !== name;
  }
  for (const button of document.querySelectorAll(".nav-button")) {
    button.classList.toggle("is-active", button.dataset.view === name);
  }
  VIEW_LOADERS[name]();
}

/* 概览 */

function stateRow(title, hint, on, text) {
  return el(
    "div",
    { class: "state-row" },
    el(
      "span",
      { class: "state-copy" },
      el("span", { class: "state-title", text: title }),
      el("span", { class: "state-hint", text: hint })
    ),
    el("span", {
      class: `state-pill${on ? " is-on" : ""}`,
      text: text ?? (on ? t("overview.on") : t("overview.off")),
    })
  );
}

function renderSystemFacts() {
  const list = byId("ov-system");
  if (!list) return;
  const system = state.system;
  if (!system) {
    list.replaceChildren(el("p", { class: "muted small", text: t("common.loading") }));
    return;
  }
  list.replaceChildren(
    stateRow(t("overview.guest"), t("overview.guestHint"), Boolean(system.guestBrowsing)),
    stateRow(
      t("overview.registration"),
      t("overview.registrationHint"),
      system.registrationMode === "open",
      modeLabel(system.registrationMode)
    ),
    stateRow(t("overview.board"), t("overview.boardHint"), Boolean(system.publicBoard))
  );
}

function miniPost(post) {
  return el(
    "article",
    { class: "mini-post" },
    el(
      "p",
      { class: "mini-meta" },
      el("strong", { text: post.user?.displayName || t("content.noName") }),
      el("span", { text: fmtDate(post.createdAt) })
    ),
    el("p", { class: "mini-body", text: utf8(post.body) || t("content.noBody") })
  );
}

function renderOverviewPatrol() {
  const list = byId("ov-patrol-list");
  const tag = byId("ov-patrol-count");
  const count = state.patrol.length;
  if (tag) {
    tag.textContent = count ? t("overview.patrolCount", { count }) : t("overview.patrolEmpty");
    tag.classList.toggle("is-warn", count > 0);
  }
  if (!list) return;
  if (!count) {
    list.replaceChildren(el("p", { class: "muted small", text: t("overview.patrolClean") }));
    return;
  }
  list.replaceChildren(...state.patrol.slice(0, 3).map(miniPost));
}

function renderOverview() {
  const economy = state.economy || {};
  setText("ov-issued", fmtInt(economy.issued));
  setText("ov-circulating", fmtInt(economy.circulating));
  setText("ov-platform", fmtInt(economy.platform));
  setText("ov-reads", fmtInt(economy.attention?.reads));
  setText("ov-searches", fmtInt(economy.attention?.searches));
  renderSystemFacts();
  renderOverviewPatrol();
}

async function loadOverview() {
  // 三个接口各算各的：用 Promise.all 时任一失败都会把已经拿到的数字一起丢掉，
  // 整页退回「加载中」，而实际上另外两个已经回来了。
  const [economy, patrol, system] = await Promise.allSettled([
    api("/economy"),
    api("/patrol"),
    state.system ? Promise.resolve({ system: state.system }) : api("/system"),
  ]);
  if (economy.status === "fulfilled") state.economy = economy.value;
  if (patrol.status === "fulfilled") {
    state.patrol = Array.isArray(patrol.value.posts) ? patrol.value.posts : [];
    state.patrolThrough = patrol.value.through || null;
  }
  if (system.status === "fulfilled") state.system = system.value.system;
  renderOverview();
  const failure = [economy, patrol, system].find((row) => row.status === "rejected");
  if (failure && !handleAuth(failure.reason)) showBanner(humanError(failure.reason));
}

/* 内容 */

function loadContent() {
  renderPosts();
  void loadPatrol();
}

/* 日志 */

const REVIEW_ERROR_LABELS = {
  agent_timeout: "logs.review.agent_timeout",
  agent_failed: "logs.review.agent_failed",
  agent_bad_json: "logs.review.agent_bad_json",
  agent_empty: "logs.review.agent_empty",
};

function reviewErrorLabel(code) {
  return t(REVIEW_ERROR_LABELS[code] || "logs.review.other");
}

function logRow(failure) {
  const user = failure.user || {};
  return el(
    "article",
    { class: "post-row" },
    el(
      "div",
      { class: "post-main" },
      el(
        "div",
        { class: "post-head" },
        el("span", { class: "pill is-warn", text: reviewErrorLabel(failure.error) }),
        el("span", { class: "pill", text: t("logs.attempts", { count: failure.attempts }) }),
        failure.gaveUp ? el("span", { class: "pill is-warn", text: t("logs.gaveUp") }) : null,
        el("span", { text: user.displayName || t("content.noName") }),
        el("span", { text: user.email || "" }),
        el("span", { class: "post-time", text: fmtDate(failure.createdAt) }),
        el("code", { class: "post-id", text: failure.id })
      ),
      el("p", { class: "post-body", text: utf8(failure.body) || t("content.noBody") })
    )
  );
}

function renderLogs() {
  const list = byId("logs-list");
  const tag = byId("logs-count");
  if (!list) return;
  const failures = Array.isArray(state.reviewFailures) ? state.reviewFailures : null;
  if (tag) {
    if (failures) {
      tag.textContent = t("logs.count", { count: failures.length });
      tag.classList.toggle("is-warn", failures.length > 0);
    } else {
      tag.textContent = "—";
      tag.classList.remove("is-warn");
    }
  }
  if (failures == null) {
    list.replaceChildren();
    return;
  }
  if (!failures.length) {
    list.replaceChildren(emptyBlock("logs.empty", "logs"));
    return;
  }
  list.replaceChildren(...failures.map(logRow));
}

async function loadLogs() {
  try {
    const data = await api("/review-failures");
    state.reviewFailures = Array.isArray(data.failures) ? data.failures : [];
    renderLogs();
  } catch (error) {
    if (!handleAuth(error)) showBanner(humanError(error));
  }
}

async function loadPosts() {
  const user = byId("posts-user").value.trim();
  if (!user) return;
  const seq = nextLoad("posts");
  const params = new URLSearchParams({ user });
  const q = byId("posts-q").value.trim();
  const within = byId("posts-within").value.trim();
  if (q) params.set("q", q);
  if (within) params.set("within", within);
  const submit = byId("posts-submit");
  if (submit) {
    submit.disabled = true;
    const label = submit.querySelector("span:last-child");
    if (label) label.textContent = t("content.querying");
  }
  try {
    const data = await guard(() => api(`/posts?${params.toString()}`));
    if (!data || !isLatestLoad("posts", seq)) return;
    state.posts = data;
    renderPosts();
  } finally {
    if (submit) {
      submit.disabled = false;
      const label = submit.querySelector("span:last-child");
      if (label) label.textContent = t("content.query");
    }
  }
}

function postRow(post) {
  const remove = el(
    "button",
    {
      class: "button danger compact",
      type: "button",
      "aria-label": t("content.remove"),
      on: { click: (event) => void removePostFlow(post, { button: event.currentTarget, reload: loadPosts }) },
    },
    iconEl("trash", 14),
    el("span", { text: t("content.remove") })
  );
  return el(
    "article",
    { class: "post-row" },
    el(
      "div",
      { class: "post-main" },
      el(
        "div",
        { class: "post-head" },
        el("span", {
          // verdict 来自接口：只认四种取值，别的一个 class 也不拼。
          class: VERDICT_CLASSES.has(post.verdict) ? `pill ${post.verdict}` : "pill",
          text: verdictLabel(post.verdict),
        }),
        el("span", { class: "post-time", text: fmtDate(post.createdAt) }),
        el("span", {
          class: post.public === false ? "pill" : "pill passed",
          text: post.public === false ? t("content.privateTag") : t("content.publicTag"),
        }),
        el("code", { class: "post-id", text: post.id })
      ),
      el("p", { class: "post-body", text: utf8(post.body) || t("content.noBody") })
    ),
    el("div", { class: "post-actions" }, remove)
  );
}

function renderPosts() {
  const list = byId("posts-list");
  const empty = byId("posts-empty");
  const summary = byId("posts-summary");
  if (!list) return;
  const data = state.posts;
  if (!data) {
    list.replaceChildren();
    if (empty) empty.hidden = false;
    if (summary) {
      summary.hidden = true;
      summary.textContent = "";
    }
    return;
  }
  if (empty) empty.hidden = true;
  const user = data.user || {};
  const posts = Array.isArray(data.posts) ? data.posts : [];
  if (summary) {
    const within = data.within ? t("content.summaryWithin", { within: data.within }) : "";
    summary.hidden = false;
    // 后端只回一页（没给时间窗 30 条，给了 200 条），而 total 是匹配总数、不是这一页的条数。
    // 两个数不相等时必须说出来，否则「共 N 条」会让人以为屏幕上是全部，更早的帖子就永远没人管。
    const total = Number(data.total) || 0;
    const rest = Math.max(0, total - posts.length);
    const clipped = rest
      ? t("content.summaryTruncated", { shown: fmtInt(posts.length), rest: fmtInt(rest) }) +
        (data.within ? t("content.summaryNarrowWindow") : t("content.summaryNarrow"))
      : "";
    summary.textContent =
      t("content.summary", {
        name: user.displayName || t("content.noName"),
        ident: user.email || user.id || "—",
        total: fmtInt(data.total),
      }) + within + clipped;
  }
  if (!posts.length) {
    list.replaceChildren(emptyBlock("content.emptyList", "content"));
    return;
  }
  list.replaceChildren(...posts.map(postRow));
}

async function removePostFlow(post, { button, slotId, reload }) {
  const reason = window.prompt(t("content.removeTitle"), "");
  if (reason == null) return;
  const text = reason.trim();
  if (!text) {
    // 巡查栏有自己的错误位，查帖栏没有，就退回 toast。
    if (slotId) formError("", t("content.reasonRequired"), slotId);
    else toast(t("content.reasonRequired"), "error");
    return;
  }
  if (!window.confirm(t("content.removeConfirm", { reason: text }))) return;
  const result = await writeButton(
    button,
    () => api(`/posts/${encodeURIComponent(post.id)}/remove`, { method: "POST", body: { reason: text } }),
    slotId
  );
  if (!result) return;
  toast(result.already ? t("content.alreadyRemoved") : t("content.removed"), "ok");
  await reload();
}

async function loadPatrol() {
  try {
    const data = await api("/patrol");
    state.patrol = Array.isArray(data.posts) ? data.posts : [];
    state.patrolThrough = data.through || null;
    renderPatrol();
  } catch (error) {
    if (!handleAuth(error)) showBanner(humanError(error));
  }
}

function patrolItem(post) {
  const remove = el(
    "button",
    {
      class: "button danger compact",
      type: "button",
      "aria-label": t("content.remove"),
      on: { click: (event) => void patrolRemove(post, event.currentTarget) },
    },
    iconEl("trash", 14),
    el("span", { text: t("content.remove") })
  );  const warn = el(
    "button",
    {
      class: "button secondary compact",
      type: "button",
      on: { click: (event) => void patrolWarn(post, event.currentTarget) },
    },
    iconEl("alert", 14),
    el("span", { text: t("content.warn") })
  );
  return el(
    "article",
    { class: "patrol-item" },
    el(
      "p",
      { class: "patrol-head" },
      badgeNode("person", 12),
      el("span", { class: "patrol-name", text: post.user?.displayName || t("content.noName") }),
      el("span", { text: post.user?.email || "" }),
      el("span", { text: fmtDate(post.createdAt) }),
      el("span", { text: post.id })
    ),
    el("p", { class: "patrol-body", text: utf8(post.body) || t("content.noBody") }),
    el("div", { class: "patrol-actions" }, remove, warn)
  );
}

function renderPatrol() {
  const list = byId("patrol-list");
  const tag = byId("patrol-count");
  if (!list) return;
  const count = state.patrol.length;
  if (tag) {
    tag.textContent = t("content.patrolCount", { count });
    tag.classList.toggle("is-warn", count > 0);
  }
  if (!count) {
    list.replaceChildren(emptyBlock("content.patrolEmpty", "check"));
    return;
  }
  list.replaceChildren(...state.patrol.map(patrolItem));
}

// 巡查里删帖与查帖里删帖是同一条路，只差错误位与删完刷新哪一列。
function patrolRemove(post, button) {
  return removePostFlow(post, { button, slotId: "patrol-error", reload: loadPatrol });
}

async function patrolWarn(post, button) {
  const text = window.prompt(t("content.warnTitle"), "");
  if (text == null) return;
  const body = text.trim();
  if (!body) {
    formError("", t("content.warnRequired"), "patrol-error");
    return;
  }
  const result = await writeButton(
    button,
    () => api("/warnings", { method: "POST", body: { user: post.user?.id, body } }),
    "patrol-error"
  );
  if (!result) return;
  toast(t("content.warned"), "ok");
}

async function recordPatrol(event) {
  event.preventDefault();
  const body = byId("patrol-body").value.trim();
  if (!body) {
    formError("patrol-form", t("content.patrolNeeded"));
    return;
  }
  // through 是页面上这一批的最后一条：服务端按它推进水位，巡查期间新发的帖
  // 与这次没放进来的积压下一轮还会出现。
  const through = state.patrolThrough || null;
  const result = await writeForm("patrol-form", () => api("/patrol", { method: "POST", body: { body, through } }));
  if (!result) return;
  byId("patrol-body").value = "";
  toast(t("content.patrolSaved"), "ok");
  await loadPatrol();
}

/* 用户 */

const ROLE_KEYS = {
  platform: "users.rolePlatform",
  owner: "users.roleOwner",
  user: "users.roleUser",
  agent: "users.roleAgent",
};

const SVG_NS = "http://www.w3.org/2000/svg";

// 名册徽标与界面图标共用一张表与一个构建器：平台账号就用「站点」那枚建筑图。
const MARK_GLYPHS = { person: "person", agent: "agent", platform: "site" };

function identityKind(record) {
  if (!record) return "person";
  if (record.role === "agent") return "agent";
  if (record.role === "platform") return "platform";
  return "person";
}

function badgeNode(kind, size = 18) {
  const badge = el("span", { class: `identity-mark is-${kind}`, "aria-hidden": "true" });
  badge.append(svgNode(MARK_GLYPHS[kind] || "person", size));
  return badge;
}

function roleLabel(account) {
  return account?.role ? t(ROLE_KEYS[account.role] || "users.roleAccount") : t("users.roleAccount");
}

// 积分、等级、权益与禁言只记在人这一行。平台账号只读，Agent 行不单独持有这些。
function canManage(account) {
  return account?.role === "owner" || account?.role === "user";
}

// 管理端能改谁：主理人，以及主理人名下的内部 Agent。与 Backend 的 editableIdentity 同一口径。
function canEditIdentity(record) {
  if (!record) return false;
  if (record.role === "owner") return true;
  return record.role === "agent" && record.side === "internal";
}

function selection() {
  if (state.selectedAgent) return { kind: "agent", agent: state.selectedAgent, account: state.selectedUser };
  if (state.selectedUser) return { kind: "account", agent: null, account: state.selectedUser };
  return null;
}

function accountMeta(account) {
  if (account.role === "platform") return t("users.metaMachine");
  return account.email || `id ${account.id}`;
}

function accountSummary(account) {
  if (account.role === "platform") return t("users.summaryReadonly");
  let text = t("users.summary", { points: fmtInt(account.pointsBalance), level: account.level ?? 1 });
  if (account.agentLimit) {
    text += t("users.summaryAgents", { used: account.agentUsed ?? 0, limit: account.agentLimit });
  }
  if (account.muted) {
    text += account.mutedUntil
      ? t("users.summaryMutedUntil", { until: fmtDate(account.mutedUntil) })
      : t("users.summaryMuted");
  }
  return text;
}

function agentStateText(agent) {
  if (agent.retiredAt) return t("users.stateRetired", { when: fmtDate(agent.retiredAt) });
  return agent.hasToken ? t("users.stateToken") : t("users.stateNoToken");
}

function agentMatches(agent, needle) {
  return [agent.displayName, agent.id, agent.bio, ...(Array.isArray(agent.specialties) ? agent.specialties : [])]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function accountMatches(account, needle) {
  if (!needle) return true;
  const self = [account.displayName, account.email, account.bio, account.id, account.label]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  if (self.includes(needle)) return true;
  return (account.agents || []).some((agent) => agentMatches(agent, needle));
}

function findAgent(id) {
  for (const account of state.accounts) {
    const agent = (account.agents || []).find((row) => row.id === id);
    if (agent) return { agent, account };
  }
  return null;
}

// 刷新名册后把选中项对回新数据：Agent 可能被停用、账号可能被改名，行对象要换成本次这一份。
function restoreSelection() {
  const agentId = state.selectedAgent?.id;
  const accountId = state.selectedUser?.id;
  state.selectedAgent = null;
  state.selectedUser = accountId ? state.accounts.find((row) => row.id === accountId) || null : null;
  if (!agentId) return;
  const found = findAgent(agentId);
  if (found) {
    state.selectedUser = found.account;
    state.selectedAgent = found.agent;
  }
}

async function loadAccounts() {
  const seq = nextLoad("accounts");
  const list = byId("users-list");
  if (list) list.setAttribute("aria-busy", "true");
  setText("roster-count", t("users.rosterLoading"));
  const data = await guard(() => api("/accounts"));
  // 早先发出的那次不再落地：名册可能是改过筛选、连点刷新之前的快照。
  if (!isLatestLoad("accounts", seq)) return;
  if (list) list.setAttribute("aria-busy", "false");
  if (!data) {
    setText("roster-count", t("users.rosterFailed"));
    return;
  }
  state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
  state.quota = data.quota || null;
  // 名册刷新了就把选中的授权码也重读一遍：文件可能在别处换过。
  state.agentToken = null;
  restoreSelection();
  renderRoster();
  renderUserPanel();
  renderIssueQuota();
}

function selectAccount(account) {
  state.selectedUser = account;
  state.selectedAgent = null;
  renderRoster();
  renderUserPanel();
  revealPanel();
}

function selectAgent(agent, account) {
  state.selectedUser = account || null;
  state.selectedAgent = agent;
  renderRoster();
  renderUserPanel();
  revealPanel();
}

// 窄屏上详情在名册下面：选中一行后把它带进视口，不用自己往下滚。
function revealPanel() {
  if (typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1180px)").matches) return;
  byId("user-panel")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function accountRow(account) {
  const selected = !state.selectedAgent && state.selectedUser?.id === account.id;
  const kind = identityKind(account);
  const name = el(
    "span",
    { class: "user-name" },
    el("span", { class: "user-name-text", text: account.displayName || t("users.noName") }),
    el("span", { class: `role-pill is-${kind}`, text: roleLabel(account) }),
    account.label ? el("span", { class: "pill", text: account.label }) : null,
    account.muted ? el("span", { class: "pill is-warn", text: t("users.mutedTag") }) : null
  );
  const pick = el(
    "button",
    {
      class: "row-pick",
      type: "button",
      "aria-pressed": selected ? "true" : "false",
      on: { click: () => selectAccount(account) },
    },
    badgeNode(kind),
    el(
      "span",
      { class: "user-main" },
      name,
      el("span", { class: "user-meta", text: accountMeta(account) })
    ),
    el("span", { class: "user-side", text: accountSummary(account) })
  );
  return el("div", { class: `user-row${selected ? " is-selected" : ""}` }, pick);
}

function agentRow(agent, account) {
  const selected = state.selectedAgent?.id === agent.id;
  const specialties =
    (Array.isArray(agent.specialties) ? agent.specialties : []).join("、") || t("users.specialtiesNone");
  const meta = t("users.underOwner", { owner: account.displayName || t("users.noName"), specialties });
  const pick = el(
    "button",
    {
      class: "row-pick",
      type: "button",
      "aria-pressed": selected ? "true" : "false",
      on: { click: () => selectAgent(agent, account) },
    },
    badgeNode("agent", 16),
    el(
      "span",
      { class: "user-main" },
      el(
        "span",
        { class: "user-name" },
        el("span", { class: "user-name-text", text: agent.displayName }),
        el("span", { class: "role-pill is-agent", text: "Agent" }),
        agent.retiredAt ? el("span", { class: "pill", text: t("users.retiredTag") }) : null
      ),
      el("span", { class: "user-meta", text: meta })
    ),
    el("span", { class: "user-side", text: agentStateText(agent) })
  );
  const actions = el("span", { class: "agent-actions" });
  if (!agent.retiredAt) {
    actions.append(
      el("button", {
        class: "button danger compact",
        type: "button",
        text: t("users.retire"),
        on: { click: () => void retireAgent(agent) },
      })
    );
  }
  return el(
    "div",
    {
      class: `user-row agent-row${selected ? " is-selected" : ""}${agent.retiredAt ? " is-retired" : ""}`,
    },
    pick,
    actions
  );
}

function quotaChip(label, used, limit) {
  const chip = el("div", { class: "quota-chip" });
  const value = el("span", { class: "quota-value" }, el("strong", { text: fmtInt(used) }));
  if (limit) value.append(el("span", { class: "quota-limit", text: ` / ${fmtInt(limit)}` }));
  chip.append(el("span", { class: "quota-label", text: label }), value);
  if (limit) {
    const full = Number(used) >= Number(limit);
    const bar = el("progress", { class: `quota-bar${full ? " is-full" : ""}`, max: String(limit), value: String(Math.min(Number(used) || 0, Number(limit))) });
    bar.setAttribute("aria-label", `${label} ${fmtInt(used)}/${fmtInt(limit)}`);
    chip.append(bar);
  }
  return chip;
}

function renderRosterQuota() {
  const strip = byId("users-quota");
  if (!strip) return;
  const quota = state.quota;
  if (!quota) {
    strip.replaceChildren();
    return;
  }
  strip.replaceChildren(
    quotaChip(t("users.quotaInternalAgent"), quota.internalAgents?.used, quota.internalAgents?.limit),
    quotaChip(t("users.quotaExternalAccount"), quota.externalAccounts?.used, quota.externalAccounts?.limit),
    quotaChip(t("users.quotaExternalAgent"), quota.externalAgents?.used, 0)
  );
}

const ROSTER_GROUPS = [
  { role: "platform", key: "groupPlatform" },
  { role: "owner", key: "groupInternal" },
  { role: "user", key: "groupExternal" },
];

function renderRoster() {
  const list = byId("users-list");
  if (!list) return;
  renderRosterQuota();
  const needle = (byId("users-q")?.value || "").trim().toLowerCase();
  const visible = state.accounts.filter((account) => accountMatches(account, needle));
  const agentTotal = state.accounts.reduce((sum, account) => sum + (account.agents || []).length, 0);
  if (!state.accounts.length) {
    setText("roster-count", t("users.rosterEmpty"));
    list.replaceChildren(el("p", { class: "empty-state", text: t("users.rosterEmptyHint") }));
    return;
  }
  setText(
    "roster-count",
    needle
      ? t("users.rosterFiltered", { accounts: fmtInt(visible.length), agents: fmtInt(agentTotal) })
      : t("users.rosterCount", { accounts: fmtInt(state.accounts.length), agents: fmtInt(agentTotal) })
  );
  if (!visible.length) {
    list.replaceChildren(el("p", { class: "empty-state", text: t("users.filterEmpty", { query: needle }) }));
    return;
  }
  list.replaceChildren(
    ...ROSTER_GROUPS.map((group) => {
      const items = visible.filter((account) => account.role === group.role);
      if (!items.length) return null;
      return el(
        "section",
        { class: "account-group" },
        el(
          "h4",
          { class: "account-group-title" },
          el("span", { text: t(`users.${group.key}`) }),
          el("span", { class: "account-group-count", text: String(items.length) })
        ),
        el("p", { class: "muted small", text: t(`users.${group.key}Hint`) }),
        ...items.flatMap((account) => [
          accountRow(account),
          ...(account.agents || []).map((agent) => agentRow(agent, account)),
        ])
      );
    }).filter(Boolean)
  );
}

function factsRows(rows) {
  return rows.map(([label, value]) =>
    el("div", {}, el("dt", { text: label }), el("dd", { text: value }))
  );
}

function identityFacts(record, picked) {
  const isAgent = picked.kind === "agent";
  const account = picked.account || record;
  const rows = [[t("users.factType"), roleLabel(record)]];
  if (isAgent) {
    rows.push([t("users.factOwner"), account?.displayName || "—"]);
    rows.push([t("users.factName"), record.displayName || "—"]);
    rows.push([t("users.factSpecialties"), (record.specialties || []).join("、") || t("users.specialtiesNone")]);
    rows.push([t("users.factState"), agentStateText(record)]);
  } else {
    rows.push([t("users.factName"), record.displayName || "—"]);
    rows.push([
      t("users.factEmail"),
      record.email || (record.role === "platform" ? t("users.factMachineNoEmail") : t("users.factNoEmail")),
    ]);
    if (record.role === "platform") rows.push([t("users.factState"), t("users.factPlatformState")]);
    else {
      rows.push([t("users.factLevel"), String(record.level ?? 1)]);
      rows.push([t("users.factPoints"), fmtInt(record.pointsBalance)]);
      rows.push([
        t("users.factMute"),
        record.muted
          ? record.mutedUntil
            ? t("users.factMuteUntil", { when: fmtDate(record.mutedUntil) })
            : t("users.factMuteForever")
          : t("users.factMuteNone"),
      ]);
      rows.push([t("users.factEntitlements"), (record.entitlements || []).join("、") || t("common.none")]);
    }
    if (record.label) rows.push(["label", record.label]);
  }
  rows.push([t("users.factUserId"), record.id]);
  rows.push([t("users.factCreated"), fmtDate(record.createdAt)]);
  return rows;
}

function identityDraft() {
  return {
    name: byId("identity-name")?.value ?? "",
    bio: byId("identity-bio")?.value ?? "",
    specialties: splitList(byId("identity-specialties")?.value),
  };
}

// 表单里有没有还没保存的改动。后台刷新后按它决定「重填」还是「留着草稿」。
function identityDirty(record) {
  const draft = identityDraft();
  if (draft.name !== String(record.displayName || "")) return true;
  if (draft.bio !== String(record.bio || "")) return true;
  if (record.role !== "agent") return false;
  return draft.specialties.join("\u0000") !== (record.specialties || []).join("\u0000");
}

// 前端先照 Backend 的规则挡一次，错在字段旁边说清；真边界仍以接口为准。
// 两个上限按码点算（与 Backend 的 Array.from 口径一致），不看 UTF-16 码元。
const IDENTITY_LIMITS = { name: 40, bio: 200 };

function identityProblem(record, draft, { checkName }) {
  if (checkName) {
    const name = draft.name.replace(/\s+/g, " ").trim();
    if (!name) return t("users.nameRequired");
    if (Array.from(name).length > IDENTITY_LIMITS.name) return t("users.nameTooLong");
  }
  const bio = draft.bio.replace(/\r\n?/g, "\n").trim();
  if (Array.from(bio).length > IDENTITY_LIMITS.bio) return t("users.bioTooLong");
  if (record.role === "agent") {
    if (draft.specialties.length > 8) return t("users.specialtiesTooMany");
    if (draft.specialties.some((item) => Array.from(item).length > 20)) return t("users.specialtyTooLong");
  }
  return "";
}

function fillIdentityForm(record) {
  state.identityFormFor = record.id;
  const name = byId("identity-name");
  if (name) {
    name.value = record.displayName || "";
    name.disabled = false;
    name.setAttribute("aria-describedby", "identity-name-hint");
  }
  setText(
    "identity-name-hint",
    record.role === "agent" ? t("users.nameHintAgent") : t("users.nameHintPerson")
  );
  const bio = byId("identity-bio");
  if (bio) bio.value = record.bio || "";
  const field = byId("identity-specialty-field");
  if (field) field.hidden = record.role !== "agent";
  const specialties = byId("identity-specialties");
  if (specialties) specialties.value = (record.specialties || []).join(", ");
  updateBioCount();
  setAlert(byId("identity-error"), "", "error");
}

function updateBioCount() {
  const bio = byId("identity-bio")?.value || "";
  setText("identity-bio-count", `${Array.from(bio).length} / ${IDENTITY_LIMITS.bio}`);
}

function renderUserPanel() {
  const panel = byId("user-panel");
  const empty = byId("detail-empty");
  if (!panel) return;
  const picked = selection();
  if (!picked) {
    panel.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }
  const record = picked.kind === "agent" ? picked.agent : picked.account;
  const account = picked.account || record;
  panel.hidden = false;
  if (empty) empty.hidden = true;

  const kind = identityKind(record);
  const mark = byId("user-mark");
  if (mark) {
    mark.className = `identity-mark is-${kind}`;
    mark.replaceChildren(svgNode(MARK_GLYPHS[kind] || "person", 20));
  }

  setText("user-summary", record.displayName || record.email || record.id);
  const note = [
    roleLabel(record),
    picked.kind === "agent" ? t("users.underOwnerShort", { owner: account?.displayName || t("users.noName") }) : accountMeta(record),
    `id ${record.id}`,
    record.retiredAt ? t("users.stateRetired", { when: fmtDate(record.retiredAt) }) : "",
  ].filter(Boolean);
  setText("user-note", note.join(" · "));

  const editable = canEditIdentity(record);
  const form = byId("identity-form");
  if (form) form.hidden = !editable;
  const readonly = byId("identity-readonly");
  if (readonly) {
    readonly.hidden = editable;
    readonly.textContent =
      record.role === "platform"
        ? t("users.readonlyPlatform")
        : picked.kind === "agent"
          ? t("users.readonlyAgent")
          : t("users.readonlyAccount");
  }
  setText("identity-mode", editable ? t("users.editable") : t("users.readonly"));
  // 后台刷新（发积分、警告、禁言后的 updateUser）不该抹掉正在编辑的草稿：
  // 只有换了选中对象，或表单本来就与库里的值一致时，才用库里的值重填。
  if (editable && (state.identityFormFor !== record.id || !identityDirty(record))) {
    fillIdentityForm(record);
  }

  const facts = byId("identity-facts");
  if (facts) facts.replaceChildren(...factsRows(identityFacts(record, picked)));

  // 授权码只给内部 Agent 看；选中时从授权码文件读一次，换一行就重新读。
  // 选中对象不需要授权码时，顺手把上一位 Agent 的明文从内存里放掉。
  const showToken = picked.kind === "agent" && !record.retiredAt && record.side === "internal";
  if (!showToken && state.agentToken) state.agentToken = null;
  renderTokenBlock(picked.kind === "agent" ? record : null);
  if (showToken && state.agentToken?.id !== record.id) void loadAgentToken(record);

  // 运营操作只挂在人这一行：Agent 的积分、禁言与权益都算所属账号的。
  const actions = byId("user-actions");
  const manageable = picked.kind === "account" && canManage(record);
  if (actions) actions.hidden = !manageable;
  const note2 = byId("actions-note");
  if (note2) {
    note2.hidden = !manageable || record.role === "owner";
    note2.textContent = t("users.actionsNote");
  }
  if (manageable) {
    const level = byId("level-value");
    // 同一行刷新时不要把刚输入的等级改回旧值：只在换选中对象时同步一次。
    if (level && level.dataset.for !== record.id) {
      level.value = record.level ?? 1;
      level.dataset.for = record.id;
    }
  }
}

async function submitIdentity(event) {
  event.preventDefault();
  const picked = selection();
  if (!picked) return;
  const record = picked.kind === "agent" ? picked.agent : picked.account;
  if (!canEditIdentity(record)) return;
  const draft = identityDraft();
  const problem = identityProblem(record, draft, { checkName: true });
  if (problem) {
    setAlert(byId("identity-error"), problem, "error");
    return;
  }

  const patch = {};
  const name = draft.name.replace(/\s+/g, " ").trim();
  if (name !== record.displayName) patch.displayName = name;
  const bio = draft.bio.replace(/\r\n?/g, "\n").trim();
  if (bio !== (record.bio || "")) patch.bio = bio;
  if (record.role === "agent" && draft.specialties.join("\u0000") !== (record.specialties || []).join("\u0000")) {
    patch.specialties = draft.specialties;
  }
  if (!Object.keys(patch).length) {
    setAlert(byId("identity-error"), t("users.noChange"), "error");
    return;
  }

  const save = byId("identity-save");
  if (save) {
    save.disabled = true;
    save.textContent = t("common.saving");
  }
  setAlert(byId("identity-error"), "", "error");
  try {
    await api(`/accounts/${encodeURIComponent(record.id)}/profile`, { method: "POST", body: patch });
    await loadAccounts();
    toast(t("users.saved"), "ok");
  } catch (error) {
    if (handleAuth(error)) return;
    setAlert(byId("identity-error"), humanError(error), "error");
  } finally {
    if (save) {
      save.disabled = false;
      save.textContent = t("users.save");
    }
  }
}

function resetIdentity() {
  const picked = selection();
  if (!picked) return;
  fillIdentityForm(picked.kind === "agent" ? picked.agent : picked.account);
}

function updateUser(next) {
  if (!next) return;
  const index = state.accounts.findIndex((account) => account.id === next.id);
  if (index >= 0) state.accounts[index] = { ...state.accounts[index], ...next };
  if (state.selectedUser?.id === next.id) state.selectedUser = { ...state.selectedUser, ...next };
  renderRoster();
  renderUserPanel();
}

// 写操作前确认用的称呼：没有显示名就退回邮箱或 id，别在对话框里留一个空位。
function whoLabel(record) {
  return record?.displayName || record?.email || record?.id || "";
}

// 一次填表一个幂等键：超时后再点一次用的是同一个键，Backend 认作同一笔；
// 改了金额或理由就换新的（那已经是另一笔）。成功后清掉，下一次发放重新生成。
let grantKey = { signature: "", id: "" };

function grantRequestId(userId, amount, body) {
  const signature = `${userId}|${amount}|${body}`;
  if (grantKey.signature !== signature || !grantKey.id) {
    const id =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    grantKey = { signature, id };
  }
  return grantKey.id;
}

async function submitGrant(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const amount = Number(byId("grant-amount").value);
  const body = byId("grant-body").value.trim();
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    formError("grant-form", t("users.amountBad"));
    return;
  }
  if (!body) {
    formError("grant-form", t("users.reasonRequired"));
    return;
  }
  // 发积分直接落一笔账，收回只能再发一笔反向的；先让人看清给谁、给多少。
  if (!window.confirm(t("users.grantConfirm", { name: whoLabel(user), amount: fmtInt(amount) }))) return;
  const requestId = grantRequestId(user.id, amount, body);
  const data = await writeForm("grant-form", () =>
    api("/points", { method: "POST", body: { user: user.id, amount, body, requestId } })
  );
  if (!data) return;
  grantKey = { signature: "", id: "" };
  byId("grant-amount").value = "";
  byId("grant-body").value = "";
  updateUser(data.user);
  toast(t("users.granted", { amount: fmtInt(amount), balance: fmtInt(data.pointsBalance) }), "ok");
}

async function submitWarn(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const body = byId("warn-body").value.trim();
  if (!body) {
    formError("warn-form", t("users.warnRequired"));
    return;
  }
  const data = await writeForm("warn-form", () =>
    api("/warnings", { method: "POST", body: { user: user.id, body } })
  );
  if (!data) return;
  byId("warn-body").value = "";
  updateUser(data.user);
  toast(t("users.warned"), "ok");
}

async function submitMute(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const body = byId("mute-body").value.trim();
  if (!body) {
    formError("mute-form", t("users.reasonRequired"));
    return;
  }
  // 「直到平台解除」不会自己到期：确认里把期限原样说出来，别让人凭记忆判断。
  const until = byId("mute-until");
  const untilLabel = until.selectedOptions?.[0]?.textContent || until.value;
  if (!window.confirm(t("users.muteConfirm", { name: whoLabel(user), until: untilLabel }))) return;
  const data = await writeForm("mute-form", () =>
    api("/mute", { method: "POST", body: { user: user.id, until: until.value, body } })
  );
  if (!data) return;
  byId("mute-body").value = "";
  updateUser(data.user);
  toast(t("users.muted"), "ok");
}

async function submitUnmute(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const body = byId("unmute-body").value.trim();
  if (!body) {
    formError("unmute-form", t("users.reasonRequired"));
    return;
  }
  const data = await writeForm("unmute-form", () =>
    api("/unmute", { method: "POST", body: { user: user.id, body } })
  );
  if (!data) return;
  byId("unmute-body").value = "";
  updateUser(data.user);
  toast(data.already ? t("users.unmutedAlready") : t("users.unmuted"), "ok");
}

async function submitLevel(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const level = Number(byId("level-value").value);
  const body = byId("level-body").value.trim();
  if (!Number.isSafeInteger(level) || level < 1 || level > 100) {
    formError("level-form", t("users.levelBad"));
    return;
  }
  if (!body) {
    formError("level-form", t("users.reasonRequired"));
    return;
  }
  if (!window.confirm(t("users.levelConfirm", { name: whoLabel(user), level: fmtInt(level) }))) return;
  const data = await writeForm("level-form", () =>
    api("/level", { method: "POST", body: { user: user.id, level, body } })
  );
  if (!data) return;
  byId("level-body").value = "";
  updateUser(data.user);
  toast(data.already ? t("users.levelSame") : t("users.levelChanged", { level: fmtInt(level) }), "ok");
}

async function submitEntitlements(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const grant = splitList(byId("entitlement-grant").value);
  const revoke = splitList(byId("entitlement-revoke").value);
  const body = byId("entitlement-body").value.trim();
  if (!grant.length && !revoke.length) {
    formError("entitlement-form", t("users.entitlementNeeded"));
    return;
  }
  if (!body) {
    formError("entitlement-form", t("users.reasonRequired"));
    return;
  }
  // 收回权益没有撤销键：确认里把「授什么、收什么」都写出来。
  const confirmText = t("users.entitlementConfirm", {
    name: whoLabel(user),
    grant: grant.join("、") || t("common.none"),
    revoke: revoke.join("、") || t("common.none"),
  });
  if (!window.confirm(confirmText)) return;
  const data = await writeForm("entitlement-form", () =>
    api("/entitlements", { method: "POST", body: { user: user.id, grant, revoke, body } })
  );
  if (!data) return;
  byId("entitlement-grant").value = "";
  byId("entitlement-revoke").value = "";
  byId("entitlement-body").value = "";
  updateUser(data.user);
  toast(data.already ? t("users.entitlementSame") : t("users.entitlementsUpdated"), "ok");
}

async function submitIssue(event) {
  event.preventDefault();
  const name = byId("issue-name").value.trim();
  const specialties = splitList(byId("issue-specialties").value);
  if (!name) {
    formError("issue-form", t("users.issueEmpty"), "issue-result");
    return;
  }
  const body = specialties.length ? { name, specialties } : { name };
  // 签发内部 Agent 会写一份含令牌的 .local.env：双击就是第二次签发，第一次的令牌当场作废。
  const data = await writeForm(
    "issue-form",
    () => api("/internal-agents", { method: "POST", body }),
    "issue-result"
  );
  if (!data) return;
  const result = byId("issue-result");
  let message;
  const agent = data.agent || {};
  const who = `${agent.displayName || name}（${agent.id || "—"}）`;
  const file = data.envFile || "KNOT_AGENT_ENV_DIR";
  if (data.already) {
    message = t("users.issueAlready", { who });
  } else if (data.created) {
    message = t("users.issueCreated", { who, file });
  } else {
    message = t("users.issueRevived", { who, file });
  }
  setAlert(result, message, "ok");
  byId("issue-name").value = "";
  byId("issue-specialties").value = "";
  await loadAccounts();
}

// 签发只落在主理人名下：外部账号的 Agent 由账号自己在「我的」里开通，一个账号一个。
// 名额满时先不让点，别让人填完称呼才收到 409。
function renderIssueQuota() {
  const quota = state.quota;
  const note = byId("issue-quota");
  const submit = byId("issue-submit");
  if (!note) return;
  if (!quota) {
    note.textContent = t("users.issueQuotaReading");
    if (submit) submit.disabled = false;
    return;
  }
  const used = Number(quota.internalAgents?.used) || 0;
  const limit = Number(quota.internalAgents?.limit) || 0;
  const owner = state.accounts.find((account) => account.role === "owner");
  const target = owner ? t("users.ownerNamed", { name: owner.displayName }) : t("users.ownerMissing");
  const full = limit > 0 && used >= limit;
  note.textContent =
    t("users.issueQuota", { target, used, limit }) + (full ? t("users.issueQuotaFull") : "");
  if (submit) {
    submit.disabled = full;
    submit.title = full ? t("users.issueFullTitle") : "";
  }
}

async function retireAgent(agent) {
  const reason = window.prompt(t("users.retireTitle", { name: agent.displayName }), t("users.retireDefault"));
  if (reason == null) return;
  // 停用会立刻作废授权码，接在 OpenClaw 上的那个 Agent 当场断线：prompt 之后还要再确认一次。
  if (!window.confirm(t("users.retireConfirm", { name: agent.displayName }))) return;
  const data = await guard(() =>
    api(`/agents/${encodeURIComponent(agent.id)}/retire`, { method: "POST", body: { body: reason.trim() || t("users.retireDefault") } })
  );
  if (!data) return;
  toast(t("users.retired"), "ok");
  await loadAccounts();
}

/* 授权码 */

// 库里只有令牌的哈希，明文只在授权码文件里，所以选中内部 Agent 时现读一次，不缓存到页面上。
function tokenView(agent) {
  if (state.agentToken && state.agentToken.id === agent.id) return state.agentToken;
  return { id: agent.id, loading: true, token: "", file: "", error: "" };
}

function clearTokenValue() {
  const value = byId("token-value");
  if (value) value.value = "";
  const copy = byId("token-copy");
  if (copy) copy.disabled = true;
  const rotate = byId("token-rotate");
  if (rotate) rotate.disabled = true;
}

function renderTokenBlock(agent) {
  const section = byId("agent-token");
  if (!section) return;
  if (!agent || agent.retiredAt) {
    section.hidden = true;
    clearTokenValue();
    return;
  }
  section.hidden = false;

  const internal = agent.side === "internal";
  const row = byId("token-row");
  if (row) row.hidden = !internal;
  const actions = byId("token-actions");
  if (actions) actions.hidden = !internal;
  const hint = byId("token-hint");
  if (hint) hint.hidden = !internal;
  const note = byId("token-note");

  // 外部 Agent 的码只在它主人的「我的」里出现过，管理端没有明文可给。
  // 切过来时先把上一位内部 Agent 留在输入框里的码清掉。
  if (!internal) {
    clearTokenValue();
    if (note) {
      note.textContent = t("users.tokenExternal");
      note.hidden = false;
      note.classList.remove("is-warn");
    }
    return;
  }

  const data = tokenView(agent);
  const value = byId("token-value");
  if (value) value.value = data.token || "";
  const copy = byId("token-copy");
  if (copy) copy.disabled = !data.token || state.tokenBusy;
  const rotate = byId("token-rotate");
  if (rotate) rotate.disabled = state.tokenBusy || data.loading;

  if (note) {
    let message = "";
    if (data.loading) message = t("users.tokenReading");
    else if (data.error === "token_unavailable") message = t("users.tokenUnavailable");
    else if (data.error) message = errorHint(data.error) || humanError({ code: data.error });
    else message = t("users.tokenFile", { file: data.file });
    note.textContent = message;
    note.hidden = !message;
    note.classList.toggle("is-warn", Boolean(data.error));
  }
  if (hint) hint.hidden = Boolean(data.error && data.error !== "token_unavailable");
}

async function loadAgentToken(agent) {
  if (!agent || agent.retiredAt || agent.side !== "internal") return;
  const id = agent.id;
  state.agentToken = { id, loading: true, token: "", file: "", error: "" };
  renderTokenBlock(agent);
  try {
    const data = await api(`/agents/${encodeURIComponent(id)}/token`);
    if (state.agentToken?.id !== id) return;
    state.agentToken = { id, loading: false, token: data.token || "", file: data.file || "", error: "" };
  } catch (error) {
    if (handleAuth(error)) return;
    if (state.agentToken?.id !== id) return;
    state.agentToken = { id, loading: false, token: "", file: "", error: error.code || "request_failed" };
  }
  const picked = selection();
  if (picked?.kind === "agent" && picked.agent.id === id) renderTokenBlock(picked.agent);
}

async function copyAgentToken() {
  const picked = selection();
  if (!picked || picked.kind !== "agent") return;
  const token = tokenView(picked.agent).token;
  if (!token) return;
  try {
    await navigator.clipboard.writeText(token);
    toast(t("users.tokenCopied"), "ok");
  } catch {
    // 局域网里可能是 http，浏览器不给剪贴板接口：退回选中输入框再复制。
    const input = byId("token-value");
    input?.select();
    try {
      if (!document.execCommand("copy")) throw new Error("copy");
      toast(t("users.tokenCopied"), "ok");
    } catch {
      toast(t("users.tokenCopyFailed"), "error");
    }
  }
}

async function rotateAgentToken() {
  const picked = selection();
  if (!picked || picked.kind !== "agent") return;
  const agent = picked.agent;
  if (agent.retiredAt || agent.side !== "internal") return;
  if (!window.confirm(t("users.tokenRotateConfirm", { name: agent.displayName }))) return;
  state.tokenBusy = true;
  renderTokenBlock(agent);
  try {
    const data = await api(`/agents/${encodeURIComponent(agent.id)}/token/rotate`, { method: "POST" });
    state.agentToken = { id: agent.id, loading: false, token: data.token || "", file: data.file || "", error: "" };
    toast(t("users.tokenRotated"), "ok");
    await loadAccounts();
  } catch (error) {
    if (handleAuth(error)) return;
    toast(humanError(error), "error");
  } finally {
    state.tokenBusy = false;
    const current = selection();
    if (current?.kind === "agent") renderTokenBlock(current.agent);
  }
}

/* 站点 */

function fillSystem(system) {
  if (!system) return;
  const guest = byId("system-guest");
  const board = byId("system-board");
  const mode = byId("system-registration");
  if (guest) guest.checked = Boolean(system.guestBrowsing);
  if (board) board.checked = Boolean(system.publicBoard);
  if (mode) mode.value = system.registrationMode || "open";
  setText(
    "system-updated",
    system.updatedAt ? t("site.updatedAt", { when: fmtDate(system.updatedAt) }) : t("site.neverChanged")
  );
}

async function loadSystem() {
  try {
    const data = await api("/system");
    state.system = data.system;
    fillSystem(state.system);
    renderSystemFacts();
  } catch (error) {
    if (!handleAuth(error)) showBanner(humanError(error));
  }
}

async function saveSystem(event) {
  event.preventDefault();
  const patch = {
    guestBrowsing: byId("system-guest").checked,
    publicBoard: byId("system-board").checked,
    registrationMode: byId("system-registration").value,
  };
  const data = await writeForm(
    "system-form",
    () => api("/system", { method: "PATCH", body: patch }),
    "system-error"
  );
  if (!data) return;
  state.system = data.system;
  fillSystem(state.system);
  renderSystemFacts();
  toast(t("site.gateSaved"), "ok");
}

function renderInvites() {
  const body = byId("invites-list");
  if (!body) return;
  if (!state.invites.length) {
    body.replaceChildren(emptyBlock("site.inviteNone"));
    return;
  }
  body.replaceChildren(
    ...state.invites.map((invite) => {
      const disable = el("button", {
        class: "button danger compact",
        type: "button",
        text: t("site.disable"),
      });
      disable.disabled = !invite.usable;
      disable.addEventListener("click", () => disableInvite(invite));
      const meta = el(
        "span",
        { class: "invite-meta" },
        el("span", { text: t("site.inviteRemaining", { used: invite.usedCount, max: invite.maxUses }) }),
        el("span", {
          text: invite.expiresAt
            ? t("site.inviteExpires", { when: fmtDate(invite.expiresAt) })
            : t("site.inviteNoExpiry"),
        }),
        invite.note ? el("span", { text: invite.note }) : null
      );
      return el(
        "div",
        { class: "invite-row" },
        el(
          "span",
          { class: "invite-main" },
          el("code", { class: "invite-code", text: invite.code }),
          meta
        ),
        invite.usable ? disable : el("span", { class: "pill", text: t("site.disableDone") })
      );
    })
  );
}

async function loadInvites() {
  try {
    const data = await api("/invites");
    state.invites = Array.isArray(data.invites) ? data.invites : [];
    renderInvites();
  } catch (error) {
    if (!handleAuth(error)) showBanner(humanError(error));
  }
}

async function createInvite(event) {
  event.preventDefault();
  const body = {};
  const maxUses = byId("invite-max-uses").value.trim();
  const expiresIn = byId("invite-expires").value.trim();
  const note = byId("invite-note").value.trim();
  const code = byId("invite-code").value.trim();
  if (maxUses) body.maxUses = Number(maxUses);
  if (expiresIn) body.expiresIn = expiresIn;
  if (note) body.note = note;
  if (code) body.code = code;
  const data = await writeForm("invite-form", () => api("/invites", { method: "POST", body }), "invite-result");
  if (!data) return;
  setAlert(
    byId("invite-result"),
    t("site.inviteIssued", { code: data.invite.code, uses: fmtInt(data.invite.maxUses) }),
    "ok"
  );
  byId("invite-note").value = "";
  byId("invite-code").value = "";
  await loadInvites();
}

async function disableInvite(invite) {
  if (!window.confirm(t("site.disableConfirm", { code: invite.code }))) return;
  const data = await guard(() => api(`/invites/${encodeURIComponent(invite.id)}/disable`, { method: "POST" }));
  if (!data) return;
  toast(t("site.disabled"), "ok");
  await loadInvites();
}

function renderSponsors() {
  const body = byId("sponsors-list");
  if (!body) return;
  if (!state.sponsors.length) {
    body.replaceChildren(emptyBlock("site.sponsorNone", "site"));
    return;
  }
  body.replaceChildren(
    ...state.sponsors.map((sponsor, index) => {
      const edit = el("button", { class: "button ghost compact", type: "button", text: t("site.edit") });
      edit.addEventListener("click", () => editSponsor(sponsor, index));
      const up = el("button", { class: "button ghost compact", type: "button", text: t("site.up") });
      up.disabled = index === 0;
      up.addEventListener("click", () => placeSponsor(sponsor, index));
      const down = el("button", { class: "button ghost compact", type: "button", text: t("site.down") });
      down.disabled = index === state.sponsors.length - 1;
      down.addEventListener("click", () => placeSponsor(sponsor, index + 2));
      const remove = el("button", { class: "button danger compact", type: "button", text: t("site.remove") });
      remove.addEventListener("click", () => removeSponsor(sponsor));

      const thumb = el("span", { class: "sponsor-thumb" });
      if (sponsor.image) {
        thumb.append(
          el("img", {
            src: imageSource(sponsor.image),
            alt: sponsor.title || "",
            loading: "lazy",
            on: { error: () => thumb.replaceChildren(svgNode("site", 18)) },
          })
        );
      } else {
        thumb.append(svgNode("site", 18));
      }

      return el(
        "div",
        { class: "sponsor-row" },
        thumb,
        el(
          "span",
          { class: "sponsor-main" },
          el("span", { class: "sponsor-title", text: sponsor.title }),
          el("span", { class: "sponsor-link", text: sponsor.href }),
          el("span", {
            class: "sponsor-meta",
            text: [sponsor.caption, sponsor.source].filter(Boolean).join(" · ") || t("site.sponsorNoText"),
          })
        ),
        el("span", { class: "sponsor-actions" }, edit, up, down, remove)
      );
    })
  );
}

// 赞助图可以是上传 id，也可以是现成的地址：两种都交给浏览器自己取。
function imageSource(image) {
  const value = String(image || "").trim();
  if (!value) return "";
  if (/^(https?:)?\/\//.test(value) || value.startsWith("/")) return value;
  return `/api/web/uploads/${encodeURIComponent(value)}`;
}

// 服务端的 8MB 与类型白名单要等整个文件传完才回话：选中的文件先在本地看一眼。
const SPONSOR_IMAGE_MAX = 8 * 1024 * 1024;
const SPONSOR_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

async function loadSponsors() {
  try {
    const data = await api("/sponsors");
    state.sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
    renderSponsors();
  } catch (error) {
    if (!handleAuth(error)) showBanner(humanError(error));
  }
}

function resetSponsorForm() {
  state.editingSponsor = null;
  byId("sponsor-id").value = "";
  byId("sponsor-title").value = "";
  byId("sponsor-href").value = "";
  byId("sponsor-image").value = "";
  byId("sponsor-caption").value = "";
  byId("sponsor-source").value = "";
  byId("sponsor-file").value = "";
  setText("sponsor-form-title", t("site.sponsorNew"));
  byId("sponsor-cancel").hidden = true;
}

function editSponsor(sponsor, index) {
  state.editingSponsor = sponsor;
  byId("sponsor-id").value = sponsor.id;
  byId("sponsor-title").value = sponsor.title || "";
  byId("sponsor-href").value = sponsor.href || "";
  byId("sponsor-image").value = sponsor.image || "";
  byId("sponsor-caption").value = sponsor.caption || "";
  byId("sponsor-source").value = sponsor.source || "";
  setText("sponsor-form-title", t("site.sponsorEdit", { position: sponsor.position ?? index + 1 }));
  byId("sponsor-cancel").hidden = false;
  byId("sponsor-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadSponsorImage() {
  const input = byId("sponsor-file");
  const file = input.files?.[0];
  if (!file) {
    toast(t("site.sponsorPickFile"), "error");
    return;
  }
  if (!SPONSOR_IMAGE_TYPES.includes(file.type)) {
    formError("sponsor-form", t("site.sponsorFileType"));
    return;
  }
  if (file.size > SPONSOR_IMAGE_MAX) {
    formError("sponsor-form", t("site.sponsorFileTooLarge"));
    return;
  }
  formError("sponsor-form", "");
  const form = new FormData();
  form.append("file", file);
  const data = await guard(() => api("/uploads", { method: "POST", form }));
  if (!data) return;
  byId("sponsor-image").value = data.id;
  toast(t("site.sponsorUploaded"), "ok");
}

async function saveSponsor(event) {
  event.preventDefault();
  const id = byId("sponsor-id").value.trim();
  const title = byId("sponsor-title").value.trim();
  const href = byId("sponsor-href").value.trim();
  if (!title || !href) {
    formError("sponsor-form", t("site.sponsorNeed"), "sponsor-error");
    return;
  }
  const body = {
    title,
    href,
    image: byId("sponsor-image").value.trim(),
    caption: byId("sponsor-caption").value.trim(),
    source: byId("sponsor-source").value.trim(),
  };
  const data = await writeForm(
    "sponsor-form",
    () =>
      id
        ? api(`/sponsors/${encodeURIComponent(id)}`, { method: "POST", body })
        : api("/sponsors", { method: "POST", body }),
    "sponsor-error"
  );
  if (!data) return;
  resetSponsorForm();
  toast(t("site.sponsorSaved"), "ok");
  await loadSponsors();
}

async function placeSponsor(sponsor, position) {
  const data = await guard(() =>
    api(`/sponsors/${encodeURIComponent(sponsor.id)}/place`, { method: "POST", body: { position } })
  );
  if (!data) return;
  await loadSponsors();
}

async function removeSponsor(sponsor) {
  if (!window.confirm(t("site.sponsorDeleteConfirm", { title: sponsor.title }))) return;
  const data = await guard(() => api(`/sponsors/${encodeURIComponent(sponsor.id)}/remove`, { method: "POST" }));
  if (!data) return;
  if (state.editingSponsor?.id === sponsor.id) resetSponsorForm();
  toast(t("site.sponsorDeleted"), "ok");
  await loadSponsors();
}

function fillPrices(prices) {
  if (!prices) return;
  for (const key of priceKeys()) {
    const input = byId(`price-${key}`);
    if (input) input.value = prices[key] ?? "";
  }
}

function renderPrices() {
  const data = state.prices;
  const summary = byId("prices-summary");
  const apply = byId("price-apply");
  if (!data || !summary) return;
  const source = data.source === "policy" ? t("site.priceSourcePolicy") : t("site.priceSourceEnv");
  const pending = data.pending;
  const text = pending
    ? t("site.pricePending", { source, when: fmtDate(pending.createdAt) })
    : t("site.priceClean", { source });
  setText("prices-summary", text);
  if (apply) apply.hidden = !pending;
}

async function loadPrices() {
  try {
    const data = await api("/prices");
    state.prices = data;
    fillPrices(data.prices);
    renderPrices();
  } catch (error) {
    if (!handleAuth(error)) showBanner(humanError(error));
  }
}

function pricePayload() {
  const payload = {};
  for (const key of priceKeys()) {
    const raw = byId(`price-${key}`).value.trim();
    if (!/^(0|[1-9]\d*)$/.test(raw)) {
      throw new Error(`bad_price:${key}`);
    }
    payload[key] = Number(raw);
  }
  return payload;
}

async function proposePrices() {
  let payload;
  try {
    payload = pricePayload();
  } catch {
    toast(t("site.priceBad"), "error");
    return;
  }
  const data = await guard(() => api("/prices/proposals", { method: "POST", body: payload }));
  if (!data) return;
  toast(t("site.proposed"), "ok");
  await loadPrices();
}

async function applyPrices() {
  const pending = state.prices?.pending;
  if (!pending) {
    toast(t("site.noPending"), "error");
    return;
  }
  if (!window.confirm(t("site.applyConfirm"))) return;
  const data = await guard(() =>
    api(`/prices/proposals/${encodeURIComponent(pending.id)}/apply`, { method: "POST" })
  );
  if (!data) return;
  toast(t("site.applied"), "ok");
  await loadPrices();
}

async function loadSite() {
  await Promise.allSettled([loadSystem(), loadInvites(), loadSponsors(), loadPrices()]);
}

/* XKnot */

const SIGNAL_KEYS = { error: "signalError", warn: "signalWarn", info: "signalInfo", ok: "signalOk" };
// signal.level 也来自接口、也进 class 名：只认这四种。
const SIGNAL_LEVELS = new Set(["error", "warn", "info", "ok"]);

function fact(label, value) {
  return el("div", {}, el("dt", { text: label }), el("dd", { text: value == null || value === "" ? "—" : value }));
}

function mailLabel(mail) {
  if (!mail) return "—";
  if (mail.mode === "relay") return t("xknot.mailRelay");
  if (mail.mode === "smtp") return t("xknot.mailSmtp");
  return t("xknot.mailNone");
}

function loadXknot() {
  void loadProfile();
  void loadProgress();
  if (byId("fed-details")?.open) void loadFederation();
}

async function loadFederation() {
  byId("fed-facts")?.replaceChildren();
  byId("fed-health-facts")?.replaceChildren();
  setText("fed-file", "");
  byId("fed-signals")?.replaceChildren(el("li", { class: "signal", text: t("xknot.reading") }));
  const driftCard = byId("fed-drift-card");
  if (driftCard) driftCard.hidden = true;
  try {
    const data = await api("/federation");
    state.federation = data;
    renderFederation();
  } catch (error) {
    if (handleAuth(error)) return;
    showBanner(humanError(error));
    byId("fed-signals")?.replaceChildren(el("li", { class: "signal is-error", text: humanError(error) }));
  }
}

function renderSignals(signals) {
  const list = byId("fed-signals");
  if (!list) return;
  if (!signals.length) {
    list.replaceChildren(el("li", { class: "signal is-ok", text: t("xknot.signalNone") }));
    return;
  }
  list.replaceChildren(
    ...signals.map((signal) =>
      el(
        "li",
        { class: `signal is-${SIGNAL_LEVELS.has(signal.level) ? signal.level : "info"}` },
        el("span", { class: "signal-dot", "aria-hidden": "true" }),
        el(
          "span",
          {},
          el("strong", { text: `${t(`xknot.${SIGNAL_KEYS[signal.level] || "signalInfo"}`)} ` }),
          el("span", { text: signal.text })
        )
      )
    )
  );
}

function renderDrift(drift) {
  const card = byId("fed-drift-card");
  const body = byId("fed-drift");
  if (!card || !body) return;
  card.hidden = !drift.length;
  body.replaceChildren(
    ...drift.map((entry) =>
      el(
        "tr",
        {},
        el("td", { text: entry.key }),
        el("td", { class: "cell-body", text: entry.stored || t("xknot.emptyValue") }),
        el("td", { class: "cell-body", text: entry.running || t("xknot.emptyValue") })
      )
    )
  );
}

function renderFederation() {
  const data = state.federation;
  if (!data) return;
  const running = data.running || {};
  const health = data.health || {};

  const relay = running.relayUrl
    ? `${running.relayUrl}${running.relayUrlSource === "derived" ? t("xknot.relayDerived") : ""}`
    : "";
  byId("fed-facts")?.replaceChildren(
    fact(t("xknot.instanceId"), running.instanceId),
    fact(t("xknot.hub"), running.hubOrigin),
    fact(t("xknot.relay"), relay),
    fact(t("xknot.credential"), running.relayToken?.present ? running.relayToken.masked : t("xknot.notIssued")),
    fact(t("xknot.issuedAt"), running.issuedAt)
  );
  setText(
    "fed-file",
    data.file?.exists
      ? t("xknot.fileExists", {
          path: data.file.path || t("xknot.pathUnknown"),
          mode: data.file.permissions || t("xknot.permissionUnknown"),
        })
      : t("xknot.fileNone", { path: data.file?.path ? `：${data.file.path}` : "" })
  );

  byId("fed-health-facts")?.replaceChildren(
    fact(t("xknot.probeUrl"), health.url),
    fact(t("xknot.reported"), health.instance || t("xknot.notSent")),
    fact(t("xknot.protocol"), health.url ? (health.https ? "https" : t("xknot.notHttps")) : "—"),
    fact(t("xknot.mail"), mailLabel(data.mail))
  );

  renderSignals(Array.isArray(data.signals) ? data.signals : []);
  renderDrift(Array.isArray(data.drift) ? data.drift : []);
}

/* 站点档案：自述区在这里编辑，签发区只读 */
// 字段清单只写一次：表单、填表、保存都从这张表走，避免三处各记一套名字。
// v2 起没有多语种文案：一项一个输入框；只有「默认语种」是下拉框。
const PROFILE_FIELDS = [
  { key: "name", max: 40 },
  { key: "locale", select: true },
  { key: "tagline", max: 60 },
  { key: "intro", max: 800, multiline: true },
  { key: "logo", max: 300 },
  { key: "owner", max: 40 },
  { key: "contact", max: 120 },
  { key: "region", max: 6 },
  { key: "timezone", max: 40 },
  { key: "tags", max: 160, list: true },
];

function fieldLabel(key) {
  return el(
    "span",
    {},
    t(`profile.${key}`),
    el("span", { class: "field-hint", text: ` · ${t(`profile.${key}Hint`)}` })
  );
}

// 语言菜单只有这三项，与 Backend 的白名单一致。页面不打包，不引共享包。
const SITE_LOCALES = [
  { id: "zh-CN", label: "简体中文" },
  { id: "zh-TW", label: "繁體中文" },
  { id: "en", label: "English" },
];

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

// 老档案没有这一项时给一个建议值：保存才落库，由主理人自己决定。
function suggestedLocale(site) {
  if (SITE_LOCALES.some((item) => item.id === site?.locale)) return site.locale;
  const text = [site?.name, site?.tagline, site?.intro].filter(Boolean).join(" ");
  return CJK.test(text) ? "zh-CN" : "en";
}

function profileInput(field) {
  if (field.select) {
    const select = el(
      "select",
      { dataset: { profileKey: field.key } },
      ...SITE_LOCALES.map((item) => el("option", { value: item.id, text: item.label }))
    );
    return el("label", { class: "field" }, fieldLabel(field.key), select);
  }
  const input = el(field.multiline ? "textarea" : "input", {
    type: field.multiline ? null : "text",
    maxlength: field.max,
    dataset: { profileKey: field.key, ...(field.list ? { list: "yes" } : {}) },
  });
  return el("label", { class: "field" }, fieldLabel(field.key), input);
}

function renderProfileForm() {
  const container = byId("profile-fields");
  if (!container) return;
  container.replaceChildren(
    ...PROFILE_FIELDS.map((field) =>
      field.multiline
        ? el("div", { class: "field field-wide" }, profileInput(field))
        : profileInput(field)
    )
  );
}

// 档案表单的标签是 boot 时用 t() 写进 DOM 的一次性节点（没有 data-i18n）：
// 切语种要重建这一块，否则标签永远停在启动时的语言。重建前收下草稿，建完填回去。
function relabelProfileForm() {
  const container = byId("profile-fields");
  if (!container || !container.childElementCount) return;
  const draft = collectProfile();
  renderProfileForm();
  for (const input of container.querySelectorAll("[data-profile-key]")) {
    const key = input.dataset.profileKey;
    if (!Object.prototype.hasOwnProperty.call(draft, key)) continue;
    const value = draft[key];
    input.value = Array.isArray(value) ? value.join(", ") : value;
  }
}

function collectProfile() {
  const site = {};
  for (const input of document.querySelectorAll("[data-profile-key]")) {
    const value = input.value.trim();
    if (!value) continue;
    const key = input.dataset.profileKey;
    site[key] = input.dataset.list === "yes" ? splitList(value) : value;
  }
  return site;
}

function fillProfileForm(site) {
  for (const input of document.querySelectorAll("[data-profile-key]")) {
    const value = site?.[input.dataset.profileKey];
    if (Array.isArray(value)) input.value = value.join(", ");
    else input.value = typeof value === "string" ? value : "";
  }
  // 语种不从空开始：老档案没有这一项时先给一个建议值，保存才写进档案。
  const localeInput = document.querySelector('[data-profile-key="locale"]');
  if (localeInput) localeInput.value = suggestedLocale(site);
}

async function loadProfile() {
  setText("profile-note", t("xknot.reading"));
  renderIssued(null);
  try {
    const data = await api("/profile");
    state.profile = data;
    renderProfile();
    await loadJoinApplication();
  } catch (error) {
    if (handleAuth(error)) return;
    showBanner(humanError(error));
    setText("profile-note", humanError(error));
  }
}

function renderProfile() {
  const data = state.profile;
  if (!data) return;
  renderIssued(data);
  renderJoin(data);
  fillProfileForm(data.site);

  const problems = Array.isArray(data.problems) ? data.problems : [];
  setAlert(byId("profile-problems"), problems.join("；"), "error");
  // 这个接口的 file 是路径字符串；federation 那边是 { path, permissions }，别混。
  const filePath = typeof data.file === "string" ? data.file : data.file?.path || "";
  setText(
    "profile-note",
    data.file
      ? t("xknot.profileNote", {
          path: filePath || t("xknot.pathUnknown"),
          when: data.updatedAt || t("site.neverChanged"),
        })
      : t("xknot.profileNoDir")
  );
}

/* 第一次接入：检查子域、提交申请。规则在中枢，这里只显示结论。 */

const JOIN_REASON_KEYS = {
  empty: "reasonEmpty",
  too_short: "reasonTooShort",
  too_long: "reasonTooLong",
  format: "reasonFormat",
  reserved: "reasonReserved",
  taken: "reasonTaken",
};

const joinState = { available: false, label: "" };

function joinHint(min = 6) {
  setText("join-subdomain-note", t("xknot.subdomainNote", { min }));
}

// 已接入就把「提交」收起来，没接入就只显示提交那一张。
// 自述区与提交是两条线：改了档案不会自动重交，避免每存一次就发一张单。
// 已交的申请记在站点目录里：刷新、换浏览器之后仍能从卡片上打开案例页。
async function loadJoinApplication() {
  try {
    const data = await api("/xknot/application");
    state.joinApplication = data?.application || null;
  } catch (error) {
    if (handleAuth(error)) return;
    // 读不到不等于没交过：保留手上那份记录，并把这次失败写出来，
    // 否则卡片会像「从未提交」一样回话，再提交一次又会被中枢判重。
    const node = byId("join-record");
    if (node) {
      node.className = "alert is-error";
      node.textContent = humanError(error);
      node.hidden = false;
    }
    return;
  }
  renderJoinRecord();
}

/* 自动接通：进度按步骤显示，卡住的那一步带原因。 */

const CONNECT_STEPS = {
  allocate: "stepAllocate",
  publish: "stepPublish",
  account: "stepAccount",
  sshd: "stepSshd",
  static: "stepStatic",
  dns: "stepDns",
  vhost: "stepVhost",
  tls: "stepTls",
};

const CONNECT_ERRORS = {
  dns_missing: "errorDns",
  tls_failed: "errorTls",
  sshd_config_invalid: "errorSshd",
  nginx_config_invalid: "errorNginx",
  account_failed: "errorAccount",
  public_key_missing: "errorKey",
  port_exhausted: "errorPort",
  roster_invalid: "errorRoster",
  url_taken: "errorUrlTaken",
  id_taken: "errorIdTaken",
  write_failed: "errorWrite",
  application_closed: "errorClosed",
};

const PROGRESS_STATES = {
  provisioning: "stateProvisioning",
  awaiting_tunnel: "stateAwaitingTunnel",
  active: "stateActive",
  failed: "stateFailed",
};

async function loadProgress({ quiet = false } = {}) {
  const card = byId("connect-card");
  try {
    const data = await api("/xknot/progress");
    state.progress = data;
    renderProgress();
  } catch (error) {
    if (handleAuth(error)) return;
    // 轮询时不报错：写接入件之后 Backend 会自己重启一下，那几秒的断线不用吓人。
    if (!quiet && card && !card.hidden) setAlert(byId("connect-note"), humanError(error), "error");
  }
}

function renderProgress() {
  const card = byId("connect-card");
  if (!card) return;
  const data = state.progress;
  const application = data?.application || null;
  const start = byId("connect-start");
  const note = byId("connect-note");
  const list = byId("connect-steps");

  card.hidden = !application;
  if (!application) {
    if (start) start.hidden = true;
    return;
  }
  if (!list) return;

  const run = data.run || null;
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  if (!steps.length) {
    list.replaceChildren(
      el(
        "li",
        { class: "is-running" },
        el("span", { class: "step-mark", text: "…" }),
        el("span", { class: "step-name", text: t("xknot.waitingHub") }),
        el("span", { class: "step-note", text: `id ${application.id}` })
      )
    );
  } else {
    list.replaceChildren(
      ...steps.map((step) => {
        const failed = step.state === "failed" || (step.state !== "done" && Boolean(step.error));
        const done = step.state === "done";
        const name = CONNECT_STEPS[step.id] ? t(`xknot.${CONNECT_STEPS[step.id]}`) : step.id;
        const text = failed
          ? CONNECT_ERRORS[step.error]
            ? t(`xknot.${CONNECT_ERRORS[step.error]}`)
            : step.error || t("xknot.stepFailed")
          : step.note || (done ? t("xknot.stepDone") : t("xknot.stepTodo"));
        return el(
          "li",
          { class: failed ? "is-failed" : done ? "is-done" : "is-running" },
          el("span", { class: "step-mark", text: failed ? "!" : done ? "✓" : "…" }),
          el("span", { class: "step-name", text: name }),
          el("span", { class: "step-note", text })
        );
      })
    );
  }

  const summary = run
    ? PROGRESS_STATES[run.state]
      ? t(`xknot.${PROGRESS_STATES[run.state]}`)
      : run.state
    : t("xknot.pendingReview");
  const handoff = data.handoff;
  const local = data.local || {};
  let text = handoff
    ? `${summary}${t("xknot.handoff", { account: handoff.account, host: handoff.host, port: handoff.port })}`
    : summary;
  if (run?.state === "active" && data.issued?.url) text += t("xknot.accepted", { url: data.issued.url });
  if (local.error) text += t("xknot.localError", { error: local.error });
  else if (local.joinError) text += t("xknot.joinError", { error: local.joinError });
  if (local.changed) text += t("xknot.tunnelRestarted");
  if (local.restart && local.restart.deferred && !local.restart.ok) {
    text += t("xknot.restartManual", { command: local.restart.command });
  }
  if (local.joined) text += t("xknot.joined");

  setAlert(note, text, run?.state === "active" ? "ok" : run?.lastError || local.error || local.joinError ? "error" : "ok");
  if (start) start.hidden = !handoff || run?.state === "active";
}

async function startTunnel() {
  const button = byId("connect-start");
  if (button) button.disabled = true;
  setAlert(byId("connect-note"), t("xknot.writing"), "ok");
  try {
    const data = await api("/xknot/connect", { method: "POST" });
    const restart = data.restart || {};
    if (data.changed === false) {
      setAlert(byId("connect-note"), t("xknot.unchanged"), "ok");
      await loadProgress();
      return;
    }
    setAlert(
      byId("connect-note"),
      restart.ok
        ? t("xknot.tunnelWritten")
        : t("xknot.tunnelManual", {
            command: restart.command || "bash ops/scripts/run-entry-tunnel.sh",
          }),
      "ok"
    );
    // 隧道正在重启：这时经隧道读进度只会拿到 502，别立刻读。
  } catch (error) {
    if (handleAuth(error)) return;
    setAlert(byId("connect-note"), humanError(error), "error");
  } finally {
    button.disabled = false;
  }
}

// 中枢回来的地址只认站内路径或 https：其它 scheme（javascript:、data:）不放进 href。
function safeHref(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.startsWith("/") || /^https:\/\//i.test(value)) return value;
  return "";
}

function renderJoinRecord() {
  const node = byId("join-record");
  if (!node) return;
  // 上一次读取失败时这块被临时改成错误条，拿回记录时要还原成原来的说明行。
  node.className = "muted small";
  const application = state.joinApplication;
  if (!application?.id) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }
  // 中枢给的是 UTC 的 ISO 串：截前 10 位在东八区会把凌晨的申请显示成前一天。
  const href = safeHref(application.caseUrl);
  node.replaceChildren(
    el("span", {
      text: t("xknot.joinRecord", {
        id: application.id,
        status: application.status || "pending",
        when: application.submittedAt ? fmtDate(application.submittedAt) : "—",
      }),
    }),
    href
      ? el("a", {
          href,
          target: "_blank",
          rel: "noopener",
          text: t("xknot.viewProgress"),
        })
      : null
  );
  node.hidden = false;
}

function renderJoin(data) {
  const card = byId("join-card");
  const issuedCard = byId("issued-card");
  if (!card) return;
  const joined = Boolean(data?.issued?.id);
  card.hidden = joined;
  if (issuedCard) issuedCard.hidden = !joined;
  if (joined) return;

  const email = byId("join-email");
  const contact = String(data?.site?.contact || "").trim();
  if (email && !email.value && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(contact)) {
    email.value = contact;
  }
}

function resetJoinCheck() {
  joinState.available = false;
  joinState.label = "";
  const submit = byId("join-submit");
  if (submit) submit.disabled = true;
}

async function checkJoinSubdomain() {
  const input = byId("join-subdomain");
  const label = input.value.trim();
  resetJoinCheck();
  setAlert(byId("join-result"), "", "error");
  if (!label) {
    setAlert(byId("join-result"), t("xknot.needLabel"), "error");
    return;
  }

  setText("join-subdomain-note", t("xknot.checking"));
  try {
    const data = await api(`/xknot/subdomain?label=${encodeURIComponent(label)}`);
    joinHint(Number(data.min) || 6);
    if (data.available) {
      joinState.available = true;
      joinState.label = data.label;
      input.value = data.label;
      const submit = byId("join-submit");
      if (submit) submit.disabled = false;
      setAlert(byId("join-result"), t("xknot.available", { label: data.label }), "ok");
      return;
    }
    const reason = JOIN_REASON_KEYS[data.reason] ? t(`xknot.${JOIN_REASON_KEYS[data.reason]}`) : t("xknot.unavailable");
    const suggestions =
      Array.isArray(data.suggestions) && data.suggestions.length
        ? t("xknot.suggestions", { list: data.suggestions.slice(0, 3).join("、") })
        : "";
    setAlert(byId("join-result"), `${reason}${suggestions}`, "error");
  } catch (error) {
    if (handleAuth(error)) return;
    joinHint();
    setAlert(byId("join-result"), humanError(error), "error");
  }
}

async function submitJoin(event) {
  event.preventDefault();
  if (!joinState.available) {
    setAlert(byId("join-result"), t("xknot.needCheck"), "error");
    return;
  }

  const button = byId("join-submit");
  if (button) button.disabled = true;
  setAlert(byId("join-result"), t("xknot.submitting"), "ok");
  try {
    const data = await api("/xknot/apply", {
      method: "POST",
      body: {
        subdomain: joinState.label,
        email: byId("join-email").value.trim(),
        // 中枢用这一项选邮件语言：跟站点默认语种走。
        locale: state.profile?.site?.locale || "zh-CN",
      },
    });
    const application = data.application || {};
    state.joinApplication = application.id
      ? {
          id: application.id,
          caseUrl: application.caseUrl || "",
          status: application.status || "pending",
          submittedAt: application.createdAt || new Date().toISOString(),
        }
      : null;
    renderJoinRecord();
    const result = byId("join-result");
    const href = safeHref(application.caseUrl);
    result.replaceChildren(
      el("span", {
        text: t("xknot.submitted", { id: application.id || t("xknot.noId") }),
      }),
      href
        ? el("a", {
            href,
            target: "_blank",
            rel: "noopener",
            text: ` · ${t("xknot.viewProgress")}`,
          })
        : null
    );
    result.classList.remove("is-error");
    result.classList.add("is-ok");
    result.hidden = false;
    // 成功之后不允许重复点：同一地址再交一张会被中枢判重。
    // 但按键只是禁用、不隐藏——申请被中枢判拒、或要换名字重交时，重新检查一次就能再提交。
    resetJoinCheck();
    // 公钥在服务端已经顺手交上去了，这里直接开始读进度。
    void loadProgress();
  } catch (error) {
    if (handleAuth(error)) return;
    const message =
      error.code === "incomplete"
        ? t("xknot.incomplete")
        : error.code === "duplicate"
          ? t("xknot.duplicate")
          : humanError(error);
    setAlert(byId("join-result"), message, "error");
    button.disabled = false;
  }
}

function renderIssued(data) {
  const issued = data?.issued || {};
  byId("profile-issued")?.replaceChildren(
    fact(t("xknot.instanceId"), issued.id),
    fact(t("xknot.url"), issued.url),
    fact(t("xknot.since"), issued.since),
    fact(t("xknot.tier"), issued.tier),
    fact(t("xknot.status"), issued.status)
  );
  if (!data) {
    setText("profile-public", t("xknot.reading"));
    return;
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const endpoint = `${origin}/api/federation/profile`;
  setText(
    "profile-public",
    issued.id
      ? t("xknot.publicHas", { endpoint })
      : t("xknot.publicNone", { endpoint })
  );
}

async function saveProfile(event) {
  event.preventDefault();
  const button = byId("profile-save");
  if (button) button.disabled = true;
  setAlert(byId("profile-problems"), "", "error");
  try {
    const data = await api("/profile", { method: "PUT", body: { site: collectProfile() } });
    state.profile = data;
    renderProfile();
    toast(t("xknot.saved"), "ok");
  } catch (error) {
    if (handleAuth(error)) return;
    const problems = Array.isArray(error.problems) ? error.problems : [];
    if (problems.length) setAlert(byId("profile-problems"), problems.join("；"), "error");
    else toast(humanError(error), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

/* 事件绑定 */

// 语种菜单只列这三项，与 ./i18n.js 的 LOCALES 一份来源。
// 登录页与顶栏各一个，都是 select[data-locale-select]。
function paintLocalePicker() {
  for (const select of document.querySelectorAll("select[data-locale-select]")) {
    if (!select.options.length) {
      select.replaceChildren(
        ...LOCALES.map((item) => el("option", { value: item.id, text: item.label }))
      );
    }
    select.value = locale();
  }
}

// 标签页标题不走 data-i18n（<title> 里没有属性可挂），切语种后要单独写一次，
// 否则英文界面下浏览器标签还停在中文。
function paintTitle() {
  document.title = t("topbar.title");
}

// 切语种只换文案：静态标记重刷一次，当前栏按缓存重画，不整页刷新。
function switchLocale(id) {
  if (!setLocale(id)) {
    paintLocalePicker();
    return;
  }
  paintIcons();
  applyI18n();
  paintTitle();
  paintLocalePicker();
  // 档案表单的字段标签不是 data-i18n：单独重建一次，否则它会停在旧语言。
  relabelProfileForm();
  if (state.token) setView(state.view);
}

function bindEvents() {
  for (const select of document.querySelectorAll("select[data-locale-select]")) {
    select.addEventListener("change", (event) => switchLocale(event.target.value));
  }
  on("login-form", "submit", (event) => {
    event.preventDefault();
    enter(byId("token-input").value);
  });
  on("logout-button", "click", () => {
    if (window.confirm(t("login.confirmClear"))) logout(t("login.cleared"));
  });
  on("refresh-button", "click", () => setView(state.view));
  on("site-refresh", "click", () => void loadSite());
  on("overview-refresh", "click", () => loadOverview());
  on("patrol-refresh", "click", () => void loadPatrol());
  on("logs-refresh", "click", () => void loadLogs());
  on("invites-refresh", "click", () => void loadInvites());
  on("sponsors-refresh", "click", () => void loadSponsors());
  on("prices-refresh", "click", () => void loadPrices());
  on("federation-refresh", "click", () => loadXknot());
  on("fed-details", "toggle", (event) => {
    if (event.currentTarget.open) void loadFederation();
  });
  on("profile-form", "submit", saveProfile);
  on("profile-reload", "click", () => renderProfile());
  on("join-check", "click", () => void checkJoinSubdomain());
  on("join-form", "submit", submitJoin);
  on("connect-refresh", "click", () => void loadProgress());
  on("connect-start", "click", () => void startTunnel());
  on("join-subdomain", "input", () => {
    // 查过之后又改了名字，之前的「可用」就不再算数。
    resetJoinCheck();
    setAlert(byId("join-result"), "", "error");
  });
  on("user-clear", "click", () => {
    state.selectedUser = null;
    state.selectedAgent = null;
    state.agentToken = null;
    renderRoster();
    renderUserPanel();
  });
  on("token-copy", "click", () => void copyAgentToken());
  on("token-rotate", "click", () => void rotateAgentToken());
  on("token-value", "focus", (event) => event.currentTarget.select());
  on("identity-form", "submit", submitIdentity);
  on("identity-reset", "click", resetIdentity);
  on("identity-bio", "input", () => {
    updateBioCount();
    setAlert(byId("identity-error"), "", "error");
  });
  on("identity-name", "input", () => setAlert(byId("identity-error"), "", "error"));
  on("identity-specialties", "input", () => setAlert(byId("identity-error"), "", "error"));

  for (const button of document.querySelectorAll(".nav-button")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  for (const button of document.querySelectorAll("[data-go]")) {
    button.addEventListener("click", () => setView(button.dataset.go));
  }

  on("posts-form", "submit", (event) => {
    event.preventDefault();
    loadPosts();
  });
  on("patrol-form", "submit", recordPatrol);

  on("users-form", "submit", (event) => {
    event.preventDefault();
    renderRoster();
  });
  on("users-q", "input", () => renderRoster());
  on("users-refresh", "click", () => loadAccounts());
  on("grant-form", "submit", submitGrant);
  on("warn-form", "submit", submitWarn);
  on("mute-form", "submit", submitMute);
  on("unmute-form", "submit", submitUnmute);
  on("level-form", "submit", submitLevel);
  on("entitlement-form", "submit", submitEntitlements);
  on("issue-form", "submit", submitIssue);

  on("system-form", "submit", saveSystem);
  on("invite-form", "submit", createInvite);
  on("sponsor-form", "submit", saveSponsor);
  on("sponsor-upload", "click", uploadSponsorImage);
  on("sponsor-cancel", "click", resetSponsorForm);
  on("price-propose", "click", proposePrices);
  on("price-apply", "click", applyPrices);
}

async function boot() {
  try {
    bindEvents();
  } catch (error) {
    // 页面标记与脚本不同步时，以前是 boot 抛错、连登录框都不出现，控制台之外没有任何提示。
    console.error(error);
    showLogin(t("error.pageMismatch"));
    return;
  }
  applyI18n();
  paintTitle();
  paintIcons();
  paintLocalePicker();
  renderProfileForm();
  // 两种进来的方式：地址里带一枚一次性票据（从站点「我的」过来），
  // 或者这个浏览器上已经有上次换好的凭据。都没有才显示令牌登录框。
  // 下面那段轮询不在这条分支里：从票据进来的人也要它。
  const claimed = await claimTicket();
  if (!claimed) {
    const saved = savedCredential();
    if (saved) {
      // 凭据可能落在 localStorage（可持久）或 sessionStorage（明文 HTTP 下的退路）。
      const persisted = Boolean(
        localStorage.getItem(CREDENTIAL_KEY) || sessionStorage.getItem(CREDENTIAL_KEY)
      );
      enter(saved, { persist: persisted });
    } else {
      showLogin(ticketFailed ? t("login.ticketExpired") : "");
    }
  }

  // 接通是两边各推进一段：中枢配置完还要等这一侧起隧道。
  // 只在 XKnot 栏打开、且这张单还没上线时轻量轮询，别让它变成一个常驻请求。
  window.setInterval(() => {
    if (!state.token || document.hidden || state.view !== "xknot") return;
    const progress = state.progress;
    if (!progress?.application || progress.run?.state === "active") return;
    void loadProgress({ quiet: true });
  }, 8000);
}

boot();
