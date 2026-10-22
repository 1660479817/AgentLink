import { defineStore } from "pinia";
import { DEFAULT_SITE_LOCALE, isLocale } from "@knot/locale";
import { confirmLoginKey, endSession, getAgent, getSession, requestLoginKey } from "../api.js";
import { browserStorage, cachedBrand, cachedSite, readBoardCache } from "../boardCache.js";

const INITIAL_POLICY = {
  defaultPrice: 10,
  priceMin: 0,
  priceMax: 100,
  publishServiceFeePerMb: 1,
  downloadServiceFeePerMb: 1,
  serviceFeeCap: 10,
};

// 后端还没回话时按最保守的开关：未登录停在登录/注册页，快照不读。
const INITIAL_SITE = {
  guestBrowsing: false,
  registrationMode: "open",
  publicBoard: false,
};

// 站点身份来自 sites/<站点>/profile.json（主理人在 /admin 里编辑）。
// v2 起是十项扁平字段，没有多语种文案映射：填什么就显示什么。`locale` 是站点默认界面语言。
const INITIAL_BRAND = {
  name: null,
  tagline: null,
  logo: "",
  // 主理人（owner）：具体负责这个站点的人。没填时弹窗只显示站点信息。
  owner: null,
  intro: null,
  contact: "",
};

// Agent 指引的地址。后端按 KNOT_HUB_ORIGIN 给出，这里只是首帧的默认值：
// 文档在联邦中枢，不在本实例，所以不能拿 location.origin 拼。
const INITIAL_AGENT_DOC = {
  page: "https://xknot.si/knot-help",
  raw: "https://xknot.si/knot-help.md",
};

let loading = null;

// 上一份公开快照里已经带着站点开关与身份，够首帧用了。
// 有它就不必为了画第一屏先穿一次隧道；没有时才等 /api/web/session。
const cachedBoard = readBoardCache(browserStorage());
const cachedSitePolicy = cachedSite(cachedBoard);
const cachedBrandInfo = cachedBrand(cachedBoard);
const cachedLocale = isLocale(cachedBoard?.locale) ? cachedBoard.locale : null;

function initialSite() {
  return { ...INITIAL_SITE, ...(cachedSitePolicy || {}) };
}

function initialBrand() {
  return { ...INITIAL_BRAND, ...(cachedBrandInfo || {}) };
}

// 站点关掉访客浏览时不能拿快照先画：那会把本该停在登录页的人放进站内。
const cachedReady = Boolean(cachedSitePolicy) && cachedSitePolicy.guestBrowsing !== false;

export const useSessionStore = defineStore("session", {
  state: () => ({
    user: null,
    // 会话接口有没有真的回话过。快照能让页面先画，但不能假装知道登录的人是谁。
    userKnown: false,
    policy: { ...INITIAL_POLICY },
    site: initialSite(),
    brand: initialBrand(),
    ready: cachedReady,
    // 会话接口没回话时记一笔：未登录访客此时拿不到站点开关，
    // 页面要说明「连不上」，不能只是把入口藏起来。
    failed: false,
    // 站点默认界面语言，来自 sites/<站点>/profile.json 的 locale（主理人在 /admin 里设）。
    defaultLocale: cachedLocale || DEFAULT_SITE_LOCALE,
    // Agent 指引住在联邦中枢，地址由 Backend 给（KNOT_HUB_ORIGIN）。首帧先用联邦入口那份。
    agentDoc: { ...INITIAL_AGENT_DOC },
    agentDelegated: null,
  }),
  getters: {
    // 未登录能不能进站内。登录的人永远可以；访客看系统开关。
    canBrowse: (state) => Boolean(state.user) || state.site.guestBrowsing,
    // 站点名：主理人填的原文，没填时回落到默认名。
    brandName: (state) => String(state.brand?.name || "").trim() || "Knot",
    // 一句话介绍，弹窗和登录卡用。
    brandTagline: (state) => String(state.brand?.tagline || "").trim(),
    // 站点自己的 logo。没配就留空，由界面退回站点名首字。
    siteLogo: (state) => String(state.brand?.logo || "").trim(),
    // 主理人：名字、站点长介绍、联系方式，三项都可能为空，界面按项显示。
    owner: (state) => ({
      name: String(state.brand?.owner || "").trim(),
      note: String(state.brand?.intro || "").trim(),
      contact: String(state.brand?.contact || "").trim(),
    }),
  },
  actions: {
    load() {
      if (loading) return loading;
      loading = (async () => {
        try {
          const data = await getSession();
          this.user = data.user;
          if (data.policy) this.policy = data.policy;
          if (data.site && typeof data.site === "object") this.site = { ...INITIAL_SITE, ...data.site };
          if (data.brand && typeof data.brand === "object") this.brand = { ...INITIAL_BRAND, ...data.brand };
          if (typeof data.defaultLocale === "string" && data.defaultLocale) this.defaultLocale = data.defaultLocale;
          if (data.agentDoc && typeof data.agentDoc === "object") this.agentDoc = { ...INITIAL_AGENT_DOC, ...data.agentDoc };
          // Agent 是否开通随会话一起回来，不再为这一项单独发一次请求。
          if (typeof data.agentDelegated === "boolean") this.agentDelegated = data.agentDelegated;
          this.failed = false;
        } catch {
          this.user = null;
          this.site = { ...INITIAL_SITE };
          this.agentDelegated = null;
          this.failed = true;
        } finally {
          this.userKnown = true;
          this.ready = true;
          loading = null;
        }
      })();
      return loading;
    },
    // `/api/web/home` 一次带回会话、Agent、未读数和公开快照上的个人状态。
    // 首屏已经画了快照，所以这里晚到也没关系。
    applyHome(data) {
      if (!data || typeof data !== "object") return;
      this.user = data.user ?? null;
      if (data.policy) this.policy = data.policy;
      if (data.site && typeof data.site === "object") this.site = { ...INITIAL_SITE, ...data.site };
      if (data.brand && typeof data.brand === "object") this.brand = { ...INITIAL_BRAND, ...data.brand };
      if (typeof data.defaultLocale === "string" && data.defaultLocale) this.defaultLocale = data.defaultLocale;
      if (data.agentDoc && typeof data.agentDoc === "object") this.agentDoc = { ...INITIAL_AGENT_DOC, ...data.agentDoc };
      if (typeof data.agentDelegated === "boolean") this.agentDelegated = data.agentDelegated;
      this.failed = false;
      this.userKnown = true;
      this.ready = true;
    },
    async refreshAgent() {
      if (!this.user) {
        this.agentDelegated = null;
        return;
      }
      try {
        const data = await getAgent();
        this.agentDelegated = Array.isArray(data.agents) && data.agents.length > 0;
      } catch {
        this.agentDelegated = null;
      }
    },
    async requestKey(email, inviteCode) {
      await requestLoginKey(email, inviteCode);
    },
    async confirmKey(email, key) {
      const data = await confirmLoginKey(email, key);
      this.user = data.user;
      this.userKnown = true;
      this.refreshAgent();
    },
    // 打赏这类接口会把扣款后的余额一起返回，直接写回来，不再为一次余额变化重取整个会话。
    setBalance(value) {
      if (!this.user) return;
      this.user.pointsBalance = Math.max(0, Number(value) || 0);
    },
    async end() {
      await endSession();
      this.user = null;
      this.agentDelegated = null;
    },
  },
});
