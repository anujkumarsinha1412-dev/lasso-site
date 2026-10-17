// Public analytics contract. Never pass form values, report text or arbitrary URLs.
export const VERSION = '2026-10-17.1';
export const HOSTS = ['agenquest.com', 'www.agenquest.com'];
export const EVENTS = ['page_view', 'section_view', 'scroll_depth', 'content_engaged', 'cta_view', 'cta_click', 'contact_click', 'outbound_click', 'audit_prefilled', 'audit_started', 'audit_prompts_generated', 'audit_question_added', 'audit_question_selection', 'audit_run', 'audit_partial', 'audit_completed', 'lead_gate_view', 'lead_form_start', 'lead_validation_error', 'lead_submit_attempt', 'generate_lead', 'audit_failed', 'report_detail_open', 'booking_started'];
export const PARAMS = ['placement', 'action', 'contact_method', 'section_id', 'percent_scrolled', 'has_prefill', 'question_count', 'category_group', 'selected_count', 'question_type', 'attempt_no', 'is_retry', 'checked_count', 'failed_count', 'duration_ms', 'score', 'form_id', 'gate_step', 'field_name', 'error_code', 'stage', 'http_status', 'lead_source', 'detail_type', 'scheduler', 'destination_domain', 'link_group'];
const numeric = new Set(['percent_scrolled', 'question_count', 'selected_count', 'attempt_no', 'checked_count', 'failed_count', 'duration_ms', 'score', 'http_status']);
export function safeToken(value, max = 80) {
  return typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9_. -]+$/.test(value) && !/\b\d{7,}\b/.test(value) ? value.trim() : '';
}
export function cleanParams(params = {}) {
  return Object.fromEntries(PARAMS.flatMap(key => {
    const value = params[key];
    if (value === undefined || value === null) return [];
    if (numeric.has(key)) return Number.isFinite(value) && value >= 0 && value <= (key === 'duration_ms' ? 3600000 : 10000) ? [[key, Math.round(value)]] : [];
    if (['has_prefill', 'is_retry'].includes(key)) return typeof value === 'boolean' ? [[key, value ? 'true' : 'false']] : [];
    const cleaned = safeToken(value);
    return cleaned ? [[key, cleaned]] : [];
  }));
}
export function cleanUrl(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.origin + u.pathname : ''; } catch { return ''; }
}
export function pageContext(href) {
  const u = new URL(href); const p = u.pathname.replace(/\/$/, '') || '/';
  const group = p === '/' ? 'home' : p === '/blog' ? 'blog_index' : p.startsWith('/blog/') ? 'article' : p === '/research-methodology' ? 'methodology' : ['/about', '/privacy', '/contact', '/how-we-help', '/who-aeo-is-for'].includes(p) ? p.slice(1) : 'other';
  return { page_location: cleanUrl(href), page_group: group, content_slug: group === 'article' ? safeToken(p.split('/').pop()) : group };
}
export function categoryGroup(value = '') {
  if (/cook|kitchen|home|furniture/i.test(value)) return 'home_and_kitchen';
  if (/beauty|skin|cosmetic|health|wellness/i.test(value)) return 'beauty_and_wellness';
  if (/fashion|apparel|clothing|jewel/i.test(value)) return 'fashion';
  if (/software|saas|technology/i.test(value)) return 'software';
  if (/food|beverage|drink/i.test(value)) return 'food_and_drink';
  return 'other';
}
const aiHosts = [['chatgpt.com','chatgpt'], ['openai.com','chatgpt'], ['perplexity.ai','perplexity'], ['gemini.google.com','gemini'], ['claude.ai','claude'], ['copilot.microsoft.com','copilot'], ['you.com','you'], ['grok.com','grok']];
export function acquisition(href, referrer = '', now = Date.now()) {
  const u = new URL(href); let host = '';
  try { host = new URL(referrer).hostname.toLowerCase(); } catch {}
  const external = host && !HOSTS.includes(host);
  const pick = k => safeToken(u.searchParams.get('utm_' + k)?.toLowerCase(), 80);
  const explicit = pick('source');
  const source = explicit || (external ? host : '(direct)');
  const medium = pick('medium') || (explicit ? 'unknown' : external ? /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$/.test(host) ? 'organic' : 'referral' : '(none)');
  // Explicit campaign attribution takes precedence over the browser referrer.
  const ai = aiHosts.find(([h, label]) => explicit ? [h, label].includes(explicit) : external && (host === h || host.endsWith('.' + h)));
  return { source, medium, campaign: pick('campaign'), content: pick('content'), campaign_id: pick('id'), ai_source: ai?.[1] || 'none', landing_page: u.origin + u.pathname, at: now };
}
export function attributionRecord(previous, current, now = Date.now()) {
  const valid = previous && now - previous.updated_at < 90 * 86400000;
  const old = valid ? previous : null;
  const nonDirect = current.source !== '(direct)';
  const changed = nonDirect && ['source','medium','campaign','content','campaign_id'].some(k => current[k] !== old?.session?.[k]);
  return { first: old?.first || current, session: !old || now - old.updated_at > 30 * 60000 || changed ? current : old.session, last_non_direct: nonDirect ? current : old?.last_non_direct || null, updated_at: now };
}
