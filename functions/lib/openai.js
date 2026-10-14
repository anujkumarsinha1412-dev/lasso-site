export class AuditError extends Error {
  constructor(code, message, status = 502, stage = 'request') {
    super(message);
    Object.assign(this, { code, status, stage });
  }
}

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export function trace() { return { request_id: crypto.randomUUID(), started: Date.now() }; }

export function log(t, event, details = {}) {
  // Never log prompts, answers, contact details, or credentials.
  console.log(JSON.stringify({ event, request_id: t.request_id, duration_ms: Date.now() - t.started, ...details }));
}

export function failure(error, t) {
  const e = error instanceof AuditError ? error : new AuditError('INTERNAL_ERROR', 'The request could not be completed. Please try again.', 500);
  log(t, 'audit_error', { code: e.code, stage: e.stage, status: e.status });
  return json({ error: e.message, code: e.code, stage: e.stage, request_id: t.request_id }, e.status);
}

export async function readJson(request, limit = 120000) {
  const reader = request.body?.getReader();
  if (!reader) throw new AuditError('BAD_REQUEST', 'A JSON request is required.', 400);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AuditError('REQUEST_TOO_LARGE', 'The submitted report is too large.', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid object');
    return body;
  } catch (e) {
    if (e instanceof AuditError) throw e;
    throw new AuditError('BAD_REQUEST', 'The request contains invalid JSON.', 400);
  } finally { reader.releaseLock(); }
}

export async function fetchJson(url, options, { timeout = 15000, stage = 'request', t, signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AuditError('UPSTREAM_TIMEOUT', 'The service took too long to respond. Please retry.', 504, stage));
    }, timeout);
  });
  try {
    const operation = (async () => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (t) log(t, 'upstream_response', { stage, upstream_status: response.status, upstream_request_id: response.headers.get('x-request-id') || undefined });
      if (!response.ok) {
        const status = response.status === 429 ? 429 : [401, 403, 404].includes(response.status) ? 503 : 502;
        throw new AuditError(response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', response.status === 429 ? 'The service is busy. Please wait a moment and retry.' : 'The live service could not complete this request. Please retry.', status, stage);
      }
      try { return await response.json(); }
      catch { throw new AuditError('INVALID_UPSTREAM_RESPONSE', 'The service returned an unreadable response. Please retry.', 502, stage); }
    })();
    return await Promise.race([operation, deadline]);
  } catch (e) {
    if (e instanceof AuditError) throw e;
    if (signal?.aborted) throw new AuditError('REQUEST_CANCELLED', 'The request was cancelled.', 499, stage);
    if (controller.signal.aborted) throw new AuditError('UPSTREAM_TIMEOUT', 'The service took too long to respond. Please retry.', 504, stage);
    throw new AuditError('UPSTREAM_UNAVAILABLE', 'The live service could not be reached. Please retry.', 502, stage);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function outputText(data) {
  return (data.output || []).filter(item => item.type === 'message' && item.role === 'assistant')
    .flatMap(item => item.content || []).filter(c => c.type === 'output_text' && typeof c.text === 'string')
    .map(c => c.text).join('\n').trim();
}

export function citedSources(data) {
  const sources = new Map();
  for (const item of data.output || []) {
    if (item.type !== 'message' || item.role !== 'assistant') continue;
    for (const content of item.content || []) {
      for (const citation of content.annotations || []) {
        if (citation.type !== 'url_citation') continue;
        try {
          const url = new URL(citation.url);
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
          sources.set(url.href, { url: url.href, title: String(citation.title || url.hostname).slice(0, 200) });
        } catch {}
      }
    }
  }
  return [...sources.values()];
}

export async function search(context, input, t) {
  if (!context.env.OPENAI_API_KEY) throw new AuditError('NOT_CONFIGURED', 'The live audit is temporarily unavailable. Please try again later.', 503, 'search');
  // gpt-4o-mini is not a documented Responses web-search model.
  const model = context.env.OPENAI_SEARCH_MODEL || 'gpt-4.1-mini';
  const data = await fetchJson('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${context.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, tools: [{ type: 'web_search', search_context_size: 'low' }], tool_choice: 'required', max_output_tokens: 1800, store: false, input }),
  }, { timeout: 35000, stage: 'search', t, signal: context.request.signal });
  const answer = outputText(data);
  const sources = citedSources(data);
  const searched = (data.output || []).some(item => item.type === 'web_search_call' && item.status === 'completed' && item.action?.type === 'search');
  if (data.status !== 'completed' || typeof data.id !== 'string' || !data.id || !searched || !answer || !sources.length) {
    throw new AuditError('SEARCH_NOT_VERIFIED', 'No complete, cited web-search answer was returned. Please retry this question.', 502, 'search');
  }
  log(t, 'search_verified', { model, source_count: sources.length });
  return { answer, sources, model, response_id: data.id, checked_at: new Date().toISOString() };
}

export async function generateJson(context, messages, t, stage) {
  if (!context.env.OPENAI_API_KEY) throw new AuditError('NOT_CONFIGURED', 'The live audit is temporarily unavailable.', 503, stage);
  const data = await fetchJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${context.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: context.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini', response_format: { type: 'json_object' }, max_tokens: 1800, temperature: 0, messages }),
  }, { timeout: 15000, stage, t, signal: context.request.signal });
  try {
    if (data.choices?.[0]?.finish_reason !== 'stop') throw new Error('incomplete');
    return JSON.parse(data.choices[0].message.content);
  } catch { throw new AuditError('INVALID_GENERATED_RESULT', 'The report could not be checked. Please retry.', 502, stage); }
}
