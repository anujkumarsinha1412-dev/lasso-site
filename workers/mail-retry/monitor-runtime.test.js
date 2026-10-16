import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';

test('the separate monitor verifies signed webhooks and checks heartbeat in the Workers runtime',async()=>{
  const config=JSON.parse(readFileSync(new URL('../mail-monitor/wrangler.jsonc',import.meta.url),'utf8'));
  const secret='whsec_'+Buffer.from('runtime-test-secret-not-a-real-key').toString('base64');
  const runtime=new Miniflare(convertV4MiniflareOptions({
    modulesRoot:fileURLToPath(new URL('../mail-monitor/',import.meta.url)),
    modules:['index.js','signature.js','monitor.js'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../mail-monitor/'+name,import.meta.url)),contents:readFileSync(new URL('../mail-monitor/'+name,import.meta.url),'utf8')})),
    compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
    bindings:{RESEND_WEBHOOK_SECRET:secret},kvNamespaces:['RETRY_STATUS'],d1Databases:['LEAD_DB'],email:{send_email:config.send_email},
    outboundService:()=>assert.fail('The monitor uses no Resend or public health fetch'),
  }));
  try {
    const db=await runtime.getD1Database('LEAD_DB');
    for(const name of ['0001_leads','0002_consultation_inquiries','0003_consultation_attribution','0004_mail_failure_alerts','0005_mail_monitor']) {
      const sql=readFileSync(new URL('../../migrations/'+name+'.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\r/g,'').split(';').map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean).join(';\n')+';';
      await db.exec(sql);
    }
    const status=await runtime.getKVNamespace('RETRY_STATUS'),worker=await runtime.getWorker();
    const checkpoint=()=>({scheduled_at:new Date().toISOString(),finished_at:new Date().toISOString(),ok:true,drain_ok:true,alerts_ok:true});
    await status.put('latest',JSON.stringify(checkpoint()));
    const body=JSON.stringify({type:'email.bounced',data:{email_id:'00000000-0000-4000-8000-000000000002',subject:'[TEST] Workers runtime'}}),at=String(Math.floor(Date.now()/1000));
    const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update('msg_runtime.'+at+'.'+body).digest('base64');
    const url='https://mail-monitor.agenquest.com/webhooks/resend';
    assert.equal((await worker.fetch(url,{method:'POST',body,headers:{'content-type':'application/json'}})).status,401);
    assert.equal((await worker.fetch(url,{method:'POST',body,headers:{'content-type':'application/json','svix-id':'msg_runtime','svix-timestamp':at,'svix-signature':'v1,'+signature}})).status,202);
    const tick=()=>worker.scheduled({cron:'*/5 * * * *',scheduledTime:new Date()});
    await tick();
    assert.equal((await db.prepare('SELECT state FROM mail_monitor_alerts').first()).state,'accepted');
    await status.put('latest',JSON.stringify({...checkpoint(),scheduled_at:'2000-01-01',finished_at:'2000-01-01'}));
    await tick();await tick();
    assert.equal((await db.prepare("SELECT count(*) n FROM mail_monitor_alerts WHERE kind='timer_stale'").first()).n,1);
    await status.put('latest',JSON.stringify(checkpoint()));await tick();await tick();
    assert.equal((await db.prepare("SELECT count(*) n FROM mail_monitor_alerts WHERE state='accepted'").first()).n,3);
    assert.equal((await worker.fetch('https://mail-monitor.agenquest.com/')).status,404);
  }finally{await runtime.dispose();}
});
