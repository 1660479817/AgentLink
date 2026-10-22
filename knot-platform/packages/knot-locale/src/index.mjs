// 语种标记的唯一一份清单。Backend、WebUI、管理后台与运维脚本都从这里取。
//
// 界面语种只看两个来源：站点默认（主理人在 /admin 里设）与这个人自己的选择。
// 不按访客 IP、不按 Accept-Language、不按 navigator.languages 猜；这里也就没有那些函数。

export const LOCALES = ["zh-CN", "zh-TW", "en"];

/**
 * 站点还没建档案、或档案还没写这一项时的占位。
 * 它不是「回退链」的一环：档案一保存，主理人写的那一个就唯一生效。
 */
export const DEFAULT_SITE_LOCALE = "zh-CN";

export function isLocale(value) {
  return LOCALES.includes(value);
}

/** 接口里的语种：只收这三个，其他值（包括空串）当没给。 */
export function parseLocale(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return LOCALES.includes(text) ? text : null;
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 迁移期用：档案里还没有 `locale` 时，按文案推一个写进去。
 * 只在迁移与表单预填时调用，运行时判定链里没有它。
 * 含中日韩字符就当简中（繁体由主理人自己改），否则英文。
 */
export function inferLocale(text) {
  return CJK.test(String(text ?? "")) ? "zh-CN" : "en";
}

// 话题标签用字：汉字、假名与谚文。拉丁字母、数字与标点不算。
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const KANA = /[\u3040-\u30ff]/;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

/** 这段文字里有没有中日韩文字。 */
export function hasCjkScript(text) {
  const value = String(text ?? "");
  return HAN.test(value) || KANA.test(value) || HANGUL.test(value);
}

/**
 * 话题标签是否与内容语种同一写法。
 *
 * 标签跟着正文走，不跟着界面语种走：英文帖写英文标签，中文帖写中文标签。
 * - 语种没写（空、`und`）时不拦；
 * - 中日韩正文允许任何写法（`AI`、`API` 这类专有名词本来就留原文）；
 * - 其他语种的正文不收含中日韩文字的标签。
 */
export function topicMatchesLanguage(topic, language) {
  const base = String(language ?? "").trim().toLowerCase().split("-")[0];
  if (!base || base === "und") return true;
  if (base === "zh" || base === "ja" || base === "ko") return true;
  return !hasCjkScript(topic);
}
