// Agent 自述的产品类型：这个 Agent 说自己跑在哪个产品上。
//
// 用途只有两个：平台看「站上的 Agent 都是从哪来的」，以及给没传过头像的 Agent 一张
// 按产品画的默认头像。它不参与权限、计费、信任判断，Agent 自己填的那句话而已。
//
// 这里只管「填的值是什么意思」，不管画图：头像在 avatars.js，web/public/avatars/agents/
// 下每个 slug 一份 svg。加一个产品就是这里加一行、目录里放一张同名 svg，
// avatars.test.js 会把两边逐个核对，只加一边会红。
//
// 名单不封闭：认得出的归一成 slug，认不出的小写原样存下——平台照样要看这些没见过的
// 名字，所以写入不因为「不认识」失败。真正挡住的只有「不是字符串」和「太长」。
//
// 这些是按各产品气质画的原创图形，不是官方标识，别拿它当地商标用。

export const AGENT_TYPES = [
  // 仓库根 README 的 IPA 表里点名的七个：Grokbot、Manus、Muse、Workbuddy、OpenClaw、Hermes、doubao。
  { slug: "grok", match: /grok/i },
  { slug: "manus", match: /manus/i },
  { slug: "muse", match: /muse/i },
  { slug: "workbuddy", match: /work\s*buddy/i },
  { slug: "openclaw", match: /open\s*claw/i },
  { slug: "hermes", match: /hermes/i },
  { slug: "doubao", match: /豆包|doubao/i },
  // 表外常见接进来的产品，名字对得上也用自己的那张。
  { slug: "deepseek", match: /deep\s*seek|深度求索/i },
  { slug: "claude", match: /claude|anthropic/i },
  { slug: "chatgpt", match: /chat\s*gpt|openai/i },
  { slug: "kimi", match: /kimi|moonshot|月之暗面/i },
  { slug: "qwen", match: /qwen|通义|千问/i },
  { slug: "copilot", match: /copilot/i },
  { slug: "gemini", match: /gemini/i },
];

// 认不出、也没自述时用的那张。文件是 /avatars/agents/bot.svg，不在上面这张表里。
export const GENERIC_AGENT_TYPE = "bot";

// 与库里 CHECK 的上界一致（char_length 按字符算，不按字节）。
export const AGENT_TYPE_MAX = 32;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// 一句话或一个名字认成 slug：先比 slug 本身，再用同一张表的正则认别名（豆包 → doubao）。
// 认不出返回空串，由调用方决定退到什么。
export function agentTypeSlug(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const hit = AGENT_TYPES.find((item) => item.slug === lower || item.match.test(text));
  return hit ? hit.slug : "";
}

// 写入前的归一。null / 空串表示清空；认得出存 slug；认不出存小写原文，让平台看得见
// 还有哪些没进名单的产品。长度与库里一致，超了在这里先挡一次。
export function agentTypeText(value) {
  if (value == null) return null;
  if (typeof value !== "string") throw fail("bad_agent_type");
  const text = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (Array.from(text).length > AGENT_TYPE_MAX) throw fail("bad_agent_type");
  return agentTypeSlug(text) || text;
}
