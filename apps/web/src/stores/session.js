import { defineStore } from "pinia";
import { confirmLoginKey, endSession, getDelegation, getSession, requestLoginKey } from "../api.js";

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

let loading = null;

export const useSessionStore = defineStore("session", {
  state: () => ({
    user: null,
    policy: { ...INITIAL_POLICY },
    site: { ...INITIAL_SITE },
    ready: false,
    region: "zh-CN",
    agentDelegated: null,
  }),
  getters: {
    // 未登录能不能进站内。登录的人永远可以；访客看系统开关。
    canBrowse: (state) => Boolean(state.user) || state.site.guestBrowsing,
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
          if (typeof data.region === "string" && data.region) this.region = data.region;
          if (this.user) this.refreshAgent();
        } catch {
          this.user = null;
          this.site = { ...INITIAL_SITE };
          this.agentDelegated = null;
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
    async end() {
      await endSession();
      this.user = null;
      this.agentDelegated = null;
    },
  },
});
