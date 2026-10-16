import { isVerified, summarize, MAX_QUESTIONS } from './audit-report.js';

// Research is read-only: recover once from transient transport/provider failures.
// Never automatically resubmit a lead or retry invalid/uncertain evidence.
export async function postJson(url, body, fetcher = fetch, timeout = 55000, { onRetry = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const retryableRoute = ['/api/audit', '/api/suggest'].includes(url);
  for (let attempt = 0; ; attempt++) {
    try { return await postOnce(url, body, fetcher, timeout); }
    catch (error) {
      if (!retryableRoute || attempt >= 1 || !error.retryable) throw error;
      onRetry({ attempt_no: attempt + 2, error_code: error.code, http_status: error.http_status || 0 });
      await wait(error.retry_after_ms || 750);
    }
  }
}

async function postOnce(url, body, fetcher, timeout) {
  const controller = new AbortController();
  let timer;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); const e = new Error('This request timed out. Please retry.'); e.code = 'REQUEST_TIMEOUT'; e.retryable = true; reject(e); }, timeout);
    });
    return await Promise.race([(async () => {
      let response;
      try { response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }); }
      catch { const error = new Error('The connection was interrupted. Please retry.'); error.code = 'NETWORK_ERROR'; error.retryable = true; throw error; }
      let data;
      try { data = await response.json(); }
      catch { const error = new Error('The service returned an unreadable response. Please retry.'); error.code = 'INVALID_RESPONSE'; error.http_status = response.status; error.retryable = [502, 503, 504].includes(response.status); throw error; }
      if (!response.ok || data.error) {
        const error = new Error(`${data.error || 'The service could not complete this request.'}${data.request_id ? ` Reference: ${data.request_id}` : ''}`);
        error.code = data.code || 'REQUEST_FAILED'; error.http_status = response.status;
        error.retryable = [429, 502, 503, 504].includes(response.status) && ['RATE_LIMITED', 'UPSTREAM_ERROR', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT'].includes(error.code);
        const retryAfter = response.headers?.get('retry-after');
        const delay = retryAfter && (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now());
        // A long provider cooldown requires an explicit later retry, not a retry storm.
        if (Number.isFinite(delay) && delay > 5000) error.retryable = false;
        if (Number.isFinite(delay) && delay > 0) error.retry_after_ms = Math.max(750, delay);
        throw error;
      }
      if (data.mock === true) throw new Error('No verified live result was returned. Please retry.');
      return data;
    })(), deadline]);
  } finally { clearTimeout(timer); }
}

export async function runQuestions({ brand, website, questions, previous = [], onProgress = () => {}, onRetry = () => {}, fetcher = fetch, retryWait }) {
  if (!questions.length || questions.length > MAX_QUESTIONS) throw new Error(`Select between 1 and ${MAX_QUESTIONS} questions.`);
  const results = questions.map(q => previous.find(r => isVerified(r) && r.query === q.query && r.query_type === q.query_type) || null);
  let next = 0;
  let finished = results.filter(Boolean).length;
  let retry_count = 0;
  onProgress(finished, questions.length);
  async function worker() {
    while (next < questions.length) {
      const index = next++;
      if (results[index]) continue;
      const question = questions[index];
      try {
        const data = await postJson('/api/audit', { brand, website, queries: [question.query], query_type: question.query_type }, fetcher, 55000, { wait: retryWait, onRetry: detail => { retry_count++; onRetry(detail); } });
        const result = data.results?.[0];
        if (data.status !== 'complete' || data.results.length !== 1 || !isVerified(result) || result.query !== question.query || result.query_type !== question.query_type) throw new Error('No verified answer was returned for this question. Please retry.');
        results[index] = result;
      } catch (e) {
        results[index] = { ...question, status: 'failed', error: e.message || 'The live check failed. Please retry.', error_code: e.code || 'REQUEST_FAILED', http_status: e.http_status || 0 };
      }
      onProgress(++finished, questions.length);
    }
  }
  await Promise.all([worker(), worker()]);
  return { status: results.every(isVerified) ? 'complete' : 'partial', results, overall: summarize(results), retry_count };
}
