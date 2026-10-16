import { flushFailureAlerts } from './alerts.js';

// Pages retains the Resend secret. The Worker reads only failure metadata for
// operational warnings, sent independently through a restricted email binding.
/** @satisfies {ExportedHandler<Env>} */
export default {
  async scheduled(controller, env) {
    const status = { scheduled_at: new Date(controller.scheduledTime).toISOString(), finished_at: '', ok: false, code: 'REQUEST_FAILED' };
    try {
      const response = await fetch('https://agenquest.com/api/health', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        // Workers accepts manual/follow at runtime. Reject 3xx below rather
        // than following it or using the unsupported redirect: error mode.
        redirect: 'manual',
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) {
        status.code = 'HTTP_' + response.status;
        await response.body?.cancel();
      } else {
        status.code = 'INVALID_RESPONSE';
        // The owned endpoint has a fixed, small JSON response with no lead data.
        const result = await response.json();
        status.ok = result.ok === true && result.service === 'agenquest-api' && result.mail_retry === 'completed';
        status.code = status.ok ? 'DRAIN_COMPLETED' : 'INVALID_RESPONSE';
      }
    } catch {
      // Never log response bodies, credentials, or submitted contact details.
    }
    // Scan failures even when the Pages wake-up request itself fails.
    let alertsOk = false;
    try { await flushFailureAlerts(env); alertsOk = true; } catch {
      console.error(JSON.stringify({ event: 'mail_failure_alerts_failed' }));
    }
    const heartbeat = { ...status, ok: status.ok && alertsOk, drain_ok: status.ok, alerts_ok: alertsOk,
      code: !status.ok ? status.code : alertsOk ? status.code : 'ALERTS_UNAVAILABLE' };
    heartbeat.finished_at = new Date().toISOString();
    console.log(JSON.stringify({ event: 'mail_retry_tick', ...heartbeat }));
    // Five-minute checkpoints use 288 KV writes/day, including during outages.
    // Every invocation is still recorded in Workers Logs; KV is private.
    if (Math.floor(controller.scheduledTime / 60000) % 5 === 0) {
      await env.RETRY_STATUS.put('latest', JSON.stringify(heartbeat));
    }
    if (!status.ok) throw new Error('MAIL_RETRY_' + status.code);
    if (!alertsOk) throw new Error('MAIL_FAILURE_ALERTS_FAILED');
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
