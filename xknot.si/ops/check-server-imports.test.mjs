import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findBadServerImports } from "./check-server-imports.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "xknot-imports-"));
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return root;
}

test("server 的 import 落在 server/、ops/、web/src/lib/ 之内就通过", async () => {
  const root = await fixture({
    "server/app.mjs": [
      'import "./lib/local.mjs";',
      'import { x } from "../ops/subdomain.mjs";',
      'import { isCountryCode } from "../web/src/lib/regions.js";',
    ].join("\n"),
  });
  assert.deepEqual(await findBadServerImports(root), []);
  await rm(root, { recursive: true, force: true });
});

test("import 到 web/ 别处会被指出来：远端没有那份文件", async () => {
  const root = await fixture({
    "server/validate.mjs": 'import { thing } from "../web/src/components/thing.js";',
    "server/lazy.mjs": 'export const load = () => import("../web/src/components/lazy.js");',
    "web/src/components/thing.js": "export const thing = 1;",
    "web/src/components/lazy.js": "export default 1;",
  });
  const problems = await findBadServerImports(root);
  assert.deepEqual(
    problems.map((item) => `${item.file}:${item.specifier}`).sort(),
    [
      `${path.join("server", "lazy.mjs")}:../web/src/components/lazy.js`,
      `${path.join("server", "validate.mjs")}:../web/src/components/thing.js`,
    ]
  );
  await rm(root, { recursive: true, force: true });
});

test("测试文件不参与：部署把 *.test.mjs 排除在外", async () => {
  const root = await fixture({
    "server/app.test.mjs": 'import { thing } from "../web/src/components/thing.js";',
  });
  assert.deepEqual(await findBadServerImports(root), []);
  await rm(root, { recursive: true, force: true });
});

test("仓库当前的 server/ 没有越界 import", async () => {
  // 这条守的是部署：越界一次就是远端 ERR_MODULE_NOT_FOUND，进程反复重启。
  assert.deepEqual(await findBadServerImports(path.join(here, "..")), []);
});
