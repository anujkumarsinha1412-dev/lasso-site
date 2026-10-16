/** @param {string} value */
const bytes = value => Uint8Array.from(atob(value), c=>c.charCodeAt(0));

/** Verify Svix's raw-body HMAC and five-minute replay window with Web Crypto.
 * @param {Headers} headers @param {string} payload @param {string} secret
 */
export async function validSignature(headers,payload,secret) {
  const id=headers.get('svix-id')||'',timestamp=headers.get('svix-timestamp')||'',signatures=headers.get('svix-signature')||'';
  if(!/^[\w-]{1,200}$/.test(id)||!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||signatures.length>4096) return false;
  try {
    const key=await crypto.subtle.importKey('raw',bytes(secret.replace(/^whsec_/,'')),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const signed=new TextEncoder().encode(`${id}.${timestamp}.${payload}`);
    for(const signature of signatures.split(' ').slice(0,16)) {
      const [version,value]=signature.split(',');
      if(version==='v1'&&value&&await crypto.subtle.verify('HMAC',key,bytes(value),signed))return true;
    }
  } catch { /* Invalid signatures and configuration never disclose details. */ }
  return false;
}

/** @param {Request} request */
export async function boundedBody(request) {
  const reader=request.body?.getReader();
  if(!reader)return '';
  const chunks=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(value);}
  } finally {reader.releaseLock();}
  const buffer=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);
}
