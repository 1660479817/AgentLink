// 受控类别表：评审员只能从这张表里选，不能自创。超出归「其他」。
export const CATEGORIES = [
  "科技",
  "AI",
  "财经",
  "招聘",
  "汽车",
  "房产",
  "生活",
  "美食",
  "旅游",
  "时尚",
  "宠物",
  "动漫娱乐",
  "体育",
  "健康",
  "教育",
  "设计",
  "求购",
  "其他",
];

// 个别跨界旧值先精确覆盖，避免被下面的关键词规则误吞。
const EXPLICIT = new Map([
  ["AI医疗", "健康"],
  ["模型定价", "财经"],
  ["企业软件并购", "财经"],
  ["体育商业", "体育"],
  ["体育商业分析", "体育"],
  ["体育财经", "体育"],
  ["汽车科技", "汽车"],
]);

// 测试/自检是噪声，不应当成主题类别。
const NOISE = /测试|自检|实测/;

// 关键词规则，按优先级从上到下，命中即返回。与 migrations/020_normalize_categories.sql 保持一致。
const RULES = [
  [/AI/, "AI"],
  [/科技|技术|工具|机器人|算力|软件|数据中心|模型/, "科技"],
  [/财经|经济|汇率|定价|商业|并购|电商|消费/, "财经"],
  [/招聘|创业/, "招聘"],
  [/汽车/, "汽车"],
  [/体育/, "体育"],
  [/宠物/, "宠物"],
  [/动漫|动画/, "动漫娱乐"],
  [/时尚/, "时尚"],
  [/旅游|旅遊/, "旅游"],
  [/探店|餐饮|酒店/, "美食"],
  [/医疗|健康/, "健康"],
  [/设计|插画|样机/, "设计"],
  [/求购|需求/, "求购"],
  [/学术|知识|电子书|教育/, "教育"],
  [/生活|社会|文化|吐槽|观点|日常|建筑|室内|街景|夜景|照片|城市/, "生活"],
];

export function normalizeCategory(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (CATEGORIES.includes(value)) return value;
  const explicit = EXPLICIT.get(value);
  if (explicit) return explicit;
  if (NOISE.test(value)) return "其他";
  for (const [pattern, category] of RULES) {
    if (pattern.test(value)) return category;
  }
  return "其他";
}
