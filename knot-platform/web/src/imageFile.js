// 选图时的类型判定。
//
// 图片看 MIME；只有 MIME 为空时才看文件名。空类型时也只认已知的图片后缀，
// 不是「一律放行」：PDF、文本仍然在客户端就被挡住。少数相册与文件管理器不给出
// 类型（HEIC 最常见，从安卓应用里拷出来的 .jpg 也有），认后缀才不会让一张
// 该传的照片无声消失。

export const HEIC_TYPE = /^image\/hei[cf](-sequence)?$/i;
export const HEIC_NAME = /\.hei[cf](-sequence)?$/i;
// 只列服务端收的格式（HEIC/HEIF 会在客户端转成 JPEG）。
export const IMAGE_NAME = /\.(jpe?g|png|webp|gif|avif|hei[cf](-sequence)?)$/i;

// 有类型就以类型为准：改过扩展名的 HEIC 由服务端按内容判定，不靠猜。
export function isHeicFile(file) {
  const type = String(file?.type || "");
  if (HEIC_TYPE.test(type)) return true;
  return !type && HEIC_NAME.test(String(file?.name || ""));
}

export function looksLikeImage(file) {
  const type = String(file?.type || "");
  return type ? type.startsWith("image/") : IMAGE_NAME.test(String(file?.name || ""));
}
