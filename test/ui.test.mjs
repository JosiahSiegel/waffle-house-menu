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

test("scroll-margin-top: jump handler uses scrollIntoView, not manual offset math", () => {
  // After PR #6, we replaced the -96 magic number with native
  // scrollIntoView. Make sure no one re-introduces a manual offset.
  const handlerMatch = indexHtml.match(
    /jumpnavEl\.addEventListener\('click',[\s\S]*?\}\);/u
  );
  assert.ok(handlerMatch, "jumpnav click handler block not found");
  assert.match(
    handlerMatch[0],
    /target\.scrollIntoView\(/,
    "handler must use target.scrollIntoView (not manual offset math)"
  );
  assert.doesNotMatch(
    handlerMatch[0],
    /getBoundingClientRect\(\)\.top\s*\+\s*window\.scrollY/,
    "handler must NOT use manual getBoundingClientRect offset math"
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

test("jump-nav: scroll-spy uses IntersectionObserver with --jump-offset rootMargin", () => {
  // The observer's rootMargin pushes the detection line below
  // the sticky controls bar so the link activates when its
  // section title crosses into view (not when it scrolls behind
  // the header).
  assert.match(
    indexHtml,
    /IntersectionObserver/,
    "scroll-spy must use IntersectionObserver (not a scroll listener)"
  );
  assert.match(
    indexHtml,
    /rootMargin\s*:\s*['"]-200px/u,
    "scroll-spy rootMargin must start with -200px (matches --jump-offset)"
  );
  assert.match(
    indexHtml,
    /for\s*\(\s*const\s+sec\s+of\s+_sectionEls\s*\)\s*spy\.observe/,
    "scroll-spy must observe all cached _sectionEls"
  );
});

test("jump-nav: no legacy scroll-spy in onScroll that sets aria-current='false' on every link", () => {
  // Bug found during validation: the OLD onScroll() function
  // (before the IntersectionObserver scroll-spy) had a buggy
  // scroll-spy that set aria-current to 'true' OR 'false' on
  // EVERY jump-nav link — never removing the attribute. The
  // string 'false' is truthy in JS, so the active-state filter
  // thought all 19 links were active. This test catches a
  // regression of that pattern.
  const onScrollMatch = indexHtml.match(
    /function\s+onScroll\s*\(\s*\)\s*\{[\s\S]*?\n\}/u
  );
  assert.ok(onScrollMatch, "onScroll function not found");
  assert.doesNotMatch(
    onScrollMatch[0],
    /setAttribute\(\s*['"]aria-current['"]/u,
    "onScroll must NOT set aria-current (scroll-spy is in IntersectionObserver now)"
  );
  assert.doesNotMatch(
    onScrollMatch[0],
    /jumpnavEl\.querySelectorAll\(['"]a['"]\)/u,
    "onScroll must NOT iterate over jumpnav links (scroll-spy moved out)"
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
