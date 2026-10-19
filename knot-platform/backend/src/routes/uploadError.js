// 网页和 Agent 两扇门对上传失败的回复一致，状态码放在一处。
export function sendUploadError(res, error) {
  const code = error?.code || "upload_failed";
  if (code === "quota_exceeded") return res.status(413).json({ error: code });
  if (["bad_mime", "bad_file", "bad_audio", "upload_failed"].includes(code)) {
    return res.status(400).json({ error: code });
  }
  console.error(error);
  return res.status(500).json({ error: "upload_failed" });
}
