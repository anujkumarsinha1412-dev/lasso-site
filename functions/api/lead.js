// POST /api/lead  { email, phone, brand, website, report }
// Stores the lead as a Resend contact, emails the report to the prospect,
// and sends a lead notification to the AgenQuest inbox.

const OWNER_EMAIL = "rishavjani@gmail.com";
const FROM = "AgenQuest <audit@agenquest.com>";

function reportHtml(brand, report) {
  const rows = (report.results || []).map((r) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${esc(r.query)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;color:${r.prominence === "recommended" ? "#1A7F4E" : r.prominence === "mentioned" ? "#B7791F" : "#C53030"}">${esc(r.prominence)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${esc((r.brands_named || []).join(", "))}</td>
    </tr>`).join("");
  const gaps = (report.overall?.gaps || []).map((g) => `<li>${esc(g)}</li>`).join("");
  return `<div style="font-family:system-ui,sans-serif;max-width:640px;margin:auto;color:#14120F;">
    <h2>ChatGPT Visibility Report — ${esc(brand)}</h2>
    <p style="font-size:28px;margin:8px 0;"><b>${report.overall?.score ?? "?"}/100</b> visibility score</p>
    <p>${esc(report.overall?.summary || "")}</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr><th align="left" style="padding:8px;">Query</th><th align="left" style="padding:8px;">Result</th><th align="left" style="padding:8px;">Brands named</th></tr>
      ${rows}
    </table>
    <h3>Top gaps</h3><ul>${gaps}</ul>
    <p style="margin-top:24px;">Want these gaps closed? Reply to this email — the audit was free, the roadmap conversation is too.</p>
    <p>— AgenQuest · <a href="https://agenquest.com">agenquest.com</a></p>
  </div>`;
}
const esc = (s) => String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

export async function onRequestPost(context) {
  try {
    const { email, phone, brand, website, report } = await context.request.json();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "valid email required" }, 400);
    const key = context.env.RESEND_API_KEY;
    const out = { ok: true, stored: false, reportEmail: false, notify: false };
    if (!key) return json(out); // unblur anyway; nothing configured yet

    const send = (body) => fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    });

    // 1) store contact (audience optional)
    if (context.env.RESEND_AUDIENCE_ID) {
      const c = await fetch(`https://api.resend.com/audiences/${context.env.RESEND_AUDIENCE_ID}/contacts`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ email, first_name: brand, unsubscribed: false }),
      });
      out.stored = c.ok;
    }
    // 2) report to prospect
    const r1 = await send({ from: FROM, to: [email], subject: `Your ChatGPT visibility report — ${brand}`, html: reportHtml(brand, report || {}) });
    out.reportEmail = r1.ok;
    // 3) notification to owner
    const r2 = await send({
      from: FROM, to: [OWNER_EMAIL], subject: `🔥 New audit lead: ${brand} (${email})`,
      html: `<p><b>Brand:</b> ${esc(brand)}<br><b>Website:</b> ${esc(website)}<br><b>Email:</b> ${esc(email)}<br><b>Phone:</b> ${esc(phone || "—")}<br><b>Score:</b> ${report?.overall?.score ?? "?"}/100</p><p>${esc(report?.overall?.summary || "")}</p>`,
    });
    out.notify = r2.ok;
    return json(out);
  } catch { return json({ ok: true }); }
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
