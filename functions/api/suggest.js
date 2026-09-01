// POST /api/suggest  { brand, website }
// Infers the category itself, returns { queries: [...8], category }

const MOCK = (brand) => [
  `What are the best brands in this category right now?`,
  `Best options under a mid-range budget?`,
  `Which brands do experts actually recommend?`,
  `Is ${brand} legit? Reviews and reputation?`,
  `${brand} vs the leading alternatives — which should I buy?`,
  `What do people on Reddit say about ${brand}?`,
  `Where can I buy ${brand} and is it worth the price?`,
  `Top-rated options for beginners?`,
];

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const raw = String(body.brand || "").trim();
    if (!raw || raw.length > 120) return json({ error: "brand required" }, 400);
    // Derive a clean display name if they typed a URL
    const brand = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].replace(/\.(com|in|co|io|net|org|shop|store|ai)$/i, "") || raw;
    const website = body.website || (/\.[a-z]{2,}/i.test(raw) ? raw : "");

    const key = context.env.OPENAI_API_KEY;
    if (!key) return json({ queries: MOCK(brand), brand, mock: true });

    const sys = `You generate realistic consumer queries typed into ChatGPT, for auditing a brand's AI visibility.
First infer what the brand sells from its name/website. Then return strict JSON:
{"category":"<short category label>","queries":[...8 strings]}
Rules: 6 category/purchase-intent queries where this brand SHOULD appear (best-of, comparison, expert-recommended, budget, use-case, community opinion) — these must name the CATEGORY, not the brand. 2 brand-specific queries (reputation/reviews, vs-alternatives). Natural phrasing, specific, varied, no numbering.`;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: `Brand or website: ${raw}` }],
        temperature: 0.7,
      }),
    });
    if (!r.ok) return json({ queries: MOCK(brand), brand, mock: true });
    const data = await r.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    const queries = (parsed.queries || []).slice(0, 8).filter((q) => typeof q === "string" && q.length > 5);
    return json({ queries: queries.length ? queries : MOCK(brand), category: parsed.category || "", brand, website });
  } catch (e) {
    return json({ error: "bad request" }, 400);
  }
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
