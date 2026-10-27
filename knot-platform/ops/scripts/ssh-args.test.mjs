import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, chmodSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// ssh 只用空格把 argv 拼成一条命令串，远端 shell 再重新拆词：空串整个消失，带空格
// 的值被拆成两个。这两件事都会让远端 $1..$N 逐位错开。远程部署踩过前一条：没带
// --runtime 时的空串消失，--bootstrap 前移一格被当成 --runtime 的值读掉，看起来
// 像「补装开关没生效」，人只好手工补一个 --runtime launchd 绕过去。
//
// 这里不 mock 参数拼装：从 push-deploy.sh 里取出真实的循环和远端正脚本，按 ssh
// 的规则拼成一条命令再交给 bash，断言远端到底收到了什么。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUSH_DEPLOY = path.join(HERE, "push-deploy.sh");
const SSH_ARGS = path.join(HERE, "lib", "ssh-args.sh");

// bash 单引号字面量：值里的单引号按 '\'' 断开再续上。
function bashLiteral(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// 取「在目标机解包并安装」那一段：参数循环 + 经 stdin 喂给远端的正脚本。
function remoteInstall() {
  const text = readFileSync(PUSH_DEPLOY, "utf8").split("\n");
  const marker = text.findIndex((line) => line.includes("==> remote install"));
  assert.ok(marker > 0, "push-deploy.sh 里找不到「在目标机解包并安装」那一段");

  const loopStart = text.findIndex((line, index) => index > marker && /^REMOTE_ARGS=\(\)$/.test(line));
  assert.ok(loopStart > 0, "找不到拼装远程参数的循环");
  const loopEnd = text.findIndex((line, index) => index > loopStart && line === "done");
  assert.ok(loopEnd > loopStart, "参数循环没有闭合");

  // 循环必须真的接到 ssh 调用上，否则断言的是死代码。
  const call = text.findIndex((line, index) => index > loopEnd && line.includes("bash -s --"));
  assert.ok(call > loopEnd, "参数循环后面没有 ssh 调用");
  assert.ok(text[call].includes('"${REMOTE_ARGS[@]}"'), "ssh 调用没有用 REMOTE_ARGS");

  // ssh 调用与 heredoc 起始在同一行（`… bash -s -- "${REMOTE_ARGS[@]}" <<'REMOTE'`）。
  const heredocStart = text.findIndex((line, index) => index >= call && /<<'REMOTE'$/.test(line));
  assert.ok(heredocStart >= call, "ssh 调用后面没有 <<'REMOTE'");
  const heredocEnd = text.findIndex((line, index) => index > heredocStart && line === "REMOTE");
  assert.ok(heredocEnd > heredocStart, "heredoc 没有闭合");

  return {
    loop: text.slice(loopStart, loopEnd + 1).join("\n"),
    block: `${text.slice(heredocStart + 1, heredocEnd).join("\n")}\n`,
  };
}

// 用脚本里的真实循环拼出位置参数，再按 ssh 的规则（空格拼接）交给远端 bash。
async function runRemote({ loop, block }, values) {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-ssh-args-"));
  const argvScript = path.join(dir, "argv.sh");
  await writeFile(
    argvScript,
    `set -eu\nsource "$KNOT_SSH_ARGS"\n${loop}\nprintf '%s\\0' "\${REMOTE_ARGS[@]}"\n`
  );
  const env = { ...process.env, KNOT_SSH_ARGS: SSH_ARGS };
  for (const [key, value] of Object.entries(values)) env[key] = value;
  const tokens = execFileSync("bash", [argvScript], { env, encoding: "utf8" }).split("\0").slice(0, -1);

  const remote = execFileSync("bash", ["-c", `bash -s -- ${tokens.join(" ")}`], {
    input: block,
    encoding: "utf8",
  });
  return { stdout: remote, tokens };
}

// 造一个能被远端那段 `tar -xzf` 吃下的发布包：里面的 deploy-site.sh 只打印它收到的
// 参数，这样就能看清位次有没有错开。
async function makeDeployDir({ withSpace = false } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), withSpace ? "knot deploy " : "knot-deploy-"));
  const deployDir = path.join(base, "root");
  const relName = "knot-9.9.9-test";
  const artifact = `${relName}-darwin-arm64.tar.gz`;
  const stage = path.join(base, "stage");

  await mkdir(path.join(stage, relName, "ops", "scripts"), { recursive: true });
  await mkdir(path.join(deployDir, "artifacts"), { recursive: true });
  await mkdir(path.join(deployDir, ".incoming"), { recursive: true });

  const stub = path.join(stage, relName, "ops", "scripts", "deploy-site.sh");
  await writeFile(stub, '#!/usr/bin/env bash\nprintf "arg=%s\\n" "$@"\nprintf "root=%s\\n" "${KNOT_DEPLOY_ROOT:-}"\n');
  chmodSync(stub, 0o755);

  execFileSync("tar", ["-czf", path.join(deployDir, "artifacts", artifact), "-C", stage, relName]);
  return { deployDir, relName, artifact };
}

