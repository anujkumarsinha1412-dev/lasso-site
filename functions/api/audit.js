import { retiredAuditResponse } from '../lib/retired-audit.js';

// All methods are retired; no request parsing, provider calls or storage access.
export function onRequest() {
  return retiredAuditResponse();
}
