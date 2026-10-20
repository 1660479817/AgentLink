import { checkRuntime } from "@knot/config";

// Backend 启动前的配置闸门。
//
// 值不合法就退出：带着错的端口、错的连接串或不知道的开关跑起来，比不启动更难查。
// 必填项缺失只警告：站点还能读写，只是相关功能不可用（例如没有管理员邮箱就没有管理入口）。
// 未登记的键不在这里查：部署脚本会把 KNOT_DEPLOY_ROOT 这类脚本变量一起导出，
// 逐条报警只会淹没真正的问题；文件本身由 checkSite / checkPlatform 在部署时校验。
export function assertRuntimeConfig(env = process.env) {
  const { errors, warnings } = checkRuntime(env);
  for (const message of warnings) console.warn(`配置警告：${message}`);
  if (!errors.length) return;
  for (const message of errors) console.error(`配置错误：${message}`);
  console.error("Backend 没有启动：环境变量不合法。键的清单见 docs/CONFIG.md。");
  process.exit(1);
}
