// 通知的标题与正文在库里有中文原文（Agent 直接读那两份），这里按界面语言重排。
// 新记录带 `data`，取值是金额、等级、禁言期限、审核错误码这些结构化的东西；
// 旧记录没有 `data`，退回原文，不把中文硬翻成别的语言。
// 这里不直接取 i18n：t 与当前语种由调用方传入，渲染逻辑可以单独测。
function lookup(text, key) {
  return text === key ? null : text;
}

export function createNoticeText(translate, currentLocale) {
  function message(key) {
    return lookup(translate(key), key);
  }

  function dataOf(item) {
    const value = item?.data;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  // 一句平台话后面跟一句人写的原因。中文不加空格，英文加。
  function sentences(parts) {
    return parts
      .filter((part) => part != null && String(part).trim() !== "")
      .join(currentLocale() === "en" ? " " : "");
  }

  function withNote(lead, note) {
    return sentences([lead, note]);
  }

  function formatMoment(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function names(list) {
    return list.join(translate("notifications.listSeparator"));
  }

  function noticeTitle(item) {
    return message(`notifications.kinds.${item?.kind}`) || item?.title || "";
  }

  function noticeBody(item) {
    const data = dataOf(item);
    if (!Object.keys(data).length) return item?.body || "";
    switch (item?.kind) {
      case "points_granted":
        if (data.amount == null || !Number.isFinite(Number(data.amount))) return item.body || "";
        return withNote(translate("notifications.body.pointsGranted", { amount: data.amount }), data.note);
      case "muted": {
        const lead = data.until
          ? translate("notifications.body.mutedUntil", { until: formatMoment(data.until) })
          : translate("notifications.body.mutedForever");
        return withNote(lead, data.note);
      }
      case "entitled": {
        const granted = Array.isArray(data.granted) ? data.granted.filter(Boolean) : [];
        const revoked = Array.isArray(data.revoked) ? data.revoked.filter(Boolean) : [];
        const parts = [];
        if (granted.length) parts.push(translate("notifications.body.entitledGranted", { names: names(granted) }));
        if (revoked.length) parts.push(translate("notifications.body.entitledRevoked", { names: names(revoked) }));
        return sentences([...parts, data.note]);
      }
      case "level_changed":
        if (data.level == null || !Number.isFinite(Number(data.level))) return item.body || "";
        return withNote(translate("notifications.body.level", { level: data.level }), data.note);
      case "intel_review_error": {
        if (!data.code) return item.body || "";
        const label = message(`notifications.review.${data.code}`) || translate("notifications.review.other");
        const lead = translate("notifications.body.reviewError", { label, code: data.code });
        return sentences([lead, data.detail, translate("notifications.body.reviewTail")]);
      }
      case "store_sold":
        if (data.price == null || !Number.isFinite(Number(data.price))) return item.body || "";
        return translate("notifications.body.storeSold", {
          buyer: data.buyer || translate("notifications.body.storeBuyer"),
          price: data.price,
        });
      case "tip":
        if (data.amount == null || !Number.isFinite(Number(data.amount))) return item.body || "";
        return translate("notifications.body.tip", {
          giver: data.giver || translate("notifications.body.tipSomeone"),
          amount: data.amount,
        });
      case "intel_removed":
        return data.platformClosed ? translate("notifications.body.removedByPlatform") : item.body || "";
      default:
        return item?.body || "";
    }
  }

  return { noticeTitle, noticeBody };
}
