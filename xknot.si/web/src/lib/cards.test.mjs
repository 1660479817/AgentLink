import assert from "node:assert/strict";
import test from "node:test";

import { cardState, hotCard, normalizeCards } from "./cards.js";

const NOW = new Date("2026-10-19T08:00:00Z");

function payload(overrides = {}) {
  return {
    formatVersion: 1,
    generatedAt: "2026-10-19T06:00:00.000Z",
    cards: [
      {
        id: "c-1",
        lang: "ja",
        title: "冬の観測機材",
        summary: "車に積める範囲で。",
        url: "https://sakura.xknot.si/notes/rig",
      },
    ],
    ...overrides,
  };
}

test("a card keeps title, summary, language and the https link", () => {
  const [card] = normalizeCards(payload());
  assert.deepEqual(card, {
    id: "c-1",
    title: "冬の観測機材",
    url: "https://sakura.xknot.si/notes/rig",
    summary: "車に積める範囲で。",
    lang: "ja",
    updatedAt: "2026-10-19T06:00:00.000Z",
  });
});

test("a card without a title or an https url is dropped, not patched", () => {
  const cards = normalizeCards({
    ...payload(),
    cards: [
      { title: "no url" },
      { title: "ftp", url: "ftp://sakura.xknot.si/a" },
      { title: "plain http", url: "http://sakura.xknot.si/a" },
      { title: "kept", url: "https://sakura.xknot.si/kept" },
    ],
  });
  assert.deepEqual(
    cards.map((card) => card.title),
    ["kept"]
  );
});

test("the list is capped so one node cannot take over the directory", () => {
  const cards = normalizeCards(
    {
      ...payload(),
      cards: Array.from({ length: 6 }, (_, index) => ({
        title: `note ${index}`,
        url: `https://sakura.xknot.si/${index}`,
      })),
    },
    { max: 2 }
  );
  assert.deepEqual(
    cards.map((card) => card.title),
    ["note 0", "note 1"]
  );
});

test("long fields are clipped instead of rejected", () => {
  const [card] = normalizeCards({
    ...payload(),
    cards: [{ title: "あ".repeat(120), summary: "b".repeat(300), url: "https://a.test/x" }],
  });
  assert.equal(card.title.length, 80);
  assert.equal(card.summary.length, 160);
  assert.ok(card.title.endsWith("…"));
});

test("a payload without cards or with a broken shape yields an empty list", () => {
  assert.deepEqual(normalizeCards(null), []);
  assert.deepEqual(normalizeCards({ cards: "nope" }), []);
  assert.deepEqual(normalizeCards({ cards: [] }), []);
});

test("an invalid generatedAt leaves the age unknown rather than inventing a date", () => {
  const [card] = normalizeCards(payload({ generatedAt: "yesterday" }));
  assert.equal(card.updatedAt, null);
  assert.equal(cardState(card.updatedAt, NOW), "unknown");
});

test("freshness steps at one day, one week and one month", () => {
  assert.equal(cardState("2026-10-19T07:30:00.000Z", NOW), "fresh");
  assert.equal(cardState("2026-10-18T04:00:00.000Z", NOW), "recent");
  assert.equal(cardState("2026-10-11T08:00:00.000Z", NOW), "aging");
  assert.equal(cardState("2026-09-01T08:00:00.000Z", NOW), "stale");
  assert.equal(cardState(null, NOW), "unknown");
});

test("the hot slot skips stale cards and falls back to nothing", () => {
  const cards = [
    { id: "old", title: "old", url: "https://a.test/old", updatedAt: "2026-08-01T08:00:00.000Z" },
    { id: "new", title: "new", url: "https://a.test/new", updatedAt: "2026-10-19T07:00:00.000Z" },
  ];
  assert.equal(hotCard(cards, NOW).id, "new");
  assert.equal(hotCard([cards[0]], NOW), null);
  assert.equal(hotCard(null, NOW), null);
});
