import { flushNotifications } from '../lib/lead-store.js';
import { flushInquiryMail } from '../lib/inquiry-store.js';

// The cron Worker uses this existing queue wake-up route. Await both drains so
// its heartbeat confirms completion, rather than just a successful HTTP request.
export async function onRequestGet({ env }) {
  let ok = false;
  if (env.LEAD_DB && env.RESEND_API_KEY) {
    const results = await Promise.allSettled([flushNotifications(env), flushInquiryMail(env)]);
    ok = results.every(result => result.status === 'fulfilled');
  }
  if (!ok) console.error(JSON.stringify({ event: 'mail_retry_drain_failed' }));
  return Response.json({ ok, service: 'agenquest-api', routes: 'functions-invoked', mail_retry: ok ? 'completed' : 'unavailable' }, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
