import { defineStore } from "pinia";
import { confirmLoginKey, endSession, getSession, requestLoginKey } from "../api.js";

const INITIAL_POLICY = {
  demandTtlHours: 24,
  matchLimit: 10,
  bountyMaxHours: 72,
  defaultPrice: 10,
  priceMin: 0,
  priceMax: 100,
  listingFee: 1,
  completionFee: 1,
};

export const useSessionStore = defineStore("session", {
  state: () => ({
    user: null,
    policy: { ...INITIAL_POLICY },
    ready: false,
  }),
  actions: {
    async load() {
      try {
        const data = await getSession();
        this.user = data.user;
        if (data.policy) this.policy = data.policy;
      } catch {
        this.user = null;
      } finally {
        this.ready = true;
      }
    },
    async requestKey(email) {
      await requestLoginKey(email);
    },
    async confirmKey(email, key) {
      const data = await confirmLoginKey(email, key);
      this.user = data.user;
    },
    async end() {
      await endSession();
      this.user = null;
    },
  },
});
