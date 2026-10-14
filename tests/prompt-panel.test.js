import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/suggest.js';
import { mentionsBrand } from '../src/lib/audit-report.js';

const queries = ['Which cookware sets last longest?', 'Best cookware sets under $400?', 'Which pans fit a small kitchen?', 'Which cookware works on induction?', 'Which cookware do chefs recommend?', 'What cookware does Reddit recommend?', 'Is Acme cookware worth buying?', 'Acme vs Caraway: which should I buy?'];
const context = () => ({ request: new Request('https://example.test/api/suggest', { method: 'POST', body: JSON.stringify({ brand: 'acme.test' }) }), env: { OPENAI_API_KEY: 'test-key' } });
const search = { id: 'resp_test', status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search' } }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Acme sells cookware.', annotations: [{ type: 'url_citation', title: 'Acme', url: 'https://acme.test' }] }] }] };

test('researched prompts return a resolved brand and separate discovery/branded metadata', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return new Response(JSON.stringify(url.endsWith('/responses') ? search : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ brand: 'Acme', category: 'Cookware', confidence: 'high', queries }) } }] }));
  });
  const result = await onRequestPost(context());
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.brand, 'Acme');
  assert.equal(data.website, 'https://acme.test/');
  assert.deepEqual(data.query_types, [...Array(6).fill('discovery'), 'branded', 'branded']);
  assert.equal(data.research.sources[0].url, 'https://acme.test/');
  assert.ok(calls.every(url => url.startsWith('https://api.openai.com/')));
});

test('a brand-biased discovery prompt is rejected instead of inflating the score', async t => {
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(url.endsWith('/responses') ? search : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ brand: 'Acme', category: 'Cookware', confidence: 'high', queries: ['Best Acme cookware?', ...queries.slice(1)] }) } }] })));
  const result = await onRequestPost(context());
  assert.equal(result.status, 502);
  assert.equal((await result.json()).code, 'INVALID_GENERATED_RESULT');
});

test('brand detection respects word boundaries, punctuation and non-English names', () => {
  assert.equal(mentionsBrand('A small space', 'Ace'), false);
  assert.equal(mentionsBrand('Our Place reviews', 'Our Place'), true);
  assert.equal(mentionsBrand('B&O headphones', 'B&O'), true);
  assert.equal(mentionsBrand('Compare 小米 phones', '小米'), true);
});
