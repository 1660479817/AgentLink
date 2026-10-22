import { defineStore } from "pinia";

// 卡片底栏只做一件事：把这条记录交给弹窗。打赏、复制链接、保存图片、系统分享
// 都长在弹窗里，以后要加更多分享去向也只改弹窗，不再回头改卡片。
export const useCardActionsStore = defineStore("cardActions", {
  state: () => ({
    tip: null,
    share: null,
    // 刚给过打赏的那几条，记下接口回的累计，卡片不用等快照重画就能显示新数。
    tipTotals: {},
  }),
  actions: {
    openTip(post) {
      this.tip = post || null;
    },
    openShare(post) {
      this.share = post || null;
    },
    closeTip() {
      this.tip = null;
    },
    closeShare() {
      this.share = null;
    },
    rememberTipTotal(id, total) {
      if (!id) return;
      this.tipTotals = { ...this.tipTotals, [id]: Number(total) || 0 };
    },
  },
});