test("经 ssh 拼接再拆词，每个值仍是原样（空串也还在）", async () => {
  const values = ["plain", "", "has space", "it's", "-"];
  const dir = await mkdtemp(path.join(tmpdir(), "knot-shq-"));
  const collect = path.join(dir, "collect.sh");
  await writeFile(
    collect,
    `set -eu
source "$KNOT_SSH_ARGS"
args=()
for value in ${values.map(bashLiteral).join(" ")}; do
  args+=("$(knot_shq "$value")")
done
printf '%s\\0' "\${args[@]}"
`
  );
  const probe = path.join(dir, "probe.sh");
  await writeFile(probe, 'n=0\nfor a in "$@"; do n=$((n+1)); printf "%d=[%s]\\n" "$n" "$a"; done\n');

  const tokens = execFileSync("bash", [collect], { env: { ...process.env, KNOT_SSH_ARGS: SSH_ARGS }, encoding: "utf8" })
    .split("\0")
    .slice(0, -1);
  assert.equal(tokens.length, values.length, "参数个数在拼接前就不对");

  const out = execFileSync("bash", ["-c", `bash ${bashLiteral(probe)} ${tokens.join(" ")}`], { encoding: "utf8" });
  assert.deepEqual(out.trim().split("\n"), values.map((value, index) => `${index + 1}=[${value}]`));
});

test("没带 --runtime 时 --bootstrap 仍然落在 bootstrap 上", async () => {
  const { deployDir, relName, artifact } = await makeDeployDir();
  const { stdout } = await runRemote(remoteInstall(), {
    DEPLOY_DIR: deployDir,
    REL_NAME: relName,
    ARTIFACT_BASE: artifact,
    KNOT_SITE: "demo",
    // 就是这个空串：旧写法把它直接当位置参数，ssh 一拼就没了。
    RUNTIME_ARG: "",
    BOOTSTRAP: "1",
  });

  const got = stdout
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("arg="))
    .map((line) => line.slice("arg=".length));
  assert.ok(got.includes("--bootstrap"), `远端没收到 --bootstrap：${got.join(" ")}`);
  assert.ok(!got.includes("--runtime"), `远端多收到一个 --runtime：${got.join(" ")}`);
  assert.ok(got.includes("--site") && got.includes("demo"), `站点参数不全：${got.join(" ")}`);
  assert.ok(got.includes(deployDir), `部署根不对：${got.join(" ")}`);
  assert.ok(stdout.includes(`root=${deployDir}`));
});

test("显式 --runtime launchd 与 --bootstrap 一起到，路径带空格也不拆开", async () => {
  const { deployDir, relName, artifact } = await makeDeployDir({ withSpace: true });
  assert.match(deployDir, / /, "这组用例要一个带空格的部署根");

  const { stdout } = await runRemote(remoteInstall(), {
    DEPLOY_DIR: deployDir,
    REL_NAME: relName,
    ARTIFACT_BASE: artifact,
    KNOT_SITE: "demo",
    RUNTIME_ARG: "launchd",
    BOOTSTRAP: "1",
  });

  const got = stdout
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("arg="))
    .map((line) => line.slice("arg=".length));
  const at = got.indexOf("--runtime");
  assert.ok(at >= 0, `远端没收到 --runtime：${got.join(" ")}`);
  assert.equal(got[at + 1], "launchd");
  assert.ok(got.includes("--bootstrap"));
  assert.ok(got.includes(deployDir), `部署根被空格拆开了：${got.join(" ")}`);
});

test("位次错开时当场说清原因，不把错值当运行时传下去", async () => {
  const { deployDir, relName, artifact } = await makeDeployDir();
  const { block } = remoteInstall();
  // 模拟旧写法的后果：空串消失后 bootstrap 前移，--runtime 收到 "1"。
  const remote = spawnSync(
    "bash",
    ["-c", `bash -s -- ${bashLiteral(deployDir)} ${bashLiteral(relName)} ${bashLiteral(artifact)} demo 1`],
    { input: block, encoding: "utf8" }
  );
  assert.equal(remote.status, 2, remote.stdout);
  assert.match(remote.stderr, /参数错位/);
  assert.match(remote.stderr, /第 5 个参数/);
});
