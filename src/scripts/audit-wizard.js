import { postJson, runQuestions } from '../lib/audit-client.js';
import { isVerified, MAX_QUESTIONS, mentionsBrand } from '../lib/audit-report.js';
import { categoryGroup } from '../lib/tracking.js';

const $ = id => document.getElementById(id);
const show = n => { for (const i of [1, 2, 3, 4]) $('ws' + i).hidden = i !== n; };
const track = (name, params = {}, onceKey = '') => { try { window.aqAnalytics?.track(name, params, onceKey); } catch {} };
const escape = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const feedback = (message, diagnostic = {}) => { $('w-feedback').textContent = message; $('w-feedback').hidden = !message; $('w-feedback').dataset.errorCode = diagnostic.error_code || ''; $('w-feedback').dataset.httpStatus = String(diagnostic.http_status || ''); };
const state = { brand: '', website: '', questions: [], selected: [], report: null, unlocked: false };
let flow = 0, attempt = 0, leadAttempt = 0, formStarted = false;
const errorParams = (e, stage) => ({ stage, error_code: /^[A-Z_]{1,60}$/.test(e.code || '') ? e.code : 'REQUEST_FAILED', ...(e.http_status ? { http_status: e.http_status } : {}) });
const counts = () => ({ question_count: state.selected.length, checked_count: state.report?.overall.checked || 0, failed_count: state.selected.length - (state.report?.overall.checked || 0), category_group: categoryGroup(state.category), ...(state.report?.overall.score !== null && state.report?.overall.score !== undefined ? { score: state.report.overall.score } : {}) });

// ---------------------------------------------------------------------------
// Outbound attribution.
//
// Links in outbound email / LinkedIn carry ?brand= plus UTMs, e.g.
//   agenquest.com/?brand=ourplace&utm_source=email&utm_campaign=cookware-oct
//
// Two things happen: the brand field is pre-filled, which removes the biggest
// drop-off in the flow (asking someone to type their own brand name), and the
// campaign string is carried through to the owner notification so a submission
// can be traced back to the exact message that produced it.
// Nothing is auto-submitted; the visitor still clicks.
// ---------------------------------------------------------------------------
const attribution = (() => {
  try {
    const qp = new URLSearchParams(location.search);
    const pick = keys => { for (const k of keys) { const v = qp.get(k); if (v) return v.slice(0, 120); } return ''; };
    const prefill = pick(['brand', 'b', 'company']);
    const parts = [
      ['source', pick(['utm_source'])],
      ['medium', pick(['utm_medium'])],
      ['campaign', pick(['utm_campaign'])],
      ['content', pick(['utm_content'])],
    ].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    const ref = document.referrer ? new URL(document.referrer).host : '';
    if (!parts.length && ref && ref !== location.host) parts.push(`referrer=${ref}`);
    return { prefill, label: parts.join(' \u00b7 ').slice(0, 200) };
  } catch { return { prefill: '', label: '' }; }
})();

