// transition.js
//
// Gives internal navigation a "single page app" feel: a quick fade
// instead of the browser's plain white flash between pages. Real
// full-page loads still happen (nothing here intercepts your own app
// logic, forms, or socket connections) — this only adds a cosmetic
// cross-fade around them, so every page keeps working exactly as before.
//
// Opt a specific link out with data-no-transition="true".

(function () {
  if (window.__fariusTransitionInstalled) return;
  window.__fariusTransitionInstalled = true;

  var BG = "#f7f7f7";
  var overlay = document.createElement("div");
  overlay.id = "__farius_fade";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:" + BG + ";" +
    "opacity:1;pointer-events:none;transition:opacity .2s ease;";
  (document.body || document.documentElement).appendChild(overlay);

  function mountAndFadeIn() {
    if (!overlay.parentNode) (document.body || document.documentElement).appendChild(overlay);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.style.opacity = "0";
      });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAndFadeIn);
  } else {
    mountAndFadeIn();
  }
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) overlay.style.opacity = "0";
  });

  document.addEventListener(
    "click",
    function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest("a[href]");
      if (!a) return;
      if (a.target && a.target !== "" && a.target !== "_self") return;
      if (a.hasAttribute("download") || a.dataset.noTransition) return;
      var href = a.getAttribute("href");
      if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) return;

      var url;
      try {
        url = new URL(href, window.location.href);
      } catch (err) {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.href.split("#")[0] === window.location.href.split("#")[0]) return;

      e.preventDefault();
      overlay.style.pointerEvents = "auto";
      overlay.style.opacity = "1";
      setTimeout(function () {
        window.location.href = url.href;
      }, 170);
    },
    true
  );
})();
