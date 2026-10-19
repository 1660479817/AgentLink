// 开发时同时拉起接口与 Vite。
//
//   npm run dev        带示例节点（XKNOT_PREVIEW=1）
//   npm run dev:real   只用仓库里的 instances.json
//
// 接口在 5181，Vite 在 5180 并把 /api 与 /admin 透传过去。
// Ctrl-C 一起收掉。

import { spawn } from "node:child_process";

const preview = process.argv.includes("--preview");
const node = process.execPath;

const api = spawn(node, ["server/index.mjs"], {
  stdio: "inherit",
  env: { ...process.env },
});

const vite = spawn("npm", ["--prefix", "web", "run", "dev"], {
  stdio: "inherit",
  env: { ...process.env, XKNOT_PREVIEW: preview ? "1" : "0" },
});

let closing = false;

function stop(code = 0) {
  if (closing) return;
  closing = true;
  api.kill("SIGTERM");
  vite.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

vite.on("exit", (code) => stop(code ?? 0));
api.on("exit", (code) => {
  // 接口挂了但界面还在，会让表单一直 502；一起收掉更好排查。
  if (!closing && code) stop(code);
});
