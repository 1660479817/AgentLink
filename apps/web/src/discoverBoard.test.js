import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { applyDiscoverSelf, cardIsMine, coveredBy, hideDiscoverItem, paintDiscover, rememberAhead, rememberDiscover, showDiscoverItem } from "./discoverBoard.js";

beforeEach(() => {
  showDiscoverItem("11111111-1111-4111-8111-111111111111");
  showDiscoverItem("55555555-5555-4555-8555-555555555555");
  rememberAhead(null);
  rememberDiscover(null);
});

const ME = "33333333-3333-4333-8333-333333333333";
const POST = "11111111-1111-4111-8111-111111111111";
const WISH = "22222222-2222-4222-8222-222222222222";
const FRESH = "55555555-5555-4555-8555-555555555555";

test("a wish is mine when the author is the current user", () => {
  const painted = paintDiscover(
    {
      information: [{ id: POST, personal: false, canFriend: false, mine: false }],
      requests: [{ id: WISH, authorId: ME, responseCount: null }],
    },
    ME
  );
  assert.equal(painted.requests[0].mine, true);
  assert.equal(painted.requests[0].responseCount, null);
  assert.equal(cardIsMine(painted.information[0], { id: ME }), false);
});

test("the personal patch hides, stars, and unlocks only after it arrives", () => {
  const painted = paintDiscover(
    {
      information: [
        { id: POST, personal: false, audio: [{ name: "a.mp3", stored: true }] },
        { id: FRESH, personal: false },
      ],
      requests: [{ id: WISH, authorId: ME, mine: true, responseCount: null }],
    },
    ME
  );
  const next = applyDiscoverSelf(painted, {
    dismissed: [FRESH],
    starred: [POST],
    friends: [POST],
    granted: [],
    mine: [],
    audio: { [POST]: [{ name: "a.mp3", stored: true, url: "/api/web/uploads/sound" }] },
    wishes: { [WISH]: { responseCount: 3 } },
  });
  assert.deepEqual(next.information.map((item) => item.id), [POST]);
  assert.equal(next.information[0].personal, true);
  assert.equal(next.information[0].starred, true);
  assert.equal(next.information[0].friend, true);
  assert.equal(next.information[0].canFriend, true);
  assert.equal(next.information[0].audio[0].url, "/api/web/uploads/sound");
  assert.equal(cardIsMine(next.information[0], { id: ME }), false);
  assert.equal(next.requests[0].responseCount, 3);
});

test("a card is mine only after the personal patch says so", () => {
  assert.equal(cardIsMine({ personal: true, mine: true, canFriend: false }, { id: ME }), true);
  assert.equal(cardIsMine({ canFriend: false }, { id: ME }), true);
  assert.equal(cardIsMine({ canFriend: false }, null), false);
});

test("a locally hidden card stays hidden, and a new post waits for the snapshot", () => {
  rememberDiscover({ information: [{ id: POST }], requests: [] });
  hideDiscoverItem(POST);
  const painted = paintDiscover({ information: [{ id: POST }, { id: FRESH }], requests: [] }, ME);
  assert.deepEqual(painted.information.map((item) => item.id), [FRESH]);
  showDiscoverItem(POST);
  rememberAhead({ information: [{ id: POST }, { id: FRESH }], requests: [] });
  assert.equal(coveredBy({ information: [{ id: POST }], requests: [] }), false);
  assert.equal(coveredBy({ information: [{ id: POST }, { id: FRESH }], requests: [] }), true);
  rememberAhead(null);
  rememberDiscover(null);
});
