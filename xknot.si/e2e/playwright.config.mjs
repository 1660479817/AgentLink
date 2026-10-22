import { defineConfig, devices } from "@playwright/test";

// 浏览器端到端跑在本地部署上：
//   ops/local-stack.mjs 起接口 + 本机入口（复刻 nginx 的路径与响应头）
//   数据用 fixtures 样例（--preview），不依赖外网与伙伴站点
//   管理员用 --admin 在同一次启动里建好，密码与 browser/constants.mjs 一致
//
// 端口固定为 5199，方便失败后直接打开看。reuseExistingServer 让本机
// 已经手动起了同一套栈时不再重复启动。

const PORT = 5199;

// 默认借本机已装的 Chrome（macOS / GitHub runner 都有），省掉一次几百 MB 的
// 浏览器下载。要跑 Playwright 自带的那份：
//   npx playwright install chromium
//   E2E_CHANNEL= npx playwright test
const channel = process.env.E2E_CHANNEL === undefined ? "chrome" : process.env.E2E_CHANNEL || undefined;

export default defineConfig({
  testDir: "./browser",
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
    // 每次跑都用新的数据目录：否则第二次运行会因为管理员已存在而起不来。
    // 清单与名册也用临时副本：控制台里的「编辑」会写回文件，不能改到仓库里的真清单。
    command: `D="$(mktemp -d -t xknot-ui)"; cp ../instances.json "$D/instances.json"; cp ../federation.json "$D/federation.json"; node ../ops/local-stack.mjs --preview --port ${PORT} --data-dir "$D/data" --instances "$D/instances.json" --federation "$D/federation.json" --admin e2e-admin:e2e-correct-horse-battery`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
