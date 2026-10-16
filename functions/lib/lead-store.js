import { AuditError, fetchJson, log } from './openai.js';
import { safeToken, HOSTS } from '../../src/lib/tracking.js';

export function privateAttribution(value, consent) {
  if (consent !== true || !value || typeof value !== 'object') return null;
  const touch = item => {
    if (!item || typeof item !== 'object') return null;
    const clean = {};
    for (const key of ['source','medium','campaign','content','campaign_id','ai_source']) clean[key] = ['(direct)','(none)'].includes(item[key]) ? item[key] : safeToken(item[key], 80);
    try { const u = new URL(item.landing_page); clean.landing_page = HOSTS.includes(u.hostname) ? u.origin + u.pathname : ''; } catch { clean.landing_page = ''; }
    clean.at = Number.isFinite(item.at) && item.at > 0 && item.at <= Date.now() + 60000 ? item.at : null;
    return clean;
  };
  return { first: touch(value.first), session: touch(value.session), last_non_direct: touch(value.last_non_direct) };
}

export async function recordLead(db, input) {
  if (!db) throw new AuditError('LEAD_STORAGE_UNAVAILABLE', 'Your report could not be saved safely. Please retry shortly.', 503, 'lead_storage');
  try {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO leads (id,request_key,created_at,updated_at,email,brand,website,phone,attribution_json,analytics_consent,discovery_score,checked_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), input.key, now, now, input.email, input.brand, input.website, input.phone, input.attribution ? JSON.stringify(input.attribution) : null, input.consent ? 1 : 0, input.score, input.checked),
      db.prepare("INSERT INTO lead_events (lead_id,event,created_at) SELECT id,'lead_created',? FROM leads WHERE request_key=? AND NOT EXISTS (SELECT 1 FROM lead_events WHERE lead_id=leads.id AND event='lead_created')").bind(now, input.key),
    ]);
    const lead = await db.prepare('SELECT id,report_email_status,report_email_accepted_at,notification_status,contact_stored FROM leads WHERE request_key=?').bind(input.key).first();
    if (!lead) throw new Error('Record missing');
    return lead;
  } catch { throw new AuditError('LEAD_STORAGE_UNAVAILABLE', 'Your report could not be saved safely. Please retry shortly.', 503, 'lead_storage'); }
}

export async function acceptReport(db, id, providerId, ownerPayload) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE leads SET report_email_status='accepted',report_email_id=?,report_email_accepted_at=?,updated_at=? WHERE id=?").bind(providerId, now, now, id),
    db.prepare("INSERT INTO lead_events (lead_id,event,created_at) SELECT ?,'report_email_accepted',? WHERE NOT EXISTS (SELECT 1 FROM lead_events WHERE lead_id=? AND event='report_email_accepted')").bind(id, now, id),
    db.prepare('INSERT OR IGNORE INTO notification_outbox (id,lead_id,payload_json,next_attempt_at) VALUES (?,?,?,?)').bind('owner/' + id, id, JSON.stringify(ownerPayload), now),
  ]);
}

// Durable retry queue. Lease a row atomically so concurrent requests cannot send it twice.
// Retrying uses a stable provider idempotency key and stops automatic attempts after 24h.
export async function flushNotifications(env, t = { request_id: 'outbox' }) {
  if (!env.LEAD_DB || !env.RESEND_API_KEY) return;
  const now = new Date().toISOString();
  const due = await env.LEAD_DB.prepare("SELECT o.id,o.lead_id,o.payload_json,o.attempts,l.created_at FROM notification_outbox o JOIN leads l ON l.id=o.lead_id WHERE o.state IN ('pending','sending') AND o.next_attempt_at<=? ORDER BY o.next_attempt_at LIMIT 2").bind(now).all();
  for (const row of due.results || []) {
    if (row.attempts > 0 && Date.now() - Date.parse(row.created_at) >= 23 * 3600000) {
      await env.LEAD_DB.batch([
        env.LEAD_DB.prepare("UPDATE notification_outbox SET state='failed',last_error='RETRY_WINDOW_EXPIRED' WHERE id=?").bind(row.id),
        env.LEAD_DB.prepare("UPDATE leads SET notification_status='failed' WHERE id=?").bind(row.lead_id),
      ]);
      continue;
    }
    const lease = new Date(Date.now() + 60000).toISOString();
    const claimed = await env.LEAD_DB.prepare("UPDATE notification_outbox SET state='sending',next_attempt_at=? WHERE id=? AND state IN ('pending','sending') AND next_attempt_at<=?").bind(lease, row.id, now).run();
    if (!claimed.meta?.changes) continue;
    try {
      const sent = await fetchJson('https://api.resend.com/emails', { method: 'POST', headers: { 'content-type':'application/json', authorization:'Bearer ' + env.RESEND_API_KEY, 'Idempotency-Key':row.id }, body:row.payload_json }, { timeout:7000, stage:'owner_notification', t });
      if (!sent.id) throw new Error('EMAIL_NOT_ACCEPTED');
      await env.LEAD_DB.batch([
        env.LEAD_DB.prepare("UPDATE notification_outbox SET state='accepted',provider_id=?,attempts=attempts+1,last_error=NULL WHERE id=?").bind(sent.id, row.id),
        env.LEAD_DB.prepare("UPDATE leads SET notification_status='accepted',updated_at=? WHERE id=?").bind(now, row.lead_id),
      ]);
    } catch (e) {
      const attempts = row.attempts + 1;
      const next = new Date(Date.now() + Math.min(21600000, 60000 * 2 ** Math.min(attempts,8))).toISOString();
      // Expired attempts are held for owner review; never blindly resend after 24h.
      const state = attempts >= 8 ? 'failed' : 'pending';
      await env.LEAD_DB.prepare('UPDATE notification_outbox SET state=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=?').bind(state, attempts, next, /^[A-Z_]+$/.test(e.code || '') ? e.code : 'PROVIDER_ERROR', row.id).run();
      if (state === 'failed') await env.LEAD_DB.prepare("UPDATE leads SET notification_status='failed' WHERE id=?").bind(row.lead_id).run();
      log(t, 'lead_followup_failed', { stage:'owner_notification', code:'QUEUED_FOR_RETRY' });
    }
  }
}
