import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 单元文件是模板，占位符漏填会原样写进系统的 service 文件：systemd 读到
// ReadWritePaths=-__KNOT_UPLOAD_DIR__ 这种值不会报错，只是那条路径不存在，
// 后端在 ProtectSystem=full 下写不了上传目录，等到有人上传才暴露。
// 这里把「单元里出现的占位符」和「site-config.sh 会替换的占位符」对一遍。

const UNIT_DIRS = ["systemd", "launchd"].map((name) =>
  fileURLToPath(new URL(`../${name}/`, import.meta.url)),
);
const SITE_CONFIG = readFileSync(
  fileURLToPath(new URL("./lib/site-config.sh", import.meta.url)),
  "utf8",
);

const PLACEHOLDER = /__KNOT_[A-Z_]+__/g;

function unitFiles() {
  const files = [];
  for (const dir of UNIT_DIRS) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".service") && !name.endsWith(".timer") && !name.endsWith(".plist")) continue;
      files.push({ name, path: `${dir}${name}` });
    }
  }
  return files;
}

function substituted() {
  const names = new Set();
  for (const match of SITE_CONFIG.matchAll(/s\|(__KNOT_[A-Z_]+__)\|/g)) names.add(match[1]);
  return names;
}

test("单元模板里的占位符都有对应的替换", () => {
  const known = substituted();
  assert.ok(known.size >= 7);
  const missing = [];
  for (const file of unitFiles()) {
    const text = readFileSync(file.path, "utf8");
    for (const name of text.match(PLACEHOLDER) ?? []) {
      if (!known.has(name)) missing.push(`${file.name}: ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("后端单元放开了上传目录，并把新文件的权限收紧", () => {
  const text = readFileSync(fileURLToPath(new URL("../systemd/knot-backend.service", import.meta.url)), "utf8");
  // UPLOAD_DIR 可以配到 var/ 之外：只放开 __KNOT_HOME__/var 时，上传会直接失败。
  assert.match(text, /^ReadWritePaths=-__KNOT_UPLOAD_DIR__$/m);
  // 上传原件不该对同机其他用户可读。
  assert.match(text, /^UMask=0077$/m);
});

test("备份单元卡住会超时，失败会留下可查的错误", () => {
  const text = readFileSync(fileURLToPath(new URL("../systemd/knot-backup.service", import.meta.url)), "utf8");
  // 没有上限的 oneshot 会一直 active，之后的每日触发被 systemd 忽略，备份静默停摆。
  assert.match(text, /^TimeoutStartSec=\d+[hm]?$/m);
  assert.match(text, /^OnFailure=knot-backup-alert\.service$/m);
  const alert = readFileSync(fileURLToPath(new URL("../systemd/knot-backup-alert.service", import.meta.url)), "utf8");
  assert.match(alert, /^ExecStart=\/usr\/bin\/logger /m);
});
