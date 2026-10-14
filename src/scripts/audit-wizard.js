import { postJson, runQuestions } from '../lib/audit-client.js';
import { isVerified, MAX_QUESTIONS, mentionsBrand } from '../lib/audit-report.js';

const $ = id => document.getElementById(id);
const show = n => { for (const i of [1, 2, 3, 4]) $('ws' + i).hidden = i !== n; };
const track = (name, params = {}) => { try { window.gtag?.('event', name, params); } catch {} };
const escape = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const feedback = message => { $('w-feedback').textContent = message; $('w-feedback').hidden = !message; };
const state = { brand: '', website: '', questions: [], selected: [], report: null, unlocked: false };

$('w-gen').addEventListener('click', async () => {
  const raw = $('w-brand').value.trim();
  if (!raw) { $('w-brand').focus(); return; }
  feedback('');
  $('w-gen').disabled = true;
  $('w-gen').textContent = 'Researching your brand…';
  track('audit_started');
  try {
    const data = await postJson('/api/suggest', { brand: raw, website: /\.[a-z]{2,}/i.test(raw) ? raw : '' });
    if (data.status !== 'complete' || !data.research?.searched || !Array.isArray(data.queries) || data.queries.length !== 8 || data.queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 300) || !Array.isArray(data.query_types) || data.query_types.length !== 8 || data.query_types.some(t => !['discovery', 'branded'].includes(t)) || typeof data.brand !== 'string' || !data.brand.trim() || typeof data.website !== 'string') throw new Error('No verified researched question set was returned. Please retry.');
    Object.assign(state, { brand: data.brand, website: data.website, category: data.category, questions: data.queries.map((query, i) => ({ query, query_type: data.query_types[i], selected: true })), report: null, unlocked: false });
    renderList();
    show(2);
    track('audit_prompts_generated', { category: data.category, question_count: 8 });
  } catch (e) { feedback(e.message); track('audit_failed', { stage: 'research' }); }
  $('w-gen').disabled = false;
  $('w-gen').textContent = 'Research my brand & build prompts';
});

function renderList() {
  $('w-list').innerHTML = `<p class="w-found"><b>${escape(state.category)}</b> · researched with cited web search</p>`
    + state.questions.map((q, i) => `<label class="w-q"><input type="checkbox" ${q.selected ? 'checked' : ''} data-i="${i}"><span>${escape(q.query)}<small class="w-kind">${q.query_type === 'branded' ? 'Branded question · excluded from discovery score' : 'Discovery question'}</small></span></label>`).join('')
    + `<p class="w-count">${state.questions.length} questions · maximum ${MAX_QUESTIONS}</p>`;
}
$('w-list').addEventListener('change', event => {
  if (event.target.matches('input[data-i]')) state.questions[Number(event.target.dataset.i)].selected = event.target.checked;
});
$('w-custom').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('w-addbtn').click(); } });
$('w-addbtn').addEventListener('click', () => {
  const query = $('w-custom').value.trim();
  if (!query) return;
  if (query.length > 300 || state.questions.length >= MAX_QUESTIONS || state.questions.some(q => q.query === query)) { feedback(`Add a unique question of up to 300 characters. The panel allows ${MAX_QUESTIONS} questions.`); return; }
  feedback('');
  state.questions.push({ query, query_type: mentionsBrand(query, state.brand) ? 'branded' : 'discovery', selected: true });
  $('w-custom').value = '';
  renderList();
  track('audit_question_added');
});

$('w-run').addEventListener('click', () => {
  state.selected = state.questions.filter(q => q.selected).map(({ query, query_type }) => ({ query, query_type }));
  if (!state.selected.length) { feedback('Select at least one question.'); return; }
  state.report = null;
  state.unlocked = false;
  run();
});
$('w-retry').addEventListener('click', run);

async function run() {
  feedback('');
  show(3);
  track('audit_run', { question_count: state.selected.length });
  state.report = await runQuestions({ brand: state.brand, website: state.website, questions: state.selected, previous: state.report?.results || [], onProgress: (done, total) => { $('w-status').textContent = `Finished ${done} of ${total} checks…`; } });
  renderReport();
  show(4);
  const complete = state.report.status === 'complete';
  track(complete ? 'audit_completed' : 'audit_partial', { question_count: state.selected.length, checked: state.report.overall.checked, ...(state.report.overall.score !== null ? { score: state.report.overall.score } : {}) });
}

function renderReport() {
  const report = state.report;
  const overall = report.overall;
  $('w-completeness').textContent = overall.complete ? `${overall.checked} of ${overall.total} questions verified with cited web search.` : `Incomplete audit: ${overall.checked} of ${overall.total} questions verified. Failed checks are not evidence that your brand is absent. Retry them to obtain a score.`;
  $('w-retry').hidden = overall.complete;
  $('w-gate').hidden = !overall.complete || state.unlocked;
  $('w-report').classList.toggle('w-blur', overall.complete && !state.unlocked);
  const rows = report.results.map(result => {
    if (!isVerified(result)) return `<div class="w-row"><div class="w-rq">${escape(result.query)}</div><span class="w-badge w-failed">Check failed</span><p class="w-rn">${escape(result.error)}</p></div>`;
    const sources = result.sources.map(source => `<li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a></li>`).join('');
    return `<div class="w-row"><div class="w-rq">${escape(result.query)}</div><span class="w-badge w-${escape(result.prominence)}">${escape(result.prominence)}</span><p class="w-rn">${escape(result.note)}</p><p class="w-rn">Brands named: ${escape(result.brands_named.join(', ') || 'None')}</p><small class="w-kind">${result.query_type === 'branded' ? 'Branded · excluded from discovery score' : 'Discovery'}</small><details class="w-evidence"><summary>Open observed answer and cited sources</summary><p class="w-answer">${escape(result.answer)}</p><ul>${sources}</ul><p class="w-rn">OpenAI API · ${escape(result.model)} · ${escape(result.checked_at)}</p></details></div>`;
  }).join('');
  $('w-report').innerHTML = `<div class="w-score">${overall.score === null ? 'Score pending' : `<span>${overall.score}</span>/100`}</div><p class="w-sum">${escape(overall.summary)}</p><p class="w-rn">${escape(overall.formula)}</p>${rows}`;
}

$('w-unlock').addEventListener('click', async () => {
  const email = $('w-email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('w-email').focus(); return; }
  if (state.report?.status !== 'complete') return;
  feedback('');
  $('w-unlock').disabled = true;
  $('w-unlock').textContent = 'Sending your report…';
  try {
    const data = await postJson('/api/lead', { email, phone: $('w-phone').value.trim(), brand: state.brand, website: state.website, report: state.report }, fetch, 30000);
    if (data.ok !== true || data.reportEmail !== true) throw new Error('Your report could not be emailed. Please retry.');
    state.unlocked = true;
    renderReport();
    feedback('Your report is unlocked. The email service accepted a copy for delivery; check your inbox or spam folder.');
    let ai_source = 'none';
    try { ai_source = sessionStorage.getItem('aq_ai_source') || 'none'; } catch {}
    track('generate_lead', { category: state.category, ai_source, ...(state.report.overall.score !== null ? { score: state.report.overall.score } : {}) });
  } catch (e) { feedback(e.message); track('audit_failed', { stage: 'email' }); }
  $('w-unlock').disabled = false;
  $('w-unlock').textContent = 'Unlock my report';
});
