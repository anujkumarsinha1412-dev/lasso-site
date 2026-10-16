import { flushNotifications } from './lib/lead-store.js';
import { flushInquiryMail } from './lib/inquiry-store.js';

export async function onRequest(context) {
  const response = await context.next();
  if (context.env.LEAD_DB && new URL(context.request.url).pathname !== '/api/health' && context.request.headers.get('accept')?.includes('text/html')) {
    context.waitUntil(flushNotifications(context.env).catch(() => {}));
    context.waitUntil(flushInquiryMail(context.env).catch(() => {}));
  }
  return response;
}
