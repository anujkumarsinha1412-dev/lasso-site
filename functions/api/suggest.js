// POST /api/suggest  { brand, website }
// Researches the brand first (live homepage + web search), then writes the prompt set.
// Returns { queries[], category, brand, website, research:{...} }

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

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

// Strip a URL down to a clean display name
function cleanName(raw) {
  return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]
    .replace(/\.(com|in|co|io|net|org|shop|store|ai|fr|de|uk|us)$/i, "") || raw;
}

// Pull readable text out of the brand's homepage
async function fetchSite(url) {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; AgenQuestAudit/1.0; +https://agenquest.com)" },
      cf: { cacheTtl: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 300000);
    const pick = (re) => (html.match(re)?.[1] || "").trim();
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
      || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3500);
    return { title, desc, body };
  } catch { return null; }
}

export async function onRequestPost(context) {
  try {
    const input = await context.request.json();
    const raw = String(input.brand || "").trim();
    if (!raw || raw.length > 120) return json({ error: "brand required" }, 400);

    const looksUrl = /\.[a-z]{2,}/i.test(raw);
    const brand = cleanName(raw);
    const website = input.website || (looksUrl ? raw : "");
    const key = context.env.OPENAI_API_KEY;
    if (!key) return json({ queries: MOCK(brand), brand, mock: true });

    const chat = (body) => fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });

    // ---- RESEARCH (parallel): live homepage + web search on the brand ----
    const siteUrl = website ? (website.startsWith("http") ? website : `https://${website.replace(/^www\./, "")}`) : null;

    const [site, searched] = await Promise.all([
      siteUrl ? fetchSite(siteUrl) : Promise.resolve(null),
      (async () => {
        try {
          const r = await chat({
            model: "gpt-4o-mini-search-preview",
            web_search_options: { search_context_size: "low" },
            messages: [{
              role: "user",
              content: `Research the brand "${brand}"${website ? ` (${website})` : ""}. In under 180 words state: what it sells (specific product types), its market/country, its price positioning, its main named competitors, and the customer problems it solves. If you cannot identify it confidently, say so plainly.`,
            }],
          });
          if (!r.ok) return null;
          const d = await r.json();
          return d.choices?.[0]?.message?.content || null;
        } catch { return null; }
      })(),
    ]);

    const dossier = [
      site?.title ? `HOMEPAGE TITLE: ${site.title}` : "",
      site?.desc ? `HOMEPAGE DESCRIPTION: ${site.desc}` : "",
      site?.body ? `HOMEPAGE TEXT (truncated): ${site.body}` : "",
      searched ? `WEB RESEARCH: ${searched}` : "",
    ].filter(Boolean).join("\n\n");

    // ---- GENERATION: write the prompt panel from the researched evidence ----
    const year = new Date().getFullYear();
    const sys = `You write the buyer questions a real customer would type into ChatGPT, for auditing whether a brand appears in AI answers.

Use ONLY the supplied research to determine what the brand actually sells, to whom, at what price level, and against which competitors. If the research is thin or contradictory, write safer category-level questions rather than inventing product details.

Return strict JSON:
{"category":"<specific category label>","confidence":"high"|"medium"|"low","queries":[8 strings]}

Rules for the 8 queries:
- 6 CATEGORY questions that never name the brand. A buyer with this need would type them. Vary the job: best-of, budget/price-point, specific use case or occasion, buyer constraint (skin type, size, material, region), expert/professional recommendation, community opinion.
- 2 BRAND questions naming the brand: one on reputation/reviews, one comparing it to a real named competitor from the research.
- Use concrete details from the research (real product types, price points, materials, geography) instead of generic phrasing.
- Natural spoken phrasing, no numbering, no quotes, never mention the current year.`;

    const gen = await chat({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `BRAND: ${brand}\nWEBSITE: ${website || "not given"}\nCURRENT YEAR: ${year}\n\nRESEARCH\n${dossier || "(no research available — infer cautiously from the name)"}` },
      ],
      temperature: 0.6,
    });
    if (!gen.ok) return json({ queries: MOCK(brand), brand, website, mock: true });

    const data = await gen.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    const queries = (parsed.queries || []).slice(0, 8).filter((q) => typeof q === "string" && q.length > 5);

    return json({
      queries: queries.length ? queries : MOCK(brand),
      category: parsed.category || "",
      confidence: parsed.confidence || "",
      brand,
      website,
      research: { site: !!site, searched: !!searched },
    });
  } catch (e) {
    return json({ error: "bad request" }, 400);
  }
}
