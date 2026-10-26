// 单测与部署环境隔离。
//
// 运维常按 ops/README 的写法 `set -a; . sites/<站点>/platform.env; set +a`，
// 那些变量会留在当前 shell。测试断言的是 schema 默认值，而 KNOT_PROFILE_FILE、
// KNOT_AGENT_ENV_DIR 这类键让它读进某个真实站点的档案，于是同一条命令在干净的
// shell 里通过、在部署过的 shell 里报出与改动无关的失败。
//
// 这里只带走运行必需的变量，其余一律不进子进程——与 build.sh 跑测试的方式一致。
// 额外的参数原样交给 node --test。
//
// 文件名不要叫 test*.mjs：`node --test` 会把这种名字当成测试文件，
// 于是它自己递归调用自己。

import { spawn } from "node:child_process";

const KEEP = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_ENV",
  "CI",
  "SHELL",
  "USER",
  "LOGNAME",
];

const env = {};
for (const key of KEEP) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}

const child = spawn(process.execPath, ["--test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("error", (error) => {
  console.error(`无法启动测试进程：${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
