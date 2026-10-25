// 对外公开的站点档案。中枢按 instances.json 里的 url 取这一份。
//
// 只读、无鉴权：内容与门户上显示的一样，本来就要公开。签发区来自接入件
// （中枢在签发时写入，节点只读），自述区来自 sites/<站点>/profile.json
// （主理人在 /admin 里写）。契约见 xknot.si/docs/FEDERATION.md 第 4 节。

import { Router } from "express";
import { federationStatus } from "../federation.js";
import { FORMAT_VERSION } from "../profile.js";

export function federationRouter({ profile, agentEnvDir = null, publicWebOrigin = "" }) {
  const router = Router();

  router.get("/profile", (_req, res) => {
    const running = federationStatus({ agentEnvDir, publicWebOrigin }).running || {};
    if (!running.instanceId) {
      // 没接入的站点没有签发区，也就没有可对外的档案。
      return res.status(404).json({ error: "not_joined" });
    }
    const state = profile.view();
    res.set("Cache-Control", "no-cache");
    res.json({
      formatVersion: FORMAT_VERSION,
      issued: {
        id: running.instanceId,
        url: running.issuedUrl || String(publicWebOrigin || "").replace(/\/+$/, ""),
        since: running.issuedAt || null,
        // 空值报 null：那是「中枢还没告知」，不是某一档。这里不替中枢选一个默认档。
        tier: running.tier || null,
        status: running.status || null,
      },
      site: state.site,
      updatedAt: state.updatedAt,
    });
  });

  return router;
}
