/*
 * Sumi Reader — extraction, loaded as a content script on every page.
 *
 * Defines sumiExtract(), which content.js calls when the page should be re-rendered. It shares
 * the content-script scope with vendor/Readability.js (listed before it in the manifest). The
 * returned object is sent to background.js by message, so it must survive structured cloning:
 * plain strings only, no DOM nodes.
 *
 * Readability (the same engine behind Firefox's built-in Reader View) does the hard part:
 * scoring blocks to find the main article and dropping nav, ads, and comments. We add a
 * fallback for pages it gives up on, because the point of this add-on is "make this page
 * legible", and a slightly noisy page is better than an error.
 */
// eslint-disable-next-line no-unused-vars -- called from content.js
function sumiExtract() {
  // Readability mutates the document it is given, so it gets a clone. Cloning keeps the
  // document's URL, which Readability needs to turn relative links/images into absolute ones
  // (they would otherwise resolve against moz-extension:// on the reader page).
  const clone = document.cloneNode(true);

  let article = null;
  try {
    article = new Readability(clone, {
      // Default is 500 characters. Lowered so short-but-real pages (a docs page with one
      // paragraph and a table) still count as articles instead of falling through.
      charThreshold: 200,
      // Keep class names off: the reader page throws away all site styling anyway, and
      // this way stray classes can't match anything in reader.css by accident.
      keepClasses: false,
    }).parse();
  } catch (e) {
    article = null;
  }

  if (!article || !article.content || article.textContent.trim().length < 100) {
    article = fallback();
  }

  return {
    title: article.title || document.title || location.hostname,
    byline: article.byline || "",
    siteName: article.siteName || location.hostname,
    excerpt: article.excerpt || "",
    publishedTime: article.publishedTime || "",
    lang: article.lang || document.documentElement.lang || "",
    dir: article.dir || "",
    content: article.content,
    url: location.href,
  };

  // Fallback for app-like pages (forums, dashboards) where Readability finds no single
  // article: take the whole body minus obvious chrome. Relative URLs are made absolute by
  // hand here, since Readability isn't doing it for us.
  function fallback() {
    const body = document.body.cloneNode(true);
    body
      .querySelectorAll("script, style, noscript, template, nav, header, footer, aside, form, iframe, svg, [hidden], [aria-hidden='true']")
      .forEach((n) => n.remove());
    for (const attr of ["href", "src"]) {
      body.querySelectorAll(`[${attr}]`).forEach((n) => {
        try {
          n.setAttribute(attr, new URL(n.getAttribute(attr), document.baseURI).href);
        } catch (e) {
          n.removeAttribute(attr); // unparseable URL; a dead link beats a broken one
        }
      });
    }
    return {
      title: document.title,
      content: body.innerHTML,
      textContent: body.textContent,
    };
  }
}
