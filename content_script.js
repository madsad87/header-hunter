(function () {
  const lastHref = { value: location.href };

  function notify(reason, toUrl) {
    chrome.runtime.sendMessage({
      type: "client-side-redirect",
      reason,
      from: lastHref.value,
      to: toUrl || location.href
    });
    lastHref.value = toUrl || location.href;
  }

  function checkMetaRefresh() {
    const meta = document.querySelector("meta[http-equiv='refresh']");
    if (!meta) return;
    const content = meta.getAttribute("content") || "";
    const match = content.match(/url=([^;]+)/i);
    if (match && match[1]) {
      const target = match[1].trim().replace(/^['"]|['"]$/g, "");
      notify("meta-refresh", new URL(target, location.href).href);
    }
  }

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function (...args) {
    const ret = origPush.apply(this, args);
    notify("history.pushState", location.href);
    return ret;
  };

  history.replaceState = function (...args) {
    const ret = origReplace.apply(this, args);
    notify("history.replaceState", location.href);
    return ret;
  };

  let hrefTimer = null;
  function startHrefWatch() {
    hrefTimer = setInterval(() => {
      if (location.href !== lastHref.value) {
        notify("location-change", location.href);
      }
    }, 500);
  }

  window.addEventListener("DOMContentLoaded", checkMetaRefresh, { once: true });
  startHrefWatch();
})();
