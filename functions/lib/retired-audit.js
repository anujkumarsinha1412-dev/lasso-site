export const RETIRED_AUDIT_PATHS = ['/api/suggest', '/api/audit', '/api/lead'];

export function retiredAuditResponse() {
  return Response.json({
    error: 'The automated audit has been retired. Please use the contact form to request an initial AEO plan.',
    code: 'AUDIT_RETIRED',
    contact_url: '/contact/',
  }, {
    status: 410,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
