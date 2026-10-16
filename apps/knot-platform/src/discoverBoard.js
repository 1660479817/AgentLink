import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { toRecord } from "./card.js";
import { setDiscoverPublisher } from "./discoverPublish.js";
import { fileView, visibleVerdict } from "./information.js";
import { listPublicIntel, presentIntel } from "./market.js";

const WISH_SQL = `
  SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.verdict, i.price, i.category, i.kind, i.is_public, i.user_id, i.actor, i.created_at, i.updated_at
  FROM intel i
  WHERE i.kind = 'wish' AND ${visibleVerdict("i.verdict")}
  ORDER BY i.created_at DESC
`;

const SELF_SQL = `
  SELECT i.id, i.kind, i.user_id, i.actor, i.body, i.videos, i.links, i.content_hash, i.detail, i.price, i.category, i.is_public, i.verdict, i.created_at, i.updated_at,
    (i.user_id = $1) AS mine,
    EXISTS (
      SELECT 1 FROM intel_dismissals d WHERE d.user_id = $1 AND d.intel_id = i.id
    ) AS dismissed,
    EXISTS (
      SELECT 1 FROM intel_stars s WHERE s.user_id = $1 AND s.intel_id = i.id
    ) AS starred,
    (
      i.user_id = $1 OR EXISTS (
        SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.user_id = $1
      )
    ) AS granted,
    (
      i.user_id <> $1
      AND NOT EXISTS (
        SELECT 1 FROM friend_dismissals fd WHERE fd.user_id = $1 AND fd.friend_id = i.user_id
      )
      AND (
        u.side = 'internal'
        OR EXISTS (
          SELECT 1 FROM friendships fs WHERE fs.user_id = $1 AND fs.friend_id = i.user_id
        )
      )
    ) AS friend,
    CASE WHEN i.kind = 'wish' AND i.user_id = $1 THEN (
      SELECT count(*)::int FROM intel r
      WHERE r.responds_to = i.id AND r.kind = 'wishRespond' AND ${visibleVerdict("r.verdict")}
    ) ELSE NULL END AS response_count
  FROM intel i
  JOIN users u ON u.id = i.user_id
  WHERE i.id = ANY($2::uuid[])
    AND ${visibleVerdict("i.verdict")}
    AND (
      (i.kind IN ('post', 'fastpost') AND i.is_public)
      OR i.kind = 'wish'
    )
`;

export function emptyDiscoverSelf() {
  return { dismissed: [], starred: [], friends: [], granted: [], mine: [], wishes: {} };
}

function publicPost(row, files) {
  return {
    role: "intel",
    ...presentIntel({
      ...row,
      attachments: files,
      granted: false,
      starred: false,
    }),
    friend: false,
    canFriend: false,
    mine: false,
    personal: false,
  };
}

function publicWish(row, files) {
  return {
    ...toRecord(row, { files, granted: false }),
    authorId: row.user_id,
    mine: false,
    unlocked: false,
    responseCount: null,
  };
}

async function filesByIntel(pool, ids) {
  const byId = new Map();
  if (!ids.length) return byId;
  const { rows } = await pool.query(
    `SELECT f.intel_id, u.id, u.mime, u.original_name, u.size
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = ANY($1::uuid[])
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [ids]
  );
  for (const row of rows) {
    const list = byId.get(row.intel_id) || [];
    list.push(fileView(row));
    byId.set(row.intel_id, list);
  }
  return byId;
}

export async function assembleDiscoverBoard(pool) {
  const posts = await listPublicIntel(pool, 30, null);
  const { rows: wishes } = await pool.query(WISH_SQL);
  const files = await filesByIntel(pool, [...posts.map((row) => row.id), ...wishes.map((row) => row.id)]);
  return {
    information: posts.map((row) => publicPost(row, files.get(row.id) || [])),
    requests: wishes.map((row) => publicWish(row, files.get(row.id) || [])),
  };
}

export function presentDiscoverSelf(rows) {
  const self = emptyDiscoverSelf();
  for (const row of rows) {
    if (row.dismissed) self.dismissed.push(row.id);
    if (row.starred) self.starred.push(row.id);
    if (row.friend) self.friends.push(row.id);
    if (row.granted) self.granted.push(row.id);
    if (row.mine) self.mine.push(row.id);
    if (row.kind === "wish" && row.mine) self.wishes[row.id] = { responseCount: Number(row.response_count) || 0 };
  }
  return self;
}

export async function loadDiscoverSelf(pool, userId, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!userId || !unique.length) return emptyDiscoverSelf();
  const { rows } = await pool.query(SELF_SQL, [userId, unique]);
  return presentDiscoverSelf(rows);
}

function jsonPath(boardDir) {
  return path.join(boardDir, "discover.json");
}

export function previewDir(boardDir) {
  return path.join(boardDir, "media", "previews");
}

export async function writeDiscoverBoard(env, deps = {}) {
  const board = await assembleDiscoverBoard(env.pool);
  const dir = previewDir(env.boardDir);
  const existing = await readdir(dir).catch(() => []);
  for (const name of existing) await rm(path.join(dir, name), { force: true });
  const dest = jsonPath(env.boardDir);
  const tmp = `${dest}.${randomUUID()}.tmp`;
  await mkdir(env.boardDir, { recursive: true });
  await writeFile(tmp, JSON.stringify(board));
  await rename(tmp, dest);
  if (deps.push) deps.push(env.boardDir);
  return board;
}

let dirty = false;
let wait = null;
let chain = Promise.resolve();

export function scheduleDiscoverWrite(env, push) {
  dirty = true;
  if (wait) return;
  wait = setTimeout(() => {
    wait = null;
    const run = async () => {
      while (dirty) {
        dirty = false;
        await writeDiscoverBoard(env, { push });
      }
    };
    chain = chain.then(run).catch((error) => console.error(error));
  }, 200);
  wait.unref?.();
}

export function pushDiscoverBoard(boardDir) {
  const cmd = process.env.KNOT_DISCOVER_PUSH_CMD;
  if (!cmd || !boardDir) return;
  const child = spawn(cmd, [boardDir], { stdio: "ignore", detached: true });
  child.on("error", (error) => console.error(error));
  child.unref();
}

export function bindDiscoverBoard({ pool, uploadDir, boardDir }) {
  const env = {
    pool,
    uploadDir,
    boardDir: path.resolve(boardDir || process.env.DISCOVER_BOARD_DIR || path.join(uploadDir, "board")),
  };
  setDiscoverPublisher(() => scheduleDiscoverWrite(env, pushDiscoverBoard));
  fs.mkdirSync(previewDir(env.boardDir), { recursive: true });
  scheduleDiscoverWrite(env, pushDiscoverBoard);
  return {
    dir: env.boardDir,
    previewDir: () => previewDir(env.boardDir),
    file: async () => {
      const file = jsonPath(env.boardDir);
      try {
        await access(file);
      } catch {
        await writeDiscoverBoard(env, { push: pushDiscoverBoard });
      }
      return file;
    },
  };
}
