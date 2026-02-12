const hopTemplate = document.getElementById("hopTemplate");
const hopsEl = document.getElementById("hops");
const statusEl = document.getElementById("status");
const copyBtn = document.getElementById("copyBtn");
const journeyEl = document.getElementById("journey");
const cacheSummaryEl = document.getElementById("cacheSummary");

function formatSignals(signals = {}) {
  const keys = Object.keys(signals);
  if (keys.length === 0) return "No cache signals detected";
  return keys.map((k) => `${k}: ${signals[k]}`).join(" | ");
}

function formatHeaders(headers = []) {
  return headers.map((h) => [h.name, h.value]);
}

function renderHop(hop) {
  const node = hopTemplate.content.firstElementChild.cloneNode(true);
  const row = node.querySelector(".hop-row");
  const urlEl = node.querySelector(".url");
  const codeEl = node.querySelector(".code");
  const details = node.querySelector(".details");
  const summary = node.querySelector(".summary");
  const table = node.querySelector(".headers");

  const kind = hop.clientSide ? "client" : hop.redirectType === "server" ? "server" : "final";
  node.classList.add(kind);

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = hop.clientSide
    ? "Client redirect"
    : hop.redirectType === "server"
    ? "Server redirect"
    : "Final response";
  row.appendChild(label);

  urlEl.textContent = hop.redirectUrl || hop.finalUrl || hop.url || "";
  codeEl.textContent = hop.statusCode ? String(hop.statusCode) : hop.clientSide ? "client" : "";

  summary.textContent = formatSignals(hop.cacheSignals);

  const rows = formatHeaders(hop.responseHeaders);
  if (rows.length === 0 && hop.clientSide) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>reason</td><td>${hop.reason || "client-side"}</td>`;
    table.appendChild(tr);
  } else {
    for (const [name, value] of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${name}</td><td>${value}</td>`;
      table.appendChild(tr);
    }
  }

  row.addEventListener("click", () => {
    node.classList.toggle("open");
  });

  return node;
}

function renderJourney(hops) {
  if (!journeyEl) return;
  if (!hops || hops.length === 0) {
    journeyEl.textContent = "No journey captured yet.";
    return;
  }
  const parts = [];
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const url = hop.url || hop.finalUrl || hop.redirectUrl || "";
    const tag = hop.clientSide
      ? "client"
      : hop.redirectType === "server"
      ? "server"
      : "final";
    const status = hop.statusCode ? `${hop.statusCode}` : hop.clientSide ? "client" : "";
    parts.push(
      `<span class="step">${url}</span>` +
        `<span class="pill ${tag}">${status || tag}</span>`
    );
    if (i < hops.length - 1) parts.push(`<span class="arrow">→</span>`);
  }
  journeyEl.innerHTML = parts.join(" ");
}

function extractSignals(hops) {
  const merged = {};
  for (const hop of hops) {
    const signals = hop.cacheSignals || {};
    for (const [k, v] of Object.entries(signals)) {
      if (!merged[k]) merged[k] = v;
    }
  }
  return merged;
}

function renderCacheSummary(hops) {
  if (!cacheSummaryEl) return;
  if (!hops || hops.length === 0) {
    cacheSummaryEl.textContent = "Caching summary will appear after a request is observed.";
    return;
  }

  const signals = extractSignals(hops);
  const keys = Object.keys(signals);
  if (keys.length === 0) {
    cacheSummaryEl.innerHTML =
      "<span class=\"chip\">No cache headers</span> " +
      "I've failed to observe any server-side caching headers on the main HTML response.";
    return;
  }

  const hasCloudflare = Boolean(signals["cf-cache-status"] || signals["cf-ray"]);
  const hasVarnish = Boolean(signals["x-varnish"]) || /varnish/i.test(signals["via"] || "");
  const hasCacheLayer =
    Boolean(signals["x-cache"]) ||
    Boolean(signals["x-cache-hits"]) ||
    Boolean(signals["via"]);

  let headline = "Caching signals detected on the main HTML response.";
  if (hasCloudflare) {
    headline =
      "Page is likely behind Cloudflare edge caching (HTML response).";
  } else if (hasVarnish) {
    headline = "This site shows signs of a Varnish cache for the HTML response.";
  } else if (hasCacheLayer) {
    headline = "This site shows signs of an intermediary cache for the HTML response.";
  }

  const headerList = keys
    .map((k) => `${k}: ${signals[k]}`)
    .join(", ");

  const note =
    "Full-page vs static-asset caching can’t be confirmed from main-frame headers alone.";

  cacheSummaryEl.innerHTML =
    `<span class="chip">Cache summary</span> ${headline} ` +
    `<div class="muted">Evidence: ${headerList}</div>` +
    `<div class="muted">${note}</div>`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadChain() {
  const tab = await getActiveTab();
  if (!tab || tab.id == null) {
    statusEl.textContent = "No active tab";
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "get-chain", tabId: tab.id });
  const chain = response?.chain;
  hopsEl.innerHTML = "";

  if (!chain || chain.hops.length === 0) {
    statusEl.textContent = "No hops captured yet";
    renderJourney([]);
    renderCacheSummary([]);
    return;
  }

  statusEl.textContent = `Hops: ${chain.hops.length}`;
  renderJourney(chain.hops);
  renderCacheSummary(chain.hops);
  for (const hop of chain.hops) {
    hopsEl.appendChild(renderHop(hop));
  }

  copyBtn.onclick = async () => {
    const payload = {
      startedAt: chain.startedAt,
      tabId: chain.tabId,
      hops: chain.hops
    };
    const text = JSON.stringify(payload, null, 2);
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy to Clipboard"), 1000);
  };
}

loadChain();
