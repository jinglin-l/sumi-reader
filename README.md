# sumi reader

firefox add-on that re-renders pages as clean articles in the sumi explainer theme (off-white background, Hanken Grotesk, slate-blue links, margin doodles, table of contents on the right). it's off for every site by default. press q on a page to switch that site on, and every page you open on that site gets re-rendered until you press q again. the toolbar button and alt+shift+r do the same as q. esc or "back to page" shows the original once without switching the site off.

how it works: content.js runs on every page and listens for q. when a site is on, it extracts the article with vendor/Readability.js (mozilla's reader view engine, apache-2.0) via extract.js and sends it to background.js, which keeps the per-site on/off list in storage.local, parks the article in storage.session, and opens reader.html in the same tab. reader.js sanitizes the html to an allowlist (dropping all site styles, colors, and scripts) and renders it with reader.css, a trimmed copy of ~/sumi/quartz.css. doodles.js is a port of the margin doodles from ~/sumi/quartz.js, using the svgs in doodles/.

permissions: storage, plus access to all sites, which is needed so q works on any page. there's no data collection. article images still load from the original site.

test: serve this folder (`python3 -m http.server 8765`). test/flow-test.html runs background.js and content.js together against a low-contrast page with a fake `browser` api (test/fake-browser.js) to check the q/auto-render/skip flow. test/reader-test.html renders an article saved to localStorage as `article`.
