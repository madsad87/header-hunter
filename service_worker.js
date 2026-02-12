const chainsByTab = new Map();
const reqIndexByTab = new Map();

const MAX_CHAINS_PER_TAB = 5;
const MAX_HOPS_PER_CHAIN = 50;
const PERSIST_KEY = "recentChains";

function now() {
  return Date.now();
}

function ensureTab(tabId) {
  if (!chainsByTab.has(tabId)) {
    chainsByTab.set(tabId, []);
    reqIndexByTab.set(tabId, new Map());
  }
}

function currentChain(tabId) {
  ensureTab(tabId);
  const chains = chainsByTab.get(tabId);
  if (chains.length === 0) {
    chains.push({
      startedAt: now(),
      tabId,
      hops: [],
      notes: []
    });
  }
  return chains[0];
}

function startNewChain(tabId, reason) {
  ensureTab(tabId);
  const chains = chainsByTab.get(tabId);
  if (chains.length > 0 && chains[0].hops.length === 0) {
    chains[0].notes.push({ ts: now(), type: "info", message: reason });
    return;
  }
  chains.unshift({
    startedAt: now(),
    tabId,
    hops: [],
    notes: [{ ts: now(), type: "info", message: reason }]
  });
  if (chains.length > MAX_CHAINS_PER_TAB) chains.length = MAX_CHAINS_PER_TAB;
  reqIndexByTab.set(tabId, new Map());
}

function normalizeHeaders(headers = []) {
  return headers.map((h) => ({
    name: String(h.name || "").toLowerCase(),
    value: h.value != null ? String(h.value) : ""
  }));
}

function collectCacheSignals(headers) {
  const want = new Set([
    "cf-cache-status",
    "cf-ray",
    "x-cache",
    "x-cache-hits",
    "x-varnish",
    "via",
    "server",
    "cache-control",
    "age",
    "expires",
    "pragma",
    "vary",
    "etag",
    "last-modified"
  ]);
  const signals = {};
  for (const h of headers) {
    if (want.has(h.name)) signals[h.name] = h.value;
  }
  return signals;
}

function findLocation(headers) {
  const loc = headers.find((h) => h.name === "location");
  return loc ? loc.value : "";
}

function registerHop(tabId, requestId, init) {
  const chain = currentChain(tabId);
  const hop = {
    ts: now(),
    tabId,
    requestId,
    url: init.url,
    method: init.method,
    type: init.type,
    statusCode: null,
    redirectUrl: "",
    finalUrl: "",
    responseHeaders: [],
    redirectType: "final",
    cacheSignals: {},
    clientSide: false
  };
  chain.hops.push(hop);
  if (chain.hops.length > MAX_HOPS_PER_CHAIN) chain.hops.shift();
  reqIndexByTab.get(tabId).set(requestId, hop);
  return hop;
}

function getHop(tabId, requestId) {
  ensureTab(tabId);
  return reqIndexByTab.get(tabId).get(requestId);
}

function setResponseData(hop, details) {
  const headers = normalizeHeaders(details.responseHeaders || []);
  hop.responseHeaders = headers;
  hop.statusCode = details.statusCode || null;
  hop.cacheSignals = collectCacheSignals(headers);
  if (details.statusCode >= 300 && details.statusCode < 400) {
    hop.redirectType = "server";
    hop.redirectUrl = details.redirectUrl || findLocation(headers) || "";
  } else {
    hop.redirectType = "final";
  }
}

function markFinalUrl(tabId, requestId, finalUrl) {
  const hop = getHop(tabId, requestId);
  if (hop) hop.finalUrl = finalUrl || hop.url;
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.type !== "main_frame" || details.tabId < 0) return;
    ensureTab(details.tabId);
    currentChain(details.tabId);
    registerHop(details.tabId, details.requestId, details);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== "main_frame" || details.tabId < 0) return;
    const hop = getHop(details.tabId, details.requestId);
    if (!hop) return;
    setResponseData(hop, details);
    if (hop.redirectType === "server" && hop.statusCode) {
      chrome.action.setBadgeText({ tabId: details.tabId, text: String(hop.statusCode) });
      chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#F39C12" });
    } else if (hop.statusCode && hop.statusCode < 400) {
      chrome.action.setBadgeText({ tabId: details.tabId, text: "" });
    }
    persistRecent(details.tabId);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.type !== "main_frame" || details.tabId < 0) return;
    const hop = getHop(details.tabId, details.requestId);
    if (!hop) return;
    setResponseData(hop, details);
    hop.redirectUrl = details.redirectUrl || hop.redirectUrl || "";
    if (hop.statusCode) {
      chrome.action.setBadgeText({ tabId: details.tabId, text: String(hop.statusCode) });
      chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#F39C12" });
    }
    persistRecent(details.tabId);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.type !== "main_frame" || details.tabId < 0) return;
    markFinalUrl(details.tabId, details.requestId, details.url);
    chrome.action.setBadgeText({ tabId: details.tabId, text: "" });
    persistRecent(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.type !== "main_frame" || details.tabId < 0) return;
    const hop = getHop(details.tabId, details.requestId);
    if (hop) {
      hop.error = details.error;
      hop.finalUrl = details.url || hop.url;
    }
    persistRecent(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  startNewChain(details.tabId, `committed (${details.transitionType})`);
  chrome.action.setBadgeText({ tabId: details.tabId, text: "" });
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const chain = currentChain(details.tabId);
  chain.notes.push({
    ts: now(),
    type: "history",
    message: `history ${details.transitionType} ${details.url}`
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  const tabId = msg.tabId ?? sender.tab?.id;
  if (tabId == null) return;

  if (msg.type === "client-side-redirect") {
    const chain = currentChain(tabId);
    chain.hops.push({
      ts: now(),
      tabId,
      requestId: `client-${now()}`,
      url: msg.from || sender.tab.url || "",
      method: "GET",
      type: "main_frame",
      statusCode: null,
      redirectUrl: msg.to || "",
      finalUrl: msg.to || "",
      responseHeaders: [],
      redirectType: "client",
      cacheSignals: {},
      clientSide: true,
      reason: msg.reason || ""
    });
    if (chain.hops.length > MAX_HOPS_PER_CHAIN) chain.hops.shift();
    persistRecent(tabId);
    sendResponse({ ok: true });
  } else if (msg.type === "get-chain") {
    ensureTab(tabId);
    const current = chainsByTab.get(tabId)[0];
    if (current && current.hops.length > 0) {
      sendResponse({ chain: current });
      return;
    }
    chrome.storage.local.get(PERSIST_KEY).then((data) => {
      const all = data[PERSIST_KEY] || {};
      const stored = all[String(tabId)]?.[0];
      if (stored) {
        chainsByTab.set(tabId, [stored]);
      }
      sendResponse({
        chain: stored || { startedAt: now(), tabId, hops: [], notes: [] }
      });
    });
    return true;
  }
});

async function persistRecent(tabId) {
  ensureTab(tabId);
  const chains = chainsByTab.get(tabId);
  const toStore = chains.slice(0, 1);
  const all = (await chrome.storage.local.get(PERSIST_KEY))[PERSIST_KEY] || {};
  all[String(tabId)] = toStore;
  await chrome.storage.local.set({ [PERSIST_KEY]: all });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chainsByTab.delete(tabId);
  reqIndexByTab.delete(tabId);
});
