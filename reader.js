/*
 * Sumi Reader — renders the parked article into reader.html.
 *
 * Steps: fetch the article object background.js stored for this tab, sanitize its HTML down
 * to an allowlist, drop it into the page, then add the small explainer-shell touches (meta
 * line, Copy buttons on code, scrollable tables, table of contents).
 *
 * Security note on the sanitizer. The article HTML comes from an arbitrary website and is
 * being shown on a moz-extension:// page, which has more privileges than the site did. The
 * extension CSP (Content Security Policy: script-src 'self') already refuses inline scripts
 * and on* handlers, so script execution is blocked even without us. We sanitize anyway, as a
 * second wall, and for the main feature: stripping every style/class/color/font attribute is
 * what removes the site's unreadable colours. An allowlist (keep only known-safe tags and
 * attributes) is used instead of a blocklist because a blocklist breaks the moment a site uses
 * an element we didn't think of.
 */

(async () => {
  const tabId = new URLSearchParams(location.search).get("tab");
  const key = `tab-${tabId}`;
  const stored = await browser.storage.session.get(key);
  const article = stored[key];

  wireLeaving(article, tabId);

  if (!article) {
    // storage.session is memory-only, so this happens after a Firefox restart restores the tab.
    document.getElementById("sr-title").textContent = "Nothing to show";
    document.getElementById("sr-content").innerHTML =
      '<p class="sr-error">The saved article is gone (Firefox was probably restarted). Go back and press q again.</p>';
    document.getElementById("sr-right").classList.add("sr-empty");
    return;
  }

  document.title = article.title;
  if (article.lang) document.documentElement.lang = article.lang;
  if (article.dir) document.documentElement.dir = article.dir;

  const site = document.getElementById("sr-site");
  site.textContent = article.siteName;
  site.href = article.url;

  document.getElementById("sr-title").textContent = article.title;

  const content = document.getElementById("sr-content");
  content.append(sanitize(article.content, article.url));
  dropDuplicateTitle(content, article.title);
  wrapTables(content);
  addCopyButtons(content);

  document.getElementById("sr-meta").textContent = metaLine(article, content);
  buildToc(content);
})();

/* ---------------------------------------------------------------- sanitizer */

