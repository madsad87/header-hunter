// src/detectors.js

export function detectColorForStatus(status) {
  const n = Number(status);
  if (!Number.isFinite(n)) return "#23293a";
  if (n >= 200 && n < 300) return "#1fd17a";
  if (n >= 300 && n < 400) return "#f6c945";
  return "#ff4d4d";
}

export function detectPlatform(doc) {
  const signals = [];

  const html = doc.documentElement?.innerHTML || "";
  const scripts = Array.from(doc.scripts || []).map(s => s.src || "").filter(Boolean);
  const metas = Array.from(doc.querySelectorAll("meta")).map(m => ({
    name: (m.getAttribute("name") || "").toLowerCase(),
    property: (m.getAttribute("property") || "").toLowerCase(),
    content: (m.getAttribute("content") || "")
  }));

  // WordPress
  if (html.includes("wp-content") || html.includes("wp-includes")) signals.push("Found wp-content/wp-includes");
  if (metas.some(m => m.name === "generator" && /wordpress/i.test(m.content))) signals.push("Meta generator: WordPress");
  if (doc.querySelector('link[rel="https://api.w.org/"]')) signals.push("REST API link: api.w.org");

  // Shopify
  if (scripts.some(s => s.includes("cdn.shopify.com"))) signals.push("Script: cdn.shopify.com");
  if (/Shopify\.theme/i.test(html)) signals.push("Shopify.theme present");
  if (metas.some(m => m.name === "generator" && /shopify/i.test(m.content))) signals.push("Meta generator: Shopify");

  // Squarespace
  if (scripts.some(s => s.includes("static.squarespace.com"))) signals.push("Script: static.squarespace.com");
  if (/Squarespace/i.test(html)) signals.push("Squarespace markers in HTML");

  // Wix
  if (scripts.some(s => s.includes("wixstatic.com"))) signals.push("Script: wixstatic.com");
  if (/wix/i.test(doc.documentElement?.getAttribute("data-wix") || "")) signals.push("data-wix attr");

  // Next.js
  if (doc.getElementById("__NEXT_DATA__")) signals.push("__NEXT_DATA__ script tag");
  if (scripts.some(s => s.includes("/_next/"))) signals.push("Script path includes /_next/");

  // React (heuristic)
  if (html.includes("data-reactroot") || html.includes("data-reactid")) signals.push("React root markers (legacy)");
  if (doc.querySelector("[data-reactroot]")) signals.push("data-reactroot element");

  // Static-ish heuristic
  const hasAppRoot = !!doc.querySelector("#app, #root, [data-app]");
  if (hasAppRoot) signals.push("App root container (#app/#root)");

  // Choose primary
  const pick = (name, conf) => ({ primary: name, confidence: conf, signals });

  const joined = signals.join(" | ").toLowerCase();

  if (joined.includes("wp-")) return pick("WordPress", "High");
  if (joined.includes("shopify")) return pick("Shopify", "High");
  if (joined.includes("squarespace")) return pick("Squarespace", "High");
  if (joined.includes("wix")) return pick("Wix", "Medium");
  if (joined.includes("next_data") || joined.includes("/_next/")) return pick("Next.js", "Medium");
  if (signals.some(s => s.toLowerCase().includes("react"))) return pick("React app", "Low");

  if (signals.length === 0) return pick("Unknown / likely static", "Low");
  return pick("Unknown", "Low");
}

export function toMarkdownReport({ trace, dns, platform }) {
  const lines = [];
  lines.push(`# Redirect Trace রিপোর্ট`);
  lines.push("");

  if (trace) {
    lines.push(`## Request flow`);
    for (const s of (trace.chain || [])) {
      if (s.phase === "request") continue;
      const code = s.statusCode ?? "—";
      const loc = s.location ? ` → ${s.location}` : "";
      lines.push(`- **${code}** ${s.url}${loc}`);
    }

    lines.push("");
    lines.push(`## Final`);
    lines.push(`- URL: ${trace.finalUrl || "—"}`);
    lines.push(`- Status: ${trace.finalStatus || "—"}`);
    if (trace.errors?.length) {
      lines.push(`- Errors:`);
      for (const e of trace.errors) lines.push(`  - ${e.time}: ${e.error} (${e.url})`);
    }
    lines.push("");
  }

  if (platform) {
    lines.push(`## Platform`);
    lines.push(`- Detected: **${platform.primary}** (${platform.confidence})`);
    if (platform.signals?.length) {
      lines.push(`- Signals:`);
      for (const s of platform.signals) lines.push(`  - ${s}`);
    }
    lines.push("");
  }

  if (dns) {
    lines.push(`## DNS (DoH)`);
    for (const t of ["A", "AAAA", "CNAME", "NS"]) {
      lines.push(`### ${t}`);
      const payload = dns[t];
      if (payload?.Answer?.length) {
        for (const a of payload.Answer.slice(0, 10)) {
          lines.push(`- ${a.name} ${a.type} ${a.data}`);
        }
      } else if (payload?.error) {
        lines.push(`- Error: ${payload.error}`);
      } else {
        lines.push(`- No answers`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
