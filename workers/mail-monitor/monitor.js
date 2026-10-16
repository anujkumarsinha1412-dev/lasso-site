/** @typedef {{id:string,kind:string,reason:string,reference:string,test_record:number,created_at:string,attempts:number}} MonitorAlert */

/** @param {D1Database} db @param {unknown} event */
export async function saveDeliveryAlert(db,event) {
  if(!event||typeof event!=='object'||!('type' in event)||!('data' in event))return false;
  const {type,data}=event;
  if(typeof type!=='string'||!['email.bounced','email.complained','email.failed','email.suppressed'].includes(type))return false;
  if(!data||typeof data!=='object'||!('email_id' in data)||typeof data.email_id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(data.email_id))throw new Error('INVALID_EVENT');
  const ref=data.email_id.toLowerCase(),now=new Date().toISOString();
  // Only persist an opaque provider reference, event type, timestamps and test flag.
  // Native dashboard tests and purpose-marked test sends are clearly labelled.
  let test='subject' in data&&typeof data.subject==='string'&&/^\[TEST\]/i.test(data.subject)?1:0;
  const inquiry=await db.prepare("SELECT i.status FROM consultation_mail m JOIN consultation_inquiries i ON i.id=m.inquiry_id WHERE m.provider_id=? LIMIT 1").bind(ref).first();
  if(inquiry?.status==='test')test=1;
  const oldTest=await db.prepare("SELECT 1 AS found FROM leads l JOIN lead_events e ON e.lead_id=l.id WHERE l.report_email_id=? AND e.event='test_submission' LIMIT 1").bind(ref).first();
  if(oldTest)test=1;
  await db.prepare(`INSERT OR IGNORE INTO mail_monitor_alerts
    (id,kind,reason,reference,test_record,created_at,next_attempt_at) VALUES (?,'delivery',?,?,?,?,?)`)
    .bind(`delivery/${ref}/${type}`,type,ref,test,now,now).run();
  return true;
}

/** @param {unknown} heartbeat @param {number} now */
export function heartbeatProblem(heartbeat,now=Date.now()) {
  if(!heartbeat||typeof heartbeat!=='object')return 'HEARTBEAT_MISSING';
  if(!('finished_at' in heartbeat)||!('scheduled_at' in heartbeat)||typeof heartbeat.finished_at!=='string'||typeof heartbeat.scheduled_at!=='string')return 'HEARTBEAT_INVALID';
  const finished=Date.parse(heartbeat.finished_at),scheduled=Date.parse(heartbeat.scheduled_at);
  if(!Number.isFinite(finished)||!Number.isFinite(scheduled)||finished>now+60000||scheduled>finished||scheduled>now+60000)return 'HEARTBEAT_INVALID';
  if(now-finished>15*60000||now-scheduled>15*60000)return 'HEARTBEAT_STALE';
  if(!('ok' in heartbeat)||heartbeat.ok!==true||!('drain_ok' in heartbeat)||heartbeat.drain_ok!==true||!('alerts_ok' in heartbeat)||heartbeat.alerts_ok!==true)return 'RETRY_UNHEALTHY';
  return '';
}

/** @param {Pick<Env,'LEAD_DB'|'RETRY_STATUS'> & {STATUS_KEY?:string,WATCHDOG_KEY?:string,MONITOR_TEST_MODE?:string}} env */
export async function checkHeartbeat(env) {
  let reason;
  try {reason=heartbeatProblem(await env.RETRY_STATUS.get(env.STATUS_KEY||'latest','json'));}
  catch {reason='HEARTBEAT_UNREADABLE';}
  const db=env.LEAD_DB,key=env.WATCHDOG_KEY||'retry',now=new Date().toISOString(),test=env.MONITOR_TEST_MODE==='true'?1:0;
  await db.prepare('INSERT OR IGNORE INTO mail_watchdog_state (id) VALUES (?)').bind(key).run();
  if(reason)await db.prepare('UPDATE mail_watchdog_state SET incident_id=?,opened_at=? WHERE id=? AND incident_id IS NULL').bind(crypto.randomUUID(),now,key).run();
  const state=await db.prepare('SELECT incident_id,opened_at FROM mail_watchdog_state WHERE id=?').bind(key).first();
  if(!state?.incident_id)return;
  const incident=String(state.incident_id),warning=`timer_stale/${incident}`;
  // Replayable writes recover if an invocation stops between transition and enqueue.
  await db.prepare(`INSERT OR IGNORE INTO mail_monitor_alerts
    (id,kind,reason,reference,test_record,created_at,next_attempt_at) VALUES (?,'timer_stale',?,?,?,?,?)`)
    .bind(warning,reason||'HEARTBEAT_GAP',incident,test,String(state.opened_at),now).run();
  if(!reason) {
    await db.prepare(`INSERT OR IGNORE INTO mail_monitor_alerts
      (id,kind,reason,reference,test_record,created_at,next_attempt_at,depends_on) VALUES (?,'timer_recovered','HEARTBEAT_RECOVERED',?,?,?,?,?)`)
      .bind(`timer_recovered/${incident}`,incident,test,now,now,warning).run();
    await db.prepare('UPDATE mail_watchdog_state SET incident_id=NULL,opened_at=NULL WHERE id=? AND incident_id=?').bind(key,incident).run();
  }
}

