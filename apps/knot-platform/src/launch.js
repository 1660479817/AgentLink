import { compose } from "./agents/feedback.js";
import { overlapScore } from "./agents/match.js";
import {
  feedbackAgentId,
  matchAgentId,
  runFeedbackAgent,
  runMatchAgent,
  runSourceAgent,
  sourceAgentId,
} from "./agents/openclaw.js";
import { suggest } from "./agents/source.js";
import { recordMessage } from "./messages.js";
import { recordNotification } from "./notifications.js";
import { runReview } from "./review.js";

const COLUMNS = `id, person_id, actor, door, role, body, processed, card, source_result, match_id, feedback, review_status`;

async function load(pool, id) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM expressions WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function candidates(pool, expression) {
  const opposite = expression.role === "demand" ? "supply" : "demand";
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM expressions
     WHERE role = $1 AND id <> $2 AND processed IS NOT NULL AND review_status = 'published'
     ORDER BY created_at ASC`,
    [opposite, expression.id]
  );
  return rows;
}

async function hasMatch(pool, aId, bId) {
  const left = await load(pool, aId);
  const right = await load(pool, bId);
  if (!left || !right) return true;
  const demandId = left.role === "demand" ? left.id : right.role === "demand" ? right.id : null;
  const supplyId = left.role === "supply" ? left.id : right.role === "supply" ? right.id : null;
  if (!demandId || !supplyId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM matches WHERE demand_expression_id = $1 AND supply_expression_id = $2 LIMIT 1`,
    [demandId, supplyId]
  );
  return rows.length > 0;
}

function subjectOf(expression) {
  const subject = expression.card?.subject;
  if (typeof subject === "string" && subject.trim()) return subject.trim();
  return expression.processed || "";
}

