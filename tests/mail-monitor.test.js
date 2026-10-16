import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../workers/mail-monitor/index.js';
import { validSignature } from '../workers/mail-monitor/signature.js';
import { saveDeliveryAlert,heartbeatProblem,checkHeartbeat,flushMonitorAlerts } from '../workers/mail-monitor/monitor.js';
import { memoryMailD1 } from './d1-helper.js';

const secret='whsec_'+Buffer.from('test-only-webhook-secret-not-a-real-key').toString('base64');
const emailId='00000000-0000-4000-8000-000000000001';
const event=(type='email.bounced')=>({type,data:{email_id:emailId,subject:'[TEST] monitoring check',to:['private@example.test'],bounce:{message:'private provider diagnostic'}}});
function signed(body,id='msg_test',at=Math.floor(Date.now()/1000),key=secret) {
  const signature=createHmac('sha256',Buffer.from(key.replace('whsec_',''),'base64')).update(`${id}.${at}.${body}`).digest('base64');
  return {'content-type':'application/json','svix-id':id,'svix-timestamp':String(at),'svix-signature':'v1,'+signature};
}
const healthy=()=>({scheduled_at:new Date().toISOString(),finished_at:new Date().toISOString(),ok:true,drain_ok:true,alerts_ok:true});
function setup(t) {
  const db=memoryMailD1();t.after(()=>db.sql.close());
  let heartbeat=healthy(),fail=false;const messages=[];
  const env={LEAD_DB:db,RESEND_WEBHOOK_SECRET:secret,RETRY_STATUS:{async get(){return heartbeat;}},MONITOR_EMAIL:{async send(mail){if(fail)throw Error('private provider diagnostic');messages.push(mail);return {messageId:'monitor-'+messages.length};}}};
  return {db,env,messages,setHeartbeat:value=>{heartbeat=value;},setFail:value=>{fail=value;}};
}
async function post(env,body,headers=signed(body)) {
  const pending=[];
  const result=await worker.fetch(new Request('https://mail-monitor.agenquest.com/webhooks/resend',{method:'POST',body,headers}),env,{waitUntil:p=>pending.push(p)});
  await Promise.all(pending);return result;
}

test('Svix verification matches the vendor fixture, raw body, rotation and timestamp window',async t=>{
  let clock=1731705121000;
  t.mock.method(Date,'now',()=>clock);
  const headers=new Headers({'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121','svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='});
  const body='{"event_type":"ping","data":{"success":true}}',fixture='whsec_plJ3nmyCDGBKInavdOK15jsl';
  assert.equal(await validSignature(headers,body,fixture),true);
  assert.equal(await validSignature(headers,body+' ',fixture),false);
  headers.set('svix-signature','v2,ignored v1,broken v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=');
  assert.equal(await validSignature(headers,body,fixture),true);
  clock=1731705422000;
  assert.equal(await validSignature(headers,body,fixture),false);
});

test('unsigned, forged, stale and oversized webhooks cannot create alerts',async t=>{
  const {db,env}=setup(t),body=JSON.stringify(event());
  for(const headers of [{},signed(body,'msg_stale',Math.floor(Date.now()/1000)-301),signed(body+' '),signed(body,'msg_wrong',undefined,'whsec_d3Jvbmc=')]) {
    assert.equal((await post(env,body,{'content-type':'application/json',...headers})).status,401);
  }
  assert.equal((await post(env,'x'.repeat(32769))).status,400);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM mail_monitor_alerts').get().n,0);
});

test('signed delivery events persist once per message/type, send independent alerts and omit private payloads',async t=>{
  const {db,env,messages}=setup(t),body=JSON.stringify(event());
  t.mock.method(globalThis,'fetch',()=>assert.fail('Must use Cloudflare email binding'));
  assert.equal((await post(env,body)).status,202);
  assert.equal((await post(env,body,signed(body,'msg_replay'))).status,202);
  for(const type of ['email.complained','email.failed','email.suppressed'])assert.equal((await post(env,JSON.stringify(event(type)))).status,202);
  assert.equal(messages.length,4);
  assert.ok(messages.every(m=>m.to==='agenquest@gmail.com'&&m.from.email==='hello@agenquest.com'&&m.subject.startsWith('[TEST]')));
  const metadata=JSON.stringify(db.sql.prepare('SELECT * FROM mail_monitor_alerts').all());
  assert.ok(!metadata.includes('private'));assert.ok(!JSON.stringify(messages).includes('private'));
  assert.equal(db.sql.prepare('SELECT count(*) n FROM consultation_mail').get().n,0);
});

