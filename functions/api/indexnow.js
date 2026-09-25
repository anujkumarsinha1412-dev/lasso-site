const URLS = ["https://agenquest.com/","https://agenquest.com/blog/","https://agenquest.com/blog/ai-visibility-metrics/","https://agenquest.com/blog/buyer-question-prompt-panel/","https://agenquest.com/blog/how-ai-engines-choose-brands/","https://agenquest.com/blog/improving-material-kitchen-aeo/","https://agenquest.com/blog/improving-our-place-aeo/","https://agenquest.com/blog/improving-tower-28-aeo/","https://agenquest.com/blog/is-aeo-important-for-enterprise/","https://agenquest.com/blog/is-aeo-important-for-mid-market-company/","https://agenquest.com/blog/is-aeo-important-for-small-company/","https://agenquest.com/blog/is-aeo-just-seo/","https://agenquest.com/blog/ramp-vs-brex-ai-recommendations/","https://agenquest.com/blog/webflow-vs-framer-ai-recommendations/","https://agenquest.com/blog/what-is-aeo/","https://agenquest.com/blog/what-is-answer-engine-optimization/","https://agenquest.com/blog/when-company-is-too-early-for-aeo/","https://agenquest.com/blog/where-aeo-sits-in-marketing-strategy/","https://agenquest.com/blog/which-budget-should-fund-aeo/","https://agenquest.com/blog/who-should-own-aeo/","https://agenquest.com/privacy/"];
const KEY = "3370b49b0ed350a48ac9478580e33d4c";
export async function onRequest(context) {
  const u = new URL(context.request.url);
  if (u.searchParams.get("t") !== KEY) return new Response("no", { status: 403 });
  const payload = JSON.stringify({ host: "agenquest.com", key: KEY, keyLocation: `https://agenquest.com/${KEY}.txt`, urlList: URLS });
  const endpoints = ["https://api.indexnow.org/IndexNow", "https://www.bing.com/indexnow", "https://yandex.com/indexnow"];
  const settled = await Promise.allSettled(endpoints.map(ep =>
    fetch(ep, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: payload })
      .then(async r => `${ep} => HTTP ${r.status} :: ${(await r.text()).slice(0, 150)}`)
  ));
  const lines = settled.map((s, i) => s.status === "fulfilled" ? s.value : `${endpoints[i]} => THREW ${s.reason}`);
  lines.push(`submitted ${URLS.length} urls for agenquest.com`);
  const html = `<!doctype html><html><head><title>IndexNow: ${lines[0].slice(0,80)}</title></head><body><h1>IndexNow submission result</h1><pre>${lines.join("\n")}</pre></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
