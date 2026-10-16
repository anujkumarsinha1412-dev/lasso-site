import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryMailD1 } from './d1-helper.js';
import { saveInquiry } from '../functions/lib/inquiry-store.js';
import { recordLead, acceptReport } from '../functions/lib/lead-store.js';
import { flushFailureAlerts } from '../workers/mail-retry/alerts.js';
import worker from '../workers/mail-retry/index.js';
import { onRequestGet as health } from '../functions/api/health.js';

async function failures() {
  const db = memoryMailD1();
  await saveInquiry(db,{website:'https://private.example/',name:'Private name',email:'private@example.test',message:'Private inquiry text',source_page:'/contact/'},'alert-test-key','hash',{});
  const lead = await recordLead(db,{key:'alert-audit-key',email:'audit@example.test',brand:'Private brand',website:'',phone:'',consent:false,checked:1,score:0});
  await acceptReport(db,lead.id,'report-accepted',{to:['owner@example.test'],html:'Private report'});
  db.sql.exec("UPDATE consultation_mail SET state='failed',attempts=8,last_error='EMAIL_NOT_ACCEPTED' WHERE id LIKE '%/owner'; UPDATE consultation_mail SET state='accepted' WHERE id LIKE '%/acknowledgment'; UPDATE notification_outbox SET state='failed',attempts=8,last_error='RETRY_WINDOW_EXPIRED'");
  return db;
}
function sender(messages) { return {async send(message){messages.push(message);return {messageId:'cf-alert-'+messages.length};}}; }
function statusStore() { return {latest:null,async put(key,value){this.latest=JSON.parse(value);}}; }
const checkpoint = {scheduledTime:Date.parse('2026-10-16T15:00:00Z')};

test('failed messages create one independent owner alert each without copying private payloads', async () => {
  const db = await failures(), messages=[],env={LEAD_DB:db,FAILURE_EMAIL:sender(messages)};
  await flushFailureAlerts(env); await flushFailureAlerts(env);
  assert.equal(messages.length,2);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM mail_failure_alerts WHERE state='accepted'").get().n,2);
  assert.ok(messages.every(m=>m.to==='agenquest@gmail.com' && m.from.email==='hello@agenquest.com'));
  assert.ok(messages.some(m=>m.text.includes('safety window expired')));
  assert.ok(messages.some(m=>m.text.includes('retry limit was reached')));
  for (const privateValue of ['private@example.test','Private name','Private inquiry text','Private brand','Private report']) {
    assert.ok(!JSON.stringify(messages).includes(privateValue));
    assert.ok(!JSON.stringify(db.sql.prepare('SELECT * FROM mail_failure_alerts').all()).includes(privateValue));
  }
  assert.equal(db.sql.prepare("SELECT count(*) n FROM consultation_mail WHERE state='failed'").get().n,1);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM consultation_inquiries').get().n,1);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM leads').get().n,1);
});

test('overlapping scans and recovered leases do not produce repeat accepted alerts', async () => {
  const db=await failures(),messages=[],env={LEAD_DB:db,FAILURE_EMAIL:sender(messages)};
  await Promise.all([flushFailureAlerts(env),flushFailureAlerts(env)]);
  assert.equal(messages.length,2);
  db.sql.exec("UPDATE mail_failure_alerts SET state='sending',next_attempt_at='2000-01-01',lease_token='abandoned',provider_id=NULL");
  messages.length=0;
  await Promise.all([flushFailureAlerts(env),flushFailureAlerts(env)]);
  assert.equal(messages.length,2);
  await flushFailureAlerts(env); assert.equal(messages.length,2);
});

test('alerts from marked test inquiries are clearly labelled and do not request customer follow-up', async () => {
  const db=await failures(),messages=[];
  db.sql.exec("UPDATE consultation_inquiries SET status='test'; UPDATE notification_outbox SET state='accepted'");
  await flushFailureAlerts({LEAD_DB:db,FAILURE_EMAIL:sender(messages)});
  assert.equal(messages.length,1);
  assert.ok(messages[0].subject.startsWith('[TEST] '));
  assert.ok(messages[0].text.startsWith('This warning comes from a test request. No customer follow-up is needed.'));
});

