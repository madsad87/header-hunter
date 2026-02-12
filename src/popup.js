// src/popup.js
import { detectColorForStatus, toMarkdownReport } from "./detectors.js";

let activeTabId = null;
let latest = null;
let latestPlatform = null;
let latestDns = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function renderFlow(trace) {
  const list = document.getElementById("flowList");
  list.innerHTML = "";

  const steps = trace.chain || [];
  const compact = compressSteps(steps);

  for (const s of compact) {
    const div = document.createElement("div");
    div.className = "flowItem";

    const code = s.statusCode ?? "—";
    const url = s.url ?? "—";

    const location = s.location ? `→ ${s.location}` : "";
    const controllerHint = ""; // placeholder for your future classifier

    div.innerHTML = `
      <div class="flowTop">
        <div class="flowUrl" title="${escapeHtml(url)}">${escapeHtml(url)}</div>
        <div class="flowCode">${escapeHtml(String(code))}</div>
      </div>
      <div class="flowSub">
        ${escapeHtml(location)} ${escapeHtml(controllerHint)}
      </div>
    `;
    list.appendChild(div);
  }

  setText("hopCount", `${countRedirects(compact)} hops`);
}

function compressSteps(steps) {
  // Keep "headers/redirect/completed" events, skip the raw "request" step.
  // Also de-dupe consecutive same-url phases.
  const out = [];
  for (const s of steps) {
    if (s.phase === "request") continue;
    const last = out[out.length - 1];
    if (last && last.url === s.url && last.phase === s.phase) continue;
    out.push(s);
  }
  return out;
}

function countRedirects(steps) {
  return steps.filter(s => s.phase === "redirect").length;
}

function renderSummary(trace) {
  const status = trace.finalStatus ?? (trace.chain?.findLast?.(x => x.statusCode)?.statusCode) ?? "—";
  const url = trace.finalUrl ?? trace.chain?.[trace.chain.length - 1]?.url ?? "—";

  setText("url", url);

  const pill = document.getElementById("statusPill");
  pill.textContent = status === "—" ? "—" : `${status}`;
  pill.style.borderColor = detectColorForStatus(status);

  setText("totalTime", trace.startedAt ? `since ${new Date(trace.startedAt).toLocaleTimeString()}` : "—");
}

function renderCache(trace) {
  // Use the last step that has cache info
  const step = [...(trace.chain || [])].reverse().find(s => s.cache);
  if (!step?.cache) {
    setText("cacheCard", "—");
    return;
  }
  const c = step.cache;
  const lines = [
    `Cacheable: ${c.cacheable ? "Yes" : "No"}`,
    c.signals["cf-cache-status"] ? `CF-Cache-Status: ${c.signals["cf-cache-status"]}` : null,
    c.signals["x-cache"] ? `X-Cache: ${c.signals["x-cache"]}` : null,
    c.signals.age ? `Age: ${c.signals.age}` : null,
    c.signals["cache-control"] ? `Cache-Control: ${c.signals["cache-control"]}` : null,
    c.blockers?.length ? `Notes: ${c.blockers.join(" | ")}` : null
  ].filter(Boolean);

  setText("cacheCard", lines.join("\n"));
  setText("headersView", JSON.stringify(step.headers || {}, null, 2));
}

function renderDns(dns) {
  if (!dns) {
    setText("dnsCard", "—");
    return;
  }

  const summarize = (payload) => {
    if (!payload || payload.error) return payload?.error ? `Error: ${payload.error}` : "—";
    const ans = payload.Answer || [];
    if (!ans.length) return "No answers";
    return ans.slice(0, 6).map(a => `${a.name} ${a.type} ${a.data}`).join("\n");
  };

  const lines = [
    "A:\n" + summarize(dns.A),
    "\nAAAA:\n" + summarize(dns.AAAA),
    "\nCNAME:\n" + summarize(dns.CNAME),
    "\nNS:\n" + summarize(dns.NS)
  ];

  setText("dnsCard", lines.join("\n"));
}

function renderPlatform(platform) {
  if (!platform) {
    setText("platformCard", "—");
    return;
  }
  setText(
    "platformCard",
    `${platform.primary} (${platform.confidence})\nSignals:\n- ${platform.signals.join("\n- ")}`
  );
}

async function refreshAll() {
  const tab = await getActiveTab();
  activeTabId = tab.id;

  setText("host", new URL(tab.url).hostname);
  setText("url", tab.url);

  // Get trace from background
  const traceRes = await chrome.runtime.sendMessage({ type: "GET_TAB_TRACE", tabId: activeTabId });
  latest = traceRes?.trace || null;
  if (latest) {
    renderSummary(latest);
    renderFlow(latest);
    renderCache(latest);
  }

  // Ask content script for platform detection (runs in page)
  const platform = await chrome.tabs.sendMessage(activeTabId, { type: "GET_PLATFORM" }).catch(() => null);
  latestPlatform = platform?.platform || null;
  renderPlatform(latestPlatform);

  // DNS lookup (DoH) for hostname
  const hostname = new URL(tab.url).hostname;
  const dnsRes = await chrome.runtime.sendMessage({ type: "DNS_LOOKUP", hostname }).catch(() => null);
  latestDns = dnsRes?.records || null;
  renderDns(latestDns);

  // Export panel
  document.getElementById("exportView").textContent = JSON.stringify({ trace: latest, dns: latestDns, platform: latestPlatform }, null, 2);
}

function wireTabs() {
  const buttons = document.querySelectorAll(".tab");
  for (const b of buttons) {
    b.addEventListener("click", () => {
      for (const x of buttons) x.classList.remove("active");
      b.classList.add("active");
      const name = b.dataset.tab;

      document.querySelectorAll(".tabpanel").forEach(p => p.classList.remove("active"));
      document.getElementById(`tab-${name}`).classList.add("active");
    });
  }
}

function wireButtons() {
  document.getElementById("btnRefresh").addEventListener("click", refreshAll);

  document.getElementById("btnCopy").addEventListener("click", async () => {
    const payload = { trace: latest, dns: latestDns, platform: latestPlatform };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  });

  document.getElementById("btnCopyJson").addEventListener("click", async () => {
    const payload = { trace: latest, dns: latestDns, platform: latestPlatform };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  });

  document.getElementById("btnCopyMarkdown").addEventListener("click", async () => {
    const md = toMarkdownReport({ trace: latest, dns: latestDns, platform: latestPlatform });
    await navigator.clipboard.writeText(md);
  });
}

function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

wireTabs();
wireButtons();
refreshAll();
