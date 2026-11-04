/*
 * Sumi Reader — background event page.
 *
 * Owns two pieces of state and the hop between the original page and the reader:
 *
 *   sites (storage.local)   { "example.com": true, ... }  Which sites are switched on.
 *                           Absent = off, so every site starts off after install. Kept in
 *                           local storage so it survives restarts ("remembered per site").
 *   tab-<id> (session)      The extracted article for that tab, read by reader.html.
 *   skip-<id> (session)     "Show the original once": set when you leave the reader with Esc
 *                           or "back to page" without switching the site off, so the original
 *                           doesn't immediately re-render itself and trap you in the reader.
 *
 * Flow for q on a normal page: content.js asks toggleSite → we flip the site → if now on,
 * content.js extracts the article and sends "show" → we store it and navigate the tab to
 * reader.html. q on the reader page (reader.js) flips the site off and goes back.
 *
 * Why render in an extension page instead of overlaying the original page:
 *   An overlay lives inside the site's document, so it inherits the site's CSP (which can
 *   block our fonts), its global CSS (which leaks into us), and its scripts (which can restyle
 *   or remove us). reader.html is our own origin: the bundled fonts always load and nothing
 *   from the site can run there. Going back to the original is the browser's Back, which
 *   restores it from the back-forward cache in the common case.
 */

const READER_URL = browser.runtime.getURL("reader.html");
const SKIP_TTL_MS = 10000; // see "skip" below

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
};

async function isOn(host) {
  const { sites = {} } = await browser.storage.local.get("sites");
  return !!sites[host];
}

async function setOn(host, on) {
  const { sites = {} } = await browser.storage.local.get("sites");
  // Delete rather than store false, so the list only ever holds sites you've switched on.
  if (on) sites[host] = true;
  else delete sites[host];
  await browser.storage.local.set({ sites });
}

// Toolbar badge: "on" while the current tab's site is switched on, "!" when a page can't be read.
function badge(tabId, text, color = "#284b63", title = null) {
  browser.browserAction.setBadgeBackgroundColor({ color, tabId });
  browser.browserAction.setBadgeText({ text, tabId });
  browser.browserAction.setTitle({ title, tabId });
}

browser.runtime.onMessage.addListener(async (msg, sender) => {
  // reader.js passes tabId itself: it's an extension page, and sender.tab isn't something to
  // rely on for those. Content scripts always have sender.tab.
  const tabId = msg.tabId != null ? Number(msg.tabId) : sender.tab && sender.tab.id;
  const host = hostOf(msg.url || "");

  switch (msg.type) {
    // A page just started loading: should it re-render itself?
    case "autoCheck": {
      const on = await isOn(host);
      badge(tabId, on ? "on" : "");
      if (!on) return false;
      // Skip once if the user just left the reader for this exact URL. The flag carries a
      // timestamp because if the original came back from the back-forward cache, this check
      // never runs and the flag would otherwise linger and wrongly skip a later visit.
      const key = `skip-${tabId}`;
      const { [key]: skip } = await browser.storage.session.get(key);
      await browser.storage.session.remove(key);
      if (skip && skip.url === msg.url && Date.now() - skip.at < SKIP_TTL_MS) return false;
      return true;
    }

    // q pressed (on the original page, or on the reader page with the article's URL).
    case "toggleSite": {
      const on = !(await isOn(host));
      await setOn(host, on);
      badge(tabId, on ? "on" : "");
      return on;
    }

    // content.js extracted an article: park it and switch the tab to the reader.
    case "show": {
      await browser.storage.session.set({ [`tab-${tabId}`]: msg.article });
      await browser.tabs.update(tabId, { url: `${READER_URL}?tab=${tabId}` });
      return true;
    }

    // reader.js just opened: refresh the badge (navigating the tab may have reset it).
    case "readerOpened": {
      badge(tabId, (await isOn(host)) ? "on" : "");
      return true;
    }

    // reader.js: user is leaving with Esc / "back to page" but the site stays on.
    case "skipOnce": {
      await browser.storage.session.set({ [`skip-${tabId}`]: { url: msg.url, at: Date.now() } });
      return true;
    }
  }
  return undefined;
});

// Toolbar button and Alt+Shift+R behave exactly like pressing q in the page.
browser.browserAction.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.startsWith(READER_URL)) {
    // tabs.sendMessage only reaches content scripts, and reader.html is an extension page, so
    // broadcast with runtime.sendMessage instead; reader.js ignores it unless tabId is its own.
    browser.runtime.sendMessage({ type: "pressQ", tabId: tab.id }).catch(() => {});
    return;
  }
  try {
    await browser.tabs.sendMessage(tab.id, { type: "pressQ" });
  } catch (err) {
    // No content script answered: a privileged page Firefox won't let add-ons touch
    // (about:*, the add-ons store, the PDF viewer), or a tab opened before the add-on was
    // installed (reloading it fixes that).
    badge(tab.id, "!", "#b0413e", "Sumi Reader can't run on this page (try reloading it)");
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  browser.storage.session.remove([`tab-${tabId}`, `skip-${tabId}`]);
});
