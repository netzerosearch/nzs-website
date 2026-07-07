// Vercel serverless function: receives lead form submissions and emails them
// to matt@netzero-search.com via Resend. No external dependencies (uses fetch).

const TO_EMAIL = "matt@netzero-search.com";
// The "from" address must be on a domain verified in your Resend account.
// Override with the LEAD_FROM_EMAIL env var if you use a different sender.
const FROM_EMAIL = process.env.LEAD_FROM_EMAIL || "Net Zero Search <leads@netzero-search.com>";

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function row(label, value) {
  if (!value) return "";
  return `<tr><td style="padding:6px 14px 6px 0;color:#7a7468;font-family:Arial,sans-serif;font-size:13px;vertical-align:top;white-space:nowrap">${esc(
    label
  )}</td><td style="padding:6px 0;color:#1a1a1a;font-family:Arial,sans-serif;font-size:14px">${esc(
    value
  ).replace(/\n/g, "<br>")}</td></tr>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "Email service is not configured. Missing RESEND_API_KEY." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }
  body = body || {};

  const type = body.type === "candidate" ? "candidate" : "client";
  const name = (body.name || "").trim();
  const email = (body.email || "").trim();

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }

  let subject;
  let rows;
  if (type === "candidate") {
    subject = `New candidate enquiry — ${name}`;
    rows =
      row("Name", name) +
      row("Email", email) +
      row("Current role", body.role) +
      row("Sector", body.sector) +
      row("LinkedIn", body.linkedin) +
      row("Looking for", body.message) +
      row("CV attached", body.cvFilename ? body.cvFilename : "No");
  } else {
    subject = `New client enquiry — ${name}${body.company ? " (" + body.company + ")" : ""}`;
    rows =
      row("Name", name) +
      row("Company", body.company) +
      row("Work email", email) +
      row("Hiring", body.hiring) +
      row("Sector", body.sector) +
      row("Mandate", body.message);
  }

  const html = `<div style="background:#f5f3ee;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4ded1;border-radius:12px;overflow:hidden">
      <div style="background:#141414;padding:18px 24px">
        <span style="color:#f5f3ee;font-family:Georgia,serif;font-size:18px">Net Zero Search</span>
        <span style="color:#c9a24b;font-family:Arial,sans-serif;font-size:12px;float:right;line-height:26px">${
          type === "candidate" ? "Candidate lead" : "Client lead"
        }</span>
      </div>
      <div style="padding:24px">
        <table style="border-collapse:collapse;width:100%">${rows}</table>
      </div>
    </div>
    <p style="max-width:560px;margin:14px auto 0;color:#a59f90;font-family:Arial,sans-serif;font-size:12px">Submitted from the Book a Call page.</p>
  </div>`;

  const payload = {
    from: FROM_EMAIL,
    to: [TO_EMAIL],
    reply_to: email,
    subject,
    html,
  };

  // Attach CV if provided (base64 data URL or raw base64 from the client).
  if (body.cvContent && body.cvFilename) {
    const base64 = String(body.cvContent).includes(",")
      ? String(body.cvContent).split(",").pop()
      : String(body.cvContent);
    payload.attachments = [{ filename: body.cvFilename, content: base64 }];
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.log("[v0] Resend error:", r.status, detail);
      return res
        .status(502)
        .json({ error: "Failed to send email.", detail });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.log("[v0] Lead handler error:", err && err.message);
    return res.status(500).json({ error: "Unexpected error sending email." });
  }
};
