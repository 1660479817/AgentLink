import { defineStore } from "pinia";
import { confirmLoginKey, endSession, getSession, requestLoginKey } from "../api.js";

export const useSessionStore = defineStore("session", {
  state: () => ({
    user: null,
    ready: false,
  }),
  actions: {
    async load() {
      try {
        const data = await getSession();
        this.user = data.user;
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
