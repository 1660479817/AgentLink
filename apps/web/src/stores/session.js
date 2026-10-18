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

let loading = null;

export const useSessionStore = defineStore("session", {
  state: () => ({
    user: null,
    policy: { ...INITIAL_POLICY },
    ready: false,
    region: "zh-CN",
    agentDelegated: null,
  }),
  actions: {
    load() {
      if (loading) return loading;
      loading = (async () => {
        try {
          const data = await getSession();
          this.user = data.user;
          if (data.policy) this.policy = data.policy;
          if (typeof data.region === "string" && data.region) this.region = data.region;
          if (this.user) this.refreshAgent();
        } catch {
          this.user = null;
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
    async requestKey(email) {
      await requestLoginKey(email);
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
