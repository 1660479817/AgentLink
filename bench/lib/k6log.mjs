// 从 k6 的 stderr 里挑出它自己说的话。
//
// k6 的 console.warn 有两种写法：旧的 `WARN[0000] 消息`，新的
// `time="2026-10-23T14:00:00+08:00" level=warning msg="消息"`。setup 里
// 「信息流为空，卡片详情将跳过」这类提示只在这里出现；runK6 成功时会把
// stderr 丢掉，提示就只剩当时那一屏终端，两周后重读 summary.json 已经看不到了。
//
// 只认 warn / error：进度行、`level=info` 和 summary 本身都不算提示。

const LEGACY = /^(?:WARN|ERRO)\[[^\]]*\]\s*(.+)$/;
const STRUCTURED = /^time=\S+\s+level=(?:warn|warning|error)\s+msg="(.*)"$/;

export function k6Messages(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    const legacy = LEGACY.exec(line);
    const structured = STRUCTURED.exec(line);
    const message = legacy ? legacy[1] : structured ? structured[1] : "";
    if (message.trim()) out.push(message.trim());
  }
  return out;
}
