import { defineStore } from "pinia";
import { listNotifications, pollNotifications, readNotifications } from "../api.js";

export const useNotificationStore = defineStore("notifications", {
  state: () => ({
    unread: 0,
    items: [],
    loaded: false,
    // 取失败与「本来就没有通知」是两件事，界面要分开画。
    failed: false,
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
        this.failed = false;
      } catch (err) {
        // 隧道抖一下不该把「有几个未读」和已有列表一起清掉，也不该把 rejection 抛给调用方。
        this.failed = err?.code !== "no_session";
        if (err?.code === "no_session") {
          this.items = [];
          this.unread = 0;
          this.failed = false;
        }
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
      if (this.failed || this.unread === 0) return;
      try {
        await readNotifications();
      } catch {
        /* 标已读失败不要紧：下次打开再标一遍。 */
        return;
      }
      this.unread = 0;
      this.items = this.items.map((item) => ({ ...item, read: true }));
    },
  },
});
