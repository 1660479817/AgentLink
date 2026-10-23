import { defineConfig, devices } from "@playwright/test";

import { ADMIN } from "./browser/constants.mjs";

// 浏览器端到端跑在本地部署上：
//   ops/local-stack.mjs 起接口 + 本机入口（复刻 nginx 的路径与响应头）
//   数据用 fixtures 样例（--preview），不依赖外网与伙伴站点
//   管理员用环境变量在同一次启动里建好，用户名与口令只有 browser/constants.mjs 一份
//
// 端口固定为 5199，方便失败后直接打开看。

const PORT = 5199;

// 默认借本机已装的 Chrome（macOS / GitHub runner 都有），省掉一次几百 MB 的
// 浏览器下载。要跑 Playwright 自带的那份：
//   npx playwright install chromium
//   E2E_CHANNEL= npx playwright test
const channel = process.env.E2E_CHANNEL === undefined ? "chrome" : process.env.E2E_CHANNEL || undefined;

export default defineConfig({
  testDir: "./browser",
  // 误提交的 test.only 会让其余用例静默跳过、流水线照样绿。CI 里直接让它失败。
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(channel ? { channel } : {}),
        ...(process.env.E2E_EXECUTABLE ? { launchOptions: { executablePath: process.env.E2E_EXECUTABLE } } : {}),
      },
    },
  ],
  webServer: {
    // 每次跑都起一套新栈：数据目录、清单与名册都是临时副本（控制台的「编辑」会写回文件，
    // 不能改到仓库里的真清单）。目录由 trap 在进程退出时清掉。
    //
    // 不复用上一次留下的栈：复用分支不执行 command，注释承诺的「新数据目录」就不成立，
    // 用例可能对着旧代码、旧清单和旧会话跑绿（S24-08）。想留着一套手动栈看现场，
    // 就换一个端口（--port）再跑，别指望 Playwright 接上去。
    command: `D="$(mktemp -d -t xknot-ui)"; trap 'rm -rf "$D"' EXIT; cp ../instances.json "$D/instances.json"; cp ../federation.json "$D/federation.json"; node ../ops/local-stack.mjs --preview --port ${PORT} --data-dir "$D/data" --instances "$D/instances.json" --federation "$D/federation.json"`,
    // 管理员口令从环境变量进 local-stack，不写在命令行里：命令串会进进程表与日志。
    // 变量名以 XKNOT_ 开头，local-stack 的 cleanEnv 会把它从接口进程的环境里删掉。
    env: { XKNOT_E2E_ADMIN: `${ADMIN.username}:${ADMIN.password}` },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