/** @param {MonitorAlert} row @returns {EmailMessageBuilder} */
export function monitorEmail(row) {
  const label=row.kind==='delivery'?'email delivery needs attention':row.kind==='timer_recovered'?'email retry timer recovered':'email retry timer needs attention';
  const detail=row.kind==='delivery'
    ? 'Resend reported '+row.reason+'. Check the matching message in Resend before following up. Do not automatically resend to a bounced or complaining recipient.'
    : row.kind==='timer_recovered'?'A fresh, healthy retry checkpoint is available again.':'The separate monitor could not confirm a fresh, healthy email retry checkpoint. Check the retry Worker, cron trigger and delivery logs. The normal checkpoint is written every five minutes; warnings allow a fifteen-minute grace period.';
  return {from:{email:'hello@agenquest.com',name:'Agenquest delivery alerts'},to:'agenquest@gmail.com',replyTo:'hello@agenquest.com',
    subject:(row.test_record?'[TEST] ':'')+'Agenquest '+label,
    text:[...(row.test_record?['This is a monitoring test. No customer follow-up is needed.','']:[]),detail,'',
      'Reason: '+row.reason,'Reference: '+row.reference,'Observed at: '+row.created_at,
      'Check the current status; it may have changed since this incident was recorded.',
      'This warning contains no visitor message or contact details and is sent through Cloudflare, independently of Resend.'].join('\n')};
}

/** @param {Pick<Env,'LEAD_DB'|'MONITOR_EMAIL'>} env */
export async function flushMonitorAlerts(env) {
  const db=env.LEAD_DB,now=new Date().toISOString();
  const due=/** @type {D1Result<MonitorAlert>} */(await db.prepare(`SELECT a.* FROM mail_monitor_alerts a
    LEFT JOIN mail_monitor_alerts dependency ON dependency.id=a.depends_on
    WHERE a.state IN ('pending','sending') AND a.next_attempt_at<=? AND (a.depends_on IS NULL OR dependency.state='accepted')
    ORDER BY a.created_at,a.id LIMIT 4`).bind(now).all());
  let accepted=0,deferred=0;
  for(const row of due.results||[]) {
    const token=crypto.randomUUID();
    const claim=await db.prepare("UPDATE mail_monitor_alerts SET state='sending',lease_token=?,next_attempt_at=? WHERE id=? AND state IN ('pending','sending') AND next_attempt_at<=?")
      .bind(token,new Date(Date.now()+5*60000).toISOString(),row.id,now).run();
    if(!claim.meta?.changes)continue;
    let sent;
    try {sent=await env.MONITOR_EMAIL.send(monitorEmail(row));if(!sent?.messageId)throw new Error('NOT_ACCEPTED');}
    catch {
      await db.prepare("UPDATE mail_monitor_alerts SET state='pending',attempts=attempts+1,next_attempt_at=?,lease_token=NULL,last_error='ALERT_NOT_ACCEPTED' WHERE id=? AND lease_token=?")
        .bind(new Date(Date.now()+Math.min(3600000,60000*2**Math.min(row.attempts,6))).toISOString(),row.id,token).run();
      deferred++;continue;
    }
    const recorded=await db.prepare("UPDATE mail_monitor_alerts SET state='accepted',attempts=attempts+1,accepted_at=?,provider_id=?,lease_token=NULL,last_error=NULL WHERE id=? AND lease_token=?")
      .bind(new Date().toISOString(),sent.messageId,row.id,token).run();
    if(!recorded.meta?.changes)throw new Error('MONITOR_LEASE_LOST');
    accepted++;
  }
  console.log(JSON.stringify({event:'mail_monitor_alerts',accepted,deferred}));
  if(deferred)throw new Error('MONITOR_DELIVERY_DEFERRED');
}
