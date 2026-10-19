// 预览用的样例清单合并。
//
// fixtures/ 里的十条伙伴条目只用于看版式，不写进 instances.json。
// 真实清单里已经有同名 id 时以真实条目为准，样例只补空缺。
// 用法见 ops/build-hub.sh --preview 与 web/vite.config.js 的 XKNOT_PREVIEW。

export const PREVIEW_INSTANCES_PATH = "fixtures/preview-instances.json";
export const PREVIEW_HEALTH_PATH = "fixtures/preview-health.json";

/**
 * 把样例条目和样例状态并进真实数据。
 * @param {{ instances?: unknown[] }} manifest
 * @param {{ checkedAt?: string, instances?: Record<string, unknown> }} health
 * @param {{ instances?: unknown[] }} previewManifest
 * @param {{ checkedAt?: string, instances?: Record<string, unknown> }} previewHealth
 */
export function mergePreview(manifest, health, previewManifest, previewHealth) {
  const real = Array.isArray(manifest?.instances) ? manifest.instances : [];
  const samples = Array.isArray(previewManifest?.instances) ? previewManifest.instances : [];

  const taken = new Set(real.map((item) => item?.id));
  const instances = [...real, ...samples.filter((item) => item?.id && !taken.has(item.id))];

  // 真实探测结果优先，样例只补没有探过的 id。
  const states = {
    ...(previewHealth?.instances || {}),
    ...(health?.instances || {}),
  };

  return {
    manifest: { ...manifest, instances },
    health: {
      checkedAt: health?.checkedAt || previewHealth?.checkedAt || null,
      instances: states,
    },
  };
}
