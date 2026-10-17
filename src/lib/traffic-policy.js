// Explicit, non-personal signals only. Direct visits and denied consent are not tests.
export function trafficIntent(href, referrer = '') {
  const u = new URL(href), q = u.searchParams;
  const token = key => (q.get(key) || '').trim().toLowerCase();
  const test = token('aq_test') === '1' || token('aq_qa') === '1';
  let preview = ['gtm_debug', 'gtm_preview'].some(key => !!q.get(key));
  try { preview ||= new URL(referrer).hostname === 'tagassistant.google.com'; } catch {}
  const labelled = ['qa', 'test', 'internal'].includes(token('utm_source')) || ['qa', 'test', 'internal'].includes(token('utm_medium'));
  return { test, internal: test || preview || labelled || token('aq_internal') === '1' || token('noanalytics') === '1', reset: token('noanalytics') === '0' };
}

export function submissionClass(body = {}, cookieHeader = '') {
  const cookies = Object.fromEntries(cookieHeader.split(';').map(part => part.trim().split('=')));
  if (body.traffic_class === 'test' || cookies.aq_test === '1') return 'test';
  if (body.traffic_class === 'internal' || cookies.aq_internal === '1' || cookies.aq_optout === '1') return 'internal';
  return 'new';
}
