import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1-helper.js';
import { validateInquiry,normalizeWebsite } from '../src/lib/inquiry.js';
import { onRequestPost } from '../functions/api/inquiry.js';
import { flushInquiryMail,inquiryEmails } from '../functions/lib/inquiry-store.js';

function database(){const db=memoryD1();db.sql.exec(readFileSync(new URL('../migrations/0002_consultation_inquiries.sql',import.meta.url),'utf8'));return db;}
const input=()=>({request_key:crypto.randomUUID(),website:'example.com',name:'अनुज',email:'person@example.com',message:'A consultation, please.',source_page:'/blog/what-is-aeo/'});
function context(body,db,headers={}){const pending=[];return {request:new Request('https://agenquest.com/api/inquiry',{method:'POST',headers:{origin:'https://agenquest.com','content-type':'application/json','cf-connecting-ip':'192.0.2.1',...headers},body:JSON.stringify(body)}),env:{LEAD_DB:db},waitUntil:p=>pending.push(p),pending};}

test('consultation accepts an international single name and a domain without making a live lookup',()=>{
  const result=validateInquiry(input());assert.equal(result.valid,true);assert.equal(result.data.website,'https://example.com/');assert.equal(result.data.name,'अनुज');
  for(const value of ['http://127.0.0.1/','localhost','https://user:pass@example.com','javascript:alert(1)','https://private.local','http://[::1]','https://example.com:4321'])assert.equal(normalizeWebsite(value),'');
  assert.equal(normalizeWebsite('example.com/path?private=email#secret'),'https://example.com/path');
  assert.ok(normalizeWebsite('пример.рф').startsWith('https://xn--'));
});

test('invalid fields fail on the server without saving or scheduling email',async()=>{
  const db=database();const ctx=context({...input(),email:'bad',name:'',website:'localhost',message:'x'.repeat(2001)},db);
  const response=await onRequestPost(ctx);assert.equal(response.status,400);assert.deepEqual(Object.keys((await response.json()).fields).sort(),['email','message','name','website']);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM consultation_inquiries').get().n,0);assert.equal(ctx.pending.length,0);
});

test('cross-origin submissions and honeypot spam are rejected',async()=>{
  const db=database();assert.equal((await onRequestPost(context(input(),db,{origin:'https://unrelated.example'}))).status,403);
  assert.equal((await onRequestPost(context({...input(),fax:'spam'},db))).status,400);
});

test('a complete inquiry and both mail jobs are saved atomically, without analytics or an audit',async()=>{
  const db=database(),body=input(),ctx=context(body,db);const response=await onRequestPost(ctx);const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.stored,true);await Promise.all(ctx.pending);
  const record=db.sql.prepare('SELECT * FROM consultation_inquiries').get();assert.equal(record.id,result.inquiry_id);assert.equal(record.source_page,body.source_page);assert.equal(record.website,'https://example.com/');
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM consultation_mail').get().n,2);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM leads').get().n,0);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM lead_events').get().n,0);
});

test('duplicate and concurrent requests save one inquiry and cannot silently replace submitted details',async()=>{
  const db=database(),body=input();const responses=await Promise.all([onRequestPost(context(body,db)),onRequestPost(context(body,db))]);
  const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results[0].inquiry_id,results[1].inquiry_id);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM consultation_inquiries').get().n,1);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM consultation_mail').get().n,2);
  assert.equal((await onRequestPost(context({...body,message:'Changed details'},db))).status,409);
});

test('storage errors never report success or send an email',async()=>{
  const ctx=context(input(),{prepare(){throw new Error('Database unavailable');}});const response=await onRequestPost(ctx);assert.equal(response.status,503);assert.equal((await response.json()).ok,undefined);assert.equal(ctx.pending.length,0);
});

test('a failed mail-job insert rolls back the inquiry transaction',async()=>{
  const db=database();db.sql.exec('DROP TABLE consultation_mail');const ctx=context(input(),db);
  assert.equal((await onRequestPost(ctx)).status,503);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM consultation_inquiries').get().n,0);
  assert.equal(ctx.pending.length,0);
});

test('rate limits apply to new requests while accepted retries remain available',async()=>{
  const db=database(),first=input();assert.equal((await onRequestPost(context(first,db))).status,200);
  for(let i=1;i<10;i++)assert.equal((await onRequestPost(context(input(),db))).status,200);
  assert.equal((await onRequestPost(context(input(),db))).status,429);assert.equal((await onRequestPost(context(first,db))).status,200);
});

test('email failure preserves saved requests and a later drain delivers each queued email once',async t=>{
  const db=database(),ctx=context(input(),db);await onRequestPost(ctx);await Promise.all(ctx.pending);
  const realFetch=globalThis.fetch;t.after(()=>globalThis.fetch=realFetch);globalThis.fetch=async()=>new Response('unavailable',{status:502});
  const env={LEAD_DB:db,RESEND_API_KEY:'test-key'};await flushInquiryMail(env);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM consultation_inquiries').get().n,1);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM consultation_mail WHERE state='pending' AND attempts=1").get().n,2);
  db.sql.exec("UPDATE consultation_mail SET next_attempt_at='2000-01-01T00:00:00.000Z'");let sent=0;
  const delivered=[];
  globalThis.fetch=async(url,init)=>{sent++;assert.ok(init.headers['Idempotency-Key'].startsWith('inquiry/'));delivered.push(JSON.parse(init.body));return new Response(JSON.stringify({id:'email-'+sent}),{headers:{'content-type':'application/json'}});};
  await Promise.all([flushInquiryMail(env),flushInquiryMail(env)]);assert.equal(sent,2);await flushInquiryMail(env);assert.equal(sent,2);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM consultation_mail WHERE state='accepted'").get().n,2);
  assert.ok(delivered.every(mail=>mail.from==='Agenquest <hello@agenquest.com>'));
  const notification=delivered.find(mail=>mail.to.includes('agenquest@gmail.com'));
  assert.equal(notification.reply_to,input().email);
  const acknowledgment=delivered.find(mail=>mail.to.includes(input().email));
  assert.equal(acknowledgment.reply_to,'hello@agenquest.com');
  assert.ok(!delivered.some(mail=>mail.to.includes('rishavjani@gmail.com')));
});

test('consultation mail configuration overrides preserve visitor and founder reply routing',()=>{
  const data=input();
  const messages=inquiryEmails(data,'reference',{INQUIRY_FROM_EMAIL:'Team <hello@example.org>',INQUIRY_OWNER_EMAIL:'inbox@example.org',INQUIRY_REPLY_TO_EMAIL:'replies@example.org'});
  assert.ok(messages.every(mail=>mail.payload.from==='Team <hello@example.org>'));
  assert.deepEqual(messages[0].payload.to,['inbox@example.org']);
  assert.equal(messages[0].payload.reply_to,data.email);
  assert.deepEqual(messages[1].payload.to,[data.email]);
  assert.equal(messages[1].payload.reply_to,'replies@example.org');
});

test('email templates escape entered values and keep personal details out of subject lines',()=>{
  const messages=inquiryEmails({...input(),name:'<img src=x onerror=alert(1)>',website:'https://example.com/',message:'<script>bad</script>'},'reference',{});
  for(const {payload} of messages){assert.ok(!payload.html.includes('<script>'));assert.ok(!payload.html.includes('<img'));assert.ok(!payload.subject.includes('example.com'));}
});
