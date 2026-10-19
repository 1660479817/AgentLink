import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 开发代理默认连本机 Backend；连别的机器时用 KNOT_API_TARGET 覆盖。
const apiTarget = process.env.KNOT_API_TARGET || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [vue()],
  build: {
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
