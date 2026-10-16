import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../workers/mail-retry/index.js';
import { onRequestGet as health } from '../functions/api/health.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { saveInquiry } from '../functions/lib/inquiry-store.js';
import { recordLead, acceptReport } from '../functions/lib/lead-store.js';
import { memoryD1 } from './d1-helper.js';

const checkpoint = { scheduledTime: Date.parse('2026-10-16T13:05:00Z') };
function statusStore() {
  const writes = [];
  return { writes, async put(key, value) { writes.push({ key, value: JSON.parse(value) }); } };
}
async function queuedMail() {
  const db = memoryD1();
  for (const name of ['0002_consultation_inquiries','0003_consultation_attribution']) {
    db.sql.exec(readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8'));
  }
  await saveInquiry(db,{website:'https://example.test/',name:'Test',email:'prospect@example.test',message:'Test',source_page:'/contact/'},'inquiry-key','hash',{});
  const lead = await recordLead(db,{key:'audit-key',email:'audit@example.test',brand:'Test',website:'',phone:'',consent:false,score:0,checked:1});
  await acceptReport(db,lead.id,'already-sent-report',{from:'sender@example.test',to:['owner@example.test'],subject:'Test',html:'Test'});
  return db;
}

test('quiet-site scheduled ticks retry both queues, respect backoff and do not resend accepted mail', async t => {
  const db = await queuedMail(), env = { LEAD_DB:db, RESEND_API_KEY:'test-only' }, RETRY_STATUS = statusStore();
  let good = false;
  const sends = [];
  t.mock.method(globalThis,'fetch',async (url, init) => {
    if (url === 'https://agenquest.com/api/health') {
      assert.equal(init.redirect,'error'); assert.ok(init.signal);
      return health({env});
    }
    assert.equal(url,'https://api.resend.com/emails');
    sends.push(init.headers['Idempotency-Key']);
    return Response.json(good ? {id:'provider-'+sends.length} : {error:'temporary'},{status:good ? 200 : 503});
  });
  await worker.scheduled(checkpoint,{RETRY_STATUS});
  assert.equal(sends.length,3);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM consultation_mail WHERE state='pending' AND attempts=1").get().n,2);
  assert.equal(db.sql.prepare('SELECT state FROM notification_outbox').get().state,'pending');
  await worker.scheduled(checkpoint,{RETRY_STATUS});
  assert.equal(sends.length,3,'early ticks must respect stored backoff');
  const firstKeys = [...sends].sort();
  db.sql.exec("UPDATE consultation_mail SET next_attempt_at='2000-01-01'; UPDATE notification_outbox SET next_attempt_at='2000-01-01'");
  good = true;
  await worker.scheduled(checkpoint,{RETRY_STATUS});
  assert.deepEqual(sends.slice(3).sort(),firstKeys,'retry keeps provider idempotency keys');
  assert.equal(db.sql.prepare("SELECT count(*) n FROM consultation_mail WHERE state='accepted'").get().n,2);
  assert.equal(db.sql.prepare('SELECT notification_status FROM leads').get().notification_status,'accepted');
  await worker.scheduled(checkpoint,{RETRY_STATUS});
  assert.equal(sends.length,6);
  assert.equal(RETRY_STATUS.writes.at(-1).value.code,'DRAIN_COMPLETED');
  assert.ok(!JSON.stringify(RETRY_STATUS.writes).includes('example.test'));
});

test('health awaits both queues and safely reports configuration or database failures', async t => {
  t.mock.method(console,'error',()=>{});
  for (const env of [{},{LEAD_DB:{},RESEND_API_KEY:''},{LEAD_DB:{prepare(){throw new Error('private database details');}},RESEND_API_KEY:'test'}]) {
    const response = await health({env});
    assert.equal(response.status,503);
    const result = await response.json();
    assert.equal(result.mail_retry,'unavailable'); assert.equal(result.ok,false);
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});

test('cron reports bad HTTP, unexpected JSON and network/timeout failures; a later tick recovers', async t => {
  const RETRY_STATUS = statusStore();
  for (const behavior of [()=>new Response('private gateway',{status:503}),()=>Response.json({ok:true}),()=>new Response('not json'),()=>{throw new DOMException('private timeout','TimeoutError');}]) {
    t.mock.method(globalThis,'fetch',async()=>behavior());
    await assert.rejects(worker.scheduled(checkpoint,{RETRY_STATUS}),/^Error: MAIL_RETRY_/);
    assert.equal(RETRY_STATUS.writes.at(-1).value.ok,false);
    assert.ok(!JSON.stringify(RETRY_STATUS.writes).includes('private'));
    t.mock.restoreAll();
  }
  t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true,service:'agenquest-api',mail_retry:'completed'}));
  await worker.scheduled(checkpoint,{RETRY_STATUS});
  assert.equal(RETRY_STATUS.writes.at(-1).value.ok,true);
  const n=RETRY_STATUS.writes.length;
  await worker.scheduled({scheduledTime:checkpoint.scheduledTime+60000},{RETRY_STATUS});
  assert.equal(RETRY_STATUS.writes.length,n,'checkpoint writes stay within the KV free daily allowance');
  assert.equal((await worker.fetch()).status,404);
});

test('expired or exhausted mail is held for review without sending; an abandoned lease is recovered', async t => {
  const db = await queuedMail(), env = { LEAD_DB:db, RESEND_API_KEY:'test-only' };
  db.sql.exec("UPDATE consultation_mail SET created_at='2000-01-01',next_attempt_at='2000-01-01'; UPDATE notification_outbox SET attempts=1; UPDATE leads SET created_at='2000-01-01'");
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(init.headers['Idempotency-Key']);return Response.json({id:'recovered'});});
  assert.equal((await health({env})).status,200);
  assert.equal(calls.length,0);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM consultation_mail WHERE state='failed'").get().n,2);
  assert.equal(db.sql.prepare('SELECT state FROM notification_outbox').get().state,'failed');
  db.sql.prepare("UPDATE consultation_mail SET state='sending',attempts=7,created_at=?,next_attempt_at='2000-01-01' WHERE id LIKE '%/owner'").run(new Date().toISOString());
  await Promise.all([health({env}),health({env})]);
  assert.equal(calls.length,1,'overlapping ticks claim a recovered lease once');
  db.sql.exec("UPDATE consultation_mail SET state='pending',attempts=8,next_attempt_at='2000-01-01' WHERE id LIKE '%/owner'");
  await health({env}); assert.equal(calls.length,1);
});

test('health drain is not duplicated by background middleware', async () => {
  const response = Response.json({ok:true});
  const result = await middleware({request:new Request('https://agenquest.com/api/health',{headers:{accept:'text/html'}}),env:{LEAD_DB:{}},next:async()=>response,waitUntil(){assert.fail('duplicate health drain');}});
  assert.equal(result,response);
});
