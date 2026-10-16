import { flushNotifications } from './lib/lead-store.js';
import { flushInquiryMail } from './lib/inquiry-store.js';
import { RETIRED_AUDIT_PATHS, retiredAuditResponse } from './lib/retired-audit.js';

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname.replace(/\/+$/, '');
  // Retired requests must not trigger background sends for existing queues.
  if (RETIRED_AUDIT_PATHS.includes(path)) return retiredAuditResponse();
  const response = await context.next();
  if (context.env.LEAD_DB && new URL(context.request.url).pathname !== '/api/health' && context.request.headers.get('accept')?.includes('text/html')) {
    context.waitUntil(flushNotifications(context.env).catch(() => {}));
    context.waitUntil(flushInquiryMail(context.env).catch(() => {}));
  }
  return response;
}
