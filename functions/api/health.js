// GET-able liveness probe. Exists so that Pages Functions routing can be
// verified from outside: the audit endpoints are POST-only, and a GET against
// them returns a status that cannot be distinguished from the worker never
// having been invoked at all.
export function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, service: 'agenquest-api', routes: 'functions-invoked' }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
