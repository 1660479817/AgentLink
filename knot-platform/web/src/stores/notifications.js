import { defineStore } from "pinia";
import { listNotifications, readNotifications } from "../api.js";

export const useNotificationStore = defineStore("notifications", {
  state: () => ({
    unread: 0,
    items: [],
    loaded: false,
  }),
  actions: {
    async load() {
      try {
        const data = await listNotifications();
        this.items = data.notifications;
        this.unread = data.unread;
      } catch (err) {
        this.items = [];
        this.unread = 0;
        if (err.code !== "no_session") throw err;
      } finally {
        this.loaded = true;
      }
    },
    async open() {
      await this.load();
      if (this.unread === 0) return;
      await readNotifications();
      this.unread = 0;
      this.items = this.items.map((item) => ({ ...item, read: true }));
    },
  },
});
