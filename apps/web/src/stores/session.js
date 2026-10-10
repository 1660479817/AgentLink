import { defineStore } from "pinia";
import { authMe } from "../api.js";
import { t } from "../i18n/index.js";

export const useSessionStore = defineStore("session", {
  state: () => ({
    user: undefined,
  }),
  getters: {
    ready: (s) => s.user !== undefined,
    loadingText: () => t("app.loading"),
  },
  actions: {
    async load() {
      try {
        const data = await authMe();
        this.user = data.user ?? null;
      } catch {
        this.user = null;
      }
    },
    setUser(user) {
      this.user = user;
    },
  },
});
