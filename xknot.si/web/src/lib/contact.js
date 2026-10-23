// 门户上的运营方联系方式。
//
// 门户已不再收申请表：这里出现在右栏「如何加入」的末尾，
// 是四步走不通、或不知道找谁时的那一个出口。两个值都不是秘密，可以进构建产物。
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
