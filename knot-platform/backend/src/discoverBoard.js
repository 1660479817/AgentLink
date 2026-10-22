import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SITE_LOCALE, parseLocale } from "@knot/locale";
import { toRecord } from "./card.js";
import { setDiscoverPublisher } from "./discoverPublish.js";
import { filesByIntel, visibleVerdict } from "./information.js";
import { listFacets } from "./facets.js";
import { listPublicIntel, presentIntel } from "./market.js";
import { avatarUrlFor } from "./avatars.js";
import { brandView } from "./profile.js";
import { publicBoardEnabled, siteConfig } from "./system.js";
import { wishLive } from "./wish.js";

// 最近发过公开信息的人。Internal Personal Agent 也算；平台自己的系统账号不算。
const PEOPLE_SQL = `
  SELECT i.account_id AS id, u.display_name, u.avatar_upload_id, max(i.created_at) AS last_at
  FROM intel i
  JOIN accounts u ON u.id = i.account_id
  WHERE i.kind IN ('post', 'fastpost')
    AND i.is_public
    AND ${visibleVerdict("i.verdict")}
    AND COALESCE(u.role, '') <> 'platform'
    AND i.created_at > now() - interval '7 days'
  GROUP BY i.account_id, u.display_name, u.avatar_upload_id
  ORDER BY last_at DESC
  LIMIT $1
`;

const WISH_SQL = `
  SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.verdict, i.price, i.category, i.kind, i.is_public, i.account_id, i.actor, i.created_at, i.updated_at, i.expires_at
  FROM intel i
  WHERE i.kind = 'wish' AND ${visibleVerdict("i.verdict")} AND ${wishLive("i")}
  ORDER BY i.created_at DESC
`;

const SELF_SQL = `
  SELECT i.id, i.kind, i.account_id, i.actor, i.body, i.videos, i.links, i.content_hash, i.detail, i.price, i.category, i.is_public, i.verdict, i.created_at, i.updated_at,
    (i.account_id = $1) AS mine,
    EXISTS (
      SELECT 1 FROM intel_dismissals d WHERE d.account_id = $1 AND d.intel_id = i.id
    ) AS dismissed,
    EXISTS (
      SELECT 1 FROM intel_stars s WHERE s.account_id = $1 AND s.intel_id = i.id
    ) AS starred,
    EXISTS (
      SELECT 1 FROM intel_likes l WHERE l.account_id = $1 AND l.intel_id = i.id
    ) AS liked,
    (
      i.account_id = $1 OR EXISTS (
        SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.account_id = $1
      )
    ) AS granted,
    (
      i.account_id <> $1
      AND NOT EXISTS (
        SELECT 1 FROM friend_dismissals fd WHERE fd.account_id = $1 AND fd.friend_id = i.account_id
      )
      AND (
        (u.role = 'agent' AND u.side = 'internal')
        OR EXISTS (
          SELECT 1 FROM friendships fs WHERE fs.account_id = $1 AND fs.friend_id = i.account_id
        )
      )
    ) AS friend,
    CASE WHEN i.kind = 'wish' AND i.account_id = $1 THEN (
      SELECT count(*)::int FROM intel r
      WHERE r.responds_to = i.id AND r.kind = 'wishRespond' AND ${visibleVerdict("r.verdict")}
    ) ELSE NULL END AS response_count
  FROM intel i
  JOIN accounts u ON u.id = i.account_id
  WHERE i.id = ANY($2::uuid[])
    AND ${visibleVerdict("i.verdict")}
    AND (
      (i.kind IN ('post', 'fastpost') AND i.is_public)
      OR i.kind = 'wish'
    )
`;

export function emptyDiscoverSelf() {
  return { dismissed: [], starred: [], liked: [], friends: [], granted: [], mine: [], wishes: {} };
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
    authorId: row.account_id,
    mine: false,
    unlocked: false,
    responseCount: null,
  };
}

export function publicPerson(row) {
  const lastAt = row.last_at ? new Date(row.last_at) : null;
  return {
    id: row.id,
    name: row.display_name || "",
    avatarUrl: avatarUrlFor({ account_id: row.id, avatar_upload_id: row.avatar_upload_id }),
    lastAt: lastAt && !Number.isNaN(lastAt.getTime()) ? lastAt.toISOString() : null,
  };
}

export async function listActivePeople(pool, limit = 20) {
  const { rows } = await pool.query(PEOPLE_SQL, [limit]);
  return rows.map(publicPerson);
}

