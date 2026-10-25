import { defineStore } from "pinia";
import {
  buyStoreItem,
  listMyStore,
  listStore,
  listStoreOrders,
  relistStoreItem,
  withdrawStoreItem,
} from "../api.js";
import { useSessionStore } from "./session";

// Knot Store 的前端状态：货架、我挂出的、订单。
//
// 名字叫 catalog 而不是 store：`web/src/stores/` 里每个文件都是一个 Pinia store，
// 再叫 store 就读不出这一层是货架。见 docs/STORE.md 第 11 节。
//
// 帖子不进这里。内容线有它自己的信息流与收藏，商品也不从那些路径出现。
export const useCatalogStore = defineStore("catalog", {
  state: () => ({
    shelf: [],
    // 游标是货架上最后一行的 id，不是时间戳：同一毫秒上架两件时，时间戳会跳行。
    shelfCursor: null,
    shelfMore: false,
    shelfLoaded: false,
    shelfFailed: false,
    shelfLoading: false,

    mine: [],
    mineLoaded: false,
    mineFailed: false,

    orders: [],
    ordersLoaded: false,
    ordersFailed: false,

    // 每件商品各自一把锁：买一件时不该把货架上其它卡片的按钮也冻住。
    busy: {},
    error: "",
  }),
  getters: {
    // 我买到的：货架上能看到的加上我自己的（自己的东西买不了，也不算买到）。
    bought: (state) => state.orders.filter((order) => order.side === "buy"),
    sold: (state) => state.orders.filter((order) => order.side === "sell"),
    onShelf: (state) => state.mine.filter((item) => item.store?.state === "on_sale"),
    offShelf: (state) => state.mine.filter((item) => item.store?.state !== "on_sale"),
  },
  actions: {
    isBusy(id) {
      return Boolean(this.busy[id]);
    },
    setBusy(id, value) {
      this.busy = { ...this.busy, [id]: value };
    },
    // 同一件商品可能同时出现在货架和「我挂出的」：两处改同一份状态，切栏时不会一旧一新。
    patch(item) {
      if (!item?.id) return;
      const replace = (list) => list.map((row) => (row.id === item.id ? { ...row, ...item } : row));
      this.shelf = replace(this.shelf);
      this.mine = replace(this.mine);
    },
    async loadShelf({ more = false } = {}) {
      if (this.shelfLoading) return;
      this.shelfLoading = true;
      try {
        const data = await listStore(more ? this.shelfCursor : null);
        const incoming = Array.isArray(data.items) ? data.items.filter((item) => item?.id) : [];
        if (more) {
          const seen = new Set(this.shelf.map((item) => item.id));
          this.shelf = [...this.shelf, ...incoming.filter((item) => !seen.has(item.id))];
        } else {
          this.shelf = incoming;
        }
        this.shelfCursor = incoming.length ? incoming[incoming.length - 1].id : more ? this.shelfCursor : null;
        // 取回一页就是「可能还有下一页」；空页才是到底。不要用「恰好 40 条」推断。
        this.shelfMore = incoming.length > 0;
        this.shelfFailed = false;
      } catch {
        // 取失败不是「货架空了」：两个空态在界面上说的不是一件事。
        this.shelfFailed = true;
      } finally {
        this.shelfLoaded = true;
        this.shelfLoading = false;
      }
    },
    async loadMine() {
      try {
        const data = await listMyStore();
        this.mine = Array.isArray(data.items) ? data.items : [];
        this.mineFailed = false;
      } catch {
        this.mineFailed = true;
      } finally {
        this.mineLoaded = true;
      }
    },
    async loadOrders() {
      try {
        const data = await listStoreOrders();
        this.orders = Array.isArray(data.orders) ? data.orders : [];
        this.ordersFailed = false;
      } catch {
        this.ordersFailed = true;
      } finally {
        this.ordersLoaded = true;
      }
    },
    // 买下：后端在一个事务里写订单、转账，前端只等结果。
    // 成功后把这一件换成返回的那份（bought 变 true），并刷新余额。
    async buy(id) {
      if (!id || this.isBusy(id)) return false;
      this.error = "";
      this.setBusy(id, true);
      try {
        const data = await buyStoreItem(id);
        if (data.item) this.patch(data.item);
        else this.patch({ id, store: { bought: true } });
        const session = useSessionStore();
        await session.load().catch(() => {});
        return true;
      } catch (error) {
        this.error = error?.code || "request_failed";
        return false;
      } finally {
        this.setBusy(id, false);
      }
    },
    async withdraw(id) {
      if (!id || this.isBusy(id)) return false;
      this.error = "";
      this.setBusy(id, true);
      try {
        const data = await withdrawStoreItem(id);
        if (data.item) this.patch(data.item);
        return true;
      } catch (error) {
        this.error = error?.code || "request_failed";
        return false;
      } finally {
        this.setBusy(id, false);
      }
    },
    async relist(id) {
      if (!id || this.isBusy(id)) return false;
      this.error = "";
      this.setBusy(id, true);
      try {
        const data = await relistStoreItem(id);
        if (data.item) this.patch(data.item);
        return true;
      } catch (error) {
        this.error = error?.code || "request_failed";
        return false;
      } finally {
        this.setBusy(id, false);
      }
    },
  },
});
