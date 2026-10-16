import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('the real Workers runtime executes scheduled fetches and rejects redirects without following them', async () => {
  let redirect = false, requests = 0;
  const config = JSON.parse(readFileSync(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: readFileSync(new URL('./index.js',import.meta.url),'utf8'),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    kvNamespaces: config.kv_namespaces.map(binding=>binding.binding),
    outboundService: async request => {
      requests++;
      assert.equal(request.url,'https://agenquest.com/api/health');
      return redirect
        ? new Response(null,{status:302,headers:{location:'https://unrelated.example/'}})
        : Response.json({ok:true,service:'agenquest-api',mail_retry:'completed'});
    },
  }));
  try {
    const worker = await runtime.getWorker();
    const status = await runtime.getKVNamespace('RETRY_STATUS');
    const scheduledTime = new Date('2026-10-16T13:05:00Z');
    await worker.scheduled({cron:'* * * * *',scheduledTime});
    assert.equal(requests,1,'fetch must reach the endpoint in the Workers runtime');
    assert.equal((await status.get('latest','json')).code,'DRAIN_COMPLETED');
    redirect = true;
    await worker.scheduled({cron:'* * * * *',scheduledTime});
    assert.equal(requests,2,'redirect destination must never be fetched');
    assert.equal((await status.get('latest','json')).code,'HTTP_302');
    assert.equal((await worker.fetch('https://example.test/')).status,404);
  } finally {
    await runtime.dispose();
  }
});
