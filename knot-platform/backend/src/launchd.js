// 常驻单元的标签。
//
// launchd 的标签在用户命名空间里唯一，不按目录分。同一台机器上跑两个实例时，
// 同名标签会把前一个实例的单元 bootout 掉、换成自己的路径——部署 B 之后 A 停了，
// 而 A 的站点看起来一直正常，直到重启机器才发现它根本没在跑。
//
// 所以标签带上实例名，规则与 ops/scripts/lib/site-config.sh 的 knot_label 一致：
// com.knot.<实例>.<角色>，实例名缺省取部署根目录名，KNOT_INSTANCE 可覆盖。
import { basename } from "node:path";

export function knotInstance(env = process.env) {
  const configured = String(env.KNOT_INSTANCE || "").trim();
  if (configured) return configured;
  const root = String(env.KNOT_DEPLOY_ROOT || "").trim().replace(/\/+$/, "");
  return root ? basename(root) : "";
}

/**
 * knot_label 的等价物。没有部署根（开发机上 npm run dev）时退回不带实例名的标签：
 * 那种环境本来就没有常驻单元，这个字符串只会出现在「照着跑一次」的提示里。
 */
export function launchdLabel(role, env = process.env) {
  const instance = knotInstance(env);
  return instance ? `com.knot.${instance}.${role}` : `com.knot.${role}`;
}
