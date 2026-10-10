import { defineStore } from "pinia";
import { listMessages, readMessages } from "../api.js";

export const useMessageStore = defineStore("messages", {
  state: () => ({
    unread: 0,
    items: [],
    guest: false,
    loaded: false,
  }),
  actions: {
    async load() {
      try {
        const data = await listMessages();
        this.items = data.messages;
        this.unread = data.unread;
        this.guest = false;
      } catch (err) {
        this.items = [];
        this.unread = 0;
        this.guest = err.code === "no_session";
      } finally {
        this.loaded = true;
      }
    },
    async open() {
      await this.load();
      if (this.unread === 0) return;
      await readMessages();
      this.unread = 0;
      this.items = this.items.map((item) => ({ ...item, read: true }));
    },
  },
});
