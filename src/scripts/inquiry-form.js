import { validateInquiry } from '../lib/inquiry.js';

const form=document.querySelector('#inquiry-form');
if(form instanceof HTMLFormElement){
  const button=form.querySelector('button[type=submit]');
  const status=document.querySelector('#inquiry-status');
  const requestKey=crypto.randomUUID();
  let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const values=Object.fromEntries(new FormData(form));
    const {data,errors,valid}=validateInquiry(values);
    let first;
    for(const field of ['website','name','email','message']){
      const input=form.elements.namedItem(field),error=document.querySelector(`#${field}-error`);
      if(input instanceof HTMLElement)input.setAttribute('aria-invalid',String(!!errors[field]));
      error.textContent=errors[field]||'';error.hidden=!errors[field];if(errors[field]&&!first)first=input;
    }
    if(!valid){status.textContent='Please check the highlighted fields.';first?.focus();return;}
    busy=true;button.disabled=true;button.textContent='Sending your request…';status.textContent='';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      let source_page='';try{const source=new URL(document.referrer);if(source.origin===location.origin)source_page=source.pathname;}catch{}
      const response=await fetch('/api/inquiry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,fax:values.fax,request_key:requestKey,source_page}),signal:controller.signal});
      const result=await response.json().catch(()=>{throw new Error('Your request hasn’t been confirmed. Please try again, or email hello@agenquest.com.');});
      if(!response.ok || !result.ok || result.stored!==true)throw new Error(result.error||'Your request hasn’t been sent. Please try again, or email hello@agenquest.com.');
      document.querySelector('#inquiry-reference').textContent=result.inquiry_id;
      form.hidden=true;const success=document.querySelector('#inquiry-success');success.hidden=false;success.focus();
    }catch(error){status.textContent=error.name==='AbortError'?'We couldn’t confirm the response. Please retry with the same details, or email hello@agenquest.com.':error instanceof TypeError?'The connection was interrupted. Please retry with the same details, or email hello@agenquest.com.':error.message;}
    finally{clearTimeout(timer);busy=false;button.disabled=false;button.textContent='Request my free AEO plan';}
  });
}
