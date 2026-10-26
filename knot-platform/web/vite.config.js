import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";

// 开发代理默认连本机 Backend；连别的机器时用 KNOT_API_TARGET 覆盖。
const apiTarget = process.env.KNOT_API_TARGET || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [
    vue(),
    // Babel 只按下限决定转不转某个语法：下限写高了，async 之类的语法会原样留在
    // nomodule 包里，而没有 type="module" 的内核只会执行这一份。
    // chrome 53 / Safari 10 是内置浏览器（X5、WKWebView）的合理下限。
    legacy({
      targets: ["chrome >= 53", "safari >= 10", "ios >= 10", "firefox >= 60", "edge >= 18"],
    }),
  ],
  build: {
    // 产物降到 ES2015：?? 与 ?. 在这些内核里是语法错误。新内核照常跑，老内核至少能解析。
    target: "es2015",
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ["vue", "vue-router", "pinia"],
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
