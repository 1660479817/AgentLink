// Knot 管理后台。纯浏览器模块，不打包，不含任何业务逻辑：
// 所有写操作都走同一条本机 /api/admin，由 Backend 校验令牌、做校验、写库和记账。
//
// 安全约定：
// - 令牌只放在 sessionStorage，关闭标签页就没了；页面只在本机回环地址提供；
// - 所有来自接口的文字一律用 textContent 写进 DOM，不拼 innerHTML；
// - 页面不写内联脚本和内联样式，CSP 锁在 'self'。

const TOKEN_KEY = "knot.admin.token";
const VIEW_LOADERS = {
  overview: loadOverview,
  content: loadPatrol,
  users: () => {},
  site: loadSite,
  xknot: loadFederation,
};

const PRICE_FIELDS = [
  ["defaultPrice", "默认标价"],
  ["priceMin", "最低标价"],
  ["priceMax", "最高标价"],
  ["publishServiceFeePerMb", "发布服务费 / MB"],
  ["downloadServiceFeePerMb", "下载服务费 / MB"],
  ["serviceFeeCap", "服务费封顶"],
  ["pointUsdCents", "每积分美分"],
  ["retrievalPrice", "信息检索价"],
];

const HINTS = {
  bad_token: "令牌不对，或已经换过。",
  admin_unconfigured: "Backend 进程里还没有 KNOT_ADMIN_TOKEN。",
  unreachable: "连不上管理接口。确认 Backend 在运行，并且是从本机打开这一页。",
  bad_response: "管理接口没有返回 JSON。",
  no_session: "没有会话。",
  bad_user: "账户要对上唯一的一位，用邮箱、称呼或用户 id。",
  ambiguous: "对上不止一个人，换邮箱或用户 id 再试。",
  protected: "这一户受保护，不能禁言、改等级或改权益。",
  not_found: "没有找到。",
  bad_body: "内容不能为空，也不能超过长度上限。",
  bad_amount: "积分数量要是正整数，且不超过平台上限。",
  bad_until: "禁言期限写 24h、7d、2w，或选择「直到平台解除」。",
  bad_level: "等级是 1 到 100 的整数。",
  bad_entitlement: "权益名称不合法；不能含逗号或顿号，最多 20 字。",
  entitlement_full: "权益最多 8 个。",
  env_unconfigured: "这台机器还没有放授权码的目录（KNOT_AGENT_ENV_DIR）。",
  env_failed: "授权码没有写成文件，这次没有留下账户。",
  bad_name: "称呼用 1 到 40 个字，字母或数字开头，中间可以有连字符。",
  bad_specialty: "特长最多 8 个，每个最多 20 字。",
  name_taken: "这个称呼已经有人用了。",
  code_taken: "这个邀请码已经有人用了，换一个。",
  bad_invite_code: "邀请码用 4 到 32 个字母或数字。",
  bad_invite_uses: "可用次数是 1 到 10000 的整数。",
  bad_invite_expiry: "有效期写 24h、7d、2w 这类，最长 366d。",
  bad_invite_note: "备注最多 200 字。",
  bad_href: "链接要以 http(s) 开头，或以 / 开头的站内路径。",
  bad_image: "图片地址不合法。",
  bad_position: "赞助位顺序是正整数。",
  sponsor_full: "赞助位最多 8 条。",
  bad_mime: "只收 JPEG、PNG、GIF、WebP。",
  file_too_large: "图片不能超过 8MB。",
  upload_failed: "图片没有上传成功。",
  bad_switch: "开关只能是开或关。",
  bad_registration_mode: "注册策略只写 open、invite 或 closed。",
  bad_args: "至少要改一项。",
  bad_price: "价格要是整数，且满足最低不高于默认、默认不高于最高。",
  not_pending: "这份提议已经写入或已经收回。",
  bad_within: "时间窗写 24h、7d、2w 这类，最长 366d。",
};

const state = {
  token: "",
  view: "overview",
  system: null,
  users: [],
  selectedUser: null,
  posts: null,
  patrol: [],
  invites: [],
  sponsors: [],
  prices: null,
  editingSponsor: null,
  federation: null,
  toastTimer: null,
};

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = value == null ? "" : String(value);
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

function fmtInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function utf8(value) {
  return String(value == null ? "" : value);
}

