import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { installBootGuard } from "./boot.js";
import "./styles.css";

const root = document.getElementById("app");
// 必须在 mount 之前：Vue 挂载会清空 #app，而兜底页面就写在里面。
// 挂载中途或首帧渲染出错时，这里负责把兜底放回去。
const boot = installBootGuard(root);

const app = createApp(App);
// 渲染期抛出的错误默认只进控制台，页面上什么都不剩。交给兜底守卫统一处理。
app.config.errorHandler = (error, _instance, info) => {
  console.error(`[knot] render error (${info}):`, error);
  boot.fail(error);
};
app.use(createPinia());
app.use(router);

try {
  app.mount(root);
  boot.ready();
} catch (error) {
  // mount 自己也可能是抛错的那一步（处理器、根组件 setup）。不往外抛：
  // 抛出去只会在控制台多一条重复记录，页面状态由兜底守卫负责。
  console.error("[knot] mount failed:", error);
  boot.fail(error);
}
