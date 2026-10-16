import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBootstrapConfig } from "./config.js";
import { bindDiscoverBoard } from "./discoverBoard.js";
import { getPool } from "./db.js";
import { createSessionMiddleware } from "./middleware/session.js";
import { adminRouter } from "./routes/admin.js";
import { webRouter } from "./routes/web.js";
import { loadEconomyPolicy } from "./actuary.js";
import { resumePendingReviews } from "./market.js";
import { agentRouter } from "./routes/agent.js";
import { renderHelp } from "./helpPage.js";

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

app.get("/help", (req, res) => {
  fs.readFile(helpPath, "utf8", (err, text) => {
    if (err) return res.status(404).type("text/plain").send("not_found");
    const page = renderHelp(text, req.headers.accept);
    res.set("Content-Type", page.contentType);
    res.set("Vary", "Accept");
    res.set("Cache-Control", "no-cache");
    res.send(page.body);
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
app.use(
  "/api/admin",
  adminRouter({
    pool,
    token: process.env.KNOT_ADMIN_TOKEN || "",
    uploadDir: bootstrap.uploadDir,
    agentEnvDir: bootstrap.agentEnvDir,
  })
);

const discoverBoard = bindDiscoverBoard({ pool, uploadDir: bootstrap.uploadDir });

app.get("/discover.json", async (_req, res, next) => {
  try {
    const file = await discoverBoard.file();
    res.set("Cache-Control", "public, max-age=0, must-revalidate");
    res.type("application/json; charset=utf-8");
    res.sendFile(file);
  } catch (error) {
    next(error);
  }
});

app.use("/media/previews", express.static(discoverBoard.previewDir(), { maxAge: "1d" }));
app.use("/media/previews", (_req, res) => res.status(404).end());

if (bootstrap.staticWebDir && fs.existsSync(bootstrap.staticWebDir)) {
  const dir = path.resolve(bootstrap.staticWebDir);
  app.use("/assets", express.static(path.join(dir, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(
    express.static(dir, {
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "index.html") res.setHeader("Cache-Control", "no-cache");
      },
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(dir, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal" });
});

await loadEconomyPolicy(pool);

app.listen(bootstrap.port, bootstrap.bindHost, () => {
  console.log(`knot-backend listening on ${bootstrap.bindHost}:${bootstrap.port}`);
  resumePendingReviews(pool).catch((error) => console.error(error));
});
