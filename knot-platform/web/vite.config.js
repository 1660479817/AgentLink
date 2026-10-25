import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";

// 开发代理默认连本机 Backend；连别的机器时用 KNOT_API_TARGET 覆盖。
const apiTarget = process.env.KNOT_API_TARGET || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [
    vue(),
    // 微信内置浏览器不总是 Chromium 的最近版本，旧 X5 内核甚至不执行 type="module"。
    // legacy 产物用 nomodule 加载，只有老内核会下载；现代浏览器仍然只拿 es2015 那一份。
    legacy({
      targets: ["chrome >= 61", "safari >= 11", "ios >= 11", "firefox >= 60", "edge >= 18"],
    }),
  ],
  build: {
    // 微信内置浏览器与旧 Android 内核未必支持 ??、?. 这些语法。构建产物降到 ES2015：
    // 新内核照常跑，老内核至少能解析；不能在客户端假设「用户用的是今年的 Chrome」。
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
