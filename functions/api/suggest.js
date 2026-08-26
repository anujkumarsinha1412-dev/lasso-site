// POST /api/suggest  { brand, website, category }
// Returns { queries: [ ...8 suggested ChatGPT prompts ] }

const MOCK = (brand, category) => [
  `What are the best ${category.toLowerCase()} brands right now?`,
  `Best ${category.toLowerCase()} products under a mid-range budget?`,
  `Which ${category.toLowerCase()} brands do dermatologists/experts actually recommend?`,
  `Is ${brand} legit? Reviews and reputation?`,
  `${brand} vs the leading alternatives — which should I buy?`,
  `What do people on Reddit say about ${brand}?`,
  `Where can I buy ${brand} and is it worth the price?`,
  `Top-rated ${category.toLowerCase()} for beginners?`,
];

export async function onRequestPost(context) {
  try {
    const { brand, website, category } = await context.request.json();
    if (!brand || brand.length > 100) return json({ error: "brand required" }, 400);
    const key = context.env.OPENAI_API_KEY;
    if (!key) return json({ queries: MOCK(brand, category || "consumer products"), mock: true });

    const sys = `You generate realistic consumer queries typed into ChatGPT. Return strict JSON: {"queries":[...8 strings]}.
Rules: 6 category/purchase-intent queries where a brand like the one given SHOULD appear (best-of, comparisons, expert-recommended, budget, use-case, community opinion). 2 brand-specific queries (reputation/reviews, vs-alternatives). Natural, specific, varied. No numbering.`;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Brand: ${brand}\nWebsite: ${website || "n/a"}\nCategory: ${category || "consumer products"}` },
        ],
        temperature: 0.7,
      }),
    });
    if (!r.ok) return json({ queries: MOCK(brand, category || "consumer products"), mock: true });
    const data = await r.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    const queries = (parsed.queries || []).slice(0, 8).filter((q) => typeof q === "string" && q.length > 5);
    return json({ queries: queries.length ? queries : MOCK(brand, category || "consumer products") });
  } catch (e) {
    return json({ error: "bad request" }, 400);
  }
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
