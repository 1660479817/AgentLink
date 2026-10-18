import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 开发代理默认连 bot01；本机临时转发时用 KNOT_API_TARGET 覆盖，不把临时端口写进仓库。
const apiTarget = process.env.KNOT_API_TARGET || "http://192.168.3.91:8080";

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
