import { defineStore } from "pinia";
import { listFriends, removeFriend } from "../api.js";
import { useSessionStore } from "./session";

export const useFriendStore = defineStore("friends", {
  state: () => ({
    items: [],
    loaded: false,
    error: "",
    revision: 0,
  }),
  actions: {
    async load() {
      const session = useSessionStore();
      if (!session.user) {
        this.items = [];
        this.loaded = true;
        this.error = "";
        return;
      }
      try {
        const data = await listFriends();
        this.items = data.friends || [];
        this.error = "";
      } catch (error) {
        this.items = [];
        this.error = error.code || "request_failed";
      } finally {
        this.loaded = true;
      }
    },
    async remove(id) {
      const previous = this.items;
      this.items = this.items.filter((item) => item.id !== id);
      try {
        await removeFriend(id);
        this.revision += 1;
      } catch (error) {
        this.items = previous;
        throw error;
      }
    },
  },
});
