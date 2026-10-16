// Pages holds the database and Resend secret. Calling its existing wake-up route
// keeps sending in one place, without replicating credentials into this Worker.
/** @satisfies {ExportedHandler<Env>} */
export default {
  async scheduled(controller, env) {
    const status = { scheduled_at: new Date(controller.scheduledTime).toISOString(), finished_at: '', ok: false, code: 'REQUEST_FAILED' };
    try {
      const response = await fetch('https://agenquest.com/api/health', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) {
        status.code = 'HTTP_' + response.status;
        await response.body?.cancel();
      } else {
        // The owned endpoint has a fixed, small JSON response with no lead data.
        const result = await response.json();
        status.ok = result.ok === true && result.service === 'agenquest-api' && result.mail_retry === 'completed';
        status.code = status.ok ? 'DRAIN_COMPLETED' : 'INVALID_RESPONSE';
      }
    } catch {
      // Never log response bodies, credentials, or submitted contact details.
    }
    status.finished_at = new Date().toISOString();
    console.log(JSON.stringify({ event: 'mail_retry_tick', ...status }));
    // Five-minute checkpoints use 288 KV writes/day, including during outages.
    // Every invocation is still recorded in Workers Logs; KV is private.
    if (Math.floor(controller.scheduledTime / 60000) % 5 === 0) {
      await env.RETRY_STATUS.put('latest', JSON.stringify(status));
    }
    if (!status.ok) throw new Error('MAIL_RETRY_' + status.code);
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
