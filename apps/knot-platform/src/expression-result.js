export const RESULT_COLUMNS = `e.id, e.role, e.review_status, e.reject_code, e.reject_reason, e.processed, e.evaluation, e.intel_reward, c.category AS intel_category, c.fact AS intel_fact, c.basis AS intel_basis`;

export const RESULT_FROM = `expressions e LEFT JOIN intel_classes c ON c.expression_id = e.id`;

export function expressionResult(row) {
  const evaluation = row.evaluation && typeof row.evaluation === "object"
    ? { score: row.evaluation.score, reason: row.evaluation.reason || "" }
    : null;
  const intelClass = row.intel_category
    ? { category: row.intel_category, fact: row.intel_fact, basis: row.intel_basis }
    : null;
  return {
    id: row.id,
    role: row.role,
    reviewStatus: row.review_status,
    summary: row.processed || null,
    reject: row.reject_code ? { code: row.reject_code, reason: row.reject_reason } : null,
    evaluation,
    intelClass,
    intelReward: row.intel_reward ?? null,
  };
}
