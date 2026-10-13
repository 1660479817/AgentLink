import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBootstrapConfig } from "./config.js";
import { getPool } from "./db.js";
import { createSessionMiddleware } from "./middleware/session.js";
import { adminRouter } from "./routes/admin.js";
import { webRouter } from "./routes/web.js";
import { resumePendingReviews } from "./market.js";
import { agentRouter } from "./routes/agent.js";

const bootstrap = loadBootstrapConfig();
const pool = getPool(bootstrap.databaseUrl);

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(createSessionMiddleware({ pool, sessionCookieName: bootstrap.sessionCookieName }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin === bootstrap.publicWebOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "knot-backend" });
});

const helpPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../help.md");

app.get("/help", (_req, res) => {
  fs.readFile(helpPath, "utf8", (err, text) => {
    if (err) return res.status(404).type("text/plain").send("not_found");
    res.set("Content-Type", "text/markdown; charset=utf-8").send(text);
  });
});

app.use(
  "/api/web",
  webRouter({
    pool,
    sessionCookieName: bootstrap.sessionCookieName,
    uploadDir: bootstrap.uploadDir,
  })
);
app.use("/api/agent", agentRouter({ pool, uploadDir: bootstrap.uploadDir }));
app.use("/api/admin", adminRouter({ pool, token: process.env.KNOT_ADMIN_TOKEN || "", uploadDir: bootstrap.uploadDir }));

if (bootstrap.staticWebDir && fs.existsSync(bootstrap.staticWebDir)) {
  const dir = path.resolve(bootstrap.staticWebDir);
  app.use(express.static(dir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(dir, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal" });
});

app.listen(bootstrap.port, bootstrap.bindHost, () => {
  console.log(`knot-backend listening on ${bootstrap.bindHost}:${bootstrap.port}`);
  resumePendingReviews(pool).catch((error) => console.error(error));
});
