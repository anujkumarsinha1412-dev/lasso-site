import { VERSION, HOSTS, EVENTS, PARAMS, cleanParams, cleanUrl, pageContext, acquisition, attributionRecord } from '../lib/tracking.js';

const qp = new URLSearchParams(location.search);
const qa = ['localhost', '127.0.0.1'].includes(location.hostname) && qp.get('aq_qa') === '1';
const production = HOSTS.includes(location.hostname);
const OPT = 'aq_optout', CONSENT = 'aq_consent_v1', ATTR = 'aq_attribution_v1';
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const cookie = key => { try { return decodeURIComponent(document.cookie.split('; ').find(x => x.startsWith(key + '='))?.split('=').slice(1).join('=') || ''); } catch { return ''; } };
function writeCookie(key, value, days) { document.cookie = `${key}=${encodeURIComponent(value)}; Path=/; Max-Age=${days * 86400}; SameSite=Lax${production ? '; Domain=.agenquest.com; Secure' : ''}`; }
function save(key, value, days = 180) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {} writeCookie(key, value, value ? days : 0); }
if (['1', '0'].includes(qp.get('noanalytics'))) save(OPT, qp.get('noanalytics') === '1' ? '1' : '', 730);
const excluded = read(OPT) === '1' || cookie(OPT) === '1';
if (excluded) save(OPT, '1', 730);
window.__aqOptedOut = excluded;
const eligible = (production || qa) && !excluded;
function choice() {
  const choices = [read(CONSENT),cookie(CONSENT)].flatMap(raw => { try { const v=JSON.parse(raw); return v && ['granted','denied'].includes(v.value) && Number.isFinite(v.expires) ? [v] : []; } catch { return []; } });
  // The shared cookie carries later choices between apex/www; a stale local copy
  // must never override a newer withdrawal made on the other hostname.
  const stored = choices.sort((a,b)=>b.expires-a.expires)[0];
  return stored && Date.now() < stored.expires && ['granted','denied'].includes(stored.value) ? stored.value : '';
}
let granted = eligible && choice() === 'granted';
let started = false, attribution = null, cleanup = () => {};
function reconcileChoice() {
  if (!granted || !started) return;
  if (read(OPT) === '1' || cookie(OPT) === '1' || choice() !== 'granted') {
    granted = false;
    window['ga-disable-G-DD18JLWTDD'] = true;
    window.gtag('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    try { window.clarity?.('consentv2',{analytics_Storage:'denied',ad_Storage:'denied'}); window.clarity?.('consent',false); } catch {}
    cleanup(); purge(); attribution = null;
    if (!qa) location.reload(); else displayQA();
  }
}
window.addEventListener('storage', event => { if ([OPT,CONSENT].includes(event.key)) reconcileChoice(); });
document.addEventListener('visibilitychange', reconcileChoice);
const seen = new Set();
window.dataLayer = window.dataLayer || [];
window.gtag = function () { window.dataLayer.push(arguments); };
window['ga-disable-G-DD18JLWTDD'] = !granted;
window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', functionality_storage: 'granted', security_storage: 'granted' });
const context = { ...pageContext(location.href), page_referrer: cleanUrl(document.referrer), tracking_version: VERSION };
function displayQA() {
  if (!qa) return;
  let node = document.getElementById('aq-qa-events');
  if (!node) { node = document.createElement('pre'); node.id = 'aq-qa-events'; node.setAttribute('aria-label', 'Analytics test events'); document.body.appendChild(node); }
  node.textContent = JSON.stringify({ consent: granted, excluded, attribution, events: window.dataLayer.filter(x => x.event && x.event !== 'gtm.js') }, null, 2);
}
function track(event, params = {}, onceKey = '') {
  if (!eligible || !granted || !started || !EVENTS.includes(event) || onceKey && seen.has(onceKey)) return;
  if (onceKey) seen.add(onceKey);
  const cleared = Object.fromEntries(PARAMS.map(k => [k, null]));
  window.dataLayer.push({ ...cleared, ...context, event, ai_source: attribution?.session?.ai_source || 'none', ...cleanParams(params) });
  try { window.clarity?.('event', event); } catch {}
  displayQA();
}
window.aqAnalytics = { track, attribution: () => granted && eligible ? attribution : null, context: () => context, allowed: () => granted && eligible, version: VERSION };
function purge() {
  save(ATTR, '');
  for (const part of document.cookie.split('; ')) {
    const key = part.split('=')[0];
    if (/^(_ga|_gid|_gat|_clck|_clsk)/.test(key)) {
      document.cookie = `${key}=; Path=/; Max-Age=0`;
      document.cookie = `${key}=; Path=/; Domain=.agenquest.com; Max-Age=0; Secure`;
      document.cookie = `${key}=; Path=/; Domain=${location.hostname}; Max-Age=0`;
    }
  }
}
function activate() {
  if (!eligible || !granted || started) return;
  let previous; try { previous = JSON.parse(read(ATTR) || cookie(ATTR)); } catch {}
  attribution = attributionRecord(previous, acquisition(location.href, document.referrer));
  save(ATTR, JSON.stringify(attribution), 90);
  // Remove private prefill/query data before any third-party script can inspect the address.
  const safeHash = ['#top','#audit','#shift','#services','#signals','#faq'].includes(location.hash) ? location.hash : '';
  history.replaceState(history.state, '', location.pathname + safeHash);
  for (const id of ['wiz','w-brand','w-custom','w-list','w-email','w-phone','w-report','w-feedback']) document.getElementById(id)?.setAttribute('data-clarity-mask', 'true');
  window['ga-disable-G-DD18JLWTDD'] = false;
  window.gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  const a = attribution.session;
  window.dataLayer.push({ ...context, ai_source: a.ai_source, campaign_source: a.source === '(direct)' ? '' : a.source, campaign_medium: a.medium === '(none)' ? '' : a.medium, campaign_name: a.campaign, campaign_content: a.content, campaign_id: a.campaign_id });
  started = true;
  if (qa) track('page_view', {}, 'page_view');
  else {
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    window.dataLayer.push({ event: 'aq_ready' });
    const script = document.createElement('script'); script.async = true; script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-5RDHZMWP'; document.head.appendChild(script);
  }
  cleanup = observe();
  displayQA();
}
function choose(value) {
  const wasStarted = started;
  granted = value === 'granted' && eligible;
  save(CONSENT, JSON.stringify({value,expires:Date.now() + 180 * 86400000}));
  document.getElementById('aq-consent')?.remove();
  if (granted) activate();
  else {
    window['ga-disable-G-DD18JLWTDD'] = true;
    window.gtag('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    try { window.clarity?.('consentv2', { analytics_Storage: 'denied', ad_Storage: 'denied' }); window.clarity?.('consent', false); } catch {}
    cleanup(); purge(); attribution = null; displayQA();
    if (wasStarted && !qa) location.reload();
  }
}
function preferences() {
  document.getElementById('aq-consent')?.remove();
  const box = document.createElement('div'); box.id = 'aq-consent'; box.setAttribute('role','region'); box.setAttribute('aria-label','Privacy choices');
  box.innerHTML = '<p><strong>Your privacy choices</strong><br>With your permission, Google Analytics measures visits and Microsoft Clarity shows masked interaction recordings. Your audit works either way. <a href="/privacy">Read our privacy note</a>.</p><div><button type="button" data-choice="granted">Accept analytics</button><button type="button" data-choice="denied">Reject analytics</button></div>';
  box.addEventListener('click', e => { const button = e.target.closest('[data-choice]'); if (button) choose(button.dataset.choice); });
  document.body.appendChild(box);
}
function observe() {
  const timers = new Map(); let activeMs = 0, last = performance.now(), depth = 0, lastPersisted = Date.now();
  const exposure = new WeakMap();
  const visible = new IntersectionObserver(entries => entries.forEach(entry => {
    const el = entry.target;
    if (entry.isIntersecting && !timers.has(el)) timers.set(el, setTimeout(() => {
      if (document.visibilityState !== 'visible') { timers.delete(el); return; }
      const detail = exposure.get(el);
      if (detail) track(detail.event, detail.params, detail.key);
      visible.unobserve(el); timers.delete(el);
    }, 1000));
    else if (!entry.isIntersecting) { clearTimeout(timers.get(el)); timers.delete(el); }
  }), { threshold: 0.5 });
  document.querySelectorAll('section[id]').forEach(section => {
    const heading = section.querySelector('h1,h2');
    if (heading) { exposure.set(heading, {event:'section_view',params:{section_id:section.id},key:`section:${section.id}`}); visible.observe(heading); }
  });
  document.querySelectorAll('a[href="#audit"], a[href="/#audit"]').forEach((el,i) => {
    exposure.set(el, {event:'cta_view',params:{placement:placement(el),action:'start_audit'},key:`cta_view:${i}`}); visible.observe(el);
  });
  const tick = () => {
    reconcileChoice();
    if (!granted) return;
    const now = performance.now(); if (document.visibilityState === 'visible') activeMs += now - last; last = now;
    const max = document.documentElement.scrollHeight - innerHeight;
    depth = Math.max(depth, max > 100 ? Math.min(100, Math.round(scrollY / max * 100)) : 0);
    for (const p of [25,50,75,90]) if (depth >= p) track('scroll_depth', { percent_scrolled: p }, `scroll:${p}`);
    if (context.page_group === 'article' && activeMs >= 30000 && depth >= 50) track('content_engaged', {}, 'content_engaged');
    if (attribution && document.visibilityState === 'visible' && Date.now() - lastPersisted >= 30000) { attribution.updated_at = Date.now(); save(ATTR, JSON.stringify(attribution), 90); lastPersisted = Date.now(); }
  };
  const interval = setInterval(tick, 1000);
  return () => { clearInterval(interval); visible.disconnect(); timers.forEach(clearTimeout); };
}
function placement(el) { return el.closest('header,nav') ? 'header' : el.closest('footer') ? 'footer' : context.page_group === 'article' ? 'article' : el.closest('.hero') ? 'hero' : el.closest('#audit') ? 'audit' : 'body'; }
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]'); if (!a || a.closest('#w-report')) return;
  const href = a.getAttribute('href'); const p = placement(a);
  if (href === '#audit' || href === '/#audit') track('cta_click', { placement: p, action: 'start_audit' });
  else if (/^mailto:/i.test(href)) track('contact_click', { placement: p, contact_method: 'email' });
  else if (/^tel:/i.test(href)) track('contact_click', { placement: p, contact_method: 'phone' });
  else {
    try { const u = new URL(href, location.href); if (/^https?:$/.test(u.protocol) && !HOSTS.includes(u.hostname) && u.origin !== location.origin) track('outbound_click', { placement: p, destination_domain: u.hostname, link_group: 'external' }); } catch {}
  }
});
function init() {
  if (!eligible) {
    if (excluded) { const badge = document.createElement('div'); badge.className = 'aq-excluded'; badge.textContent = 'Analytics excluded for this browser'; document.body.appendChild(badge); }
    displayQA(); return;
  }
  const button = document.createElement('button'); button.type = 'button'; button.id = 'aq-privacy'; button.textContent = 'Privacy choices'; button.addEventListener('click', preferences); document.body.appendChild(button);
  // Let page modules read any brand prefill before activate sanitizes the address.
  setTimeout(() => { if (granted) activate(); else if (!choice()) preferences(); displayQA(); }, 0);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
