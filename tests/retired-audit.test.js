import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as audit } from '../functions/api/audit.js';
import { onRequest as suggest } from '../functions/api/suggest.js';
import { onRequest as lead } from '../functions/api/lead.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { recordLead, acceptReport } from '../functions/lib/lead-store.js';
import { saveInquiry } from '../functions/lib/inquiry-store.js';
import { memoryMailD1 } from './d1-helper.js';

const routes = [['/api/audit', audit], ['/api/suggest', suggest], ['/api/lead', lead]];
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const forbidden = () => assert.fail('Retirement must not access input, services, storage or background work');

for (const [path, handler] of routes) {
  test(`${path} is retired for every method without parsing input or accessing bindings`, async t => {
    const fetch = t.mock.method(globalThis, 'fetch', forbidden);
    for (const method of methods) {
      // Includes a valid-looking report, invalid JSON and deliberately unavailable bindings.
      for (const body of ['{', JSON.stringify({brand:'Test',website:'example.test',email:'test@example.test',queries:['Which product?'],report:{status:'complete',results:[]}})]) {
        const request = new Request('https://agenquest.com' + path, {method, ...(!['GET','HEAD'].includes(method) ? {body} : {})});
        const result = await handler({request:new Proxy(request,{get:forbidden}),env:new Proxy({},{get:forbidden}),waitUntil:forbidden,next:forbidden});
        assert.equal(result.status,410);
        assert.equal(result.headers.get('cache-control'),'no-store');
        assert.equal(result.headers.get('x-robots-tag'),'noindex');
        const payload = await result.json();
        assert.equal(payload.code,'AUDIT_RETIRED');
        assert.equal(payload.contact_url,'/contact/');
        assert.equal(payload.ok,undefined);
      }
    }
    assert.equal(fetch.mock.callCount(),0);
  });
}

test('middleware retires exact and trailing-slash paths before fallback or HTML queue drains', async t => {
  const fetch = t.mock.method(globalThis,'fetch',forbidden);
  for (const [path] of routes) for (const suffix of ['', '/', '/?old=1']) for (const method of methods) {
    const result = await middleware({request:new Request('https://agenquest.com'+path+suffix,{method,headers:{accept:'text/html'}}),get env(){forbidden();},next:forbidden,waitUntil:forbidden});
    assert.equal(result.status,410);
  }
  for (const path of ['/api/inquiry','/api/health','/contact/','/blog/','/api/audit-other']) {
    const expected = new Response('normal handling');
    assert.equal(await middleware({request:new Request('https://agenquest.com'+path),env:{},next:async()=>expected,waitUntil:forbidden}),expected);
  }
  assert.equal(fetch.mock.callCount(),0);
});

test('retired requests preserve historical leads, events, saved payloads and consultation records', async t => {
  const db = memoryMailD1();
  t.after(()=>db.sql.close());
  const oldLead = await recordLead(db,{key:'historical',email:'old@example.test',brand:'Historical',website:'',phone:'',consent:false,score:50,checked:2});
  await acceptReport(db,oldLead.id,'historical-report',{from:'sender@example.test',to:['owner@example.test'],subject:'Saved notification',html:'Saved historical payload'});
  await saveInquiry(db,{website:'https://example.test/',name:'Saved',email:'saved@example.test',message:'Saved inquiry',source_page:'/contact/'},'saved-key','saved-hash',{});
  // Old records remain intact even when they are older than the policy period.
  db.sql.exec("UPDATE leads SET created_at='2000-01-01'; UPDATE consultation_inquiries SET created_at='2000-01-01'");
  const snapshot = () => Object.fromEntries(['leads','lead_events','notification_outbox','consultation_inquiries','consultation_mail','consultation_attribution','mail_failure_alerts'].map(table=>[table,db.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot();
  t.mock.method(globalThis,'fetch',forbidden);
  for (const [path] of routes) await middleware({request:new Request('https://agenquest.com'+path,{method:'POST',headers:{accept:'text/html'},body:'{}'}),env:{LEAD_DB:db,RESEND_API_KEY:'test'},next:forbidden,waitUntil:forbidden});
  assert.deepEqual(snapshot(),before);
});
