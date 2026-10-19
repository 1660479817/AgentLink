// 写出门户读取的运行时快照。
//
// 用法：
//   node xknot.si/ops/build-hub-data.mjs --out xknot.si/web/dist/data/hub.json

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildHubData } from "../web/src/lib/snapshot.js";
import { mergePreview } from "../web/src/lib/preview.js";
import { mergeCards, readCards, PREVIEW_CARDS_PATH } from "./cards.mjs";

export { buildHubData };

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : path.join(here, "..", "var", "hub.json");

  let manifest = await readJson(path.join(here, "..", "instances.json"), null);
  if (!manifest || !Array.isArray(manifest.instances)) {
    throw new Error("cannot read instances.json");
  }
  let health = await readJson(path.join(here, "..", "var", "health.json"), { instances: {} });
  let cards = await readCards(path.join(here, "..", "var", "cards"));

  // 预览构建：并入 fixtures/ 的样例条目，只影响这一次输出。
  if (process.env.XKNOT_PREVIEW === "1") {
    const samples = await readJson(path.join(here, "..", "fixtures", "preview-instances.json"), null);
    const sampleHealth = await readJson(path.join(here, "..", "fixtures", "preview-health.json"), null);
    const sampleCards = await readJson(path.join(here, "..", PREVIEW_CARDS_PATH), {});
    ({ manifest, health } = mergePreview(manifest, health, samples, sampleHealth));
    cards = mergeCards(cards, sampleCards);
  }

  const data = buildHubData(manifest, health, new Date(), cards);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${outPath}: ${data.instances.length} instance(s)`);
  return data;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
