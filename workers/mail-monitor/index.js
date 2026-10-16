import { validSignature,boundedBody } from './signature.js';
import { saveDeliveryAlert,checkHeartbeat,flushMonitorAlerts } from './monitor.js';

/** @satisfies {ExportedHandler<Env & {RESEND_WEBHOOK_SECRET:string}>} */
export default {
  async fetch(request,env,ctx) {
    if(new URL(request.url).pathname!=='/webhooks/resend')return new Response('Not found',{status:404});
    if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:{allow:'POST'}});
    if(!env.RESEND_WEBHOOK_SECRET||!env.LEAD_DB)return new Response('Unavailable',{status:503});
    if(!request.headers.get('content-type')?.startsWith('application/json'))return new Response('JSON required',{status:415});
    if(!request.headers.get('svix-signature'))return new Response('Invalid signature',{status:401});
    let body;
    try {body=await boundedBody(request);}catch{return new Response('Invalid body',{status:400});}
    if(!await validSignature(request.headers,body,env.RESEND_WEBHOOK_SECRET))return new Response('Invalid signature',{status:401});
    let event;
    try {event=JSON.parse(body);}catch{return new Response('Invalid JSON',{status:400});}
    try {
      const saved=await saveDeliveryAlert(env.LEAD_DB,event);
      if(saved)ctx.waitUntil(flushMonitorAlerts(env).catch(()=>{console.error(JSON.stringify({event:'mail_monitor_delivery_deferred'}));}));
      return new Response('Accepted',{status:202,headers:{'cache-control':'no-store'}});
    }catch {
      // Non-2xx makes Resend retry. Never log raw events or provider error text.
      console.error(JSON.stringify({event:'mail_monitor_storage_failed'}));
      return new Response('Event not saved',{status:503});
    }
  },
  async scheduled(_controller,env) {
    let problem=false;
    try {await checkHeartbeat(env);}catch{problem=true;console.error(JSON.stringify({event:'mail_monitor_heartbeat_failed'}));}
    // Previously saved delivery warnings can still send when the status read fails.
    await flushMonitorAlerts(env);
    console.log(JSON.stringify({event:'mail_monitor_tick',ok:!problem}));
    if(problem)throw new Error('MAIL_MONITOR_CHECK_FAILED');
  },
};
