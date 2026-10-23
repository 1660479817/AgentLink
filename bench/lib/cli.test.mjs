import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 四份脚本原本各写一份 arg：`--duration` 少写一个值时，有的脚本静默用默认值，
// 于是那一轮的数字不是它标称的时长。这里用子进程验证「写了一半就停」。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = pathToFileURL(path.join(HERE, "cli.mjs")).href;

function run(args, body = "console.log(JSON.stringify(arg('name', 'fallback')))") {
  // `--` 之后的才进 process.argv；否则 node 会把 `--name` 当成自己的选项（退出码 9）。
  return spawnSync(process.execPath, ["--input-type=module", "-e", `import { arg, flag } from ${JSON.stringify(CLI)};\n${body}`, "--", ...args], {
    encoding: "utf8",
  });
}

test("给了值就用值", () => {
  const out = run(["--name", "x"]);
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), '"x"');
});

test("没给就用缺省", () => {
  const out = run([]);
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), '"fallback"');
});

test("--name 后面是另一个开关或行尾时直接失败，不拿缺省顶替", () => {
  for (const args of [["--name"], ["--name", "--other"]]) {
    const out = run(args);
    assert.equal(out.status, 2, args.join(" "));
    assert.match(out.stderr, /--name 后面要跟一个值/);
  }
});

test("空字符串也算没写值", () => {
  const out = run(["--name", ""]);
  assert.equal(out.status, 2);
});

test("flag 只看有没有出现，不吃后面的值", () => {
  const out = run(["--allow-writes", "--name", "x"], "console.log(JSON.stringify([flag('allow-writes'), flag('missing')]))");
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), "[true,false]");
});
