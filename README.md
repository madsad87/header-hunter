# Redirect Trace (Chrome Extension)

Redirect Trace is a Manifest V3 Chrome extension skeleton for investigating how a page resolves and why it might (or might not) be cached.

## Use case

This project helps developers, SEO specialists, and technical QA answer questions like:

- What redirect chain did this page follow?
- Which status codes were returned at each hop?
- What cache headers/signals are present (`Cache-Control`, `Age`, `CF-Cache-Status`, etc.)?
- What DNS answers are returned for the hostname (via DNS-over-HTTPS)?
- What platform/CMS signals are detectable on the loaded page?

It is useful when debugging:

- Redirect loops or unexpected 3xx behavior
- CDN caching misses and stale content behavior
- Domain cutovers and DNS propagation issues
- Platform fingerprinting during audits or migrations

## Current feature set

- Main-frame network trace collection in the background service worker
  - Request / headers / redirect / completed phases
  - Final URL and final status tracking
  - Error capture
- Cache signal summarization from response headers
- DNS-over-HTTPS lookup (Cloudflare endpoint)
- Content-script based platform detection heuristics
- Popup UI with:
  - Request flow timeline
  - Cache, DNS, and Platform summary cards
  - Headers/Cookies/Export tabs
  - Copy JSON and Markdown report actions

## Project structure

```text
header-hunter/
  manifest.json
  src/
    background.js
    popup.html
    popup.css
    popup.js
    content.js
    detectors.js
```

## How it works (high level)

1. `src/background.js` listens to `chrome.webRequest` events for `main_frame` requests and stores tab-scoped trace state.
2. `src/popup.js` requests trace + DNS data from the background and requests platform data from the content script.
3. `src/content.js` runs in-page heuristics from `src/detectors.js` to identify likely platform signals.
4. The popup renders all collected results and supports export/copy workflows.

## Load locally in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository root (`header-hunter/`).
5. Open any site and click the extension icon to view the popup.

## Permissions overview

- `webRequest`: observe main-frame request/response lifecycle
- `tabs` / `activeTab`: discover and query the active tab
- `storage`: reserved for future persistence
- `scripting`: reserved for future script injection workflows
- Host permissions include `<all_urls>` and `https://cloudflare-dns.com/*` for DoH queries

## Notes

- This is a practical skeleton intended for iteration.
- Platform detection is heuristic and best-effort, not guaranteed.
- DNS responses and cache behavior vary by region, resolver, CDN tier, and timing.