function shortlist(expression, peers) {
  return peers
    .map((peer) => ({ peer, score: overlapScore(subjectOf(expression), subjectOf(peer)) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.peer);
}

async function partnerFor(expression, peers) {
  const ranked = shortlist(expression, peers);
  if (!ranked.length) return null;
  if (!matchAgentId()) return ranked[0];
  let failed = 0;
  for (const peer of ranked) {
    const demand = expression.role === "demand" ? expression : peer;
    const supply = expression.role === "supply" ? expression : peer;
    try {
      const reply = await runMatchAgent(
        { id: demand.id, text: subjectOf(demand) },
        { id: supply.id, text: subjectOf(supply) }
      );
      if (reply.fits) return peer;
    } catch (err) {
      console.error(err);
      failed += 1;
    }
  }
  if (failed === ranked.length) return ranked[0];
  return null;
}

async function choose(expression, peers) {
  if (expression.review_status === "rejected") return null;
  if (expression.review_status === "pending" || !expression.processed) {
    return { kind: "process" };
  }
  if (expression.role === "intel") {
    if (needsFeedback(expression)) return { kind: "feedback" };
    return null;
  }
  const partner = await partnerFor(expression, peers);
  if (partner) return { kind: "match", partner };
  if (expression.role === "demand" && !expression.source_result) return { kind: "source" };
  if (needsFeedback(expression)) return { kind: "feedback" };
  return null;
}

function needsFeedback(expression) {
  if (!expression.processed || expression.review_status !== "published") return false;
  if (expression.match_id) return !expression.feedback?.startsWith("已配对");
  if (expression.source_result) return !expression.feedback;
  if (expression.role === "supply" || expression.role === "intel") return !expression.feedback;
  return false;
}

async function notifyMatch(pool, matchId, demand, supply) {
  const demandBody = `撮合成功，可与供给方对接：${supply.processed}`;
  const supplyBody = `撮合成功，可与需求方对接：${demand.processed}`;
  await recordMessage(pool, {
    personId: demand.person_id,
    expressionId: demand.id,
    door: demand.door,
    direction: "in",
    body: demandBody,
    matchId,
  });
  await recordMessage(pool, {
    personId: supply.person_id,
    expressionId: supply.id,
    door: supply.door,
    direction: "in",
    body: supplyBody,
    matchId,
  });
  await recordNotification(pool, {
    personId: demand.person_id,
    kind: "match_pending",
    title: "有新的撮合可对接",
    body: demandBody,
    href: "/messages",
  });
  await recordNotification(pool, {
    personId: supply.person_id,
    kind: "match_pending",
    title: "有新的撮合可对接",
    body: supplyBody,
    href: "/messages",
  });
}

async function apply(pool, expression, step) {
  if (step.kind === "process") {
    if (expression.review_status === "published" && expression.processed) return null;
    if (expression.review_status === "rejected") return null;
    await runReview(pool, expression);
    return null;
  }
  if (step.kind === "source") {
    let suggestion = suggest(subjectOf(expression));
    if (sourceAgentId()) {
      try {
        const reply = await runSourceAgent({ id: expression.id, text: subjectOf(expression) });
        suggestion = reply.suggestion;
      } catch (err) {
        console.error(err);
      }
    }
    await pool.query(`UPDATE expressions SET source_result = $1 WHERE id = $2`, [suggestion, expression.id]);
    return null;
  }
  if (step.kind === "match") {
    const demand = expression.role === "demand" ? expression : step.partner;
    const supply = expression.role === "supply" ? expression : step.partner;
    if (await hasMatch(pool, demand.id, supply.id)) return null;
    const inserted = await pool.query(
      `INSERT INTO matches (demand_expression_id, supply_expression_id)
       VALUES ($1, $2)
       ON CONFLICT (demand_expression_id, supply_expression_id) DO NOTHING
       RETURNING id`,
      [demand.id, supply.id]
    );
    if (!inserted.rows[0]) return null;
    const matchId = inserted.rows[0].id;
    await pool.query(`UPDATE expressions SET match_id = $1 WHERE id = $2 AND match_id IS NULL`, [
      supply.id,
      demand.id,
    ]);
    await pool.query(`UPDATE expressions SET match_id = $1 WHERE id = $2 AND match_id IS NULL`, [
      demand.id,
      supply.id,
    ]);
    const demandRow = await load(pool, demand.id);
    const supplyRow = await load(pool, supply.id);
    await notifyMatch(pool, matchId, demandRow, supplyRow);
    return expression.id === demand.id ? supply.id : demand.id;
  }
  const current = await load(pool, expression.id);
  let partner = null;
  if (current.match_id) partner = await load(pool, current.match_id);
  let response = compose(current, partner);
  if (feedbackAgentId()) {
    try {
      const reply = await runFeedbackAgent({
        id: current.id,
        self: subjectOf(current),
        peer: partner ? subjectOf(partner) : "",
        suggestion: current.source_result || "",
      });
      response = reply.body;
      if (!partner && current.source_result) response = current.source_result;
      if (partner && !response.startsWith("已配对")) response = compose(current, partner);
    } catch (err) {
      console.error(err);
    }
  }
  await pool.query(`UPDATE expressions SET feedback = $1 WHERE id = $2`, [response, expression.id]);
  await recordMessage(pool, {
    personId: current.person_id,
    expressionId: current.id,
    door: current.door,
    direction: "in",
    body: response,
  });
  return null;
}

export async function advance(pool, expressionId, seen = new Set()) {
  if (seen.has(expressionId)) return;
  seen.add(expressionId);
  let partnerId = null;
  for (let i = 0; i < 8; i += 1) {
    const expression = await load(pool, expressionId);
    if (!expression) return;
    if (expression.review_status === "rejected") break;
    const peers = await candidates(pool, expression);
    const filtered = [];
    for (const peer of peers) {
      if (!(await hasMatch(pool, expression.id, peer.id))) filtered.push(peer);
    }
    const step = await choose(expression, filtered);
    if (!step) break;
    const linked = await apply(pool, expression, step);
    if (linked) partnerId = linked;
  }
  if (partnerId) await advance(pool, partnerId, seen);
}