// Structural and inline-text tags worth keeping. Anything else is unwrapped (children kept,
// tag dropped) unless it's in DROP, which removes the element and everything inside it.
const KEEP = new Set(
  ("a abbr b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt " +
    "em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p picture pre q rp rt " +
    "ruby s samp section small source span strong sub summary sup table tbody td tfoot th thead " +
    "time tr u ul var video article aside header footer main").split(" ")
);
const DROP = new Set(
  ("script style link meta noscript template iframe frame frameset object embed applet form " +
    "input button select textarea option base svg math canvas dialog").split(" ")
);
// Attributes allowed per tag ("*" = any kept tag). No style, class, color, bgcolor, face,
// width/height on text, or event handlers: those are exactly what we're throwing away.
const ATTRS = {
  "*": ["id", "title", "lang", "dir"],
  a: ["href"],
  img: ["src", "srcset", "alt", "width", "height"],
  source: ["src", "srcset", "type", "media"],
  video: ["src", "poster", "controls"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start", "reversed", "type"],
  time: ["datetime"],
  abbr: ["title"],
  details: ["open"],
};
const URL_ATTRS = new Set(["href", "src", "poster"]);
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function sanitize(html, baseUrl) {
  // DOMParser produces an inert document: nothing in it loads or runs while we walk it.
  const doc = new DOMParser().parseFromString(html, "text/html");
  clean(doc.body, baseUrl);
  const frag = document.createDocumentFragment();
  frag.append(...doc.body.childNodes);
  return frag;
}

function clean(node, baseUrl) {
  // Snapshot children first: unwrapping/removing mutates the live childNodes list.
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.localName;
    if (DROP.has(tag)) {
      child.remove();
      continue;
    }
    clean(child, baseUrl); // depth-first, so unwrapped children are already clean
    if (!KEEP.has(tag)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    scrubAttributes(child, tag, baseUrl);
  }
}

function scrubAttributes(el, tag, baseUrl) {
  const allowed = new Set([...ATTRS["*"], ...(ATTRS[tag] || [])]);
  for (const { name, value } of [...el.attributes]) {
    if (!allowed.has(name)) {
      el.removeAttribute(name);
    } else if (URL_ATTRS.has(name)) {
      const safe = safeUrl(value, baseUrl, name === "href");
      if (safe === null) el.removeAttribute(name);
      else el.setAttribute(name, safe);
    } else if (name === "srcset") {
      // "url 2x, url 640w" — resolve each URL like src; drop the whole attribute if any
      // candidate is unsafe (the plain src is still there as a fallback).
      const parts = value.split(",").map((part) => {
        const [u, ...descriptor] = part.trim().split(/\s+/);
        const safe = u ? safeUrl(u, baseUrl, false) : null;
        return safe === null ? null : [safe, ...descriptor].join(" ");
      });
      if (parts.includes(null)) el.removeAttribute(name);
      else el.setAttribute(name, parts.join(", "));
    } else if (name === "id") {
      // Prefix ids so the article can't collide with the reader's own sr-* elements;
      // in-page #fragment links are rewritten to match in safeUrl().
      el.setAttribute("id", `a-${value}`);
    }
  }
  // Links open the real site in this tab, like a normal page. noreferrer for the same reason
  // as the <meta name="referrer"> in reader.html.
  if (tag === "a" && el.hasAttribute("href")) el.setAttribute("rel", "noreferrer");
}

// Returns an absolute, safe URL string, or null to drop the attribute. Links pointing back at
// a #fragment of the original page become local #a-fragment links so in-article footnotes and
// "jump to section" links keep working.
function safeUrl(value, baseUrl, isLink) {
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch (e) {
    return null;
  }
  const base = new URL(baseUrl);
  if (isLink && url.hash && url.origin === base.origin && url.pathname === base.pathname && url.search === base.search) {
    return `#a-${decodeURIComponent(url.hash.slice(1))}`;
  }
  // Images may legitimately be data: URLs (inline thumbnails); links may not.
  if (!isLink && url.protocol === "data:" && /^data:image\//i.test(value)) return value;
  return SAFE_SCHEMES.has(url.protocol) ? url.href : null;
}

/* ---------------------------------------------------------------- explainer-shell touches */

// Readability often keeps the article's own <h1>, which would repeat the title block.
function dropDuplicateTitle(root, title) {
  const first = root.querySelector("h1, h2");
  if (first && normalize(first.textContent) === normalize(title)) first.remove();
}
const normalize = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

function wrapTables(root) {
  for (const table of root.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "sr-table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }
}

function addCopyButtons(root) {
  for (const pre of root.querySelectorAll("pre")) {
    const btn = document.createElement("button");
    btn.className = "sr-copy";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      // Copy the code text, not the button's own label.
      const text = [...pre.childNodes].filter((n) => n !== btn).map((n) => n.textContent).join("");
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    });
    pre.append(btn);
  }
}

// "site · byline · date · N min read", skipping anything missing. 200 wpm matches the
// reading-time estimate in the explainer shell.
function metaLine(article, root) {
  const words = (root.textContent.match(/\S+/g) || []).length;
  const minutes = Math.max(1, Math.round(words / 200));
  let date = "";
  if (article.publishedTime) {
    const d = new Date(article.publishedTime);
    if (!isNaN(d)) date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  return [article.byline, date, `${minutes} min read`].filter(Boolean).join(" · ");
}

// Right-hand TOC from h2/h3, with the section currently on screen highlighted. Hidden when an
// article has fewer than two headings, since a one-line TOC is just noise.
function buildToc(root) {
  const heads = [...root.querySelectorAll("h2, h3")].filter((h) => h.textContent.trim());
  const aside = document.getElementById("sr-right");
  if (heads.length < 2) {
    aside.classList.add("sr-empty");
    return;
  }
  const list = document.getElementById("sr-toc");
  const links = new Map();
  heads.forEach((h, i) => {
    if (!h.id) h.id = `sr-h-${i}`;
    const li = document.createElement("li");
    li.className = h.localName === "h3" ? "sr-l3" : "sr-l2";
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.textContent = h.textContent.trim();
    li.append(a);
    list.append(li);
    links.set(h, a);
  });

  // Highlight the last heading that has scrolled past the top third of the window. Tracking
  // visibility per heading with IntersectionObserver alone flickers between sections whose
  // headings are both off screen, so the observer just triggers this recompute.
  const update = () => {
    let current = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top < window.innerHeight / 3) current = h;
    for (const [h, a] of links) a.classList.toggle("sr-inview", h === current);
  };
  const io = new IntersectionObserver(update, { rootMargin: "0px 0px -66% 0px" });
  heads.forEach((h) => io.observe(h));
  update();
}

/* ---------------------------------------------------------------- leaving */

// Two ways out, matching the per-site on/off model in background.js:
//   q (or the toolbar button)  switch this site off, then go back to the original.
//   Esc / "back to page"       peek at the original once; the site stays on, so the next page
//                              you open on it re-renders again. background.js gets a
//                              "skip once" note first, otherwise the original would
//                              re-render itself the moment it loads.
// Both use history.back(), which restores the original from the back-forward cache instead of
// reloading it when it can.
function wireLeaving(article, tabId) {
  const url = article ? article.url : "";

  if (article) browser.runtime.sendMessage({ type: "readerOpened", tabId, url });

  const peek = async (e) => {
    if (e) e.preventDefault();
    if (article) await browser.runtime.sendMessage({ type: "skipOnce", tabId, url });
    history.back();
  };

  const switchOff = async () => {
    if (!article) return history.back();
    const on = await browser.runtime.sendMessage({ type: "toggleSite", tabId, url });
    // toggleSite flips the state. If the site was somehow already off (switched off from
    // another tab), it just got switched back on; flip again so q always means "off" here.
    if (on) await browser.runtime.sendMessage({ type: "toggleSite", tabId, url });
    history.back();
  };

  document.getElementById("sr-back").addEventListener("click", peek);
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === "Escape") peek(e);
    else if (e.key === "q") switchOff();
  });

  // Toolbar button / Alt+Shift+R, broadcast by background.js. Every extension page hears every
  // runtime message (including content scripts' autoCheck), so filter by type and tab, and
  // return nothing: returning a value would answer messages meant for background.js.
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "pressQ" && String(msg.tabId) === String(tabId)) switchOff();
  });
}
