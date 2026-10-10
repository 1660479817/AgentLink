import { Router } from "express";
import { requireRegistered } from "../middleware/auth.js";

/** Phase 0 占位：信息交换入口，统一 REGISTER_REQUIRED */
export function exchangeRouter({ pool }) {
  const router = Router();

  router.post("/intent", requireRegistered, async (req, res) => {
    const cardId = req.body?.card_id;
    if (!cardId) {
      return res.status(400).json({ error: "missing_card_id" });
    }
    const { rows } = await pool.query(
      "SELECT id, visibility FROM information_cards WHERE id = $1",
      [cardId]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });

    res.status(501).json({
      error: "NOT_IMPLEMENTED",
      message: "Msgbox / 交钥匙将在 Phase 1 开放；当前仅验证注册档可触达交换 API。",
      card_id: cardId,
    });
  });

  return router;
}
