import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";

// 开发代理默认连本机 Backend；连别的机器时用 KNOT_API_TARGET 覆盖。
const apiTarget = process.env.KNOT_API_TARGET || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [
    vue(),
    // 微信内置浏览器不总是 Chromium 的最近版本：旧 X5 内核（Chromium 53 一带）
    // 既没有 type="module"，也没有 async/await——而 babel 只按 targets 的下限决定
    // 转不转某个语法。targets 写 chrome 61 时 async 原样留着，53 的内核拿到 legacy
    // 包一样是语法错误，两套产物都跑不起来。下限压到 53 / Safari 10，
    // 让 legacy 包真的能被这批内核解析。
    legacy({
      targets: ["chrome >= 53", "safari >= 10", "ios >= 10", "firefox >= 60", "edge >= 18"],
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
