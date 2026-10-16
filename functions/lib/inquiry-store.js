import { fetchJson } from './openai.js';

export const esc=value=>String(value??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
export async function digest(value){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}

export function inquiryEmails(data,id,env){
  const from=env.INQUIRY_FROM_EMAIL||'Agenquest <hello@agenquest.com>';
  const owner=env.INQUIRY_OWNER_EMAIL||'agenquest@gmail.com';
  const replyTo=env.INQUIRY_REPLY_TO_EMAIL||'hello@agenquest.com';
  return [
    {kind:'owner',payload:{from,to:[owner],reply_to:data.email,subject:'New Agenquest consultation inquiry',html:`<p>Inquiry reference: ${esc(id)}</p><p><b>Website:</b> ${esc(data.website)}<br><b>Name:</b> ${esc(data.name)}<br><b>Email:</b> ${esc(data.email)}<br><b>Originating page:</b> ${esc(data.source_page||'/contact/')}</p><p style="white-space:pre-wrap">${esc(data.message)}</p>`}},
    {kind:'acknowledgment',payload:{from,to:[data.email],reply_to:replyTo,subject:'Your Agenquest AEO plan request',html:`<p>Hi ${esc(data.name)},</p><p>Thanks for sharing ${esc(data.website)}. We've received your request.</p><p>We'll review the public information and follow up to arrange a free 30-minute call. We'll use it to discuss initial findings, your customers, and where AEO could help.</p><p>If there's a particular question you'd like us to look at, just reply.</p><p>Anuj and Rishav<br>Agenquest</p>`}},
  ];
}

export async function saveInquiry(db,data,key,payloadHash,env){
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const statements=[db.prepare('INSERT OR IGNORE INTO consultation_inquiries (id,request_key,payload_hash,created_at,website,name,email,message,source_page) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,key,payloadHash,now,data.website,data.name,data.email,data.message,data.source_page)];
  for(const email of inquiryEmails(data,id,env))statements.push(db.prepare('INSERT OR IGNORE INTO consultation_mail (id,inquiry_id,payload_json,created_at,next_attempt_at) SELECT ?,id,?,?,? FROM consultation_inquiries WHERE request_key=? AND id=?').bind(`inquiry/${id}/${email.kind}`,JSON.stringify(email.payload),now,now,key,id));
  await db.batch(statements);
  return db.prepare('SELECT id,payload_hash FROM consultation_inquiries WHERE request_key=?').bind(key).first();
}

export async function flushInquiryMail(env){
  if(!env.LEAD_DB||!env.RESEND_API_KEY)return;
  const now=new Date().toISOString();
  const due=await env.LEAD_DB.prepare("SELECT * FROM consultation_mail WHERE state IN ('pending','sending') AND next_attempt_at<=? ORDER BY created_at LIMIT 2").bind(now).all();
  await Promise.all((due.results||[]).map(async row=>{
    if(row.attempts>=8 || Date.now()-Date.parse(row.created_at)>=23*3600000){await env.LEAD_DB.prepare("UPDATE consultation_mail SET state='failed',last_error='RETRY_WINDOW_EXPIRED' WHERE id=?").bind(row.id).run();return;}
    const claimed=await env.LEAD_DB.prepare("UPDATE consultation_mail SET state='sending',next_attempt_at=? WHERE id=? AND state IN ('pending','sending') AND next_attempt_at<=?").bind(new Date(Date.now()+60000).toISOString(),row.id,now).run();
    if(!claimed.meta?.changes)return;
    try{
      const sent=await fetchJson('https://api.resend.com/emails',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${env.RESEND_API_KEY}`,'Idempotency-Key':row.id},body:row.payload_json},{timeout:7000,stage:'inquiry_email'});
      if(typeof sent.id!=='string'||!sent.id)throw new Error('NOT_ACCEPTED');
      await env.LEAD_DB.prepare("UPDATE consultation_mail SET state='accepted',provider_id=?,attempts=attempts+1,last_error=NULL WHERE id=?").bind(sent.id,row.id).run();
    }catch{
      await env.LEAD_DB.prepare("UPDATE consultation_mail SET state=?,attempts=attempts+1,next_attempt_at=?,last_error='EMAIL_NOT_ACCEPTED' WHERE id=?").bind(row.attempts>=7?'failed':'pending',new Date(Date.now()+Math.min(21600000,60000*2**row.attempts)).toISOString(),row.id).run();
    }
  }));
}
