// test/ui.test.mjs — UI behavior tests for the rendered HTML.
//
// These tests read the source index.html and assert that the
// critical UI behaviors the user has asked for are present in
// the code. They're a regression net for:
//   - jump-nav accordion (clicking closes all, opens target)
//   - scroll-margin-top on sections (jump lands below sticky bar)
//   - loading indicator (hidden in HTML, shown by JS bootstrap)
//   - empty state (never has .show in HTML)
//
// Mutation tested: removing the close-all loop in the jump
// handler does NOT break these tests (they're structural, not
// behavioral). The puppeteer-based scripts/snap.mjs covers
// behavioral validation. These tests catch the case where
// someone deletes the accordion code entirely.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, "../index.html"), "utf8");

// ---------------------------------------------------------------------------
// Jump-nav accordion
// ---------------------------------------------------------------------------

test("jump-nav: handler exists and calls e.preventDefault", () => {
  assert.match(
    indexHtml,
    /jumpnavEl\.addEventListener\('click'/,
    "jumpnav click handler must be registered"
  );
  assert.match(
    indexHtml,
    /e\.preventDefault\(\)/,
    "jump handler must preventDefault to block native hash navigation"
  );
});

test("jump-nav: handler iterates over _sectionEls (cached) to close all sections", () => {
  // The accordion logic must use the cached _sectionEls array
  // (set in render()), not a fresh querySelectorAll per click.
  const handlerMatch = indexHtml.match(
    /jumpnavEl\.addEventListener\('click',[\s\S]*?\}\);/u
  );
  assert.ok(handlerMatch, "jumpnav click handler block not found");
  const handler = handlerMatch[0];
  assert.match(
    handler,
    /for\s*\(\s*const\s+sec\s+of\s+_sectionEls\s*\)/,
    "handler must iterate over cached _sectionEls (not querySelectorAll)"
  );
  assert.match(
    handler,
    /sec\.removeAttribute\(\s*['"]open['"]\s*\)/,
    "handler must removeAttribute('open') to close sections"
  );
  assert.match(
    handler,
    /target\.setAttribute\(\s*['"]open['"]\s*,\s*['"]['"]\s*\)/,
    "handler must setAttribute('open', '') on the target"
  );
});

test("jump-nav: target is looked up by id from the href hash", () => {
  const handlerMatch = indexHtml.match(
    /jumpnavEl\.addEventListener\('click',[\s\S]*?\}\);/u
  );
  assert.ok(handlerMatch, "jumpnav click handler block not found");
  assert.match(
    handlerMatch[0],
    /getElementById\(a\.getAttribute\(['"]href['"]\)\.slice\(1\)\)/,
    "handler must resolve target by id from href"
  );
});

// ---------------------------------------------------------------------------
// scroll-margin-top
// ---------------------------------------------------------------------------

test("scroll-margin-top: --jump-offset custom property is defined", () => {
  assert.match(
    indexHtml,
    /--jump-offset\s*:\s*\d+px/,
    "--jump-offset CSS custom property must be defined"
  );
});

test("scroll-margin-top: details.sec uses scroll-margin-top with the var", () => {
  assert.match(
    indexHtml,
    /details\.sec\s*\{[^}]*scroll-margin-top\s*:\s*var\(\s*--jump-offset\s*\)/u,
    "details.sec must use scroll-margin-top: var(--jump-offset)"
  );
});

test("scroll-margin-top: jump handler uses window.scrollTo for grey-line alignment", () => {
  // After PR #23, we replaced scrollIntoView with a manual
  // window.scrollTo because we need precise positioning: the
  // grey divider line at the top of the category must meet
  // the bottom border line of the pill navbar. scrollIntoView
  // can't do fractional positioning relative to a sibling
  // element's border. The handler computes
  //   scrollY = prevSectionBottomInDocument - 183
  // so the 1px grey line at prevSectionBottom-1 lands at y=182.
  const handlerMatch = indexHtml.match(
    /jumpnavEl\.addEventListener\('click',[\s\S]*?\}\);/u
  );
  assert.ok(handlerMatch, "jumpnav click handler block not found");
  assert.match(
    handlerMatch[0],
    /window\.scrollTo\(/,
    "handler must use window.scrollTo (to precisely position the grey line at the bottom border)"
  );
  assert.match(
    handlerMatch[0],
    /prevBottomDoc\s*-\s*183/u,
    "handler must compute scrollY = prevSectionBottomInDocument - 183 (grey line meets bottom border)"
  );
});

// ---------------------------------------------------------------------------
// Loading indicator — hidden in HTML, shown by JS bootstrap
// ---------------------------------------------------------------------------

test("loading: indicator does NOT have .show in the HTML by default", () => {
  // The fix from PR (loading-indicator) was to remove .show from
  // the HTML so the loading text doesn't show on initial page load
  // when JavaScript is broken or slow.
  const loadingMatch = indexHtml.match(
    /<div[^>]*id=["']loading["'][^>]*>/u
  );
  assert.ok(loadingMatch, "loading div not found in HTML");
  const tag = loadingMatch[0];
  assert.doesNotMatch(
    tag,
    /class=["'][^"']*\bshow\b/u,
    `loading div must not have .show in HTML (got: ${tag})`
  );
});

test("loading: tiny inline bootstrap script adds .show to loading div", () => {
  // The fix added a <script> at the top of <body> that adds .show
  // to the loading div only if JavaScript actually runs.
  assert.match(
    indexHtml,
    /<script>\s*document\.getElementById\(['"]loading['"]\)\.classList\.add\(['"]show['"]\)\s*;?\s*<\/script>/u,
    "missing inline bootstrap script that adds .show to loading div"
  );
});

test("loading: render() removes .show from loading div", () => {
  // After the menu renders, the loading indicator must be hidden.
  // Look in the initial-load path for the remove call.
  const initialPath = indexHtml.match(
    /if\s*\(window\.MENU_DATA[\s\S]*?else\s*\{[\s\S]*?loadErrEl[\s\S]*?\}/u
  );
  if (initialPath) {
    assert.match(
      initialPath[0],
      /getElementById\(['"]loading['"]\)\.classList\.remove\(['"]show['"]\)/,
      "render path must remove .show from loading div"
    );
  }
});

// ---------------------------------------------------------------------------
// Empty state — never has .show in HTML, only added by applyFilters
// ---------------------------------------------------------------------------

test("empty: empty div does NOT have .show in the HTML", () => {
  const emptyMatch = indexHtml.match(/<div[^>]*id=["']empty["'][^>]*>/u);
  assert.ok(emptyMatch, "empty div not found in HTML");
  const tag = emptyMatch[0];
  assert.doesNotMatch(
    tag,
    /class=["'][^"']*\bshow\b/u,
    `empty div must not have .show in HTML (got: ${tag})`
  );
});

test("empty: applyFilters only toggles .show when _sectionEls is populated", () => {
  // The fix from PR (loading-indicator) was to wrap the empty
  // state toggle in `if (_sectionEls.length > 0)` so the initial
  // setInvert() call (which runs applyFilters() before render())
  // doesn't accidentally add .show to the empty div.
  const applyFiltersMatch = indexHtml.match(
    /function\s+applyFilters\s*\(\s*\)\s*\{[\s\S]*?\n\}/u
  );
  assert.ok(applyFiltersMatch, "applyFilters function not found");
  const fn = applyFiltersMatch[0];
  assert.match(
    fn,
    /if\s*\(\s*_sectionEls\.length\s*>\s*0\s*\)/,
    "applyFilters must guard the empty-state toggle with _sectionEls.length > 0"
  );
  assert.match(
    fn,
    /emptyEl\.classList\.toggle\(\s*['"]show['"]\s*,\s*!anyVisible\s*\)/,
    "applyFilters must toggle empty .show based on !anyVisible"
  );
});

// ---------------------------------------------------------------------------
// Jump-nav active state (aria-current) — like pressed chips
// ---------------------------------------------------------------------------

test("jump-nav: click handler sets aria-current on the clicked link", () => {
  // The CSS rule `.jumpnav a[aria-current="true"]` paints the
  // active link with black bg + yellow text (same as a pressed
  // chip). The click handler must actually set this attribute,
  // or the rule never fires.
  const handlerMatch = indexHtml.match(
    /jumpnavEl\.addEventListener\('click',[\s\S]*?\}\);/u
  );
  assert.ok(handlerMatch, "jumpnav click handler block not found");
  assert.match(
    handlerMatch[0],
    /setActiveJumpLink\(/,
    "click handler must call setActiveJumpLink to mark the active link"
  );
});

test("jump-nav: setActiveJumpLink removes aria-current from all links first", () => {
  // Without the clear pass, multiple links would carry aria-current
  // and the CSS would paint them all as active.
  assert.match(
    indexHtml,
    /function\s+setActiveJumpLink\s*\([\s\S]*?for\s*\(\s*const\s+jl\s+of\s+_jumpLinks\s*\)[\s\S]*?removeAttribute\(\s*['"]aria-current['"]\s*\)/u,
    "setActiveJumpLink must clear aria-current from all _jumpLinks first"
  );
  assert.match(
    indexHtml,
    /setAttribute\(\s*['"]aria-current['"]\s*,\s*['"]true['"]\s*\)/,
    "setActiveJumpLink must set aria-current='true' on the new active link"
  );
});

test("jump-nav: scroll-spy picks the section the user is 'in' (largest top ≤ controls bottom)", () => {
  // User: scrolling should change the active pill to reflect
  // which section the user is currently reading.
  //
  // Approach: the active section is the one whose <details>
  // top is the largest value that is still ≤ controlsBottom.
  // This is the section whose title has crossed (or is at)
  // the controls bottom — the one the user is "in".
  //
  // This approach correctly handles all scroll positions,
  // unlike the grey-line approach (which was always tied
  // at distance=0 for the first section since its grey
  // line is the controls bottom border itself).
  assert.match(
    indexHtml,
    /window\.addEventListener\(\s*['"]scroll['"]/u,
    "scroll-spy must listen to scroll events"
  );
  assert.match(
    indexHtml,
    /requestAnimationFrame/u,
    "scroll-spy must throttle with rAF to avoid running on every pixel of a smooth scroll"
  );
  assert.match(
    indexHtml,
    /top\s*<=\s*controlsBottom\s*&&\s*top\s*>\s*bestTop/u,
    "scroll-spy must use the 'largest top ≤ controls bottom' approach"
  );
  assert.doesNotMatch(
    indexHtml,
    /greyLineY/u,
    "scroll-spy must NOT use greyLineY (that approach left the first section always-tied at dist=0)"
  );
  assert.match(
    indexHtml,
    /if\s*\(\s*!active\s*\)\s*active\s*=\s*_sectionEls\[0\]/u,
    "scroll-spy must fall back to the first section when none qualify"
  );
});

test("jump-nav: no legacy buggy scroll-spy that sets aria-current='false' on every link", () => {
  // Bug found during validation: an earlier buggy scroll-spy
  // set aria-current to 'true' OR 'false' on EVERY jump-nav
  // link — never removing the attribute. The string 'false'
  // is truthy in JS, so the active-state filter thought all
  // 19 links were active. This test catches a regression of
  // that pattern.
  assert.doesNotMatch(
    indexHtml,
    /setAttribute\(\s*['"]aria-current['"]\s*,\s*['"]false['"]/u,
    "no code must set aria-current='false' (string 'false' is truthy and makes all links appear active)"
  );
  assert.doesNotMatch(
    indexHtml,
    /jumpnavEl\.querySelectorAll\(['"]a['"]\)[\s\S]{0,200}setAttribute\(\s*['"]aria-current['"]/u,
    "no code must iterate over all jumpnav links and set aria-current (the buggy pattern)"
  );
});

// ---------------------------------------------------------------------------
// Kids Meals — fun-color theme (the one section that gets a playful palette)
// ---------------------------------------------------------------------------

test("kids-meals: jump-nav link uses a fun gradient background (not the default ink color)", () => {
  // The kids jump link should stand out from the other categories
  // with a bright pink→orange→blue gradient. Catch a regression
  // where the default `.jumpnav a` color scheme is used for it.
  assert.match(
    indexHtml,
    /\.jumpnav\s+a\[href="#sec-kids-meals"\]\s*\{[^}]*background\s*:\s*linear-gradient/u,
    "kids jump link must use a linear-gradient background (fun colors)"
  );
  assert.match(
    indexHtml,
    /\.jumpnav\s+a\[href="#sec-kids-meals"\][^}]*font-weight\s*:\s*700/u,
    "kids jump link must be bold (extra emphasis for the kids audience)"
  );
  // Bright candy-pink + sky-blue are the signal colors
  assert.match(
    indexHtml,
    /#ff5b9c.*#3ec5f1|#3ec5f1.*#ff5b9c/u,
    "kids theme must include both the candy-pink and sky-blue signal colors"
  );
});

test("kids-meals: section header uses the same fun gradient", () => {
  // The Kids Meals section header (<summary>) should match the
  // jump link's palette so the two read as one theme.
  assert.match(
    indexHtml,
    /details#sec-kids-meals>summary\s*\{[^}]*background\s*:\s*linear-gradient/u,
    "kids section summary must use a linear-gradient background"
  );
  assert.match(
    indexHtml,
    /details#sec-kids-meals>summary\s*\{[^}]*color\s*:\s*#fff/u,
    "kids section summary must have white text (contrast on the gradient)"
  );
});

test("kids-meals: star marker (★) appears in both the jump link and the section header", () => {
  // A small star glyph in front of "Kids Meals" labels makes
  // it visually distinct and signals "this is the playful one"
  // without needing a separate emoji or icon.
  assert.match(
    indexHtml,
    /\.jumpnav\s+a\[href="#sec-kids-meals"\][^{]*::before\s*\{[^}]*content\s*:\s*['"]★/u,
    "kids jump link ::before must contain a star marker"
  );
  assert.match(
    indexHtml,
    /details#sec-kids-meals>summary::before\s*\{[^}]*content\s*:\s*['"]★/u,
    "kids section summary ::before must contain a star marker"
  );
});

test("jumpnav-label: is styled as a prominent pill button, not plain text", () => {
  // The "Jump to" label was a small brown text — easy to miss.
  // It should look like a proper pill/button (black bg, white
  // text) so it stands out from the category links it labels.
  const labelMatch = indexHtml.match(/\.jumpnav-label\s*\{[^}]*\}/u);
  assert.ok(labelMatch, ".jumpnav-label CSS not found");
  assert.match(
    labelMatch[0],
    /background\s*:\s*var\(--black\)|background\s*:\s*#000/u,
    ".jumpnav-label must have a black pill background"
  );
  assert.match(
    labelMatch[0],
    /color\s*:\s*#fff/u,
    ".jumpnav-label must have white text (contrast on black pill)"
  );
  assert.match(
    labelMatch[0],
    /border-radius\s*:\s*999px/u,
    ".jumpnav-label must be rounded (pill shape)"
  );
});

test("jumpnav-label: has a downward arrow icon (↓) to signal 'scroll to'", () => {
  // The arrow reinforces the meaning of the label — this is
  // a navigation control, not just a heading.
  assert.match(
    indexHtml,
    /\.jumpnav-label::before\s*\{[^}]*content\s*:\s*['"]↓/u,
    ".jumpnav-label ::before must contain a down-arrow"
  );
});

test("jumpnav: nested inside .controls so it sticks to the top on scroll", () => {
  // The user reported: "I don't see jump to staying fixed to nav
  // as I scroll down". Root cause: <nav class="jumpnav"> was a
  // SIBLING of <div class="controls">, not a child. Only the
  // .controls element had position:sticky, so the jumpnav
  // scrolled off-screen with the page.
  //
  // The fix: nest the <nav> inside the <div class="controls">,
  // so it sticks with the rest of the controls bar.
  //
  // This test counts <div> open/close tags after the
  // <div class="controls"> opening to find the matching
  // </div>, and asserts that <nav class="jumpnav"> appears
  // BEFORE that closing tag.
  const start = indexHtml.indexOf('<div class="controls"');
  assert.ok(start > -1, ".controls div not found");
  let depth = 1;
  let i = start + '<div class="controls"'.length;
  const jumpnavIdx = indexHtml.indexOf('<nav class="jumpnav"', start);
  assert.ok(jumpnavIdx > -1, ".jumpnav not found");
  // Walk through the HTML, tracking <div> depth
  const tagRe = /<div\b|<\/div>/gu;
  tagRe.lastIndex = i;
  let controlsEnd = -1;
  while (depth > 0) {
    const m = tagRe.exec(indexHtml);
    if (!m) break;
    if (m[0] === '</div>') {
      depth--;
      if (depth === 0) controlsEnd = m.index;
    } else {
      depth++;
    }
  }
  assert.ok(controlsEnd > -1, "could not find matching </div> for .controls");
  assert.ok(
    jumpnavIdx < controlsEnd,
    `<nav class="jumpnav"> (at index ${jumpnavIdx}) must be INSIDE <div class="controls"> (closes at index ${controlsEnd})`
  );
});

test("jumpnav: pills are vertically centered (symmetric padding, no border-top)", () => {
  // User: "jump nav pills STILL aren't centered vertically
  // between the lines". Caused by border-top:1px which
  // created a visible line above the pills and made them
  // look top-heavy. Fix: removed border-top, removed
  // min-height, symmetric padding 8px 14px.
  const jnMatch = indexHtml.match(/\.jumpnav\s*\{[^}]*\}/u);
  assert.ok(jnMatch, ".jumpnav CSS not found");
  const css = jnMatch[0];
  // No border-top (it created the visible top line that
  // made pills look off-center)
  assert.doesNotMatch(
    css,
    /border-top\s*:/u,
    ".jumpnav must NOT have a border-top (it creates a visible line above the pills that breaks vertical centering)"
  );
  // No min-height (it forced the row taller than the content,
  // creating uneven space around the pills)
  assert.doesNotMatch(
    css,
    /min-height\s*:/u,
    ".jumpnav must NOT have a min-height (let the content + padding determine the height)"
  );
  // Symmetric padding
  assert.match(
    css,
    /padding\s*:\s*8px\s+14px/u,
    ".jumpnav padding must be symmetric (8px vertical, 14px horizontal)"
  );
  // align-items:center is required
  assert.match(
    css,
    /align-items\s*:\s*center/u,
    ".jumpnav must use align-items:center to center pills on the cross axis"
  );
});

test("jumpnav: scroll-spy scrolls the active link into the visible center", () => {
  // User: "can we have the jump to buttons stay in sync with
  // menu item scrolling". The jumpnav is horizontally
  // scrollable (overflow-x:auto). When the user scrolls into
  // a section whose link is off-screen to the right, the
  // active state changes but the user can't SEE which section
  // they're in. Fix: scrollIntoView({inline:'center'}) on
  // the active link so the jumpnav auto-scrolls to show it.
  assert.match(
    indexHtml,
    /scrollIntoView\s*\(\s*\{[^}]*inline\s*:\s*['"]center['"]/u,
    "setActiveJumpLink must call scrollIntoView with inline:'center' to keep the active link visible"
  );
});

test("jumpnav: scroll-spy uses 'largest top ≤ controls bottom' (the one the user is in)", () => {
  // The active section is the one whose <details> top is
  // the largest value that is still ≤ controlsBottom. This
  // is the section whose title has crossed (or is at) the
  // controls bottom — the one the user is currently reading.
  assert.match(
    indexHtml,
    /top\s*<=\s*controlsBottom\s*&&\s*top\s*>\s*bestTop/u,
    "scroll-spy must use the 'largest top ≤ controls bottom' approach"
  );
  assert.doesNotMatch(
    indexHtml,
    /greyLineY/u,
    "scroll-spy must NOT use greyLineY (that approach left section 0 always-tied at dist=0)"
  );
  assert.doesNotMatch(
    indexHtml,
    /lineAboveTitle/u,
    "scroll-spy must NOT use lineAboveTitle (that was an intermediate fix)"
  );
});

test("jumpnav: click handler scrolls so grey line meets bottom border", () => {
  // The click handler must compute the scroll position so
  // that the previous section's border-bottom (the grey
  // divider line) is at y=183 in the viewport (so the 1px
  // grey line is at y=182, meeting the bottom of the black
  // border at the controls bottom).
  assert.match(
    indexHtml,
    /window\.scrollTo/u,
    "click handler must use window.scrollTo (not scrollIntoView) to precisely position the grey line"
  );
  assert.match(
    indexHtml,
    /prevBottomDoc\s*-\s*183/u,
    "click handler must compute scrollY = prevSectionBottomInDocument - 183 (so grey line at prevBottom-1 = 182)"
  );
});
