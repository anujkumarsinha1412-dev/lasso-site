import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as audit } from '../functions/api/audit.js';
import { onRequestPost as suggest } from '../functions/api/suggest.js';
import { onRequestPost as lead, reportHtml } from '../functions/api/lead.js';
import { fetchJson } from '../functions/lib/openai.js';
import { runQuestions, postJson } from '../src/lib/audit-client.js';
import { summarize, isVerified } from '../src/lib/audit-report.js';

const context = (body, env = { OPENAI_API_KEY: 'test-key' }) => ({ request: new Request('https://example.test/api/audit', { method: 'POST', body: JSON.stringify(body) }), env });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const question = { query: 'Which cookware should I buy?', query_type: 'discovery' };
const verified = (query = question.query, query_type = 'discovery', prominence = 'recommended') => ({ query, query_type, prominence, status: 'verified', brands_named: ['Acme'], note: 'Acme is recommended.', answer: 'Consider Acme cookware [1].', sources: [{ url: 'https://example.com/review', title: 'Review' }], model: 'gpt-4.1-mini', response_id: 'resp_test', checked_at: '2026-10-14T10:00:00Z' });
const searched = () => ({ id: 'resp_test', status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search' } }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Consider Acme cookware [1].', annotations: [{ type: 'url_citation', url: 'https://example.com/review', title: 'Review' }] }] }] });
const generated = object => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(object) } }] });
const classification = { prominence: 'recommended', brands_named: ['Acme'], note: 'Acme is recommended.' };

test('missing OpenAI configuration returns unavailable, never synthetic data', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not call provider'); });
  for (const handler of [audit, suggest]) {
    const result = await handler(context({ brand: 'Acme', queries: [question.query] }, {}));
    assert.equal(result.status, 503);
    const body = await result.json();
    assert.equal(body.code, 'NOT_CONFIGURED');
    assert.equal(body.results, undefined);
    assert.equal(body.mock, undefined);
  }
});

test('search HTTP failures never fall back to a plain completion', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return response({ error: 'model unavailable' }, 404); });
  const result = await audit(context({ brand: 'Acme', queries: [question.query] }));
  assert.equal(result.status, 503);
  assert.deepEqual(calls, ['https://api.openai.com/v1/responses']);
  assert.equal((await result.json()).results, undefined);
});

test('missing search invocation, incomplete output, uncited answers and unsafe URLs are rejected', async t => {
  for (const change of [data => data.output.shift(), data => { data.status = 'incomplete'; }, data => { data.output[1].content[0].annotations = []; }, data => { data.output[1].content[0].annotations[0].url = 'javascript:alert(1)'; }]) {
    const data = searched(); change(data);
    const stub = t.mock.method(globalThis, 'fetch', async () => response(data));
    const result = await audit(context({ brand: 'Acme', queries: [question.query] }));
    assert.equal(result.status, 502);
    assert.equal((await result.json()).code, 'SEARCH_NOT_VERIFIED');
    assert.equal(stub.mock.callCount(), 1);
    stub.mock.restore();
  }
});

test('verified results preserve the actual answer and citation URLs', async t => {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return response(url.endsWith('/responses') ? searched() : generated(classification));
  });
  const result = await audit(context({ brand: 'Acme', queries: [question.query] }));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(isVerified(body.results[0]), true);
  assert.equal(body.results[0].answer, searched().output[1].content[0].text);
  assert.equal(body.results[0].sources[0].url, 'https://example.com/review');
  assert.equal(bodies[0].tool_choice, 'required');
  assert.equal(bodies[0].store, false);
  assert.equal(bodies[0].model, 'gpt-4.1-mini');
});

test('invalid or failed classification does not become a report', async t => {
  for (const provider of [response({}, 500), response(generated({ ...classification, prominence: 'made-up' })), response({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })]) {
    const stub = t.mock.method(globalThis, 'fetch', async url => url.endsWith('/responses') ? response(searched()) : provider);
    const result = await audit(context({ brand: 'Acme', queries: [question.query] }));
    assert.equal(result.status, 502);
    assert.equal((await result.json()).results, undefined);
    stub.mock.restore();
  }
});

test('batch requests are rejected instead of silently truncating questions', async () => {
  const result = await audit(context({ brand: 'Acme', queries: ['First question', 'Second question'] }));
  assert.equal(result.status, 400);
});

test('provider deadlines cover both hanging fetches and stalled response bodies', async t => {
  for (const stub of [() => new Promise(() => {}), async () => ({ ok: true, status: 200, headers: new Headers(), json: () => new Promise(() => {}) })]) {
    const mocked = t.mock.method(globalThis, 'fetch', stub);
    const start = Date.now();
    await assert.rejects(fetchJson('https://example.test', {}, { timeout: 20, stage: 'search' }), error => error.code === 'UPSTREAM_TIMEOUT' && error.stage === 'search');
    assert.ok(Date.now() - start < 1000);
    mocked.mock.restore();
  }
});

