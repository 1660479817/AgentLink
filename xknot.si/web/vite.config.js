import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildHubData } from "./src/lib/snapshot.js";
import { mergePreview } from "./src/lib/preview.js";
import { mergeCards, readCards, PREVIEW_CARDS_PATH } from "../ops/cards.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hubDir = path.join(root, "..");

// 看版式时打开：XKNOT_PREVIEW=1 npm run dev。样例条目只并进内存，不写回清单。
const preview = process.env.XKNOT_PREVIEW === "1";

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

// 开发时按仓库里的真实清单和探测结果现算 /data/hub.json。
// 生产构建时由 ops/build-hub-data.mjs 写出同一形状的文件，前后端只有一份数据格式。
function hubDataPlugin() {
  return {
    name: "knot-hub-data",
    configureServer(server) {
      server.middlewares.use("/data/hub.json", async (_req, res) => {
        let manifest = await readJson(path.join(hubDir, "instances.json"), { instances: [] });
        let health = await readJson(path.join(hubDir, "var", "health.json"), { instances: {} });
        let cards = await readCards(path.join(hubDir, "var", "cards"));

        if (preview) {
          const samples = await readJson(path.join(hubDir, "fixtures", "preview-instances.json"), null);
          const sampleHealth = await readJson(path.join(hubDir, "fixtures", "preview-health.json"), null);
          const sampleCards = await readJson(path.join(hubDir, PREVIEW_CARDS_PATH), {});
          ({ manifest, health } = mergePreview(manifest, health, samples, sampleHealth));
          cards = mergeCards(cards, sampleCards);
        }

        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(buildHubData(manifest, health, new Date(), cards)));
      });
    },
  };
}

// 中枢门户是独立子项目：自己安装、自己构建、自己部署。
// 三个语种各一个 HTML 入口，构建后得到 dist/en/、dist/zh-CN/、dist/zh-TW/，
// 每个入口的 lang 与 hreflang 直接写在 HTML 里，不依赖客户端脚本。
export default defineConfig({
  plugins: [vue(), hubDataPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 字体不进 data: URI。门户的 CSP 是 `font-src 'self'`（ops/xknot.si.conf），
    // 内联后浏览器会按 CSP 拦掉，字就悄悄退回系统字体。
    assetsInlineLimit: (filePath) =>
      filePath.endsWith(".woff2") || filePath.endsWith(".woff") ? false : undefined,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        en: fileURLToPath(new URL("./en/index.html", import.meta.url)),
        zhCN: fileURLToPath(new URL("./zh-CN/index.html", import.meta.url)),
        zhTW: fileURLToPath(new URL("./zh-TW/index.html", import.meta.url)),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: {
      // 表单与审核台由 server/ 里的接口进程提供；开发时同源透传。
      "/api": { target: "http://127.0.0.1:5181", changeOrigin: false },
      "/admin": { target: "http://127.0.0.1:5181", changeOrigin: false },
    },
  },
});