test('an alert outage stays queued with backoff and recovers even after many alert attempts', async () => {
  const db=await failures(),messages=[];
  const env={LEAD_DB:db,FAILURE_EMAIL:{async send(){messages.push('failed');throw new Error('private provider failure');}}};
  await assert.rejects(flushFailureAlerts(env),/MAIL_ALERT_DELIVERY_DEFERRED/);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM mail_failure_alerts WHERE state='pending' AND attempts=1").get().n,2);
  await flushFailureAlerts(env); assert.equal(messages.length,2,'backoff is respected');
  db.sql.exec("UPDATE mail_failure_alerts SET attempts=25,next_attempt_at='2000-01-01'");
  await assert.rejects(flushFailureAlerts(env),/MAIL_ALERT_DELIVERY_DEFERRED/);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM mail_failure_alerts WHERE state='pending' AND attempts=26").get().n,2);
  db.sql.exec("UPDATE mail_failure_alerts SET next_attempt_at='2000-01-01'");
  env.FAILURE_EMAIL=sender(messages);
  await flushFailureAlerts(env); await flushFailureAlerts(env);
  assert.equal(messages.length,6);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM mail_failure_alerts WHERE state='accepted' AND attempts=27").get().n,2);
});

test('acceptance recording failure preserves its lease and does not immediately resend', async () => {
  const db=await failures(),messages=[];
  db.sql.exec("UPDATE notification_outbox SET state='accepted'");
  let failWrite=true;
  const wrapped={prepare(sql){if(failWrite && sql.includes("SET state='accepted'")){failWrite=false;throw new Error('Storage unavailable');}return db.prepare(sql);}};
  const env={LEAD_DB:wrapped,FAILURE_EMAIL:sender(messages)};
  await assert.rejects(flushFailureAlerts(env),/Storage unavailable/);
  assert.equal(db.sql.prepare('SELECT state FROM mail_failure_alerts').get().state,'sending');
  await flushFailureAlerts(env); assert.equal(messages.length,1);
});

test('resolved source jobs are not re-alerted, and missing bindings cannot silently pass', async () => {
  const db=await failures(),messages=[];
  await assert.rejects(flushFailureAlerts({LEAD_DB:db,FAILURE_EMAIL:{async send(){throw Error('Offline');}}}));
  db.sql.exec("UPDATE consultation_mail SET state='accepted'; UPDATE notification_outbox SET state='accepted'; UPDATE mail_failure_alerts SET next_attempt_at='2000-01-01'");
  await flushFailureAlerts({LEAD_DB:db,FAILURE_EMAIL:sender(messages)});
  assert.equal(messages.length,0);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM mail_failure_alerts').get().n,2,'no cleanup deletes metadata');
  await assert.rejects(flushFailureAlerts({LEAD_DB:db}),/MAIL_ALERTS_NOT_CONFIGURED/);
});

test('the eighth Resend failure triggers alerts in the same unattended tick', async t => {
  const db=await failures(),messages=[],RETRY_STATUS=statusStore();
  db.sql.exec("UPDATE consultation_mail SET state='pending',attempts=7 WHERE state='failed'; UPDATE notification_outbox SET state='pending',attempts=7");
  const pagesEnv={LEAD_DB:db,RESEND_API_KEY:'test-only'};
  t.mock.method(globalThis,'fetch',async url=>url==='https://agenquest.com/api/health'?health({env:pagesEnv}):Response.json({error:'temporary'},{status:503}));
  const env={LEAD_DB:db,FAILURE_EMAIL:sender(messages),RETRY_STATUS};
  await worker.scheduled(checkpoint,env); await worker.scheduled(checkpoint,env);
  assert.equal(messages.length,2);
  assert.equal(RETRY_STATUS.latest.alerts_ok,true);
  assert.equal(db.sql.prepare("SELECT attempts FROM consultation_mail WHERE state='failed'").get().attempts,8);
  assert.equal(db.sql.prepare('SELECT attempts FROM notification_outbox').get().attempts,8);
});

test('alerts still run when Pages is unavailable; alert failure makes a successful drain unhealthy', async t => {
  const db=await failures(),messages=[],RETRY_STATUS=statusStore();
  t.mock.method(globalThis,'fetch',async()=>{throw Error('Pages unavailable');});
  await assert.rejects(worker.scheduled(checkpoint,{LEAD_DB:db,FAILURE_EMAIL:sender(messages),RETRY_STATUS}),/MAIL_RETRY_REQUEST_FAILED/);
  assert.equal(messages.length,2); assert.equal(RETRY_STATUS.latest.alerts_ok,true);
  t.mock.restoreAll();
  t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true,service:'agenquest-api',mail_retry:'completed'}));
  t.mock.method(console,'error',()=>{});
  await assert.rejects(worker.scheduled(checkpoint,{LEAD_DB:db,RETRY_STATUS}),/MAIL_FAILURE_ALERTS_FAILED/);
  assert.equal(RETRY_STATUS.latest.ok,false); assert.equal(RETRY_STATUS.latest.drain_ok,true); assert.equal(RETRY_STATUS.latest.alerts_ok,false);
});
