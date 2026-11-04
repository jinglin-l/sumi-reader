/*
 * Sumi Reader — margin doodles.
 *
 * Port of section 7 of ~/sumi/quartz.js. Hand-drawn doodles fill the empty space below each
 * sidebar (the empty left one, and below the TOC on the right). Each side gets a fixed layer
 * clipped to that space, holding a page-tall track that moves with scroll, so the doodles pass
 * by as if drawn on the page. They alternate sides, zigzag within each side, and cycle through
 * the set on long articles. Hovering one redraws it stroke by stroke (see reader.css).
 *
 * Differences from the shell, and why:
 *  - The shell inlines the SVGs into quartz-data.js at build time. An add-on has no build
 *    step, so we fetch doodles/*.svg from the package at startup instead.
 *  - SVGs are parsed with DOMParser and imported, not assigned via innerHTML. They're our own
 *    files so innerHTML would be safe, but Mozilla's add-on linter flags every innerHTML
 *    assignment, and this keeps the signing review clean.
 */

(async () => {
  const GAP = 260; // vertical distance between consecutive doodles (alternating sides), as in the shell
  // Resolve against this script's location, not the page's, so the test harness in test/
  // finds the same files. currentScript is only set during synchronous execution, so it's
  // read before the first await.
  const dir = new URL("doodles/", document.currentScript.src);
  const order = await (await fetch(new URL("doodles.json", dir))).json();
  const doodles = await Promise.all(
    order.map(async (d) => {
      const text = await (await fetch(new URL(`${d.name}.svg`, dir))).text();
      // Parsed as HTML, not image/svg+xml: the doodle files have no xmlns attribute, so the
      // XML parser would make plain namespace-less elements that never render. The HTML parser
      // puts <svg> in the SVG namespace automatically, exactly like the shell's innerHTML does.
      return { rot: d.rot, svg: new DOMParser().parseFromString(text, "text/html").querySelector("svg") };
    })
  );

  const left = document.getElementById("sr-left");
  const right = document.getElementById("sr-right");
  const sides = [left, right].map((aside) => {
    const track = el("div", "sr-doodle-track");
    const layer = el("div", "sr-doodles");
    layer.setAttribute("aria-hidden", "true");
    layer.append(track);
    document.body.append(layer);
    return { aside, layer, track, top: 0 };
  });

  function scrollDoodles() {
    for (const sd of sides) sd.track.style.transform = `translateY(${-(scrollY + sd.top)}px)`;
  }

  function layoutDoodles() {
    for (const sd of sides) {
      const r = sd.aside.getBoundingClientRect();
      // Free space starts 32px below the lowest visible thing in the sidebar (the TOC box on
      // the right; nothing on the left, so it starts near the top).
      const kids = [...sd.aside.children].filter((k) => k.offsetParent);
      sd.top = Math.max(0, ...kids.map((k) => k.getBoundingClientRect().bottom)) + 32;
      // Under ~140px of room a doodle would just be a sliver, so skip that side. Width 0 means
      // the sidebar is hidden by the narrow-window media query.
      const room = r.width > 0 && innerHeight - sd.top > 140;
      sd.layer.classList.toggle("sr-on", room);
      Object.assign(sd.layer.style, {
        left: `${r.left}px`,
        width: `${r.width}px`,
        top: `${sd.top}px`,
        height: `${Math.max(0, innerHeight - sd.top)}px`,
      });
      sd.track.textContent = "";
    }
    const on = sides.filter((sd) => sd.layer.classList.contains("sr-on"));
    if (on.length) {
      const start = Math.max(...on.map((sd) => sd.top)) + 20;
      const count = Math.max(2, Math.floor((document.documentElement.scrollHeight - start) / GAP));
      for (let i = 0; i < count; i++) {
        const sd = on[i % on.length];
        const d = doodles[i % doodles.length];
        const wrap = el("span", "sr-doodle");
        wrap.append(document.importNode(d.svg, true));
        // Zigzag within the sidebar: every other doodle on a given side hugs its outer edge.
        const outer = Math.floor(i / on.length) % 2 === 0;
        const edge = (sd.aside === left) === outer ? "left" : "right";
        wrap.style.cssText = `--rot:${d.rot}deg;top:${start + i * GAP}px;${edge}:40px`;
        sd.track.append(wrap);
      }
    }
    scrollDoodles();
  }

  addEventListener("scroll", scrollDoodles, { passive: true });
  // Debounced: images loading in, the TOC filling in, and window resizes all change the page
  // height or free space, and they tend to arrive in bursts.
  let timer;
  const relayout = () => {
    clearTimeout(timer);
    timer = setTimeout(layoutDoodles, 100);
  };
  addEventListener("resize", relayout);
  addEventListener("load", relayout);
  new ResizeObserver(relayout).observe(document.getElementById("sr-article"));
  // The sidebar itself is always one window tall; its TOC box is what changes size.
  new ResizeObserver(relayout).observe(right.querySelector(".sr-toc-box"));
  layoutDoodles();

  function el(tag, className) {
    const n = document.createElement(tag);
    n.className = className;
    return n;
  }
})();
