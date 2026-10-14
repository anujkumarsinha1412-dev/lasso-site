export const MAX_QUESTIONS = 10;

export function mentionsBrand(query, brand) {
  const name = brand.trim().split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return !!name && new RegExp(`(?:^|[^\\p{L}\\p{N}])${name}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(query);
}

export function safeSource(source) {
  try {
    const url = new URL(source.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && typeof source.title === 'string';
  } catch { return false; }
}

export function isVerified(result) {
  return !!result && result.mock !== true && result.status === 'verified'
    && typeof result.query === 'string' && result.query.trim().length > 0 && result.query.length <= 300
    && ['discovery', 'branded'].includes(result.query_type)
    && ['recommended', 'mentioned', 'absent'].includes(result.prominence)
    && typeof result.answer === 'string' && result.answer.trim().length > 0 && result.answer.length <= 20000
    && typeof result.note === 'string' && result.note.length <= 300
    && Array.isArray(result.brands_named) && result.brands_named.length <= 4 && result.brands_named.every(b => typeof b === 'string' && b.length <= 120)
    && Array.isArray(result.sources) && result.sources.length > 0 && result.sources.length <= 40 && result.sources.every(safeSource)
    && typeof result.model === 'string' && typeof result.response_id === 'string' && Number.isFinite(Date.parse(result.checked_at));
}

export function summarize(results) {
  const valid = results.filter(isVerified);
  const discovery = valid.filter(r => r.query_type === 'discovery');
  const recommended = discovery.filter(r => r.prominence === 'recommended').length;
  const mentioned = discovery.filter(r => r.prominence === 'mentioned').length;
  const complete = results.length > 0 && valid.length === results.length;
  return {
    score: complete && discovery.length ? Math.round(100 * (2 * recommended + mentioned) / (2 * discovery.length)) : null,
    complete, checked: valid.length, total: results.length,
    discovery_checked: discovery.length, branded_checked: valid.length - discovery.length,
    recommended, mentioned,
    summary: `${valid.length} of ${results.length} questions checked with cited web search. ${recommended} discovery answers recommended the brand; ${mentioned} mentioned it. Branded questions are reported separately.`,
    formula: 'Discovery score = (2 × recommended + mentioned) ÷ (2 × valid discovery answers) × 100. No score is published for an incomplete panel.',
  };
}
