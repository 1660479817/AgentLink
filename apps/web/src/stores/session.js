import { defineStore } from "pinia";
import { endSession, getSession, startSession } from "../api.js";

export const useSessionStore = defineStore("session", {
  state: () => ({
    person: null,
    ready: false,
  }),
  actions: {
    async load() {
      try {
        const data = await getSession();
        this.person = data.person;
      } catch {
        this.person = null;
      } finally {
        this.ready = true;
      }
    },
    async start() {
      const data = await startSession();
      this.person = { id: data.personId };
    },
    async end() {
      await endSession();
      this.person = null;
    },
  },
});
