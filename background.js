/*
 * Sumi Reader — background event page.
 *
 * The whole add-on is a three-hop pipeline, and this file is the switchboard:
 *
 *   1. Toolbar click (or Alt+Shift+R) lands here.
 *   2. We inject vendor/Readability.js + extract.js into the active tab. They run against the
 *      live DOM (so JS-rendered content is included) and hand back a plain article object.
 *   3. We park that object in storage.session and navigate the same tab to our own
 *      reader.html, which renders it in the sumi theme.
 *
 * Pressing the button again while on reader.html goes back in history to the original page.
 *
 * Why render in an extension page instead of overlaying the original page:
 *   An overlay lives inside the site's document, so it inherits the site's CSP (which can
 *   block our fonts and injected styles), its global CSS (which leaks into us unless we fight
 *   it with shadow DOM), and its scripts (which can re-style or remove us). reader.html is our
 *   own origin: the bundled fonts always load, nothing from the site can execute there, and
 *   "toggle off" is just the browser's Back, which restores the original from the back-forward
 *   cache in the common case. The trade-off is that an unusual page that can't be bfcached
 *   reloads when you go back.
 */

const READER_URL = browser.runtime.getURL("reader.html");

// storage.session (not local) on purpose: articles can contain private pages you were logged
// into, and session storage lives in memory only and is wiped when Firefox quits. One slot per
// tab, overwritten on each use, so memory stays bounded by the number of open tabs.
const keyFor = (tabId) => `tab-${tabId}`;

browser.browserAction.onClicked.addListener(async (tab) => {
  // Second press on the reader page = toggle off.
  if (tab.url && tab.url.startsWith(READER_URL)) {
    await browser.tabs.goBack(tab.id).catch(() => {});
    return;
  }

  try {
    // Two separate injections because executeScript takes one file. Both share the same
    // content-script sandbox in the tab, so `Readability` defined by the first is visible to
    // the second. Top frame only: articles live there, and iframes are usually ads.
    await browser.tabs.executeScript(tab.id, { file: "vendor/Readability.js" });
    const [article] = await browser.tabs.executeScript(tab.id, { file: "extract.js" });
    if (!article || !article.content) throw new Error("nothing readable found");

    await browser.storage.session.set({ [keyFor(tab.id)]: article });
    await browser.tabs.update(tab.id, { url: `${READER_URL}?tab=${tab.id}` });
    clearBadge(tab.id);
  } catch (err) {
    // Typical failures: privileged pages Firefox won't let any add-on touch (about:*, the
    // add-ons store, the built-in PDF viewer) or a page with no text. Surface it on the button
    // rather than failing silently, since there is no other UI to report through.
    console.warn("sumi-reader:", err);
    browser.browserAction.setBadgeBackgroundColor({ color: "#b0413e", tabId: tab.id });
    browser.browserAction.setBadgeText({ text: "!", tabId: tab.id });
    browser.browserAction.setTitle({
      title: `Sumi Reader can't read this page (${err.message || err})`,
      tabId: tab.id,
    });
  }
});

function clearBadge(tabId) {
  browser.browserAction.setBadgeText({ text: "", tabId });
  browser.browserAction.setTitle({ title: null, tabId });
}

browser.tabs.onRemoved.addListener((tabId) => {
  browser.storage.session.remove(keyFor(tabId));
});
