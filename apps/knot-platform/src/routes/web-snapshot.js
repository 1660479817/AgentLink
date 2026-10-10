import { Router } from "express";
import { buildWebSnapshot, VALID_SURFACES } from "../web-snapshot/index.js";

export function webSnapshotRouter({ pool }) {
  const router = Router();

  router.get("/v1/snapshot", async (req, res) => {
    try {
      const rawSurfaces = String(req.query.surfaces || "home,plaza")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const s of rawSurfaces) {
        if (!VALID_SURFACES.has(s)) {
          return res.status(400).json({ error: "bad_surface", surface: s });
        }
      }

      const viewer = req.user
        ? {
            userId: req.user.id,
            email: req.user.email,
            displayName: req.user.email.split("@")[0] || req.user.email,
          }
        : null;

      const body = await buildWebSnapshot(pool, {
        surfaceNames: rawSurfaces,
        viewer,
        user: req.user ?? null,
        plaza: {
          q: String(req.query["plaza.q"] || req.query.q || ""),
          limit: req.query["plaza.limit"],
          cursorRaw: req.query["plaza.cursor"] ?? null,
        },
      });

      res.json(body);
    } catch (e) {
      console.error("[web-snapshot]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}
