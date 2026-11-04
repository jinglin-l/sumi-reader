# sumi reader

firefox add-on that re-renders the current page as a clean article in the sumi explainer theme (off-white background, Hanken Grotesk, slate-blue links). press the toolbar button or alt+shift+r to switch, and press it again, press esc, or click "back to page" to return.

how it works: background.js injects vendor/Readability.js (mozilla's reader view engine, apache-2.0) and extract.js into the tab, stores the extracted article in storage.session, and opens reader.html in the same tab. reader.js sanitizes the html to an allowlist (dropping all site styles, colors, and scripts) and renders it with reader.css, a trimmed copy of ~/sumi/quartz.css.

permissions: activeTab and storage. there's no data collection. article images still load from the original site.

test: `python3 -m http.server 8765` here, open test/fixture.html, then see the steps in test/reader-test.html.
