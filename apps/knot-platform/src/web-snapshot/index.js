import { loadWebDisplayConfig } from "../web-display-config.js";
import { composeHomeSurface, composePlazaSurface, composeMineSurface } from "./compose.js";
import { decodeCursor } from "./cursor.js";

export const VALID_SURFACES = new Set(["home", "plaza", "mine"]);

export { decodeCursor, encodeCursor } from "./cursor.js";

/**
 * 展示快照流水线：读库 → compose（内含 beautify）→ WebSnapshotResponse 载荷。
 * @param {import('pg').Pool} pool
 * @param {{
 *   surfaceNames: string[];
 *   viewer: { userId: string; email: string; displayName: string } | null;
 *   user: { id: string; email: string } | null;
 *   plaza?: { q?: string; limit?: number; cursorRaw?: string | null };
 *   webCfg?: Awaited<ReturnType<typeof loadWebDisplayConfig>>;
 * }} input
 */
export async function buildWebSnapshot(pool, input) {
  const webCfg = input.webCfg ?? (await loadWebDisplayConfig(pool));
  const surfaces = {};
  const errors = {};

  if (input.surfaceNames.includes("home")) {
    surfaces.home = await composeHomeSurface(pool, webCfg, input.viewer);
  }

  if (input.surfaceNames.includes("plaza")) {
    const pq = input.plaza ?? {};
    const q = String(pq.q ?? "").trim().slice(0, 80);
    const limit = Math.min(50, Math.max(1, Number(pq.limit) || webCfg.plazaDefaultLimit));
    const cursor = pq.cursorRaw ? decodeCursor(String(pq.cursorRaw)) : null;
    surfaces.plaza = await composePlazaSurface(pool, input.viewer, { q, limit, cursor });
  }

  if (input.surfaceNames.includes("mine")) {
    if (!input.user) {
      surfaces.mine = null;
      errors.mine = "REGISTER_REQUIRED";
    } else {
      surfaces.mine = await composeMineSurface(pool, input.user.id, input.user.email);
    }
  }

  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    refreshAfterMs: webCfg.refreshAfterMs,
    viewer: input.viewer,
    surfaces,
    errors,
  };
}
