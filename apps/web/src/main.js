import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useInfoBufferStore } from "./stores/infoBuffer";
import "./styles.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

useInfoBufferStore().bindPool();

app.mount("#app");
