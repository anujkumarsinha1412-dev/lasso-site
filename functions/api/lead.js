import { AuditError, json, trace, log, failure, readJson, fetchJson } from '../lib/openai.js';
import { isVerified, summarize, MAX_QUESTIONS } from '../../src/lib/audit-report.js';

const OWNER_EMAIL = 'rishavjani@gmail.com';
const FROM = 'AgenQuest <audit@agenquest.com>';
const esc = value => String(value ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

export function reportHtml(brand, report) {
  const overall = summarize(report.results);
  const sections = report.results.map(result => `<section style="margin:24px 0;border-top:1px solid #ddd;padding-top:16px;"><h3>${esc(result.query)}</h3><p><b>${esc(result.prominence)}</b> · ${result.query_type === 'branded' ? 'Branded question, excluded from discovery score' : 'Discovery question'}</p><p>${esc(result.note)}</p><p>Brands named: ${esc(result.brands_named.join(', ') || 'None')}</p><div style="white-space:pre-wrap">${esc(result.answer)}</div><h4>Cited sources</h4><ul>${result.sources.map(source => `<li><a href="${esc(source.url)}">${esc(source.title)}</a></li>`).join('')}</ul><p style="font-size:12px">OpenAI API · ${esc(result.model)} · ${esc(result.checked_at)} · ${esc(result.response_id)}</p></section>`).join('');
  return `<div style="font-family:system-ui,sans-serif;max-width:680px;margin:auto;color:#14120F;"><h2>AI visibility snapshot — ${esc(brand)}</h2><p><b>${overall.score === null ? 'No discovery score (branded questions only)' : `${overall.score}/100 discovery score`}</b></p><p>${esc(overall.summary)}</p><p>${esc(overall.formula)}</p><p>This is a single-run OpenAI API snapshot, not a repeated consumer ChatGPT study. Results can change with the model, question and date. Citations show visible sourcing, not why a recommendation was made.</p>${sections}<p>Reply if you would like to discuss the findings.</p><p>— AgenQuest · <a href="https://agenquest.com">agenquest.com</a></p></div>`;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const t = trace();
  try {
    const { email, phone = '', brand, website = '', source = '', report } = await readJson(context.request, 180000);
    if (typeof email !== 'string' || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || typeof brand !== 'string' || !brand.trim() || brand.length > 120 || typeof website !== 'string' || website.length > 300 || typeof phone !== 'string' || phone.length > 60) throw new AuditError('BAD_REQUEST', 'Enter a valid email address and brand.', 400);
    if (!report || report.mock === true || report.status !== 'complete' || !Array.isArray(report.results) || !report.results.length || report.results.length > MAX_QUESTIONS || report.results.some(result => !isVerified(result))) throw new AuditError('UNVERIFIED_REPORT', 'Only a complete, verified live report can be emailed. Retry the failed questions first.', 400);
    // Outbound attribution from the wizard's UTM params. Advisory only: never trusted,
    // never echoed to the prospect, truncated and escaped for the owner alert.
    const attribution = typeof source === 'string' ? source.slice(0, 200) : '';
    if (!context.env.RESEND_API_KEY) throw new AuditError('EMAIL_NOT_CONFIGURED', 'Report email is temporarily unavailable. Please try again later.', 503, 'report_email');
    const api = (path, body, stage, idempotency, timeout = 7000) => fetchJson(`https://api.resend.com${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${context.env.RESEND_API_KEY}`, ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) }, body: JSON.stringify(body),
    }, { timeout, stage, t, signal: context.request.signal });
    const html = reportHtml(brand, report);
    const idempotency = await digest(`${email}:${html}`);
    const sent = await api('/emails', { from: FROM, to: [email], subject: `Your AI visibility snapshot — ${brand}`, html }, 'report_email', `audit-report/${idempotency}`, 12000);
    if (typeof sent.id !== 'string' || !sent.id) throw new AuditError('EMAIL_NOT_ACCEPTED', 'The email service did not accept your report. Please retry.', 502, 'report_email');
    const bestEffort = async (operation, stage) => {
      try { const value = await operation(); return !!value?.id; }
      catch (e) { log(t, 'lead_followup_failed', { stage, code: e.code || 'UPSTREAM_ERROR' }); return false; }
    };
    const ownerHtml = `<p><b>Brand:</b> ${esc(brand)}<br><b>Website:</b> ${esc(website)}<br><b>Email:</b> ${esc(email)}<br><b>Phone:</b> ${esc(phone || '—')}<br><b>Discovery score:</b> ${summarize(report.results).score ?? 'branded-only'}<br><b>Came from:</b> ${esc(attribution || 'direct / unattributed')}</p>`;
    const ownerKey = await digest(ownerHtml);
    const [stored, notify] = await Promise.all([
      context.env.RESEND_AUDIENCE_ID ? bestEffort(() => api(`/audiences/${encodeURIComponent(context.env.RESEND_AUDIENCE_ID)}/contacts`, { email, first_name: brand, unsubscribed: false }, 'contact_storage'), 'contact_storage') : Promise.resolve(false),
      bestEffort(() => api('/emails', { from: FROM, to: [OWNER_EMAIL], subject: `New audit lead: ${brand}`, html: ownerHtml }, 'owner_notification', `audit-owner/${idempotency}/${ownerKey}`), 'owner_notification'),
    ]);
    log(t, 'lead_report_accepted', { stored, notify });
    return json({ ok: true, reportEmail: true, delivery: 'accepted', stored, notify, request_id: t.request_id });
  } catch (e) { return failure(e, t); }
}
