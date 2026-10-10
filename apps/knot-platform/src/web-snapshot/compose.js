import { readHomeFacts, readPlazaPage, readMineFacts } from "./readers.js";
import {
  beautifyCardRow,
  beautifyHomeCopy,
  beautifyHomeStats,
  beautifyIngestJobRow,
} from "./beautify.js";
import { encodeCursor } from "./cursor.js";

/** @typedef {import('pg').Pool} Pool */

export async function composeHomeSurface(pool, webCfg, _viewer) {
  const facts = await readHomeFacts(pool, webCfg);
  return {
    stats: beautifyHomeStats(facts.statsRaw, facts.statsTimezone),
    previewCards: facts.previewCardRows.map(beautifyCardRow),
    copy: beautifyHomeCopy(facts),
  };
}

export async function composePlazaSurface(pool, viewer, { q, limit, cursor }) {
  const page = await readPlazaPage(pool, viewer, { q, limit, cursor });
  const hasMore = page.cardRows.length > limit;
  const slice = hasMore ? page.cardRows.slice(0, limit) : page.cardRows;
  const last = slice[slice.length - 1];

  return {
    cards: slice.map(beautifyCardRow),
    pagination: {
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
      limit,
    },
    filters: { q: page.q },
  };
}

export async function composeMineSurface(pool, userId, email) {
  const facts = await readMineFacts(pool, userId);
  return {
    welcome: {
      email,
      agentTokenActive: facts.agentTokenActive,
      ingestProcessingCount: facts.ingestProcessingCount,
    },
    ingestJobs: facts.ingestJobRows.map(beautifyIngestJobRow),
    myCards: facts.myCardRows.map(beautifyCardRow),
    exchange: {
      msgboxUnread: 0,
      keysHandedOffToday: 0,
      threads: [],
      handoffs: [],
    },
  };
}
