// POST /api/audit  { brand, website, queries: [..max 10] }
// Runs each query against a search-enabled ChatGPT model, then scores brand visibility.
// Returns { results: [{query, prominence, brands_named, note}], overall: {score, summary, gaps[]} }

const MOCK_RESULT = (brand, queries) => ({
  mock: true,
  results: queries.map((q, i) => ({
    query: q,
    prominence: i % 3 === 0 ? "mentioned" : "absent",
    brands_named: ["Category Leader A", "Category Leader B", i % 3 === 0 ? brand : "Challenger C"],
    note: i % 3 === 0 ? `${brand} appears but below the leaders.` : `${brand} does not appear; answer is dominated by incumbents.`,
  })),
  overall: {
    score: 22,
    summary: `${brand} is largely invisible in ChatGPT answers for high-intent category queries. Incumbent brands dominate through review depth and citations.`,
    gaps: ["No presence in community discussions ChatGPT cites", "Thin review footprint on trusted platforms", "No earned citations in publications AI retrieves"],
  },
});

export async function onRequestPost(context) {
  try {
    const { brand, website, queries } = await context.request.json();
    if (!brand || !Array.isArray(queries) || !queries.length) return json({ error: "brand and queries required" }, 400);
    const qs = queries.slice(0, 10).map((q) => String(q).slice(0, 300));
    const key = context.env.OPENAI_API_KEY;
    if (!key) return json(MOCK_RESULT(brand, qs));

    // 1) Run all queries against a search-enabled model in parallel
    const answers = await Promise.all(
      qs.map(async (q) => {
        try {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: "gpt-4o-mini-search-preview",
              web_search_options: { search_context_size: "low" },
              messages: [{ role: "user", content: q }],
            }),
          });
          if (!r.ok) {
            // fallback: non-search model (parametric answer still meaningful)
            const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
              body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: q }] }),
            });
            if (!r2.ok) return { q, a: null };
            const d2 = await r2.json();
            return { q, a: d2.choices[0].message.content };
          }
          const d = await r.json();
          return { q, a: d.choices[0].message.content };
        } catch { return { q, a: null }; }
      })
    );

    // 2) Score the answers
    const scoringInput = answers.map((x, i) => `[Q${i + 1}] ${x.q}\n[ANSWER${i + 1}]\n${x.a || "(no answer retrieved)"}`).join("\n\n---\n\n");
    const sys = `You are an AI-visibility auditor. Given ChatGPT answers to consumer queries, assess visibility of the brand "${brand}" (website: ${website || "n/a"}).
Return strict JSON: {"results":[{"query":str,"prominence":"recommended"|"mentioned"|"absent","brands_named":[up to 4 str],"note":str (<=140 chars, factual)}],"overall":{"score":int 0-100,"summary":str (<=220 chars),"gaps":[3 short strings, each a concrete missing signal]}}.
"recommended" = named as a top pick. "mentioned" = named but not a top pick. Score reflects share of answers where brand appears, weighted by prominence. Be strict and honest.`;
    const r3 = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: scoringInput }],
      }),
    });
    if (!r3.ok) return json(MOCK_RESULT(brand, qs));
    const d3 = await r3.json();
    const report = JSON.parse(d3.choices[0].message.content);
    return json(report);
  } catch (e) {
    return json({ error: "audit failed" }, 500);
  }
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