test('unsupported events are ignored and storage failure asks Resend to retry',async t=>{
  const {db,env,messages}=setup(t);
  assert.equal((await post(env,JSON.stringify(event('email.opened')))).status,202);
  assert.equal(messages.length,0);
  const unavailable={...env,LEAD_DB:{prepare(){throw Error('private failure');}}};
  t.mock.method(console,'error',()=>{});
  assert.equal((await post(unavailable,JSON.stringify(event()))).status,503);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM mail_monitor_alerts').get().n,0);
  assert.equal((await worker.fetch(new Request('https://example.test/'),env,{})).status,404);
  assert.equal((await worker.fetch(new Request('https://example.test/webhooks/resend'),env,{})).status,405);
});

test('heartbeat checks reject missing, malformed, future, stale and unhealthy checkpoints',()=>{
  const good=healthy();assert.equal(heartbeatProblem(good),'');
  for(const value of [null,{}, {...good,finished_at:'bad'},{...good,scheduled_at:new Date(Date.now()+600000).toISOString()}, {...good,finished_at:new Date(Date.now()+600000).toISOString()}, {...good,ok:false}, {...good,alerts_ok:false}, {...good,drain_ok:false}])assert.ok(heartbeatProblem(value));
  assert.equal(heartbeatProblem({...good,scheduled_at:new Date(Date.now()-16*60000).toISOString()}),'HEARTBEAT_STALE');
});

test('a stopped retry timer produces one warning and one recovery, without changing the heartbeat',async t=>{
  const {db,env,messages,setHeartbeat}=setup(t);
  await worker.scheduled({},env);assert.equal(messages.length,0);
  setHeartbeat({...healthy(),scheduled_at:'2000-01-01',finished_at:'2000-01-01'});
  await Promise.all([worker.scheduled({},env),worker.scheduled({},env)]);
  assert.equal(messages.length,1);assert.match(messages[0].subject,/timer needs attention/);
  await worker.scheduled({},env);assert.equal(messages.length,1);
  setHeartbeat(healthy());await worker.scheduled({},env);
  await worker.scheduled({},env);assert.equal(messages.length,2);assert.match(messages[1].subject,/timer recovered/);
  assert.equal(db.sql.prepare('SELECT incident_id FROM mail_watchdog_state').get().incident_id,null);
});

test('monitor email failures back off, survive recovery and eventually send warning before recovery',async t=>{
  const {db,env,messages,setHeartbeat,setFail}=setup(t);
  setHeartbeat(null);setFail(true);
  await assert.rejects(worker.scheduled({},env),/MONITOR_DELIVERY_DEFERRED/);
  assert.equal(messages.length,0);
  await worker.scheduled({},env);assert.equal(db.sql.prepare('SELECT attempts FROM mail_monitor_alerts').get().attempts,1);
  setHeartbeat(healthy());await checkHeartbeat(env);
  setFail(false);db.sql.exec("UPDATE mail_monitor_alerts SET next_attempt_at='2000-01-01'");
  await flushMonitorAlerts(env);assert.equal(messages.length,1);assert.match(messages[0].subject,/needs attention/);
  await flushMonitorAlerts(env);assert.equal(messages.length,2);assert.match(messages[1].subject,/recovered/);
  await flushMonitorAlerts(env);assert.equal(messages.length,2);
});

test('unreadable status still warns, delivery alerts still retry, and stale leases recover',async t=>{
  const {db,env,messages}=setup(t);
  await saveDeliveryAlert(db,event());
  db.sql.exec("UPDATE mail_monitor_alerts SET state='sending',next_attempt_at='2000-01-01',lease_token='abandoned'");
  env.RETRY_STATUS.get=async()=>{throw Error('private KV failure');};
  await worker.scheduled({},env);
  assert.equal(messages.length,2);
  assert.ok(messages.some(m=>m.text.includes('HEARTBEAT_UNREADABLE')));
});

test('accepted alert storage failure keeps its lease instead of immediately duplicating delivery',async t=>{
  const {db,env,messages}=setup(t);await saveDeliveryAlert(db,event());
  db.sql.exec("CREATE TRIGGER fail_accept BEFORE UPDATE ON mail_monitor_alerts WHEN NEW.state='accepted' BEGIN SELECT RAISE(ABORT,'test storage error'); END");
  await assert.rejects(flushMonitorAlerts(env));assert.equal(messages.length,1);
  await flushMonitorAlerts(env);assert.equal(messages.length,1);
  assert.equal(db.sql.prepare('SELECT state FROM mail_monitor_alerts').get().state,'sending');
});
