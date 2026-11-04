/*
 * Sumi Reader — content script on every page (top frame only).
 *
 * Two jobs:
 *   1. Listen for the "q" key. q flips the current site (hostname) on/off. Turning it on
 *      re-renders this page right away; turning it off happens on the reader page (reader.js).
 *   2. When a page on a switched-on site loads, re-render it automatically, so browsing a
 *      site you've turned on stays readable without pressing anything.
 *
 * Why a content script for the key instead of the manifest "commands" API: commands require a
 * modifier (Alt+Shift+R etc.) and Firefox rejects a bare letter. Listening for keydown in the
 * page is the only way to make plain "q" work, and it's why the add-on needs access to all
 * sites. The page is only read when you press q or the site is switched on.
 *
 * Site state lives in background.js; this script asks it rather than reading storage, because
 * the "skip once" flag (see reader.js, Esc / "back to page") is in storage.session, which
 * content scripts can't read.
 */

(() => {
  const html = document.documentElement;

  /* ---------- automatic re-render for switched-on sites ---------- */

  // Runs at document_start. If the site is on, hide the page immediately so its unreadable
  // version doesn't flash before we navigate away, then extract once the page has rendered.
  // CSSOM setProperty is used instead of inserting a <style> because a page's CSP (Content
  // Security Policy) can block injected style elements but not CSSOM writes.
  browser.runtime.sendMessage({ type: "autoCheck", url: location.href }).then((on) => {
    if (!on) return;
    html.style.setProperty("visibility", "hidden", "important");
    // Safety net: never leave a page invisible if something below goes wrong.
    const unhide = setTimeout(show, 5000);
    whenRendered().then(() => render().finally(() => clearTimeout(unhide)));
  });

  // Wait for the page to be built before extracting. JS-heavy sites keep adding content after
  // DOMContentLoaded, so wait for "load", but cap it at 1.5s after DOMContentLoaded so one slow
  // image doesn't keep the page hidden.
  function whenRendered() {
    return new Promise((resolve) => {
      if (document.readyState === "complete") return resolve();
      addEventListener("load", resolve, { once: true });
      const cap = () => setTimeout(resolve, 1500);
      if (document.readyState === "interactive") cap();
      else document.addEventListener("DOMContentLoaded", cap, { once: true });
    });
  }

  function show() {
    html.style.removeProperty("visibility");
  }

  // Extract and hand the article to background.js, which stores it and navigates this tab to
  // reader.html. On failure, show the original page; background puts "!" on the button.
  async function render() {
    let article = null;
    try {
      article = sumiExtract();
    } catch (e) {
      article = null;
    }
    const ok = article && article.content && (await browser.runtime.sendMessage({ type: "show", article }));
    if (!ok) show();
  }

  /* ---------- the q key ---------- */

  // Capture phase on window so a site's own key handlers can't swallow q before we see it.
  addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "q" || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
      if (isTyping(e.target)) return; // q in a search box or comment field is just the letter q
      e.preventDefault();
      e.stopPropagation();
      toggle();
    },
    true
  );

  // On this (original) page, q means "flip the site". If that turned it on, render now. If it
  // turned it off (site was on but you were viewing the original via Esc), there's nothing to undo.
  async function toggle() {
    const on = await browser.runtime.sendMessage({ type: "toggleSite", url: location.href });
    if (on) render();
  }

  // The toolbar button and Alt+Shift+R reach here through background.js, so they behave
  // exactly like q.
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "pressQ") toggle();
  });

  function isTyping(el) {
    // Walk into shadow roots: in web components, e.target is the host, not the real input.
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || !el.tagName) return false;
    return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }
})();