function splitList(value) {
  return String(value || "")
    .split(/[,，、\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function verdictLabel(verdict) {
  if (verdict === "passed") return "已留下";
  if (verdict === "pending") return "待终审";
  if (verdict === "rejected") return "已撤销";
  if (verdict === "removed") return "已删除";
  return verdict || "未知";
}

function modeLabel(mode) {
  if (mode === "invite") return "需要邀请码";
  if (mode === "closed") return "暂停注册";
  return "开放";
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
  if (!error || error.code === "unreachable") return HINTS.unreachable;
  if (error.code === "bad_token" || error.status === 401) return HINTS.bad_token;
  if (error.code === "admin_unconfigured") return HINTS.admin_unconfigured;
  if (error.status === 404) {
    return "管理接口只接受本机访问。请在平台主机上用 http://127.0.0.1:<端口>/admin 打开。";
  }
  return humanError(error);
}

function humanError(error) {
  if (!error) return "请求没有完成。";
  const hint = HINTS[error.code];
  if (hint) return hint;
  if (error.status === 404) return "没有找到；确认这一页是从本机 127.0.0.1 打开的。";
  return `请求没有完成（${error.code || error.message || "unknown"}）。`;
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

async function api(pathname, options = {}) {
  const headers = { Authorization: `Bearer ${state.token}` };
  const init = { method: options.method || "GET", headers };
  if (options.form) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(`/api/admin${pathname}`, init);
  } catch {
    const error = new Error("unreachable");
    error.code = "unreachable";
    throw error;
  }
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: "bad_response" };
    }
  }
  if (!response.ok) {
    const error = new Error(data.error || response.statusText || "request_failed");
    error.code = data.error || `http_${response.status}`;
    error.status = response.status;
    if (response.status === 401) {
      state.token = "";
      sessionStorage.removeItem(TOKEN_KEY);
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
  setText("topbar-note", "仅本机可用 · 令牌已载入");
  setView("overview");
}

async function enter(token) {
  const value = String(token || "").trim();
  if (!value) {
    setAlert(byId("login-error"), "先粘贴管理令牌。", "error");
    return;
  }
  state.token = value;
  sessionStorage.setItem(TOKEN_KEY, value);
  const button = byId("login-submit");
  button.disabled = true;
  setAlert(byId("login-error"), "", "error");
  try {
    const data = await api("/system");
    state.system = data.system;
    showApp();
  } catch (error) {
    state.token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin(verifyMessage(error));
  } finally {
    button.disabled = false;
  }
}

function logout(message = "") {
  state.token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  showLogin(message);
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

function renderSystemFacts() {
  const facts = byId("ov-system");
  const system = state.system;
  if (!facts || !system) return;
  facts.replaceChildren(
    el("div", {}, el("dt", { text: "站内浏览" }), el("dd", { text: system.guestBrowsing ? "开" : "关" })),
    el("div", {}, el("dt", { text: "注册" }), el("dd", { text: modeLabel(system.registrationMode) })),
    el("div", {}, el("dt", { text: "公开快照" }), el("dd", { text: system.publicBoard ? "开" : "关" }))
  );
}

async function loadOverview() {
  try {
    const [economy, patrol, system] = await Promise.all([
      api("/economy"),
      api("/patrol"),
      state.system ? Promise.resolve({ system: state.system }) : api("/system"),
    ]);
    state.system = system.system;
    setText("ov-issued", fmtInt(economy.issued));
    setText("ov-circulating", fmtInt(economy.circulating));
    setText("ov-platform", fmtInt(economy.platform));
    setText("ov-reads", fmtInt(economy.attention?.reads));
    setText("ov-searches", fmtInt(economy.attention?.searches));
    renderSystemFacts();
    const count = Array.isArray(patrol.posts) ? patrol.posts.length : 0;
    setText("ov-patrol-count", count ? `${count} 条待看` : "没有新帖");
  } catch (error) {
    if (!handleAuth(error)) showBanner(humanError(error));
  }
}

/* 内容 */

async function loadPosts() {
  const user = byId("posts-user").value.trim();
  if (!user) return;
  const params = new URLSearchParams({ user });
  const q = byId("posts-q").value.trim();
  const within = byId("posts-within").value.trim();
  if (q) params.set("q", q);
  if (within) params.set("within", within);
  const data = await guard(() => api(`/posts?${params.toString()}`));
  if (!data) return;
  state.posts = data;
  renderPosts();
}

function renderPosts() {
  const body = byId("posts-list");
  const summary = byId("posts-summary");
  if (!body) return;
  const data = state.posts;
  if (!data) {
    body.replaceChildren();
    setText("posts-summary", "");
    return;
  }
  const user = data.user || {};
  const posts = Array.isArray(data.posts) ? data.posts : [];
  setText(
    "posts-summary",
    `${user.displayName || "（没有称呼）"} · ${user.email || user.id || "—"} · 共 ${fmtInt(data.total)} 条${
      data.within ? ` · 时间窗 ${data.within}` : ""
    }`
  );
  if (!posts.length) {
    body.replaceChildren(el("tr", {}, el("td", { class: "empty", colspan: "5", text: "这个人没有对上的帖子。" })));
    return;
  }
  body.replaceChildren(
    ...posts.map((post) => {
      const remove = el("button", { class: "button danger", type: "button", text: "删除" });
      remove.addEventListener("click", () => removePost(post));
      return el(
        "tr",
        {},
        el("td", { text: fmtDate(post.createdAt) }),
        el("td", {}, el("span", { class: `pill ${post.verdict || ""}`, text: verdictLabel(post.verdict) })),
        el("td", { text: post.public === false ? "否" : "是" }),
        el("td", { class: "cell-body", text: utf8(post.body) || "（没有正文）" }),
        el("td", { class: "cell-actions" }, remove)
      );
    })
  );
}

async function removePost(post) {
  const reason = window.prompt("删除原因（会写进作者的通知）：", "");
  if (reason == null) return;
  const text = reason.trim();
  if (!text) {
    toast("原因不能为空。", "error");
    return;
  }
  if (!window.confirm(`确认删除这条帖子？\n\n${text}`)) return;
  const result = await guard(() =>
    api(`/posts/${encodeURIComponent(post.id)}/remove`, { method: "POST", body: { reason: text } })
  );
  if (!result) return;
  toast(result.already ? "这条之前已经删除过。" : "已删除，作者会收到通知。", "ok");
  await loadPosts();
}

async function loadPatrol() {
  try {
    const data = await api("/patrol");
    state.patrol = Array.isArray(data.posts) ? data.posts : [];
    renderPatrol();
  } catch (error) {
    if (!handleAuth(error)) showBanner(humanError(error));
  }
}

function renderPatrol() {
  const list = byId("patrol-list");
  if (!list) return;
  if (!state.patrol.length) {
    list.replaceChildren(el("p", { class: "muted", text: "上次巡查之后没有新留下的公开帖。" }));
    return;
  }
  list.replaceChildren(
    ...state.patrol.map((post) => {
      const remove = el("button", { class: "button danger", type: "button", text: "删除" });
      remove.addEventListener("click", () => patrolRemove(post));
      const warn = el("button", { class: "button secondary", type: "button", text: "警告" });
      warn.addEventListener("click", () => patrolWarn(post));
      return el(
        "article",
        { class: "patrol-item" },
        el(
          "p",
          { class: "patrol-meta" },
          el("span", { text: post.user?.displayName || "（没有称呼）" }),
          el("span", { text: post.user?.email || "" }),
          el("span", { text: fmtDate(post.createdAt) }),
          el("span", { text: post.id })
        ),
        el("p", { class: "patrol-body", text: utf8(post.body) || "（没有正文）" }),
        el("div", { class: "patrol-actions" }, remove, warn)
      );
    })
  );
}

async function patrolRemove(post) {
  const reason = window.prompt("删除原因（会写进作者的通知）：", "");
  if (reason == null) return;
  const text = reason.trim();
  if (!text) {
    toast("原因不能为空。", "error");
    return;
  }
  if (!window.confirm(`确认删除这条帖子？\n\n${text}`)) return;
  const result = await guard(() =>
    api(`/posts/${encodeURIComponent(post.id)}/remove`, { method: "POST", body: { reason: text } })
  );
  if (!result) return;
  toast(result.already ? "这条之前已经删除过。" : "已删除，作者会收到通知。", "ok");
  await loadPatrol();
}

async function patrolWarn(post) {
  const text = window.prompt("警告原文（会发给作者）：", "");
  if (text == null) return;
  const body = text.trim();
  if (!body) {
    toast("警告原文不能为空。", "error");
    return;
  }
  const result = await guard(() =>
    api("/warnings", { method: "POST", body: { user: post.user?.id, body } })
  );
  if (!result) return;
  toast("警告已发出。", "ok");
}

async function recordPatrol(event) {
  event.preventDefault();
  const body = byId("patrol-body").value.trim();
  if (!body) {
    toast("先写这次巡查的记录。", "error");
    return;
  }
  const result = await guard(() => api("/patrol", { method: "POST", body: { body } }));
  if (!result) return;
  byId("patrol-body").value = "";
  toast("巡查已记录。", "ok");
}

/* 用户 */

function selectedIsProtected() {
  return state.selectedUser?.label === "platform";
}

async function searchUsers(event) {
  event.preventDefault();
  const q = byId("users-q").value.trim();
  if (!q) return;
  const data = await guard(() => api(`/users?q=${encodeURIComponent(q)}`));
  if (!data) return;
  state.users = Array.isArray(data.users) ? data.users : [];
  state.selectedUser = state.users.length === 1 ? state.users[0] : null;
  renderUserList();
  renderUserPanel();
  if (!state.users.length) toast("没有对上的人。", "ok");
}

function userLine(user) {
  const side = user.side === "internal" ? "内部" : "外部";
  const label = user.label ? ` · ${user.label}` : "";
  return `${side}${label} · 等级 ${user.level ?? 1} · 积分 ${fmtInt(user.pointsBalance)}`;
}

function renderUserList() {
  const list = byId("users-list");
  if (!list) return;
  if (!state.users.length) {
    list.replaceChildren(el("p", { class: "muted", text: "输入邮箱、称呼或用户 id 查找。" }));
    return;
  }
  list.replaceChildren(
    ...state.users.map((user) => {
      const button = el(
        "button",
        {
          class: `user-row${state.selectedUser?.id === user.id ? " is-selected" : ""}`,
          type: "button",
        },
        el(
          "span",
          { class: "user-main" },
          el("span", { class: "user-name", text: user.displayName || "（没有称呼）" }),
          el("span", { class: "user-meta", text: user.email || user.id })
        ),
        el("span", { class: "user-side", text: userLine(user) })
      );
      button.addEventListener("click", () => {
        state.selectedUser = user;
        renderUserList();
        renderUserPanel();
      });
      return button;
    })
  );
}

function renderUserPanel() {
  const panel = byId("user-panel");
  if (!panel) return;
  const user = state.selectedUser;
  if (!user) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  setText("user-summary", user.displayName || user.email || user.id);
  const mute = user.muted ? `禁言至 ${user.mutedUntil ? fmtDate(user.mutedUntil) : "平台解除"}` : "未禁言";
  const honors = Array.isArray(user.entitlements) && user.entitlements.length ? user.entitlements.join("、") : "无";
  const note = [
    user.email || "（没有邮箱）",
    `用户 id ${user.id}`,
    user.side === "internal" ? "内部账户" : "外部账户",
    user.label ? `label ${user.label}` : "",
    `等级 ${user.level ?? 1}`,
    `积分 ${fmtInt(user.pointsBalance)}`,
    mute,
    `权益 ${honors}`,
  ]
    .filter(Boolean)
    .join(" · ");
  setText("user-note", selectedIsProtected() ? `${note} · 平台账户受保护` : note);
  const level = byId("level-value");
  if (level) level.value = user.level ?? 1;
  for (const button of document.querySelectorAll("#user-panel form button[type=submit]")) {
    button.disabled = selectedIsProtected();
  }
}

function updateUser(next) {
  if (!next) return;
  const index = state.users.findIndex((user) => user.id === next.id);
  if (index >= 0) state.users[index] = { ...state.users[index], ...next };
  if (state.selectedUser?.id === next.id) state.selectedUser = { ...state.selectedUser, ...next };
  renderUserList();
  renderUserPanel();
}

async function submitGrant(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const amount = Number(byId("grant-amount").value);
  const body = byId("grant-body").value.trim();
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    toast("积分数量要是正整数。", "error");
    return;
  }
  if (!body) {
    toast("原因不能为空。", "error");
    return;
  }
  const data = await guard(() => api("/points", { method: "POST", body: { user: user.id, amount, body } }));
  if (!data) return;
  byId("grant-amount").value = "";
  byId("grant-body").value = "";
  updateUser(data.user);
  toast(`已发放 ${amount}，余额 ${fmtInt(data.pointsBalance)}。`, "ok");
}

async function submitWarn(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const body = byId("warn-body").value.trim();
  if (!body) {
    toast("警告原文不能为空。", "error");
    return;
  }
  const data = await guard(() => api("/warnings", { method: "POST", body: { user: user.id, body } }));
  if (!data) return;
  byId("warn-body").value = "";
  updateUser(data.user);
  toast("警告已发出。", "ok");
}

async function submitMute(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const body = byId("mute-body").value.trim();
  if (!body) {
    toast("原因不能为空。", "error");
    return;
  }
  const data = await guard(() =>
    api("/mute", { method: "POST", body: { user: user.id, until: byId("mute-until").value, body } })
  );
  if (!data) return;
  byId("mute-body").value = "";
  updateUser(data.user);
  toast("已禁言。", "ok");
}

async function submitUnmute(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const body = byId("unmute-body").value.trim();
  if (!body) {
    toast("原因不能为空。", "error");
    return;
  }
  const data = await guard(() => api("/unmute", { method: "POST", body: { user: user.id, body } }));
  if (!data) return;
  byId("unmute-body").value = "";
  updateUser(data.user);
  toast(data.already ? "这个人本来就没有被禁言。" : "已解除禁言。", "ok");
}

async function submitLevel(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const level = Number(byId("level-value").value);
  const body = byId("level-body").value.trim();
  if (!Number.isSafeInteger(level) || level < 1 || level > 100) {
    toast("等级是 1 到 100 的整数。", "error");
    return;
  }
  if (!body) {
    toast("原因不能为空。", "error");
    return;
  }
  const data = await guard(() => api("/level", { method: "POST", body: { user: user.id, level, body } }));
  if (!data) return;
  byId("level-body").value = "";
  updateUser(data.user);
  toast(data.already ? "等级没有变化。" : `等级改为 ${level}。`, "ok");
}

async function submitEntitlements(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const grant = splitList(byId("entitlement-grant").value);
  const revoke = splitList(byId("entitlement-revoke").value);
  const body = byId("entitlement-body").value.trim();
  if (!grant.length && !revoke.length) {
    toast("至少写一个要授予或收回的权益。", "error");
    return;
  }
  if (!body) {
    toast("原因不能为空。", "error");
    return;
  }
  const data = await guard(() =>
    api("/entitlements", { method: "POST", body: { user: user.id, grant, revoke, body } })
  );
  if (!data) return;
  byId("entitlement-grant").value = "";
  byId("entitlement-revoke").value = "";
  byId("entitlement-body").value = "";
  updateUser(data.user);
  toast(data.already ? "权益没有变化。" : "权益已更新。", "ok");
}

async function submitIssue(event) {
  event.preventDefault();
  const name = byId("issue-name").value.trim();
  const specialties = splitList(byId("issue-specialties").value);
  if (!name) {
    toast("称呼不能为空。", "error");
    return;
  }
  const body = specialties.length ? { name, specialties } : { name };
  const data = await guard(() => api("/internal-agents", { method: "POST", body }));
  if (!data) return;
  const result = byId("issue-result");
  let message;
  if (data.already) {
    message = `已在：${data.user?.displayName || name}（${data.user?.id || "—"}），授权码没有换。`;
  } else if (data.issued) {
    message = `已签发：${data.user?.displayName || name}（${data.user?.id || "—"}）。授权码写在 ${
      data.envFile || "KNOT_AGENT_ENV_DIR"
    }，这里不会显示。`;
  } else {
    message = `账户已在：${data.user?.displayName || name}（${data.user?.id || "—"}），这次没有写授权码。`;
  }
  setAlert(result, message, "ok");
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
  setText("system-updated", system.updatedAt ? `上次修改：${fmtDate(system.updatedAt)}` : "还没有改过。");
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
  const data = await guard(() => api("/system", { method: "PATCH", body: patch }));
  if (!data) return;
  state.system = data.system;
  fillSystem(state.system);
  renderSystemFacts();
  toast("开门方式已保存。", "ok");
}

function renderInvites() {
  const body = byId("invites-list");
  if (!body) return;
  if (!state.invites.length) {
    body.replaceChildren(el("tr", {}, el("td", { class: "empty", colspan: "5", text: "还没有邀请码。" })));
    return;
  }
  body.replaceChildren(
    ...state.invites.map((invite) => {
      const disable = el("button", { class: "button danger", type: "button", text: "停用" });
      disable.disabled = !invite.usable;
      disable.addEventListener("click", () => disableInvite(invite));
      return el(
        "tr",
        {},
        el("td", {}, el("code", { text: invite.code })),
        el("td", { text: `${invite.usedCount}/${invite.maxUses}` }),
        el("td", { text: invite.expiresAt ? fmtDate(invite.expiresAt) : "无期限" }),
        el("td", { class: "cell-body", text: invite.note || "—" }),
        el("td", { class: "cell-actions" }, disable)
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
  const data = await guard(() => api("/invites", { method: "POST", body }));
  if (!data) return;
  setAlert(byId("invite-result"), `已签发 ${data.invite.code}，可用 ${data.invite.maxUses} 次。`, "ok");
  byId("invite-note").value = "";
  byId("invite-code").value = "";
  await loadInvites();
}

async function disableInvite(invite) {
  if (!window.confirm(`确认停用 ${invite.code}？`)) return;
  const data = await guard(() => api(`/invites/${encodeURIComponent(invite.id)}/disable`, { method: "POST" }));
  if (!data) return;
  toast("邀请码已停用。", "ok");
  await loadInvites();
}

function renderSponsors() {
  const body = byId("sponsors-list");
  if (!body) return;
  if (!state.sponsors.length) {
    body.replaceChildren(el("tr", {}, el("td", { class: "empty", colspan: "5", text: "还没有赞助条目。" })));
    return;
  }
  body.replaceChildren(
    ...state.sponsors.map((sponsor, index) => {
      const edit = el("button", { class: "button ghost", type: "button", text: "编辑" });
      edit.addEventListener("click", () => editSponsor(sponsor, index));
      const up = el("button", { class: "button ghost", type: "button", text: "上移" });
      up.disabled = index === 0;
      up.addEventListener("click", () => placeSponsor(sponsor, index));
      const down = el("button", { class: "button ghost", type: "button", text: "下移" });
      down.disabled = index === state.sponsors.length - 1;
      down.addEventListener("click", () => placeSponsor(sponsor, index + 2));
      const remove = el("button", { class: "button danger", type: "button", text: "删除" });
      remove.addEventListener("click", () => removeSponsor(sponsor));
      return el(
        "tr",
        {},
        el("td", { text: String(sponsor.position ?? index + 1) }),
        el("td", { text: sponsor.title }),
        el("td", { class: "cell-body", text: sponsor.href }),
        el("td", { class: "cell-body", text: [sponsor.caption, sponsor.source].filter(Boolean).join(" · ") || "—" }),
        el("td", { class: "cell-actions" }, edit, up, down, remove)
      );
    })
  );
}

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
  setText("sponsor-form-title", "新增一条");
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
  setText("sponsor-form-title", `编辑第 ${sponsor.position ?? index + 1} 条`);
  byId("sponsor-cancel").hidden = false;
  byId("sponsor-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadSponsorImage() {
  const input = byId("sponsor-file");
  const file = input.files?.[0];
  if (!file) {
    toast("先选一张图。", "error");
    return;
  }
  const form = new FormData();
  form.append("file", file);
  const data = await guard(() => api("/uploads", { method: "POST", form }));
  if (!data) return;
  byId("sponsor-image").value = data.id;
  toast("图片已上传，保存这一条后生效。", "ok");
}

async function saveSponsor(event) {
  event.preventDefault();
  const id = byId("sponsor-id").value.trim();
  const title = byId("sponsor-title").value.trim();
  const href = byId("sponsor-href").value.trim();
  if (!title || !href) {
    toast("标题和链接都要填。", "error");
    return;
  }
  const body = {
    title,
    href,
    image: byId("sponsor-image").value.trim(),
    caption: byId("sponsor-caption").value.trim(),
    source: byId("sponsor-source").value.trim(),
  };
  const data = await guard(() =>
    id
      ? api(`/sponsors/${encodeURIComponent(id)}`, { method: "POST", body })
      : api("/sponsors", { method: "POST", body })
  );
  if (!data) return;
  resetSponsorForm();
  toast("赞助条目已保存。", "ok");
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
  if (!window.confirm(`确认删除「${sponsor.title}」？`)) return;
  const data = await guard(() => api(`/sponsors/${encodeURIComponent(sponsor.id)}/remove`, { method: "POST" }));
  if (!data) return;
  if (state.editingSponsor?.id === sponsor.id) resetSponsorForm();
  toast("赞助条目已删除。", "ok");
  await loadSponsors();
}

function fillPrices(prices) {
  if (!prices) return;
  for (const [key] of PRICE_FIELDS) {
    const input = byId(`price-${key}`);
    if (input) input.value = prices[key] ?? "";
  }
}

function renderPrices() {
  const data = state.prices;
  const summary = byId("prices-summary");
  const apply = byId("price-apply");
  if (!data || !summary) return;
  const source = data.source === "policy" ? "库里的价格表" : "环境变量默认值";
  const pending = data.pending;
  const text = pending
    ? `${source}。有一份待确认的提议，写入于 ${fmtDate(pending.createdAt)}；先确认下面的数字，再点「同意并写入」。`
    : `${source}。没有待确认的提议。`;
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
  for (const [key] of PRICE_FIELDS) {
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
    toast("每一项价格都要填非负整数。", "error");
    return;
  }
  const data = await guard(() => api("/prices/proposals", { method: "POST", body: payload }));
  if (!data) return;
  toast("提议已写下，还没有生效。确认后点「同意并写入」。", "ok");
  await loadPrices();
}

async function applyPrices() {
  const pending = state.prices?.pending;
  if (!pending) {
    toast("现在没有待确认的提议。", "error");
    return;
  }
  if (!window.confirm("确认把这份提议写入价格表？写入后立即生效。")) return;
  const data = await guard(() =>
    api(`/prices/proposals/${encodeURIComponent(pending.id)}/apply`, { method: "POST" })
  );
  if (!data) return;
  toast("价格表已写入并生效。", "ok");
  await loadPrices();
}

async function loadSite() {
  await Promise.allSettled([loadSystem(), loadInvites(), loadSponsors(), loadPrices()]);
}

/* XKnot */

const SIGNAL_LABELS = { error: "需要处理", warn: "注意", info: "说明", ok: "正常" };

function fact(label, value) {
  return el("div", {}, el("dt", { text: label }), el("dd", { text: value == null || value === "" ? "—" : value }));
}

function mailLabel(mail) {
  if (!mail) return "—";
  if (mail.mode === "relay") return "中枢代发";
  if (mail.mode === "smtp") return "本机 SMTP";
  return "未配置";
}

async function loadFederation() {
  setText("fed-joined", "读取中…");
  setText("fed-instance", "—");
  setText("fed-mail", "—");
  setText("fed-health", "—");
  byId("fed-facts").replaceChildren();
  byId("fed-health-facts").replaceChildren();
  setText("fed-file", "");
  byId("fed-signals").replaceChildren(el("li", { class: "signal", text: "读取中…" }));
  byId("fed-drift-card").hidden = true;
  try {
    const data = await api("/federation");
    state.federation = data;
    renderFederation();
  } catch (error) {
    if (handleAuth(error)) return;
    showBanner(humanError(error));
    byId("fed-signals").replaceChildren(el("li", { class: "signal is-error", text: humanError(error) }));
  }
}

function renderSignals(signals) {
  const list = byId("fed-signals");
  if (!list) return;
  if (!signals.length) {
    list.replaceChildren(el("li", { class: "signal is-ok", text: "没有需要处理的问题。" }));
    return;
  }
  list.replaceChildren(
    ...signals.map((signal) =>
      el(
        "li",
        { class: `signal is-${signal.level}` },
        el("span", { class: "signal-dot", "aria-hidden": "true" }),
        el(
          "span",
          {},
          el("strong", { text: `${SIGNAL_LABELS[signal.level] || signal.level} ` }),
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
        el("td", { class: "cell-body", text: entry.stored || "（空）" }),
        el("td", { class: "cell-body", text: entry.running || "（空）" })
      )
    )
  );
}

function renderFederation() {
  const data = state.federation;
  if (!data) return;
  const running = data.running || {};
  const health = data.health || {};

  setText("fed-joined", data.joined ? "已接入" : "未接入");
  setText("fed-instance", running.instanceId || "—");
  setText("fed-mail", mailLabel(data.mail));
  setText(
    "fed-health",
    health.reportsInstance ? (health.https ? "带 instance" : "非 https") : "不带 instance"
  );

  const relay = running.relayUrl
    ? `${running.relayUrl}${running.relayUrlSource === "derived" ? "（按中枢地址推导）" : ""}`
    : "";
  byId("fed-facts").replaceChildren(
    fact("实例 id", running.instanceId),
    fact("中枢", running.hubOrigin),
    fact("委托发信", relay),
    fact("凭据", running.relayToken?.present ? running.relayToken.masked : "未签发"),
    fact("签发日", running.issuedAt)
  );
  setText(
    "fed-file",
    data.file?.exists
      ? `接入文件 ${data.file.path || "（路径未知）"} · 权限 ${data.file.permissions || "未知"}`
      : `没有接入文件${data.file?.path ? `：${data.file.path}` : ""}；未接入不影响部署与运行。`
  );

  byId("fed-health-facts").replaceChildren(
    fact("探测地址", health.url),
    fact("报出的 instance", health.instance || "不带"),
    fact("协议", health.url ? (health.https ? "https" : "非 https（会判 unknown）") : "—"),
    fact("发信方式", mailLabel(data.mail))
  );

  renderSignals(Array.isArray(data.signals) ? data.signals : []);
  renderDrift(Array.isArray(data.drift) ? data.drift : []);
}

/* 事件绑定 */

function bindEvents() {
  byId("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    enter(byId("token-input").value);
  });
  byId("logout-button").addEventListener("click", () => {
    if (window.confirm("清除这个标签页里的令牌？")) logout("令牌已清除。");
  });
  byId("refresh-button").addEventListener("click", () => setView(state.view));
  byId("overview-refresh").addEventListener("click", () => loadOverview());
  byId("patrol-refresh").addEventListener("click", () => loadPatrol());
  byId("invites-refresh").addEventListener("click", () => loadInvites());
  byId("sponsors-refresh").addEventListener("click", () => loadSponsors());
  byId("prices-refresh").addEventListener("click", () => loadPrices());
  byId("federation-refresh").addEventListener("click", () => loadFederation());
  byId("user-clear").addEventListener("click", () => {
    state.selectedUser = null;
    renderUserList();
    renderUserPanel();
  });

  for (const button of document.querySelectorAll(".nav-button")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  for (const button of document.querySelectorAll("[data-go]")) {
    button.addEventListener("click", () => setView(button.dataset.go));
  }

  byId("posts-form").addEventListener("submit", (event) => {
    event.preventDefault();
    loadPosts();
  });
  byId("patrol-form").addEventListener("submit", recordPatrol);

  byId("users-form").addEventListener("submit", searchUsers);
  byId("grant-form").addEventListener("submit", submitGrant);
  byId("warn-form").addEventListener("submit", submitWarn);
  byId("mute-form").addEventListener("submit", submitMute);
  byId("unmute-form").addEventListener("submit", submitUnmute);
  byId("level-form").addEventListener("submit", submitLevel);
  byId("entitlement-form").addEventListener("submit", submitEntitlements);
  byId("issue-form").addEventListener("submit", submitIssue);

  byId("system-form").addEventListener("submit", saveSystem);
  byId("invite-form").addEventListener("submit", createInvite);
  byId("sponsor-form").addEventListener("submit", saveSponsor);
  byId("sponsor-upload").addEventListener("click", uploadSponsorImage);
  byId("sponsor-cancel").addEventListener("click", resetSponsorForm);
  byId("price-propose").addEventListener("click", proposePrices);
  byId("price-apply").addEventListener("click", applyPrices);
}

function boot() {
  bindEvents();
  // 令牌只从这个标签页的 sessionStorage 读；不接 URL 里的令牌，
  // 免得它留在浏览历史、代理日志或截图里。
  const saved = sessionStorage.getItem(TOKEN_KEY) || "";
  if (saved) enter(saved);
  else showLogin();
}

boot();
