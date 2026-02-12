// src/background.js
// Tracks main_frame request chain per tab, stores latest result for popup retrieval.

const stateByTab = new Map();

/**
 * Normalize header array into lowercased map: { 'cache-control': '...', ... }
 */
function headersToMap(headers = []) {
  const out = {};
  for (const h of headers) {
    if (!h?.name) continue;
    out[h.name.toLowerCase()] = h.value ?? "";
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureTabState(tabId) {
  if (!stateByTab.has(tabId)) {
    stateByTab.set(tabId, {
      tabId,
      startedAt: null,
      updatedAt: null,
      requestId: null,
      chain: [], // [{ url, statusCode, fromCacheHints, location, headers, time, phase }]
      finalUrl: null,
      finalStatus: null,
      errors: []
    });
  }
  return stateByTab.get(tabId);
}

function resetTabState(tabId) {
  stateByTab.set(tabId, {
    tabId,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    requestId: null,
    chain: [],
    finalUrl: null,
    finalStatus: null,
    errors: []
  });
  return stateByTab.get(tabId);
}

function getCacheSummaryFromHeaders(hmap) {
  // Minimal heuristics; you can grow this later.
  const cc = hmap["cache-control"] || "";
  const pragma = hmap["pragma"] || "";
  const age = hmap["age"] || "";
  const expires = hmap["expires"] || "";
  const etag = hmap["etag"] || "";
  const lastMod = hmap["last-modified"] || "";

  // CDN-specific (Cloudflare example) + generic
  const cfCache = hmap["cf-cache-status"] || "";
  const xCache = hmap["x-cache"] || "";
  const xProxyCache = hmap["x-proxy-cache"] || "";

  const blockers = [];
  if (cc.includes("no-store")) blockers.push("Cache-Control: no-store");
  if (cc.includes("private")) blockers.push("Cache-Control: private");
  if (cc.includes("max-age=0")) blockers.push("Cache-Control: max-age=0");
  if (pragma.includes("no-cache")) blockers.push("Pragma: no-cache");
  if (!cc && !expires && !etag && !lastMod) blockers.push("No obvious cache headers");

  // "Cacheable" is a fuzzy best-effort call.
  const cacheable = !(cc.includes("no-store") || cc.includes("private"));

  return {
    cacheable,
    blockers,
    signals: {
      "cache-control": cc,
      pragma,
      age,
      expires,
      etag,
      "last-modified": lastMod,
      "cf-cache-status": cfCache,
      "x-cache": xCache,
      "x-proxy-cache": xProxyCache
    }
  };
}

function pushChainStep(tabId, step) {
  const st = ensureTabState(tabId);
  st.updatedAt = nowIso();
  st.chain.push(step);
  return st;
}

// --- webRequest listeners (main_frame only) ---
// Docs: webRequest usage + permissions. :contentReference[oaicite:6]{index=6}

const filter = { urls: ["<all_urls>"], types: ["main_frame"] };

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // New navigation for a tab.
    const st = resetTabState(details.tabId);
    st.requestId = details.requestId;
    st.finalUrl = null;
    st.finalStatus = null;

    pushChainStep(details.tabId, {
      phase: "request",
      time: nowIso(),
      url: details.url,
      statusCode: null,
      location: null,
      headers: null,
      cache: null
    });
  },
  filter
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const hmap = headersToMap(details.responseHeaders);
    const location = hmap["location"] || null;
    const cache = getCacheSummaryFromHeaders(hmap);

    pushChainStep(details.tabId, {
      phase: "headers",
      time: nowIso(),
      url: details.url,
      statusCode: details.statusCode ?? null,
      location,
      headers: hmap,
      cache
    });
  },
  filter,
  ["responseHeaders"]
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const hmap = headersToMap(details.responseHeaders);
    const location = details.redirectUrl || hmap["location"] || null;
    const cache = getCacheSummaryFromHeaders(hmap);

    pushChainStep(details.tabId, {
      phase: "redirect",
      time: nowIso(),
      url: details.url,
      statusCode: details.statusCode ?? null,
      location,
      headers: hmap,
      cache
    });
  },
  filter,
  ["responseHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const st = ensureTabState(details.tabId);
    st.updatedAt = nowIso();
    st.finalUrl = details.url;
    st.finalStatus = details.statusCode ?? null;

    // Ensure we have a final step even if headers event didn’t land as expected.
    pushChainStep(details.tabId, {
      phase: "completed",
      time: nowIso(),
      url: details.url,
      statusCode: details.statusCode ?? null,
      location: null,
      headers: null,
      cache: null
    });
  },
  filter
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const st = ensureTabState(details.tabId);
    st.updatedAt = nowIso();
    st.errors.push({
      time: nowIso(),
      url: details.url,
      error: details.error
    });
  },
  filter
);

// Clean up when tabs close.
chrome.tabs.onRemoved.addListener((tabId) => {
  stateByTab.delete(tabId);
});

// --- Messaging API for popup/content scripts ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return;

    if (msg.type === "GET_TAB_TRACE") {
      const tabId = msg.tabId;
      const st = stateByTab.get(tabId) || ensureTabState(tabId);
      sendResponse({ ok: true, trace: st });
      return;
    }

    if (msg.type === "RESET_TAB_TRACE") {
      const tabId = msg.tabId;
      const st = resetTabState(tabId);
      sendResponse({ ok: true, trace: st });
      return;
    }

    if (msg.type === "DNS_LOOKUP") {
      // DNS over HTTPS JSON (Cloudflare). :contentReference[oaicite:7]{index=7}
      const { hostname } = msg;
      const records = await dohLookup(hostname);
      sendResponse({ ok: true, hostname, records });
      return;
    }

    if (msg.type === "PLATFORM_DETECTION") {
      // forwarded from content script, just acknowledge
      sendResponse({ ok: true });
      return;
    }
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err) });
  });

  return true; // keep message channel open for async
});

async function dohQuery(name, type) {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "accept": "application/dns-json" }
  });

  if (!res.ok) throw new Error(`DoH failed ${res.status}`);
  return await res.json();
}

async function dohLookup(hostname) {
  const types = ["A", "AAAA", "CNAME", "NS"];
  const out = {};
  for (const t of types) {
    try {
      out[t] = await dohQuery(hostname, t);
    } catch (e) {
      out[t] = { error: String(e) };
    }
  }
  return out;
}
