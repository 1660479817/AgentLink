import { defineStore } from "pinia";
import { confirmLoginKey, endSession, getDelegation, getSession, requestLoginKey } from "../api.js";
import { pickLocale } from "../brand.js";
import { locale } from "../i18n/index.js";

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
// 多语种字段是 { "zh-CN": … } 这样的表，按当前界面语种取一个字符串。
const INITIAL_BRAND = {
  name: null,
  tagline: null,
  logo: "",
  // 主理人（owner）：具体负责这个站点的人。没填时弹窗只显示站点信息。
  owner: null,
  intro: null,
  contact: "",
  themeColor: "",
};

let loading = null;

export const useSessionStore = defineStore("session", {
  state: () => ({
    user: null,
    policy: { ...INITIAL_POLICY },
    site: { ...INITIAL_SITE },
    brand: { ...INITIAL_BRAND },
    ready: false,
    // 会话接口没回话时记一笔：未登录访客此时拿不到站点开关，
    // 页面要说明「连不上」，不能只是把入口藏起来。
    failed: false,
    region: "zh-CN",
    agentDelegated: null,
  }),
  getters: {
    // 未登录能不能进站内。登录的人永远可以；访客看系统开关。
    canBrowse: (state) => Boolean(state.user) || state.site.guestBrowsing,
    // 站点名：按界面语种取，没填时回落到默认名。
    brandName: (state) => pickLocale(state.brand?.name, locale.value) || "Knot",
    // 一句话介绍，弹窗和登录卡用。
    brandTagline: (state) => pickLocale(state.brand?.tagline, locale.value),
    // 站点自己的 logo。没配就留空，由界面退回站点名首字。
    siteLogo: (state) => String(state.brand?.logo || "").trim(),
    // 主理人：名字、站点长介绍、联系方式，三项都可能为空，界面按项显示。
    owner: (state) => ({
      name: pickLocale(state.brand?.owner, locale.value),
      note: pickLocale(state.brand?.intro, locale.value),
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
          if (typeof data.region === "string" && data.region) this.region = data.region;
          this.failed = false;
          if (this.user) this.refreshAgent();
        } catch {
          this.user = null;
          this.site = { ...INITIAL_SITE };
          this.agentDelegated = null;
          this.failed = true;
        } finally {
          this.ready = true;
          loading = null;
        }
      })();
      return loading;
    },
    async refreshAgent() {
      if (!this.user) {
        this.agentDelegated = null;
        return;
      }
      try {
        const data = await getDelegation();
        this.agentDelegated = Boolean(data.delegated || data.createdAt);
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
