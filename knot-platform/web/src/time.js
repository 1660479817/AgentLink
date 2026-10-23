import { ref } from "vue";
import { t } from "./i18n/index.js";

// 一分钟一跳的「现在」。timeAgo 读它，读到的组件因此在跳的时候重渲染：
// 否则「刚刚」「3 分钟前」画上去之后就不再变，只有别的原因触发重渲染才更新。
// 定时器由 AppShell 起停，测试里 import 这个模块不会留下一个跑不完的 interval。
export const clock = ref(Date.now());

let timer = 0;

export function startClock(intervalMs = 60 * 1000) {
  if (timer) return;
  timer = setInterval(() => {
    clock.value = Date.now();
  }, intervalMs);
}

export function stopClock() {
  if (!timer) return;
  clearInterval(timer);
  timer = 0;
}

// 不传 timeZone：按浏览器所在时区取「几月几日」。
// 原先固定 Asia/Shanghai，人在别的时区时日期会差一天。
const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
});

export function timeAgo(value) {
  const then = Date.parse(value || "");
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.floor((clock.value - then) / 60000));
  if (minutes < 1) return t("home.justNow");
  if (minutes < 60) return t("home.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("home.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("home.daysAgo", { n: days });
  const parts = dayFormat.formatToParts(new Date(then));
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return t("home.postedOn", { month, day });
}
