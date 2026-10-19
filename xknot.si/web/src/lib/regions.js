// 中枢的区域分组。区域由实例清单里的 ISO 3166-1 alpha-2 代码推出，
// 不写进清单，也不参与排序。分组顺序固定，避免页面顺序漂移。
//
// 规则见 docs/I18N.md 第 2 节。

export const REGION_GROUPS = [
  "global",
  "east-asia",
  "southeast-asia",
  "south-asia",
  "central-asia",
  "middle-east",
  "europe",
  "north-america",
  "latin-america",
  "africa",
  "oceania",
  "other",
];

const COUNTRY_GROUP = new Map();

function put(group, codes) {
  for (const code of codes) COUNTRY_GROUP.set(code, group);
}

put("east-asia", ["CN", "HK", "MO", "TW", "JP", "KR", "MN"]);
put("southeast-asia", ["SG", "MY", "TH", "VN", "ID", "PH", "BN", "KH", "LA", "MM", "TL"]);
put("south-asia", ["IN", "PK", "BD", "LK", "NP", "BT", "MV", "AF"]);
put("central-asia", ["KZ", "UZ", "KG", "TJ", "TM"]);
put("middle-east", ["AE", "SA", "QA", "KW", "BH", "OM", "IL", "TR", "IR", "IQ", "JO", "LB", "EG", "YE", "SY", "PS"]);

put("europe", [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "GB", "CH", "NO", "IS", "RS", "UA", "MD", "BA", "MK", "AL", "ME", "AD", "MC", "SM", "LI", "VA",
]);

put("north-america", ["US", "CA", "MX", "GL", "BM"]);
put("latin-america", [
  "AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GT", "HT", "HN",
  "NI", "PA", "PY", "PE", "PR", "UY", "VE", "BZ", "JM", "TT", "BB", "BS", "GD",
]);
put("africa", [
  "DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CV", "CF", "TD", "KM", "CG", "CD",
  "CI", "DJ", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS",
  "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW",
  "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "ZM", "ZW",
]);
put("oceania", ["AU", "NZ", "PG", "FJ", "SB", "VU", "WS", "TO", "KI", "FM", "MH", "PW", "NR", "TV", "NC", "PF"]);

export const COUNTRY_CODES = new Set([...COUNTRY_GROUP.keys(), "GLOBAL"]);

export function isCountryCode(value) {
  return typeof value === "string" && COUNTRY_CODES.has(value);
}

export function groupOf(code) {
  if (code === "GLOBAL") return "global";
  return COUNTRY_GROUP.get(code) || "other";
}

// 一个实例可以覆盖多个国家。覆盖三个以上分组，或声明 GLOBAL，就是全球。
export function groupsOf(regions) {
  const list = Array.isArray(regions) ? regions : [];
  if (list.includes("GLOBAL")) return ["global"];
  const groups = new Set();
  for (const code of list) groups.add(groupOf(code));
  if (groups.size === 0) return [];
  if (groups.size >= 3) return ["global"];
  return REGION_GROUPS.filter((group) => groups.has(group));
}
