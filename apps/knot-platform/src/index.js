import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { loadBootstrapConfig } from "./config.js";
import { getPool } from "./db.js";
import { createSessionMiddleware } from "./middleware/session.js";
import { authRouter } from "./routes/auth.js";
import { uploadsRouter } from "./routes/uploads.js";
import { ingestJobsRouter } from "./routes/ingest-jobs.js";
import { cardsRouter } from "./routes/cards.js";
import { agentRouter } from "./routes/agent.js";
import { exchangeRouter } from "./routes/exchange.js";
import { demandsRouter } from "./routes/demands.js";
import { webSnapshotRouter } from "./routes/web-snapshot.js";
import { loadPlatformSettings } from "./system-config.js";

const bootstrap = loadBootstrapConfig();
const pool = getPool(bootstrap.databaseUrl);
fs.mkdirSync(bootstrap.uploadDir, { recursive: true });

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
  createSessionMiddleware({
    pool,
    sessionCookieName: bootstrap.sessionCookieName,
  })
);

app.use(async (req, res, next) => {
  try {
    req.platform = await loadPlatformSettings(pool);
  } catch (e) {
    console.error("[platform-settings]", e);
    req.platform = null;
  }
  const origin = req.headers.origin;
  const publicOrigin = req.platform?.publicWebOrigin;
  if (publicOrigin && origin === publicOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Knot-Email");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "knot-platform" });
});

app.use("/api/auth", authRouter({ pool, sessionCookieName: bootstrap.sessionCookieName }));
app.use("/api/uploads", uploadsRouter({ pool, uploadDir: bootstrap.uploadDir }));
app.use("/api/ingest-jobs", ingestJobsRouter({ pool }));
app.use("/api/cards", cardsRouter({ pool }));
app.use("/api/exchange", exchangeRouter({ pool }));
app.use("/api/demands", demandsRouter({ pool }));
app.use("/api/web", webSnapshotRouter({ pool }));
app.use("/api/agent", agentRouter({ pool }));

app.use("/uploads", express.static(bootstrap.uploadDir));

if (bootstrap.staticWebDir && fs.existsSync(bootstrap.staticWebDir)) {
  app.use(express.static(bootstrap.staticWebDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
      return next();
    }
    res.sendFile(path.join(bootstrap.staticWebDir, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  if (err?.message === "bad_mime") {
    return res.status(400).json({ error: "bad_mime" });
  }
  console.error(err);
  res.status(500).json({ error: "internal" });
});

app.listen(bootstrap.port, bootstrap.bindHost, () => {
  console.log(`knot-platform listening on ${bootstrap.bindHost}:${bootstrap.port}`);
  console.log(`uploads: ${path.resolve(bootstrap.uploadDir)}`);
  console.log("platform settings: PostgreSQL system_config.platform");
});
