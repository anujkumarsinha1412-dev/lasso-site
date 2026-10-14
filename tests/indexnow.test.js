import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForDeployment, sitemapUrls, submitIndexNow } from '../scripts/indexnow.mjs';

const commit = 'a'.repeat(40);
const response = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

test('submission waits until the expected commit is actually served', async () => {
  let calls = 0;
  await waitForDeployment(commit, { attempts: 3, sleep: async () => {}, fetcher: async () => response({ commit: ++calls === 3 ? commit : 'b'.repeat(40) }) });
  assert.equal(calls, 3);
});

test('a stale deployment fails without submitting any URLs', async () => {
  const calls = [];
  await assert.rejects(waitForDeployment(commit, { attempts: 2, sleep: async () => {}, fetcher: async url => { calls.push(url); return response({ commit: 'b'.repeat(40) }); } }), /no URLs were submitted/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.includes('/deployment.json')));
});

test('sitemap collection follows the index, deduplicates URLs and rejects foreign hosts', async () => {
  const fetcher = async url => response(url.endsWith('sitemap-index.xml') ? '<sitemapindex><sitemap><loc>https://agenquest.com/sitemap-0.xml</loc></sitemap></sitemapindex>' : '<urlset><url><loc>https://agenquest.com/</loc></url><url><loc>https://agenquest.com/research-methodology/</loc></url><url><loc>https://agenquest.com/</loc></url></urlset>');
  assert.deepEqual(await sitemapUrls(fetcher), ['https://agenquest.com/', 'https://agenquest.com/research-methodology/']);
  await assert.rejects(sitemapUrls(async () => response('<urlset><url><loc>https://other.example/</loc></url></urlset>')), /outside the production site/);
  await assert.rejects(sitemapUrls(async () => response('<html>not a sitemap</html>')), /not sitemap XML/);
});

test('IndexNow receives only verified production URLs and reports acknowledgement accurately', async () => {
  let payload;
  const fetcher = async (url, init) => {
    if (url.includes('/deployment.json')) return response({ commit });
    if (url.endsWith('.txt')) return response('test-key-123');
    if (url.endsWith('sitemap-index.xml')) return response('<urlset><url><loc>https://agenquest.com/research-methodology/</loc></url></urlset>');
    assert.equal(url, 'https://api.indexnow.org/indexnow');
    payload = JSON.parse(init.body);
    return response('', 202);
  };
  assert.deepEqual(await submitIndexNow({ commit, key: 'test-key-123', fetcher }), { submitted: 1, status: 202 });
  assert.equal(payload.host, 'agenquest.com');
  assert.deepEqual(payload.urlList, ['https://agenquest.com/research-methodology/']);
});

test('a verification mismatch stops before the external submission', async () => {
  const calls = [];
  await assert.rejects(submitIndexNow({ commit, key: 'test-key-123', fetcher: async url => { calls.push(url); return url.includes('/deployment.json') ? response({ commit }) : response('wrong-key'); } }), /does not match/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.startsWith('https://agenquest.com/')));
});
