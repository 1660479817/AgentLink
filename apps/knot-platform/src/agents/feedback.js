export function compose(expression, partner) {
  if (partner?.processed) return `已配对：${partner.processed}`;
  if (expression.source_result) return expression.source_result;
  return `已记下：${expression.processed}`;
}