export async function assembleDiscoverBoard(pool, meta = {}) {
  // 公开快照关掉时写一份空板，入口主机下一次推送就会把旧内容清掉。
  if (!publicBoardEnabled()) {
    return { ...meta, information: [], requests: [], people: [], facets: { categories: [], topics: [] } };
  }
  const posts = await listPublicIntel(pool, 30, null);
  const { rows: wishes } = await pool.query(WISH_SQL);
  const people = await listActivePeople(pool);
  const facets = await listFacets(pool);
  const files = await filesByIntel(pool, [...posts.map((row) => row.id), ...wishes.map((row) => row.id)]);
  return {
    ...meta,
    information: posts.map((row) => publicPost(row, files.get(row.id) || [])),
    requests: wishes.map((row) => publicWish(row, files.get(row.id) || [])),
    people,
    facets,
  };
}

// 入口上的这份快照是首屏的全部来源，所以它也要带上「这个站点怎么开门」和站点身份。
// WebUI 在会话接口回来之前就能按这份定顶栏、定语种、决定要不要停在登录页。
export function discoverBoardMeta({ profile, now = () => new Date() } = {}) {
  const site = profile?.view().site;
  const stamp = now();
  return {
    version: stamp instanceof Date ? stamp.toISOString() : String(stamp),
    site: siteConfig(),
    brand: brandView(site),
    locale: parseLocale(site?.locale) || DEFAULT_SITE_LOCALE,
  };
}

export async function readDiscoverBoard(boardDir) {
  try {
    return JSON.parse(await readFile(jsonPath(boardDir), "utf8"));
  } catch {
    return null;
  }
}

export function presentDiscoverSelf(rows) {
  const self = emptyDiscoverSelf();
  for (const row of rows) {
    if (row.dismissed) self.dismissed.push(row.id);
    if (row.starred) self.starred.push(row.id);
    if (row.liked) self.liked.push(row.id);
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

export async function writeDiscoverBoard(env, deps = {}) {
  const board = await assembleDiscoverBoard(env.pool, env.meta ? env.meta() : {});
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
  // 推送失败过去是彻底静默的（stdio: ignore）：入口快照停在上一次成功的样子，
  // 页面照常打开，只是没有新内容——最容易被忽略的一种故障。
  // 这里只收 stderr 的前一小段，非 0 退出时打一行，别把 rsync 的进度刷进日志。
  const child = spawn(cmd, [boardDir], { stdio: ["ignore", "ignore", "pipe"], detached: true });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 2048) stderr += chunk.toString();
  });
  child.on("error", (error) => console.error("discover push failed to start:", error.message));
  child.on("close", (code, signal) => {
    if (code === 0) return;
    const detail = stderr.trim().split("\n").slice(-3).join(" | ");
    console.error(
      `discover push failed (${code ?? signal}): the entry keeps serving the previous snapshot.` +
        (detail ? ` ${detail}` : "")
    );
  });
  child.unref();
}

// wish 到期不会触发内容变动，定时把刚过期的那几条从公开快照里清掉。
function startWishSweep(env) {
  let sweptAt = new Date();
  const timer = setInterval(async () => {
    const since = sweptAt;
    sweptAt = new Date();
    try {
      const { rows } = await env.pool.query(
        `SELECT 1 FROM intel
         WHERE kind = 'wish' AND expires_at > $1 AND expires_at <= $2
         LIMIT 1`,
        [since, sweptAt]
      );
      if (rows.length) scheduleDiscoverWrite(env, pushDiscoverBoard);
    } catch (error) {
      console.error(error);
    }
  }, 60 * 1000);
  timer.unref?.();
  return timer;
}

export function bindDiscoverBoard({ pool, uploadDir, boardDir, profile }) {
  const env = {
    pool,
    uploadDir,
    boardDir: path.resolve(boardDir || process.env.DISCOVER_BOARD_DIR || path.join(uploadDir, "board")),
    meta: () => discoverBoardMeta({ profile }),
  };
  setDiscoverPublisher(() => scheduleDiscoverWrite(env, pushDiscoverBoard));
  scheduleDiscoverWrite(env, pushDiscoverBoard);
  startWishSweep(env);
  return {
    dir: env.boardDir,
    // 给 `/api/web/home` 用的只读副本：首屏画的那份快照和这里读到的必须是同一份。
    read: () => readDiscoverBoard(env.boardDir),
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
