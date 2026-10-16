import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, cleanParams, acquisition, attributionRecord } from '../src/lib/tracking.js';
import { privateAttribution, recordLead, acceptReport, flushNotifications } from '../functions/lib/lead-store.js';
import { memoryD1 } from './d1-helper.js';
import { onRequestPost as submitLead } from '../functions/api/lead.js';
import { postJson } from '../src/lib/audit-client.js';
import { readFileSync } from 'node:fs';
import { EVENTS } from '../src/lib/tracking.js';

const verified = {query:'Which cookware should I buy?',query_type:'discovery',prominence:'recommended',status:'verified',brands_named:['Acme'],note:'Acme is recommended.',answer:'Consider Acme cookware [1].',sources:[{url:'https://example.com/review',title:'Review'}],model:'gpt-4.1-mini',response_id:'resp_test',checked_at:'2026-10-14T10:00:00Z'};
const body = {email:'test@example.test',brand:'Acme',report:{status:'complete',results:[verified]}};
const request = () => new Request('https://agenquest.com/api/lead',{method:'POST',body:JSON.stringify(body)});
test('published GTM contract stays within GA4 parameter limits and routes each event once', () => {
  const cv=JSON.parse(readFileSync(new URL('../analytics/gtm-container.json',import.meta.url),'utf8')).containerVersion;
  const tags=cv.tag.filter(t=>t.type==='gaawe');
  for(const tag of tags) assert.ok(tag.parameter.find(p=>p.key==='eventSettingsTable').list.length<=20);
  for(const event of EVENTS.filter(e=>e!=='page_view')) {
    const matching=tags.filter(t=>{const trigger=cv.trigger.find(x=>x.triggerId===t.firingTriggerId[0]); const regex=trigger.customEventFilter[0].parameter.find(p=>p.key==='arg1').value; return new RegExp(regex).test(event);});
    assert.equal(matching.length,1,event);
  }
  assert.equal(tags.some(t=>{const trigger=cv.trigger.find(x=>x.triggerId===t.firingTriggerId[0]); return new RegExp(trigger.customEventFilter[0].parameter.find(p=>p.key==='arg1').value).test('unapproved_event');}),false);
});

