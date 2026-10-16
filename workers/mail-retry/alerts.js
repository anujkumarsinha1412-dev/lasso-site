/**
 * @typedef {Object} FailureAlert
 * @property {string} queue
 * @property {string} message_id
 * @property {string} record_id
 * @property {string} message_kind
 * @property {number} test_record
 * @property {number} mail_attempts
 * @property {string} reason
 * @property {number} attempts
 */

/** @param {FailureAlert} row @returns {EmailMessageBuilder} */
export function failureAlertEmail(row) {
  const kind = row.message_kind === 'acknowledgment' ? 'inquiry acknowledgment'
    : row.message_kind === 'audit_owner' ? 'audit founder notification' : 'inquiry founder notification';
  const reason = row.reason === 'RETRY_WINDOW_EXPIRED' ? 'The automatic retry safety window expired.' : 'The automatic retry limit was reached.';
  return {
    from: { email: 'hello@agenquest.com', name: 'Agenquest delivery alerts' },
    to: 'agenquest@gmail.com',
    replyTo: 'hello@agenquest.com',
    subject: (row.test_record ? '[TEST] ' : '') + 'Agenquest email needs attention - ' + row.record_id.slice(0,8),
    text: [
      ...(row.test_record ? ['This warning comes from a test request. No customer follow-up is needed.',''] : []),
      `Acceptance for an Agenquest ${kind} could not be confirmed.`,
      `Recorded sending attempts: ${row.mail_attempts}.`,
      reason,
      'Automatic retries have stopped for this message. The saved request has not been discarded.',
      '',
      'Request reference: ' + row.record_id,
      'Message reference: ' + row.message_id,
      '',
      'Next step: review the original request and delivery logs, then follow up manually. Check for any prior provider acceptance before resending.',
      'This operational warning is sent through Cloudflare, independently of Resend. It does not contain the visitor\'s message or contact details.',
    ].join('\n'),
  };
}

/** @param {Pick<Env,'LEAD_DB'|'FAILURE_EMAIL'>} env */
export async function flushFailureAlerts(env) {
  if (!env.LEAD_DB || !env.FAILURE_EMAIL) throw new Error('MAIL_ALERTS_NOT_CONFIGURED');
  const db = env.LEAD_DB, now = new Date().toISOString();
  // Each INSERT is atomic and replayable. A partial run is completed next tick.
  await db.prepare(`INSERT OR IGNORE INTO mail_failure_alerts
    (queue,message_id,record_id,message_kind,test_record,mail_attempts,reason,first_seen_at,next_attempt_at)
    SELECT 'consultation_mail',m.id,m.inquiry_id,
      CASE WHEN m.id LIKE '%/acknowledgment' THEN 'acknowledgment' ELSE 'inquiry_owner' END,
      CASE WHEN i.status='test' THEN 1 ELSE 0 END,
      m.attempts,CASE WHEN m.last_error='RETRY_WINDOW_EXPIRED' THEN 'RETRY_WINDOW_EXPIRED' ELSE 'RETRIES_EXHAUSTED' END,?,?
    FROM consultation_mail m JOIN consultation_inquiries i ON i.id=m.inquiry_id WHERE m.state='failed'`).bind(now,now).run();
  await db.prepare(`INSERT OR IGNORE INTO mail_failure_alerts
    (queue,message_id,record_id,message_kind,test_record,mail_attempts,reason,first_seen_at,next_attempt_at)
    SELECT 'notification_outbox',id,lead_id,'audit_owner',
      CASE WHEN EXISTS(SELECT 1 FROM lead_events e WHERE e.lead_id=o.lead_id AND e.event='test_submission') THEN 1 ELSE 0 END,
      attempts,CASE WHEN last_error='RETRY_WINDOW_EXPIRED' THEN 'RETRY_WINDOW_EXPIRED' ELSE 'RETRIES_EXHAUSTED' END,?,?
    FROM notification_outbox o WHERE state='failed'`).bind(now,now).run();
  const due = /** @type {D1Result<FailureAlert>} */ (await db.prepare(`SELECT a.* FROM mail_failure_alerts a
    JOIN (SELECT 'consultation_mail' AS queue,id FROM consultation_mail WHERE state='failed'
      UNION ALL SELECT 'notification_outbox',id FROM notification_outbox WHERE state='failed') f
      ON f.queue=a.queue AND f.id=a.message_id
    WHERE a.state IN ('pending','sending') AND a.next_attempt_at<=?
    ORDER BY a.next_attempt_at,a.queue,a.message_id LIMIT 2`).bind(now).all());
  let accepted = 0, deferred = 0;
  for (const row of due.results || []) {
    const token = crypto.randomUUID();
    const claimed = await db.prepare(`UPDATE mail_failure_alerts SET state='sending',lease_token=?,next_attempt_at=?
      WHERE queue=? AND message_id=? AND state IN ('pending','sending') AND next_attempt_at<=?`)
      .bind(token,new Date(Date.now()+5*60000).toISOString(),row.queue,row.message_id,now).run();
    if (!claimed.meta?.changes) continue;
    let sent;
    try {
      sent = await env.FAILURE_EMAIL.send(failureAlertEmail(row));
      if (!sent?.messageId) throw new Error('ALERT_NOT_ACCEPTED');
    } catch {
      const next = new Date(Date.now()+Math.min(3600000,60000*2**Math.min(row.attempts,6))).toISOString();
      await db.prepare(`UPDATE mail_failure_alerts SET state='pending',attempts=attempts+1,next_attempt_at=?,
        last_error='ALERT_NOT_ACCEPTED',lease_token=NULL WHERE queue=? AND message_id=? AND lease_token=?`)
        .bind(next,row.queue,row.message_id,token).run();
      deferred++;
      continue;
    }
    // Keep a sending lease if this write fails after acceptance. Do not turn a
    // storage failure into an immediate resend of an already-accepted alert.
    const recorded = await db.prepare(`UPDATE mail_failure_alerts SET state='accepted',attempts=attempts+1,accepted_at=?,
      provider_id=?,last_error=NULL,lease_token=NULL WHERE queue=? AND message_id=? AND lease_token=?`)
      .bind(new Date().toISOString(),sent.messageId,row.queue,row.message_id,token).run();
    if (!recorded.meta?.changes) throw new Error('MAIL_ALERT_LEASE_LOST');
    accepted++;
  }
  console.log(JSON.stringify({ event:'mail_failure_alerts',accepted,deferred }));
  if (deferred) throw new Error('MAIL_ALERT_DELIVERY_DEFERRED');
  return { accepted };
}
