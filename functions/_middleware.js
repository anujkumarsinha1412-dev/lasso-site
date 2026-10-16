import { flushNotifications } from './lib/lead-store.js';

export async function onRequest(context) {
  const response = await context.next();
  if (context.env.LEAD_DB && (context.request.headers.get('accept')?.includes('text/html') || new URL(context.request.url).pathname === '/api/health')) {
    context.waitUntil(flushNotifications(context.env).catch(() => {}));
  }
  return response;
}