test('analytics strips private URLs and rejects arbitrary payloads', () => {
  assert.equal(cleanUrl('https://agenquest.com/?brand=private&email=test@example.com#secret'), 'https://agenquest.com/');
  assert.equal(cleanUrl('https://secret:password@agenquest.com/'), '');
  assert.equal(cleanUrl('javascript:alert(1)'), '');
  assert.deepEqual(cleanParams({ brand:'Acme', email:'test@example.com', query:'private', score:71, category_group:'home_and_kitchen', stage:'test@example.com', duration_ms:Infinity }), {category_group:'home_and_kitchen',score:71});
});
test('gateway HTML produces a safe machine-readable failure without leaking its content', async () => {
  await assert.rejects(postJson('/api/audit',{},async()=>new Response('<html>private gateway content</html>',{status:502})),e=>e.code==='INVALID_RESPONSE' && e.http_status===502 && !e.message.includes('private gateway'));
});
test('AI referral classification uses parsed, exact host boundaries', () => {
  assert.equal(acquisition('https://agenquest.com/','https://chatgpt.com/share/x').ai_source, 'chatgpt');
  for (const ref of ['https://chatgpt.com.evil.test/','https://evil.test/?next=chatgpt.com','https://notchatgpt.com/']) assert.equal(acquisition('https://agenquest.com/',ref).ai_source,'none');
  assert.equal(acquisition('https://agenquest.com/?utm_source=perplexity&utm_medium=referral').ai_source,'perplexity');
  assert.equal(acquisition('https://agenquest.com/?utm_source=person%40example.com').source,'(direct)');
});
test('attribution preserves first and last non-direct across pages and expires sessions', () => {
  const now = Date.now();
  const first = acquisition('https://agenquest.com/?utm_source=linkedin&utm_medium=social&utm_campaign=launch','',now);
  const a = attributionRecord(null,first,now);
  const direct = acquisition('https://agenquest.com/blog/','https://agenquest.com/',now+1000);
  const b = attributionRecord(a,direct,now+1000);
  assert.equal(b.session.source,'linkedin'); assert.equal(b.first.source,'linkedin'); assert.equal(b.last_non_direct.source,'linkedin');
  const c = attributionRecord(b,direct,now+31*60000);
  assert.equal(c.session.source,'(direct)'); assert.equal(c.last_non_direct.source,'linkedin');
  const d = attributionRecord(c,direct,now+91*86400000);
  assert.equal(d.first.source,'(direct)'); assert.equal(d.last_non_direct,null);
  assert.equal(privateAttribution(a,false),null);
});
test('lead record exists before email, duplicates share one ID, accepted is separate from qualified', async () => {
  const db = memoryD1();
  const input = {key:'unique',email:'prospect@example.test',brand:'Acme',website:'',phone:'',attribution:null,consent:false,score:50,checked:2};
  const first = await recordLead(db,input); const second = await recordLead(db,input);
  assert.equal(first.id,second.id); assert.equal(db.sql.prepare('SELECT count(*) AS n FROM leads').get().n,1);
  await acceptReport(db,first.id,'provider-id',{from:'sender@example.test',to:['owner@example.test'],subject:'test',html:'test'});
  const row = db.sql.prepare('SELECT * FROM leads').get();
  assert.equal(row.report_email_status,'accepted'); assert.equal(row.qualified_at,null); assert.equal(row.call_booked_at,null);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM notification_outbox').get().n,1);
  await assert.rejects(recordLead(null,input),e => e.code === 'LEAD_STORAGE_UNAVAILABLE');
});
test('failed owner notification persists and a later retry accepts it once', async t => {
  const db = memoryD1();
  const lead = await recordLead(db,{key:'retry',email:'prospect@example.test',brand:'Acme',website:'',phone:'',attribution:null,consent:false,score:50,checked:2});
  await acceptReport(db,lead.id,'report-id',{from:'sender@example.test',to:['owner@example.test'],subject:'test',html:'test'});
  let good = false; const keys = [];
  t.mock.method(globalThis,'fetch',async (url,init) => { keys.push(init.headers['Idempotency-Key']); return new Response(JSON.stringify(good ? {id:'owner-id'} : {error:'failed'}),{status:good ? 200 : 500}); });
  const env = {LEAD_DB:db,RESEND_API_KEY:'test'};
  await flushNotifications(env);
  assert.equal(db.sql.prepare('SELECT state FROM notification_outbox').get().state,'pending');
  assert.equal(db.sql.prepare('SELECT report_email_status FROM leads').get().report_email_status,'accepted');
  db.sql.prepare("UPDATE notification_outbox SET next_attempt_at='2000-01-01'").run(); good=true;
  await flushNotifications(env); await flushNotifications(env);
  assert.equal(keys.length,2); assert.equal(keys[0],keys[1]);
  assert.equal(db.sql.prepare('SELECT notification_status FROM leads').get().notification_status,'accepted');
});
test('public submit endpoint refuses to send without durable storage and deduplicates accepted retries', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,init) => { calls.push({url,body:JSON.parse(init.body)}); return new Response(JSON.stringify({id:'provider-id'})); });
  assert.equal((await submitLead({request:request(),env:{RESEND_API_KEY:'test'}})).status,503);
  assert.equal(calls.length,0);
  const env={RESEND_API_KEY:'test',LEAD_DB:memoryD1()};
  const first=await (await submitLead({request:request(),env})).json();
  const second=await (await submitLead({request:request(),env})).json();
  assert.equal(first.lead_id,second.lead_id); assert.equal(second.duplicate,true);
  assert.equal(calls.length,2); // One report, one owner alert; no duplicate sends.
  assert.equal(env.LEAD_DB.sql.prepare('SELECT count(*) AS n FROM leads').get().n,1);
  assert.equal(env.LEAD_DB.sql.prepare("SELECT count(*) AS n FROM lead_events WHERE event='report_email_accepted'").get().n,1);
});
