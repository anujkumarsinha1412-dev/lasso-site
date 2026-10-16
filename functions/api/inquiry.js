import { json,readJson } from '../lib/openai.js';
import { validateInquiry } from '../../src/lib/inquiry.js';
import { digest,saveInquiry,flushInquiryMail } from '../lib/inquiry-store.js';
import { privateAttribution } from '../lib/lead-store.js';

export async function onRequestPost(context){
  const origin=new URL(context.request.url).origin;
  if(context.request.headers.get('origin')!==origin || context.request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Please submit the form from this website.'},403);
  if(!context.request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Use the contact form to submit your request.'},415);
  let body;try{body=await readJson(context.request,12000);}catch{return json({error:'Your request could not be read. Please try again.'},400);}
  const checked=validateInquiry(body);
  if(!checked.valid)return json({error:'Please check the highlighted fields.',fields:checked.errors},400);
  if(body.fax || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.request_key||''))return json({error:'Your request could not be sent. Please refresh the page and try again.'},400);
  if(!context.env.LEAD_DB)return json({error:'Your request hasn’t been sent. Please try again, or email hello@agenquest.com.'},503);
  const db=context.env.LEAD_DB;
  const source_page=typeof body.source_page==='string' && body.source_page.length<=300 && /^\/(?:[a-zA-Z0-9_\-/]*)$/.test(body.source_page)?body.source_page:'';
  const data={...checked.data,source_page};
  try{
    const payloadHash=await digest(JSON.stringify(data));
    const existing=await db.prepare('SELECT id,payload_hash FROM consultation_inquiries WHERE request_key=?').bind(body.request_key).first();
    if(existing){if(existing.payload_hash!==payloadHash)return json({error:'A request was already saved from this form. Please refresh before sending different details.'},409);return json({ok:true,stored:true,inquiry_id:existing.id,duplicate:true});}
    const ip=context.request.headers.get('cf-connecting-ip')||'unknown';
    const hour=Math.floor(Date.now()/3600000),bucket=await digest(`${hour}:${ip}`);
    const limit=await db.prepare('INSERT INTO inquiry_rate_limits (bucket,hits,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket,(hour+1)*3600000).first();
    if(limit.hits>10)return json({error:'Too many requests. Please try again later or email hello@agenquest.com.'},429);
    await db.prepare('DELETE FROM inquiry_rate_limits WHERE expires_at<?').bind(Date.now()).run();
    const measurement={consent:body.analytics_consent===true,attribution:privateAttribution(body.attribution,body.analytics_consent===true)};
    const saved=await saveInquiry(db,data,body.request_key,payloadHash,context.env,measurement);
    if(!saved || saved.payload_hash!==payloadHash)return json({error:'This form has already been used. Please refresh and try again.'},409);
    // The transaction includes both mail jobs. Email failures cannot erase an inquiry.
    context.waitUntil(flushInquiryMail(context.env).catch(()=>{}));
    return json({ok:true,stored:true,inquiry_id:saved.id});
  }catch{return json({error:'Your request hasn’t been sent. Please try again, or email hello@agenquest.com.'},503);}
}

export function onRequestGet(){return json({error:'Submit the form on /contact/.'},405);}
