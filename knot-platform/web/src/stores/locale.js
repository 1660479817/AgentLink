import { defineStore } from "pinia";
import { DEFAULT_SITE_LOCALE, isLocale } from "@knot/locale";
import { setLocale } from "../i18n/index.js";
import { bootLocale, PIN_KEY, readStored, resolveLocale, writeStored } from "../locale.js";

function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

const storage = browserStorage();
const initial = bootLocale(readStored(storage, PIN_KEY));

export const useLocaleStore = defineStore("locale", {
  state: () => ({
    current: initial,
    pinned: Boolean(readStored(storage, PIN_KEY)),
    // 站点默认语种来自 profile.json，会话接口回话后才有值。
    siteDefault: DEFAULT_SITE_LOCALE,
  }),
  actions: {
    applyResolved(result) {
      this.current = result.locale;
      this.pinned = result.pin;
      setLocale(result.locale);
      const box = browserStorage();
      writeStored(box, PIN_KEY, result.pin ? result.locale : null);
    },
    applySession({ user, defaultLocale } = {}) {
      const site = isLocale(defaultLocale) ? defaultLocale : DEFAULT_SITE_LOCALE;
      this.siteDefault = site;
      const result = resolveLocale({
        account: user?.locale,
        pin: readStored(browserStorage(), PIN_KEY),
        site,
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
