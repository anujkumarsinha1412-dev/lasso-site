import { isVerified, summarize, MAX_QUESTIONS } from './audit-report.js';

export async function postJson(url, body, fetcher = fetch, timeout = 55000) {
  const controller = new AbortController();
  let timer;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('This request timed out. Please retry.')); }, timeout);
    });
    return await Promise.race([(async () => {
      const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      let data;
      try { data = await response.json(); }
      catch { throw new Error('The service returned an unreadable response. Please retry.'); }
      if (!response.ok || data.error) throw new Error(`${data.error || 'The service could not complete this request.'}${data.request_id ? ` Reference: ${data.request_id}` : ''}`);
      if (data.mock === true) throw new Error('No verified live result was returned. Please retry.');
      return data;
    })(), deadline]);
  } finally { clearTimeout(timer); }
}

export async function runQuestions({ brand, website, questions, previous = [], onProgress = () => {}, fetcher = fetch }) {
  if (!questions.length || questions.length > MAX_QUESTIONS) throw new Error(`Select between 1 and ${MAX_QUESTIONS} questions.`);
  const results = questions.map(q => previous.find(r => isVerified(r) && r.query === q.query && r.query_type === q.query_type) || null);
  let next = 0;
  let finished = results.filter(Boolean).length;
  onProgress(finished, questions.length);
  async function worker() {
    while (next < questions.length) {
      const index = next++;
      if (results[index]) continue;
      const question = questions[index];
      try {
        const data = await postJson('/api/audit', { brand, website, queries: [question.query], query_type: question.query_type }, fetcher);
        const result = data.results?.[0];
        if (data.status !== 'complete' || data.results.length !== 1 || !isVerified(result) || result.query !== question.query || result.query_type !== question.query_type) throw new Error('No verified answer was returned for this question. Please retry.');
        results[index] = result;
      } catch (e) {
        results[index] = { ...question, status: 'failed', error: e.message || 'The live check failed. Please retry.' };
      }
      onProgress(++finished, questions.length);
    }
  }
  await Promise.all([worker(), worker()]);
  return { status: results.every(isVerified) ? 'complete' : 'partial', results, overall: summarize(results) };
}
