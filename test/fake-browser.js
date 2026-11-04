/*
 * Test double for the WebExtension `browser` API, just enough to run background.js and
 * content.js together in one ordinary tab. Storage persists in localStorage so state survives
 * reloads (like the real storage.local / storage.session). Listeners registered before
 * FAKE.bgDone() count as background.js; later ones as content scripts. tabs.update records
 * the URL instead of navigating, so the test can inspect it.
 */
(() => {
  const load = () => JSON.parse(localStorage.getItem("fake-store") || '{"local":{},"session":{}}');
  const save = (s) => localStorage.setItem("fake-store", JSON.stringify(s));
  const area = (name) => ({
    get: async (k) => {
      const s = load()[name];
      return k in s ? { [k]: s[k] } : {};
    },
    set: async (o) => { const s = load(); Object.assign(s[name], JSON.parse(JSON.stringify(o))); save(s); },
    remove: async (k) => { const s = load(); [].concat(k).forEach((x) => delete s[name][x]); save(s); },
  });
  const bg = [], content = [];
  let bgPhase = true;
  const noop = () => {};
  window.FAKE = {
    bgDone: () => (bgPhase = false),
    log: [],
    contentListeners: content,
  };
  window.browser = {
    runtime: {
      getURL: (p) => `moz-extension://fake/${p}`,
      onMessage: { addListener: (f) => (bgPhase ? bg : content).push(f) },
      sendMessage: async (m) => {
        FAKE.log.push(m.type);
        for (const l of bg) { const r = await l(m, { tab: { id: 1 } }); if (r !== undefined) return r; }
      },
    },
    storage: { local: area("local"), session: area("session") },
    browserAction: {
      setBadgeText: ({ text }) => localStorage.setItem("fake-badge", text),
      setBadgeBackgroundColor: noop, setTitle: noop, onClicked: { addListener: noop },
    },
    tabs: {
      update: async (id, { url }) => localStorage.setItem("fake-navigated", url),
      onRemoved: { addListener: noop },
    },
  };
})();
