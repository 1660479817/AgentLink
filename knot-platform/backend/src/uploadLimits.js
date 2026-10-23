// 上传上限的唯一来源：Web 门与 Agent 门读同一组环境变量。
//
// 以前两处各写一份：Web 读 KNOT_UPLOAD_*_MAX_BYTES，Agent 门写死 8/8/50MB。
// 实例把上限调大以后，同一个文件在网页能传、走 Agent 接口却回 file_too_large。
// 默认值本来就写在 packages/knot-config/src/schema.mjs，这里只补上读取。

export const MiB = 1024 * 1024;

// 环境变量只做覆盖：不是正整数就当没写，退回默认值。
export function envBytes(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function imageMaxBytes() {
  return envBytes("KNOT_UPLOAD_IMAGE_MAX_BYTES", 8 * MiB);
}

export function audioMaxBytes() {
  return envBytes("KNOT_UPLOAD_AUDIO_MAX_BYTES", 8 * MiB);
}

export function attachmentMaxBytes() {
  return envBytes("KNOT_UPLOAD_ATTACHMENT_MAX_BYTES", 50 * MiB);
}
