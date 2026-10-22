import { defineStore } from "pinia";
import { listNotifications, pollNotifications, readNotifications } from "../api.js";

export const useNotificationStore = defineStore("notifications", {
  state: () => ({
    unread: 0,
    items: [],
    loaded: false,
  }),
  actions: {
    // /api/web/home 已经把未读数带回来了，先用它点红点，列表明开通知页时再取。
    setUnread(value) {
      const next = Number(value);
      if (!Number.isFinite(next)) return;
      this.unread = Math.max(0, next);
    },
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
    // 轮询只问「有几个未读」，不拉整张列表。
    async poll() {
      try {
        const data = await pollNotifications();
        this.setUnread(data.unread);
      } catch {
        /* 下一轮再试，红点保持当前值 */
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
