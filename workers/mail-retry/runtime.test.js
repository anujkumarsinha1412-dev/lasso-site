import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('the Workers runtime executes retries and local alert delivery, and rejects redirects', async () => {
  let redirect = false, requests = 0;
  const config = JSON.parse(readFileSync(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: ['index.js','alerts.js'].map(name=>({type:'ESModule',path:fileURLToPath(new URL(name,import.meta.url)),contents:readFileSync(new URL(name,import.meta.url),'utf8')})),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    kvNamespaces: config.kv_namespaces.map(binding=>binding.binding),
    d1Databases: ['LEAD_DB'],
    email: { send_email: config.send_email },
    outboundService: async request => {
      requests++;
      assert.equal(request.url,'https://agenquest.com/api/health');
      return redirect
        ? new Response(null,{status:302,headers:{location:'https://unrelated.example/'}})
        : Response.json({ok:true,service:'agenquest-api',mail_retry:'completed'});
    },
  }));
  try {
    const db = await runtime.getD1Database('LEAD_DB');
    for (const name of ['0001_leads','0002_consultation_inquiries','0003_consultation_attribution','0004_mail_failure_alerts']) {
      const sql = readFileSync(new URL(`../../migrations/${name}.sql`,import.meta.url),'utf8')
        .replace(/--[^\n]*/g,'').replace(/\r/g,'').split(';').map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean).join(';\n')+';';
      await db.exec(sql);
    }
    const worker = await runtime.getWorker();
    const status = await runtime.getKVNamespace('RETRY_STATUS');
    const scheduledTime = new Date('2026-10-16T13:05:00Z');
    await worker.scheduled({cron:'* * * * *',scheduledTime});
    assert.equal(requests,1,'fetch must reach the endpoint in the Workers runtime');
    assert.equal((await status.get('latest','json')).code,'DRAIN_COMPLETED');
    await db.prepare("INSERT INTO consultation_inquiries (id,request_key,payload_hash,created_at,website,name,email,status) VALUES ('runtime-inquiry','runtime-key','hash',?,'https://example.test/','Runtime test','test@example.test','test')").bind(new Date().toISOString()).run();
    await db.prepare("INSERT INTO consultation_mail (id,inquiry_id,payload_json,state,attempts,created_at,next_attempt_at,last_error) VALUES ('inquiry/runtime-inquiry/owner','runtime-inquiry','{}','failed',8,?,?,'EMAIL_NOT_ACCEPTED')").bind(new Date().toISOString(),new Date().toISOString()).run();
    await worker.scheduled({cron:'* * * * *',scheduledTime});
    assert.equal((await db.prepare('SELECT state FROM mail_failure_alerts').first()).state,'accepted');
    assert.equal((await status.get('latest','json')).alerts_ok,true);
    assert.equal(requests,2,'alerts use the local email binding rather than an outbound Resend call');
    redirect = true;
    await worker.scheduled({cron:'* * * * *',scheduledTime});
    assert.equal(requests,3,'redirect destination must never be fetched');
    assert.equal((await status.get('latest','json')).code,'HTTP_302');
    assert.equal((await worker.fetch('https://example.test/')).status,404);
  } finally {
    await runtime.dispose();
  }
});
