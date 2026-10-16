export const FIELD_ERRORS = {
  website:'Enter your website, for example yourbusiness.com.',
  name:'Enter your name so we know who to contact.',
  email:'Enter an email address we can reply to.',
  message:'Please keep this under 2,000 characters, or email us the extra detail.',
};

export function normalizeWebsite(value) {
  if (typeof value !== 'string' || value.length > 300 || /\s/.test(value)) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value);
    const host = url.hostname.toLowerCase();
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return '';
    // An inquiry never fetches the supplied address. Strip private query/hash data.
    return url.origin + url.pathname;
  } catch { return ''; }
}

export function validateInquiry(value = {}) {
  const input = { website:typeof value.website==='string'?value.website.trim():'', name:typeof value.name==='string'?value.name.trim():'', email:typeof value.email==='string'?value.email.trim().toLowerCase():'', message:typeof value.message==='string'?value.message.trim():'' };
  const errors = {};
  const website = normalizeWebsite(input.website);
  if (!website) errors.website=FIELD_ERRORS.website;
  if (!input.name || input.name.length>120 || /[\u0000-\u001f\u007f]/.test(input.name)) errors.name=FIELD_ERRORS.name;
  if (!input.email || input.email.length>254 || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(input.email)) errors.email=FIELD_ERRORS.email;
  if (input.message.length>2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.message)) errors.message=FIELD_ERRORS.message;
  return { data:{...input,website},errors,valid:Object.keys(errors).length===0 };
}
