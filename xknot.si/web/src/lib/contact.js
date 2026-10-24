// 门户右栏展示的运营者联系方式。
//
// 申请提交即自动通过，不需要人工处理；名字和邮箱只用来让申请人
// 知道有事找谁、往哪写。两个值都不是秘密，可以进构建产物。
//
// 默认值就是当前的运营方。换人时可以在构建前用环境变量覆盖，
// 不必改这一行：
//   VITE_XKNOT_OPERATOR_NAME="..." VITE_XKNOT_OPERATOR_EMAIL="..." npm run build

const env = import.meta.env || {};

function pick(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

export const OPERATOR_NAME = pick(env.VITE_XKNOT_OPERATOR_NAME, "PaulWang");
export const OPERATOR_EMAIL = pick(env.VITE_XKNOT_OPERATOR_EMAIL, "manwjh@gmail.com");
