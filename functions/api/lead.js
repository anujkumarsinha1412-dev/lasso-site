import { AuditError, json, trace, log, failure, readJson, fetchJson } from '../lib/openai.js';
import { isVerified, summarize, MAX_QUESTIONS } from '../../src/lib/audit-report.js';
import { recordLead, acceptReport, flushNotifications, privateAttribution } from '../lib/lead-store.js';

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
    const { email, phone = '', brand, website = '', report, attribution: rawAttribution, analytics_consent = false } = await readJson(context.request, 180000);
    if (typeof email !== 'string' || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || typeof brand !== 'string' || !brand.trim() || brand.length > 120 || typeof website !== 'string' || website.length > 300 || typeof phone !== 'string' || phone.length > 60) throw new AuditError('BAD_REQUEST', 'Enter a valid email address and brand.', 400);
    if (!report || report.mock === true || report.status !== 'complete' || !Array.isArray(report.results) || !report.results.length || report.results.length > MAX_QUESTIONS || report.results.some(result => !isVerified(result))) throw new AuditError('UNVERIFIED_REPORT', 'Only a complete, verified live report can be emailed. Retry the failed questions first.', 400);
    const attribution = privateAttribution(rawAttribution, analytics_consent);
    if (!context.env.RESEND_API_KEY) throw new AuditError('EMAIL_NOT_CONFIGURED', 'Report email is temporarily unavailable. Please try again later.', 503, 'report_email');
    const api = (path, body, stage, idempotency, timeout = 7000) => fetchJson(`https://api.resend.com${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${context.env.RESEND_API_KEY}`, ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) }, body: JSON.stringify(body),
    }, { timeout, stage, t, signal: context.request.signal });
    const html = reportHtml(brand, report);
    const idempotency = await digest(`${email.trim().toLowerCase()}:${html}`);
    const overall = summarize(report.results);
    const saved = await recordLead(context.env.LEAD_DB, { key:idempotency, email:email.trim().toLowerCase(), brand, website, phone, attribution, consent:analytics_consent === true, score:overall.score, checked:overall.checked });
    if (saved.report_email_accepted_at) return json({ ok:true,reportEmail:true,delivery:'accepted',lead_id:saved.id,stored:true,notify:saved.notification_status === 'accepted',duplicate:true,request_id:t.request_id });
    let sent;
    try { sent = await api('/emails', { from: FROM, to: [email], subject: `Your AI visibility snapshot — ${brand}`, html }, 'report_email', `audit-report/${idempotency}`, 12000); }
    catch (e) {
      await context.env.LEAD_DB.prepare("UPDATE leads SET report_email_status='failed',updated_at=? WHERE id=? AND report_email_accepted_at IS NULL").bind(new Date().toISOString(),saved.id).run();
      throw e;
    }
    if (typeof sent.id !== 'string' || !sent.id) throw new AuditError('EMAIL_NOT_ACCEPTED', 'The email service did not accept your report. Please retry.', 502, 'report_email');
    const bestEffort = async (operation, stage) => {
      try { const value = await operation(); return !!value?.id; }
      catch (e) { log(t, 'lead_followup_failed', { stage, code: e.code || 'UPSTREAM_ERROR' }); return false; }
    };
    const ownerHtml = `<p><b>Lead reference:</b> ${esc(saved.id)}<br><b>Brand:</b> ${esc(brand)}<br><b>Website:</b> ${esc(website)}<br><b>Email:</b> ${esc(email)}<br><b>Phone:</b> ${esc(phone || '—')}<br><b>Discovery score:</b> ${overall.score ?? 'branded-only'}<br><b>Attribution (visitor supplied):</b> ${esc(attribution ? JSON.stringify(attribution) : 'Not available — analytics not consented or source unknown')}</p><p>Report email accepted by provider. Inbox delivery and lead qualification are separate outcomes.</p>`;
    await acceptReport(context.env.LEAD_DB, saved.id, sent.id, { from:FROM,to:[OWNER_EMAIL],subject:`New audit lead: ${brand}`,html:ownerHtml });
    const contactStored = context.env.RESEND_AUDIENCE_ID ? await bestEffort(() => api(`/audiences/${encodeURIComponent(context.env.RESEND_AUDIENCE_ID)}/contacts`, { email, first_name:brand, unsubscribed:true }, 'contact_storage'), 'contact_storage') : false;
    if (contactStored) await context.env.LEAD_DB.prepare('UPDATE leads SET contact_stored=1 WHERE id=?').bind(saved.id).run();
    // A failed owner alert never loses the lead or pretends the report email failed.
    await flushNotifications(context.env, t).catch(() => {});
    const current = await context.env.LEAD_DB.prepare('SELECT notification_status FROM leads WHERE id=?').bind(saved.id).first();
    const notify = current?.notification_status === 'accepted';
    log(t, 'lead_report_accepted', { stored:true, notify });
    return json({ ok:true,reportEmail:true,delivery:'accepted',lead_id:saved.id,stored:true,notify,request_id:t.request_id });
  } catch (e) { return failure(e, t); }
}
