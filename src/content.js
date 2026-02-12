// src/content.js
import { detectPlatform } from "./detectors.js";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_PLATFORM") {
    const platform = detectPlatform(document);
    sendResponse({ ok: true, platform });
    return;
  }
});
