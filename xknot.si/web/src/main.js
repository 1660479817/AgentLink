import { createApp } from "vue";

import App from "./App.vue";
import { DEFAULT_LOCALE, isLocale } from "./lib/i18n.js";
import { tFor } from "./lib/catalogs.js";
import "./styles.css";

// 语种来自当前 HTML 的 lang，构建时由入口文件写死，运行时不再判断浏览器语言。
const lang = document.documentElement.lang;
const locale = isLocale(lang) ? lang : DEFAULT_LOCALE;

createApp(App, { locale, t: tFor(locale) }).mount("#app");