test('browser rejects mock data, gateway HTML, and mismatched answers', async () => {
  for (const fetcher of [async () => response({ mock: true, status: 'complete', results: [verified()] }), async () => new Response('<h1>504</h1>', { status: 504 }), async () => response({ status: 'complete', results: [verified('Wrong question')] })]) {
    const report = await runQuestions({ brand: 'Acme', questions: [question], fetcher });
    assert.equal(report.status, 'partial');
    assert.equal(report.overall.score, null);
    assert.equal(report.results[0].status, 'failed');
    assert.equal(report.results[0].prominence, undefined);
  }
});

test('panels limit concurrency and retries reuse only verified matching answers', async () => {
  const questions = Array.from({ length: 5 }, (_, i) => ({ query: `Question ${i}?`, query_type: 'discovery' }));
  let active = 0, peak = 0;
  const fetcher = async (_, init) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    const query = JSON.parse(init.body).queries[0];
    return query === 'Question 2?' ? response({ error: 'Rate limited' }, 429) : response({ status: 'complete', results: [verified(query)] });
  };
  const first = await runQuestions({ brand: 'Acme', questions, fetcher });
  assert.equal(peak, 2);
  assert.equal(first.overall.checked, 4);
  assert.equal(first.overall.score, null);
  const retried = [];
  const second = await runQuestions({ brand: 'Acme', questions, previous: first.results, fetcher: async (_, init) => {
    const query = JSON.parse(init.body).queries[0]; retried.push(query);
    return response({ status: 'complete', results: [verified(query)] });
  } });
  assert.deepEqual(retried, ['Question 2?']);
  assert.equal(second.status, 'complete');
  assert.equal(second.overall.score, 100);
});

test('discovery score is deterministic and excludes branded questions and incomplete panels', () => {
  const results = [verified('Discovery A', 'discovery', 'recommended'), verified('Discovery B', 'discovery', 'mentioned'), verified('Discovery C', 'discovery', 'absent'), verified('Is Acme good?', 'branded', 'recommended')];
  assert.equal(summarize(results).score, 50);
  assert.equal(summarize(results).discovery_checked, 3);
  assert.equal(summarize([verified('Is Acme good?', 'branded')]).score, null);
  assert.equal(summarize([...results, { status: 'failed' }]).score, null);
});

test('browser deadlines also cover body parsing', async () => {
  await assert.rejects(postJson('/api/audit', {}, async () => ({ ok: true, json: () => new Promise(() => {}) }), 20), /timed out/);
});

test('email failures and missing configuration never return success', async t => {
  const body = { email: 'prospect@example.test', brand: 'Acme', report: { status: 'complete', results: [verified()] } };
  assert.equal((await lead(context(body, {}))).status, 503);
  t.mock.method(globalThis, 'fetch', async () => response({ error: 'Rejected' }, 500));
  const result = await lead(context(body, { RESEND_API_KEY: 'test-key' }));
  assert.equal(result.status, 502);
  assert.equal((await result.json()).ok, undefined);
});

test('email endpoint rejects mock and incomplete evidence before contacting Resend', async t => {
  const stub = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not send'); });
  for (const report of [{ mock: true, status: 'complete', results: [verified()] }, { status: 'partial', results: [verified()] }, { status: 'complete', results: [{ ...verified(), sources: [] }] }]) {
    assert.equal((await lead(context({ email: 'prospect@example.test', brand: 'Acme', report }, { RESEND_API_KEY: 'test-key' }))).status, 400);
  }
  assert.equal(stub.mock.callCount(), 0);
});

test('accepted email is accurately reported and retries use stable idempotency keys', async t => {
  const keys = [];
  t.mock.method(globalThis, 'fetch', async (_, init) => { keys.push(init.headers['Idempotency-Key']); return response({ id: 'email_test' }); });
  const body = { email: 'prospect@example.test', brand: 'Acme', report: { status: 'complete', results: [verified()], overall: { score: 999 } } };
  for (let i = 0; i < 2; i++) {
    const result = await lead(context(body, { RESEND_API_KEY: 'test-key' }));
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.reportEmail, true);
    assert.equal(data.delivery, 'accepted');
  }
  assert.equal(keys[0], keys[2]);
  const html = reportHtml('<Acme>', body.report);
  assert.match(html, /100\/100/);
  assert.doesNotMatch(html, /999/);
  assert.match(html, /&lt;Acme&gt;/);
  assert.match(html, /https:\/\/example.com\/review/);
  assert.match(html, /Consider Acme cookware/);
});

test('research rejects uncertainty and never invents fallback prompts', async t => {
  t.mock.method(globalThis, 'fetch', async url => response(url.endsWith('/responses') ? searched() : generated({ confidence: 'low' })));
  const result = await suggest(context({ brand: 'Unclear' }));
  assert.equal(result.status, 422);
  assert.equal((await result.json()).queries, undefined);
});
