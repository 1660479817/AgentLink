import { defineStore } from "pinia";
import { setLocale } from "../i18n/index.js";
import {
  bootLocale,
  isLocale,
  PIN_KEY,
  readStored,
  resolveLocale,
  SEEN_KEY,
  writeStored,
} from "../locale.js";

function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

const storage = browserStorage();
const initial = bootLocale(readStored(storage, PIN_KEY), readStored(storage, SEEN_KEY));

export const useLocaleStore = defineStore("locale", {
  state: () => ({
    current: initial,
    pinned: Boolean(readStored(storage, PIN_KEY)),
    region: "en",
  }),
  actions: {
    applyResolved(result) {
      this.current = result.locale;
      this.pinned = result.pin;
      setLocale(result.locale);
      const box = browserStorage();
      writeStored(box, SEEN_KEY, result.locale);
      writeStored(box, PIN_KEY, result.pin ? result.locale : null);
    },
    applySession({ user, region } = {}) {
      const suggested = isLocale(region) ? region : "en";
      this.region = suggested;
      const result = resolveLocale({
        account: user?.locale,
        pin: readStored(browserStorage(), PIN_KEY),
        region: suggested,
      });
      this.applyResolved(result);
      return result;
    },
    choose(id) {
      if (!isLocale(id) || id === this.current) return null;
      const result = { locale: id, pin: true, sync: id };
      this.applyResolved(result);
      return result;
    },
    restore(snapshot) {
      this.applyResolved({
        locale: snapshot.locale,
        pin: snapshot.pinned,
        sync: null,
      });
    },
  },
});
