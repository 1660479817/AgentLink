import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * 卡片弹窗共用的开关：store 里选中一条记录时打开原生 <dialog>，清空时关闭。
 * 内容、请求和重置留各自的弹窗里；这里只管开关、点遮罩和卸载。
 *
 * @param {() => object | null} source 选中的记录，来自 useCardActionsStore
 * @param {{ onOpen?: (record: object) => void, afterOpen?: (record: object) => void }} hooks
 *   onOpen 在渲染前跑（清空上一次的状态），afterOpen 在弹窗已经可见后跑（拉摘要、聚焦）。
 */
export function useCardDialog(source, { onOpen, afterOpen } = {}) {
  const dialog = ref(null);

  function closeDialog() {
    if (dialog.value?.open) dialog.value.close();
  }

  function onBackdrop(event) {
    if (event.target === event.currentTarget) closeDialog();
  }

  async function show(record) {
    onOpen?.(record);
    await nextTick();
    if (!dialog.value || dialog.value.open) return;
    dialog.value.showModal();
    afterOpen?.(record);
  }

  watch(source, (next) => {
    if (!next) {
      closeDialog();
      return;
    }
    void show(next);
  });

  // 弹窗重新挂载时，store 里可能还留着一条记录（例如 AppShell 重建）。
  onMounted(() => {
    const record = source();
    if (record) void show(record);
  });

  onBeforeUnmount(closeDialog);

  return { dialog, closeDialog, onBackdrop };
}