if (attribution.prefill && $('w-brand') && !$('w-brand').value) {
  $('w-brand').value = attribution.prefill;
  track('audit_prefilled', { has_prefill: true });
  requestAnimationFrame(() => document.getElementById('audit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

$('w-gen').addEventListener('click', async () => {
  const raw = $('w-brand').value.trim();
  if (!raw) { $('w-brand').focus(); track('lead_validation_error', { field_name: 'brand', gate_step: 'research', error_code: 'REQUIRED' }); return; }
  feedback('');
  $('w-gen').disabled = true;
  $('w-gen').textContent = 'Researching your brand…';
  flow++; attempt = 0; leadAttempt = 0; formStarted = false;
  const started = performance.now();
  track('audit_started', { has_prefill: !!attribution.prefill });
  try {
    const data = await postJson('/api/suggest', { brand: raw, website: /\.[a-z]{2,}/i.test(raw) ? raw : '' });
    if (data.status !== 'complete' || !data.research?.searched || !Array.isArray(data.queries) || data.queries.length !== 8 || data.queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 300) || !Array.isArray(data.query_types) || data.query_types.length !== 8 || data.query_types.some(t => !['discovery', 'branded'].includes(t)) || typeof data.brand !== 'string' || !data.brand.trim() || typeof data.website !== 'string') throw new Error('No verified researched question set was returned. Please retry.');
    Object.assign(state, { brand: data.brand, website: data.website, category: data.category, questions: data.queries.map((query, i) => ({ query, query_type: data.query_types[i], selected: true })), report: null, unlocked: false });
    renderList();
    show(2);
    track('audit_prompts_generated', { category_group: categoryGroup(data.category), question_count: 8, duration_ms: performance.now() - started });
  } catch (e) { feedback(e.message, errorParams(e, 'research')); track('audit_failed', { ...errorParams(e, 'research'), duration_ms: performance.now() - started }); }
  $('w-gen').disabled = false;
  $('w-gen').textContent = 'Research my brand & build prompts';
});

function renderList() {
  $('w-list').innerHTML = `<p class="w-found"><b>${escape(state.category)}</b> · researched with cited web search</p>`
    + state.questions.map((q, i) => `<label class="w-q"><input type="checkbox" ${q.selected ? 'checked' : ''} data-i="${i}"><span>${escape(q.query)}<small class="w-kind">${q.query_type === 'branded' ? 'Branded question · excluded from discovery score' : 'Discovery question'}</small></span></label>`).join('')
    + `<p class="w-count">${state.questions.length} questions · maximum ${MAX_QUESTIONS}</p>`;
}
$('w-list').addEventListener('change', event => {
  if (event.target.matches('input[data-i]')) {
    const question = state.questions[Number(event.target.dataset.i)]; question.selected = event.target.checked;
    track('audit_question_selection', { selected_count: state.questions.filter(q => q.selected).length, question_type: question.query_type, action: event.target.checked ? 'selected' : 'unselected' });
  }
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
  track('audit_question_added', { question_type: state.questions.at(-1).query_type, question_count: state.questions.length });
});

$('w-run').addEventListener('click', () => {
  state.selected = state.questions.filter(q => q.selected).map(({ query, query_type }) => ({ query, query_type }));
  if (!state.selected.length) { feedback('Select at least one question.'); track('lead_validation_error', { field_name: 'questions', gate_step: 'audit', error_code: 'REQUIRED' }); return; }
  state.report = null;
  state.unlocked = false;
  run();
});
$('w-retry').addEventListener('click', run);

async function run() {
  feedback('');
  show(3);
  attempt++; const started = performance.now();
  track('audit_run', { question_count: state.selected.length, attempt_no: attempt, is_retry: attempt > 1 });
  try {
  state.report = await runQuestions({ brand: state.brand, website: state.website, questions: state.selected, previous: state.report?.results || [], onProgress: (done, total) => { $('w-status').textContent = `Finished ${done} of ${total} checks…`; } });
  renderReport();
  show(4);
  const complete = state.report.status === 'complete';
  const failed = state.report.results.find(result => result.status === 'failed');
  track(complete ? 'audit_completed' : 'audit_partial', { ...counts(), ...(failed ? {error_code:failed.error_code,http_status:failed.http_status,stage:'audit'} : {}), attempt_no: attempt, is_retry: attempt > 1, duration_ms: performance.now() - started });
  if (complete) track('lead_gate_view', { form_id: 'audit_report', gate_step: 'email', ...counts() }, `gate:${flow}`);
  } catch (e) { feedback(e.message); show(2); track('audit_failed', { ...errorParams(e, 'audit'), duration_ms: performance.now() - started }); }
}

for (const id of ['w-email', 'w-phone']) $(id).addEventListener('input', () => {
  if (!formStarted) { formStarted = true; track('lead_form_start', { form_id: 'audit_report', gate_step: 'email' }); }
});
$('w-report').addEventListener('toggle', event => {
  if (event.target.matches('details') && event.target.open) track('report_detail_open', { detail_type: 'cited_answer' });
}, true);

function renderReport() {
  const report = state.report;
  const overall = report.overall;
  $('w-completeness').textContent = overall.complete ? `${overall.checked} of ${overall.total} questions verified with cited web search.` : `Incomplete audit: ${overall.checked} of ${overall.total} questions verified. Failed checks are not evidence that your brand is absent. Retry them to obtain a score.`;
  $('w-retry').hidden = overall.complete;
  $('w-gate').hidden = !overall.complete || state.unlocked;
  $('w-report').classList.toggle('w-blur', overall.complete && !state.unlocked);
  const rows = report.results.map(result => {
    if (!isVerified(result)) return `<div class="w-row" data-error-code="${escape(result.error_code || 'REQUEST_FAILED')}" data-http-status="${Number(result.http_status) || 0}"><div class="w-rq">${escape(result.query)}</div><span class="w-badge w-failed">Check failed</span><p class="w-rn">${escape(result.error)}</p></div>`;
    const sources = result.sources.map(source => `<li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a></li>`).join('');
    return `<div class="w-row"><div class="w-rq">${escape(result.query)}</div><span class="w-badge w-${escape(result.prominence)}">${escape(result.prominence)}</span><p class="w-rn">${escape(result.note)}</p><p class="w-rn">Brands named: ${escape(result.brands_named.join(', ') || 'None')}</p><small class="w-kind">${result.query_type === 'branded' ? 'Branded · excluded from discovery score' : 'Discovery'}</small><details class="w-evidence"><summary>Open observed answer and cited sources</summary><p class="w-answer">${escape(result.answer)}</p><ul>${sources}</ul><p class="w-rn">OpenAI API · ${escape(result.model)} · ${escape(result.checked_at)}</p></details></div>`;
  }).join('');
  $('w-report').innerHTML = `<div class="w-score">${overall.score === null ? 'Score pending' : `<span>${overall.score}</span>/100`}</div><p class="w-sum">${escape(overall.summary)}</p><p class="w-rn">${escape(overall.formula)}</p>${rows}`;
}

$('w-unlock').addEventListener('click', async () => {
  const email = $('w-email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('w-email').focus(); track('lead_validation_error', { form_id: 'audit_report', gate_step: 'email', field_name: 'email', error_code: 'INVALID_EMAIL' }); return; }
  if (state.report?.status !== 'complete') return;
  feedback('');
  $('w-unlock').disabled = true;
  $('w-unlock').textContent = 'Sending your report…';
  leadAttempt++; const started = performance.now();
  track('lead_submit_attempt', { form_id: 'audit_report', attempt_no: leadAttempt, is_retry: leadAttempt > 1 });
  try {
    const data = await postJson('/api/lead', { email, phone: $('w-phone').value.trim(), brand: state.brand, website: state.website, attribution: window.aqAnalytics?.attribution() || null, analytics_consent: window.aqAnalytics?.allowed() === true, report: state.report }, fetch, 30000);
    if (data.ok !== true || data.reportEmail !== true) throw new Error('Your report could not be emailed. Please retry.');
    state.unlocked = true;
    renderReport();
    feedback('Your report is unlocked. The email service accepted a copy for delivery; check your inbox or spam folder.');
    track('generate_lead', { ...counts(), form_id: 'audit_report', lead_source: 'free_audit', duration_ms: performance.now() - started }, `lead:${data.lead_id || flow}`);
  } catch (e) { feedback(e.message, errorParams(e, 'email')); track('audit_failed', { ...errorParams(e, 'email'), duration_ms: performance.now() - started }); }
  $('w-unlock').disabled = false;
  $('w-unlock').textContent = 'Unlock my report';
});
