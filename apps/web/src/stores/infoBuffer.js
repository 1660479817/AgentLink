import { defineStore } from "pinia";
import {
  getInfoBufferState,
  subscribeInfoBuffer,
  pullSnapshot,
  setDesiredPull,
  getLastPlazaQuery,
  startBufferScheduler,
  stopBufferScheduler,
  invalidateSnapshot,
} from "../infoBufferPool.js";

function surfacesForRoute(path, user) {
  const surfaces = ["home", "plaza"];
  if (user && (path === "/" || path.startsWith("/mine") || path === "/agent")) {
    surfaces.push("mine");
  }
  return surfaces;
}

export const useInfoBufferStore = defineStore("infoBuffer", {
  state: () => ({
    pool: getInfoBufferState(),
    bound: false,
  }),
  getters: {
    surfaces: (s) => s.pool.surfaces,
    status: (s) => s.pool.status,
    lastError: (s) => s.pool.lastError,
    viewer: (s) => s.pool.viewer,
    errors: (s) => s.pool.errors,
    surface: (s) => (name) => ({
      data: s.pool.surfaces[name] ?? null,
      surfaceError: s.pool.errors[name] ?? null,
    }),
  },
  actions: {
    bindPool() {
      if (this.bound) return;
      subscribeInfoBuffer(() => {
        this.pool = getInfoBufferState();
      });
      this.bound = true;
    },
    syncRoute(path, user) {
      setDesiredPull(() => ({
        surfaces: surfacesForRoute(path, user),
        plaza: { q: getLastPlazaQuery().q || undefined, limit: getLastPlazaQuery().limit },
      }));
      pullSnapshot({ surfaces: ["home", "plaza"] }).catch(() => {});
      if (user && surfacesForRoute(path, user).includes("mine")) {
        pullSnapshot({ surfaces: ["mine"] }).catch(() => {});
      }
      startBufferScheduler();
    },
    stopScheduler() {
      stopBufferScheduler();
    },
    pull(req, opts) {
      return pullSnapshot(req, opts);
    },
    invalidate() {
      return invalidateSnapshot();
    },
  },
});
