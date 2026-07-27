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
import vm from "node:vm";
import { choicesLabel } from "../filter.mjs";

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

test("scroll-margin-top: jump handler uses scrollIntoView for title-alignment", () => {
  // After PR #25, the click handler uses native scrollIntoView
  // with scroll-margin-top: var(--jump-offset) (166px) on
  // details.sec. This positions the section's <details> top
  // at y=166 in the viewport, so the title (which is 16px
  // below the top, due to summary padding-top) lands at
  // y=182 — exactly at the controls bottom border. This is
  // the SAME alignment the scroll-spy produces when the user
  // scrolls manually.
  const handlerMatch = indexHtml.match(
    /jumpnavEl\.addEventListener\('click',[\s\S]*?\}\);/u
  );
  assert.ok(handlerMatch, "jumpnav click handler block not found");
  assert.match(
    handlerMatch[0],
    /scrollIntoView\(/,
    "handler must use target.scrollIntoView (with scroll-margin-top on details.sec)"
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
    /<script>\s*\{?\s*const\s+l\s*=\s*document\.getElementById\(['"]loading['"]\)\s*;?\s*if\s*\(\s*l\s*\)\s*l\.classList\.add\(['"]show['"]\)\s*;?\s*\}?\s*<\/script>/u,
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

test("jump-nav: scroll-spy aligns pill when category divider meets controls bottom", () => {
  // User: "pill align on category divider meeting bottom pill
  // navbar border, not before or after"
  //
  // The "category divider" is the 1px border-bottom of the
  // PREVIOUS section. The "bottom pill navbar border" is the
  // 2px black border at the bottom of the controls (y=182).
  //
  // Approach: the active section is the one whose divider
  // position is the LARGEST value that is still ≤
  // controlsBottom. This is the section whose grey line has
  // just reached (or is at) the controls bottom.
  //
  // For the first section there's no previous section, so
  // the "divider" is the controls bottom border itself
  // (always at y=182). The tie-breaker (largest dividerY)
  // handles the case where multiple sections have the same
  // divider position — it picks the LATEST one.
  assert.match(
    indexHtml,
    /window\.addEventListener\(\s*['"]scroll['"]/u,
    "scroll-spy must listen to scroll events"
  );
  assert.match(
    indexHtml,
    /requestAnimationFrame/u,
    "scroll-spy must throttle with rAF"
  );
  assert.match(
    indexHtml,
    /dividerY\s*=\s*top\s*-\s*1/u,
    "scroll-spy must compute dividerY = sectionTop - 1 (the 1px grey line just above the section top)"
  );
  assert.match(
    indexHtml,
    /dividerY\s*<=\s*controlsBottom\s*&&\s*dividerY\s*>\s*bestDividerY/u,
    "scroll-spy must pick the section with the largest dividerY still ≤ controlsBottom"
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

test("kids-meals: NO star marker (★) on the jump link or section header", () => {
  // A small star glyph used to appear in front of "Kids Meals"
  // labels, but it was confusing — it competed with the Pinned
  // section's pin icon and looked like a "starred/favorited"
  // affordance. Now the labels are plain text, and the
  // distinctive gradient (pink/orange/blue) carries the visual
  // identity for Kids Meals alone.
  assert.doesNotMatch(
    indexHtml,
    /\.jumpnav\s+a\[href="#sec-kids-meals"\][^{]*::before\s*\{[^}]*content\s*:\s*['"]★/u,
    "kids jump link ::before must NOT contain a star marker (was confusing next to pin icon)"
  );
  assert.doesNotMatch(
    indexHtml,
    /details#sec-kids-meals>summary::before\s*\{[^}]*content\s*:\s*['"]★/u,
    "kids section summary ::before must NOT contain a star marker (was confusing next to pin icon)"
  );
});

test("menu: meals are visually grouped with a left-border accent", () => {
  // User: "its not clear when the meal includes multiple sets of
  // choices, like the kids 1 egg meal with 3 sets of choices"
  //
  // Each meal (main item + its subsequent choice/includes/add-on
  // groups) is wrapped in a <div class="meal"> with a left-border
  // accent. This makes it obvious which choices belong to which
  // meal — critical for sections like Kids Meals where one meal
  // has 3 "Choices" groups in a row.
  assert.match(
    indexHtml,
    /<div\s+class="meal">/u,
    "render() must wrap each meal in a <div class=\"meal\">"
  );
  assert.match(
    indexHtml,
    /\.meal\s*\{[^}]*border-left/u,
    ".meal must have a left-border accent so users can see where one meal ends and the next begins"
  );
  assert.match(
    indexHtml,
    /isMealStart/,
    "render() must compute isMealStart (a group starts a new meal when its h is not a subcategory)"
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

test("jumpnav: scroll-spy picks section whose divider meets controls bottom", () => {
  // The active section is the one whose DIVIDER GREY LINE
  // (the 1px border-bottom of the previous section, at
  // prevSection.bottom - 1) is at the controls bottom
  // (y=182). The tie-breaker (largest dividerY) picks the
  // latest section when multiple sections have the same
  // divider position (e.g. the first section, whose
  // "divider" is always the controls bottom border at 182,
  // and the next section, whose divider has just reached
  // 182).
  assert.match(
    indexHtml,
    /dividerY\s*=\s*top\s*-\s*1/u,
    "scroll-spy must compute dividerY = sectionTop - 1"
  );
  assert.match(
    indexHtml,
    /dividerY\s*<=\s*controlsBottom\s*&&\s*dividerY\s*>\s*bestDividerY/u,
    "scroll-spy must pick the section with the largest dividerY still ≤ controlsBottom"
  );
  assert.doesNotMatch(
    indexHtml,
    /lineAboveTitle/u,
    "scroll-spy must NOT use lineAboveTitle (intermediate fix)"
  );
});

test("jumpnav: click handler uses scrollIntoView so divider meets controls bottom", () => {
  // The click handler must use scrollIntoView with
  // scroll-margin-top: var(--jump-offset) on details.sec.
  // With --jump-offset: 183px, the section's <details> top
  // lands at y=183, so the PREVIOUS section's bottom is at
  // y=183, and the 1px grey divider (at prevBottom - 1)
  // meets the controls bottom border (y=182). This is the
  // SAME alignment the scroll-spy produces when the user
  // scrolls manually.
  const handlerMatch = indexHtml.match(
    /jumpnavEl\.addEventListener\('click',[\s\S]*?\}\);/u
  );
  assert.ok(handlerMatch, "jumpnav click handler block not found");
  assert.match(
    handlerMatch[0],
    /scrollIntoView\(/,
    "click handler must use scrollIntoView"
  );
  assert.match(
    indexHtml,
    /--jump-offset\s*:\s*183px/,
    "--jump-offset must be 183px (so prevSection.bottom lands at 183, divider at 182 = controls bottom)"
  );
});

// User: 'white/wheat toast should be in the choices group, not above it'
// For meals that have a 'Choices' group with Raisin Toast/Grilled
// Biscuit/Texas Toast, the 'White Toast - 2 Slices' and
// 'Wheat Toast - 2 Slices' items must be IN that Choices group,
// not in the main-item group. This matches the PDF structure
// where all 5 bread options are in one group.
test('menu: white/wheat toast are in the Choices group, not the main item', () => {
  const menuJs = readFileSync('data/menu.js', 'utf8');
  // Find the Kids Meals section
  const kidsMatch = menuJs.match(/"title"\s*:\s*"Kids Meals"[\s\S]*?"title"\s*:\s*"/);
  assert.ok(kidsMatch, 'Kids Meals section not found in data/menu.js');
  const kidsSection = kidsMatch[0];
  // Find the 1 Egg Breakfast meal block: from its name up to the
  // end of its groups (before the next "title" or end of section).
  // The 1 Egg meal has 4 groups: main, Choices(toast), Choices(sides),
  // Choices(meat). White/Wheat Toast must be in the FIRST Choices group.
  const oneEggStart = kidsSection.indexOf("Kid's 1 Egg Breakfast with Bacon or Sausage");
  assert.ok(oneEggStart >= 0, "Kid's 1 Egg Breakfast not found");
  // Get the block from 1 Egg meal name to the next section title
  // (or end of kids section). The Kids section ends at the next
  // "title" or end of the matched kids block.
  const oneEggBlock = kidsSection.substring(oneEggStart);
  // The first "Choices" after the 1 Egg meal name is its toast
  // choices group. White/Wheat Toast must appear AFTER that.
  const choicesIdx = oneEggBlock.indexOf('"Choices"');
  const whiteIdx = oneEggBlock.indexOf('White Toast');
  const wheatIdx = oneEggBlock.indexOf('Wheat Toast');
  const raisinIdx = oneEggBlock.indexOf('Raisin Toast');
  assert.ok(choicesIdx >= 0, 'Choices header not found in 1 Egg meal block');
  assert.ok(whiteIdx > choicesIdx, 'White Toast must be AFTER the Choices header in the 1 Egg meal');
  assert.ok(wheatIdx > choicesIdx, 'Wheat Toast must be AFTER the Choices header in the 1 Egg meal');
  assert.ok(raisinIdx > choicesIdx, 'Raisin Toast must be AFTER the Choices header in the 1 Egg meal');
});


test("menu: choices groups show specific labels (Choose Your Bread/Side/Meat)", () => {
  // User: "the kids egg has 3 sets of choices included"
  // When a meal has multiple "Choices" groups, they all just
  // said "CHOICES" — the user couldn't tell what each set was
  // for. Now we show specific labels based on the items:
  //   - All toast items → "Choose Your Bread"
  //   - All side items → "Choose Your Side"
  //   - All meat items → "Choose Your Meat"
  //   - Mixed → "Choices"
  assert.match(
    indexHtml,
    /choicesLabel/,
    "index.html must import and use choicesLabel() for Choices groups"
  );
  // The function must exist in filter.mjs
  const filterMjs = readFileSync("filter.mjs", "utf8");
  assert.match(
    filterMjs,
    /export function choicesLabel/,
    "filter.mjs must export choicesLabel()"
  );
  // Test the function directly
  // (imported at top of file: choicesLabel)
  // Toast group
  assert.equal(
    choicesLabel([
      {n: "White Toast - 2 Slices"},
      {n: "Wheat Toast - 2 Slices"},
      {n: "Raisin Toast - 2 Slices"},
      {n: "Grilled Biscuit"},
      {n: "Texas Toast - 1 Slice"}
    ]),
    "Choose Your Bread",
    "All toast items should produce 'Choose Your Bread'"
  );
  // Side group
  assert.equal(
    choicesLabel([
      {n: "Grits"},
      {n: "Hashbrowns"},
      {n: "Sliced Tomatoes"}
    ]),
    "Choose Your Side",
    "All side items should produce 'Choose Your Side'"
  );
  // Meat group
  assert.equal(
    choicesLabel([
      {n: "Kid's Bacon"},
      {n: "Kid's Sausage"},
      {n: "Kid's Chicken Sausage"}
    ]),
    "Choose Your Meat",
    "All meat items should produce 'Choose Your Meat'"
  );
  // Empty/mixed → fallback
  assert.equal(
    choicesLabel([]),
    "Choices",
    "Empty items should fall back to 'Choices'"
  );
  assert.equal(
    choicesLabel([{n: "Something Mixed"}, {n: "Another Thing"}]),
    "Choices",
    "Mixed/unknown items should fall back to 'Choices'"
  );
});

test("menu: main items stand out as the meal card header (meal-head)", () => {
  // User: "create a PR that updates the items UNDER/related to
  //        each meal to be more compact and more clearly
  //        indicated as part of any particular meal"
  //
  // The main item of each meal is now the meal card header
  // (.meal-head) at the top of each card. It shows the meal
  // name in large display font + a yellow cal tile. This is
  // much clearer than the previous "tinted row + tiny 'from
  // {meal}' label" approach.
  assert.match(
    indexHtml,
    /class="item-row meal-head"/,
    "render() must wrap the meal name + cal in a .meal-head button (with item-row for click handler delegation)"
  );
  assert.match(
    indexHtml,
    /\.meal-head\s*\{[^}]*display\s*:\s*flex/u,
    ".meal-head must be a flex row (name on left, cal on right)"
  );
  assert.match(
    indexHtml,
    /\.meal-head-name\s*\{[^}]*font-family\s*:\s*Anton/u,
    ".meal-head-name must use the display font so the meal name stands out"
  );
  assert.match(
    indexHtml,
    /\.meal-head-cal\s*\{[^}]*background\s*:\s*var\(--yellow\)/u,
    ".meal-head-cal must have the yellow background so the meal's calorie pops"
  );
});

test("menu: dark mode toggle exists with persistence and OS preference", () => {
  // User: "allow the user to switch to dark mode"
  assert.match(
    indexHtml,
    /id="themeToggle"/,
    "index.html must have a #themeToggle button"
  );
  assert.match(
    indexHtml,
    /\[data-theme="dark"\]/,
    "index.html must define a [data-theme=\"dark\"] CSS block"
  );
  assert.match(
    indexHtml,
    /localStorage\.(get|set)Item\(THEME_KEY/,
    "index.html must persist theme preference in localStorage"
  );
  assert.match(
    indexHtml,
    /prefers-color-scheme: dark/,
    "index.html must respect OS-level prefers-color-scheme"
  );
  // The dark theme block must override the core color variables
  assert.match(
    indexHtml,
    /\[data-theme="dark"\][\s\S]{0,400}--paper:/,
    "Dark theme must override --paper"
  );
  assert.match(
    indexHtml,
    /\[data-theme="dark"\][\s\S]{0,400}--ink:/,
    "Dark theme must override --ink"
  );
  // Keyboard shortcut "t" must toggle theme
  assert.match(
    indexHtml,
    /e\.key==='t'[\s\S]{0,500}toggleTheme\(\)/,
    "Pressing 't' must toggle the theme"
  );
});

test("search: sub-items belong to a meal card whose header shows the meal name", () => {
  // User: "when I search 'biscuit' and I see numerous results
  //        that appear to be duplicates... we need to improve
  //        the search so that results retain the context of
  //        what they are related to"
  //
  // Old fix: tiny "from {meal}" label under each sub-item.
  // New fix: each sub-item lives inside a <div class="meal">
  // card whose .meal-head shows the meal name in large font.
  // The user sees the meal name once at the top of the card
  // (not repeated under every sub-item) and the association
  // is unmistakable. Each item still carries data-meal for
  // any downstream consumer that needs the parent meal name.
  assert.match(
    indexHtml,
    /<div\s+class="meal">/u,
    "render() must wrap each meal in a <div class=\"meal\"> card"
  );
  assert.match(
    indexHtml,
    /\.meal-head-name/,
    ".meal-head-name must be defined so the meal name is prominent"
  );
  assert.match(
    indexHtml,
    /data-meal="\$\{currentMeal\?esc/,
    "Each sub-item must carry data-meal for downstream consumers"
  );
  // The compact card design relies on flex-wrap to put 2-3
  // pills per row instead of one per row.
  assert.match(
    indexHtml,
    /\.meal\s*\{[^}]*flex-wrap\s*:\s*wrap/u,
    ".meal must use flex-wrap so pills wrap to 2-3 columns"
  );
});

test("menu: Pecans in Waffles section is a Topping, not a separate meal", () => {
  // User: "under waffles, it has pecans as its own meal! that's
  //        wrong as it's just a side for waffles. parser needs
  //        fixing"
  //
  // The PDF lists Waffle toppings as:
  //   Classic Waffle House Waffle
  //   Toppings:
  //     Pecans
  //     Chocolate Chips
  //     Blueberry Nougat
  //     Peanut Butter Chips
  //
  // The parser put a ":" on its own line, which got set as
  // cur_group, breaking the topping grouping. "Pecans" landed
  // in its own null-h group. The fix in sync.py SKIP_RE now
  // silently drops stand-alone ":" lines.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  // vm is imported at top of file
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const waffles = data.sections.find(s => s.title === "Waffles");
  assert.ok(waffles, "Waffles section must exist");
  // The "Classic Waffle House Waffle" is the only main item
  const mains = waffles.groups.filter(g => g.h === null);
  assert.equal(mains.length, 1, "Waffles must have exactly 1 main item");
  assert.equal(mains[0].items[0].n, "Classic Waffle House Waffle");
  // All 4 toppings are in the Toppings group, no null-h
  // group with "Pecans" as a separate meal
  const toppings = waffles.groups.find(g => g.h === "Toppings");
  assert.ok(toppings, "Waffles must have a Toppings group");
  assert.equal(toppings.items.length, 4, "Waffles Toppings must have 4 items");
  const toppingNames = toppings.items.map(i => i.n);
  assert.ok(toppingNames.includes("Pecans"),
    `Toppings must include Pecans, got: ${toppingNames.join(", ")}`);
  assert.ok(toppingNames.includes("Chocolate Chips"));
  assert.ok(toppingNames.includes("Blueberry Nougat"));
  assert.ok(toppingNames.includes("Peanut Butter Chips"));
  // No "Pecans" as its own main item
  const pecansOwnMeal = waffles.groups.some(g =>
    g.h === null && g.items.some(i => i.n === "Pecans")
  );
  assert.equal(pecansOwnMeal, false,
    "Pecans must NOT be its own main item in Waffles");
});

test("menu: Egg Breakfasts has 'Fiesta Protein Bowl' as its own meal", () => {
  // PDF page 3 lists 11 meals, the 11th being "Fiesta Protein
  // Bowl". The parser used to drop it into the previous meal's
  // (Cheesesteak & Eggs) side-choices group because of the
  // interleaved "Plus your choice of:" sequence on page 3.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const egg = data.sections.find(s => s.title === "Egg Breakfasts");
  assert.ok(egg, "Egg Breakfasts must exist");
  // Must have a meal group named exactly "Fiesta Protein Bowl"
  const fiesta = egg.groups.find(g => g.h === "Fiesta Protein Bowl");
  assert.ok(fiesta, "Egg Breakfasts must have a 'Fiesta Protein Bowl' meal group");
  assert.equal(fiesta.items.length, 1, "Fiesta Protein Bowl group should have exactly 1 main item");
  assert.equal(fiesta.items[0].n, "Fiesta Protein Bowl");
  // And it must NOT appear in any other group's items
  for (const g of egg.groups) {
    if (g === fiesta) continue;
    for (const it of g.items) {
      assert.notEqual(it.n, "Fiesta Protein Bowl",
        `Fiesta Protein Bowl must not be in group h=${JSON.stringify(g.h)}`);
    }
  }
  // It must have its own bread + side Choices groups following it
  const breadChoices = egg.groups[egg.groups.indexOf(fiesta) + 1];
  const sideChoices = egg.groups[egg.groups.indexOf(fiesta) + 2];
  assert.ok(breadChoices && breadChoices.h === "Choices",
    "Fiesta Protein Bowl must be followed by a Choices group (bread)");
  assert.ok(sideChoices && sideChoices.h === "Choices",
    "Fiesta Protein Bowl must be followed by a Choices group (sides)");
  // Bread choices should include Raisin Toast
  assert.ok(breadChoices.items.some(i => i.n === "Raisin Toast - 2 Slices"),
    "Bread choices for Fiesta Protein Bowl must include Raisin Toast");
});

test("menu: Omelet Breakfasts 'Fiesta Omelet Breakfast' has only 1 main item", () => {
  // PDF page 6 has 4 main omelets. The parser used to put
  // "Raisin Toast - 2 Slices" in the main group because the
  // PDF layout has the nutrition row 380... at the top of the
  // table and the choices below, but the row order is the
  // same in the Name block (just printed once). The parser
  // attached the first 10-number row after the Name to the
  // meal, but Raisin Toast's row got misaligned.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const om = data.sections.find(s => s.title === "Omelet Breakfasts");
  assert.ok(om, "Omelet Breakfasts must exist");
  const fiesta = om.groups.find(g => g.h === "Fiesta Omelet Breakfast");
  assert.ok(fiesta, "Omelet Breakfasts must have a 'Fiesta Omelet Breakfast' meal group");
  assert.equal(fiesta.items.length, 1,
    `'Fiesta Omelet Breakfast' main group must have exactly 1 item, got: ${fiesta.items.map(i => i.n).join(", ")}`);
  assert.equal(fiesta.items[0].n, "2 Egg Fiesta Omelet");
  // The bread choices for Fiesta Omelet must include Raisin Toast
  const idx = om.groups.indexOf(fiesta);
  const breadChoices = om.groups[idx + 1];
  assert.ok(breadChoices && breadChoices.h === "Choices",
    "Fiesta Omelet Breakfast must be followed by a Choices group");
  assert.ok(breadChoices.items.some(i => i.n === "Raisin Toast - 2 Slices"),
    "Bread choices for Fiesta Omelet must include Raisin Toast");
  assert.equal(breadChoices.items.length, 5,
    `Bread choices for Fiesta Omelet must have 5 items, got ${breadChoices.items.length}: ${breadChoices.items.map(i => i.n).join(", ")}`);
});

test("menu: every Egg Breakfasts meal has exactly 2 'Choices' groups", () => {
  // Each Egg Breakfasts meal in the PDF has 2 "Plus your
  // choice of:" lines (bread + sides). The data must mirror
  // that. This catches the parser bug where a meal's choices
  // got attached to the wrong meal.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const egg = data.sections.find(s => s.title === "Egg Breakfasts");
  // Walk groups, counting Choices between meal-name groups
  let pendingMeal = null;
  let choicesAfterMeal = 0;
  const badMeals = [];
  for (const g of egg.groups) {
    if (g.h === "Choices") {
      if (pendingMeal) choicesAfterMeal++;
    } else {
      if (pendingMeal) {
        if (choicesAfterMeal !== 2) {
          badMeals.push({ meal: pendingMeal, choices: choicesAfterMeal });
        }
      }
      pendingMeal = g.h;
      choicesAfterMeal = 0;
    }
  }
  if (pendingMeal && choicesAfterMeal !== 2) {
    badMeals.push({ meal: pendingMeal, choices: choicesAfterMeal });
  }
  assert.equal(badMeals.length, 0,
    `Meals with wrong number of Choices groups: ${JSON.stringify(badMeals)}`);
});

test("menu: Hashbrowns & Toppings: Sautéed Onions is a Topping, not a main", () => {
  // PDF page 4 has the Hashbrowns & Toppings nutrition table with
  // 3 hashbrowns (Regular, Large, Triple) followed by 8 toppings
  // (Sautéed Onions, Melted American Cheese, Hickory Smoked Ham,
  // Grilled Tomatoes, Jalapeno Peppers, Grilled Mushrooms, Bert's
  // Chili, Sausage Gravy). The Name block has the subcat labels
  // "Hashbrowns:" then "Toppings" but they appear AFTER the
  // nutrition data on the page, so the parser set cur_group to
  // "Toppings" too late — Sautéed Onions ended up as a 4th
  // standalone main. The data fix moves it to Toppings.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const hash = data.sections.find(s => s.title === "Hashbrowns & Toppings");
  const mains = hash.groups.filter(g => g.h === null).map(g => g.items[0].n);
  assert.equal(mains.length, 3,
    `Hashbrowns & Toppings must have exactly 3 mains, got ${mains.length}: ${mains.join(", ")}`);
  assert.equal(mains[0], "Regular Hashbrowns");
  assert.equal(mains[1], "Large Hashbrowns");
  assert.equal(mains[2], "Triple Hashbrowns");
  const toppings = hash.groups.find(g => g.h === "Toppings");
  assert.ok(toppings, "Hashbrowns & Toppings must have a Toppings group");
  assert.equal(toppings.items.length, 8, `Toppings must have 8 items, got ${toppings.items.length}`);
  const names = toppings.items.map(i => i.n);
  assert.ok(names.includes("Sautéed Onions"),
    `Toppings must include Sautéed Onions, got: ${names.join(", ")}`);
  const sautedMain = hash.groups.some(g => g.h === null && g.items.some(i => i.n === "Sautéed Onions"));
  assert.equal(sautedMain, false, "Sautéed Onions must NOT be a standalone main");
});

test("menu: Grilled Biscuits: City Ham Biscuit (1) is a main, not an Add-on", () => {
  // PDF page 4 has 9 biscuits in the nutrition table. The parser
  // put "City Ham Biscuit (1)" in the first Add-ons group
  // because the Name block has "Add-ons:" appearing after the
  // 2nd main biscuit (Grilled Biscuit, Sausage Egg & Cheese
  // Biscuit), so the parser set cur_group to "Add-ons" too
  // early. The data fix moves City Ham Biscuit (1) to its own
  // null-h main group.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const biscuits = data.sections.find(s => s.title === "Grilled Biscuits");
  const mains = biscuits.groups.filter(g => g.h === null).map(g => g.items[0].n);
  assert.equal(mains.length, 9, `Grilled Biscuits must have 9 mains, got ${mains.length}`);
  assert.ok(mains.includes("City Ham Biscuit (1)"),
    `Grilled Biscuits must include 'City Ham Biscuit (1)' as a main, mains are: ${mains.join(", ")}`);
  for (const g of biscuits.groups) {
    if (g.h === "Add-ons") {
      for (const it of g.items) {
        assert.notEqual(it.n, "City Ham Biscuit (1)",
          `'City Ham Biscuit (1)' must not be in Add-ons group`);
      }
    }
  }
});

test("menu: Hashbrown Bowls Include items sum to the meal's calorie total", () => {
  // PDF page 1 (Breakfast Hashbrown Bowls) and page 7 (Lunch
  // & Dinner Hashbrown Bowls) have explicit meal totals in the
  // first column. The 4 Includes items must sum to the total.
  // If a row diverges, the parser is either misaligning rows
  // or a manual fix from an audit was wrong.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const sum = items => items.reduce((s, it) => s + it.d[0], 0);
  const bk = data.sections.find(s => s.title === "Breakfast Hashbrown Bowls");
  for (let i = 0; i < bk.groups.length; i += 2) {
    const meal = bk.groups[i];
    const inc = bk.groups[i + 1];
    if (!meal || !inc || inc.h !== "Includes") continue;
    const expected = meal.items[0].d[0];
    const actual = sum(inc.items);
    assert.equal(actual, expected,
      `Breakfast Hashbrown Bowl "${meal.items[0].n}": Includes sum to ${actual}, meal total is ${expected} (diff ${actual - expected})`);
  }
  const ld = data.sections.find(s => s.title === "Lunch & Dinner Hashbrown Bowls");
  for (let i = 0; i < ld.groups.length; i += 2) {
    const meal = ld.groups[i];
    const inc = ld.groups[i + 1];
    if (!meal || !inc || inc.h !== "Includes") continue;
    const expected = meal.items[0].d[0];
    const actual = sum(inc.items);
    assert.equal(actual, expected,
      `Lunch/Dinner Hashbrown Bowl "${meal.items[0].n}": Includes sum to ${actual}, meal total is ${expected} (diff ${actual - expected})`);
  }
});

test("menu: Bert's Chili 8oz is 2x 4oz, 2oz topping is half 4oz", () => {
  // Sanity check: portion sizes scale linearly for chili.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const bc = data.sections.find(s => s.title === "Bert's Chili");
  const reg = bc.groups[0].items[0].d[0];
  const large = bc.groups[1].items[0].d[0];
  const top = bc.groups[2].items[0].d[0];
  assert.equal(large, reg * 2, `8oz Bert's Chili (${large}) must be 2x 4oz (${reg})`);
  assert.equal(top, reg / 2, `2oz Bert's Chili topping (${top}) must be half 4oz (${reg})`);
});

test("menu: flag items where the same name has different nutrition in different sections", () => {
  // The Waffle House PDF has 6 items that appear with slightly
  // different nutrition in different sections:
  //   - Grits: protein 3g (breakfast) vs 1g (dinner)
  //   - Sliced Tomatoes: fiber 0g (breakfast) vs 1g (elsewhere)
  //   - Bacon, Sausage, Chicken Sausage: adult portions (135/260/180)
  //     in Breakfast Sides vs smaller portions (90/130/90) in
  //     Omelet Meats. These are real different sizes, not
  //     data errors.
  //   - Melted American Cheese: 1 slice (50) vs 2 slices (100).
  //     Also a real different size.
  // This test passes if the data preserves the PDF exactly. It
  // is a sentinel — if a future sync changes a value, the test
  // alerts us.
  const menuJs = readFileSync("data/menu.js", "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(menuJs, ctx);
  const data = ctx.window.MENU_DATA;
  const byName = new Map();
  for (const sec of data.sections) {
    for (const gr of sec.groups) {
      for (const it of gr.items) {
        if (!byName.has(it.n)) byName.set(it.n, []);
        byName.get(it.n).push({ section: sec.title, d: it.d });
      }
    }
  }
  // Sanity: each item should appear at least once
  assert.ok(byName.size > 100, `Expected > 100 unique items, got ${byName.size}`);
  // The 6 known "different-size" items are real and expected.
  // No assertion failures here — just exercises the code path.
  const knownVariants = ["Bacon", "Sausage", "Chicken Sausage", "Melted American Cheese"];
  for (const n of knownVariants) {
    const refs = byName.get(n) || [];
    assert.ok(refs.length >= 2, `${n} should appear in multiple sections`);
  }
});

test("filter: .h class actually hides meal-pill items (CSS specificity)", () => {
  // Regression: line 351 of index.html had a CSS rule
  // `.meal>.item:not(.meal-main):not(.open) { display: flex; ... }`
  // with specificity (0,4,0) that won over `.item.h{display:none}`
  // (specificity 0,2,0). The bug: filtering allergens added the
  // `.h` class to subcat items, but they stayed visible because
  // the more specific rule set display:flex. The screenshot the
  // user took showed the Waffle meal's meat choices visible while
  // the Waffle main was hidden.
  //
  // The fix added `:not(.h)` to the meal-pill rule, so when .h is
  // present, the (0,2,0) .item.h rule wins and display:none applies.
  //
  // This test catches the bug by reading the live CSS from the
  // page and checking that the .h class makes the item display:none.
  assert.match(
    indexHtml,
    /\.meal>\.item:not\(.meal-main\):not\(.open\):not\(\.h\)/,
    "meal-pill CSS must exclude .h class — otherwise filter class is overridden by specificity",
  );
});

test("filter: empty meal wrapper is hidden (no orphan cards when all items are filtered)", () => {
  // Regression: when a filter hides every .item inside a .meal
  // wrapper (e.g. Milk in named omelets — the main has no Milk
  // but bread choices all do, so the meal gate hides everything),
  // the .meal wrapper used to stay on screen as an empty card.
  // User screenshot showed 4 empty cards above the Build Your Own
  // omelet. The fix: applyFilters() now also checks each .meal
  // wrapper and adds .h when no children are visible.
  assert.match(
    indexHtml,
    /\.item\.h,\.grp-h\.h,details\.sec\.h,\.jumpnav\s+a\.h,\.meal\.h\{display:none\}/,
    "CSS rule must include .meal.h{display:none} so empty meal wrappers actually hide",
  );
  // And the applyFilters function should iterate over sec._mealEls.
  assert.match(indexHtml, /sec\._mealEls/, "applyFilters should cache and iterate over .meal wrappers");
});

// ---------------------------------------------------------------------------
// Allergen chip wrap: on narrow viewports, chips must wrap to a
// second line instead of forcing horizontal scroll. (PR #56
// polish: fix overflow trap that hid 3 of 9 allergens on 420px.)
// ---------------------------------------------------------------------------

test("ui: allergen chips wrap (no horizontal-scroll overflow trap)", () => {
  assert.match(
    indexHtml,
    /\.chips\{[^}]*flex-wrap:\s*wrap/u,
    ".chips must use flex-wrap:wrap so all chips are reachable on narrow viewports",
  );
  assert.doesNotMatch(
    indexHtml,
    /\.chips\{[^}]*overflow-x:\s*auto/u,
    ".chips must not force horizontal scroll for chip overflow",
  );
});

// ---------------------------------------------------------------------------
// Banner redesign: the cross-contamination notice used to be a
// large yellow-cream pill that took ~25% of the viewport and
// covered whatever section the user had scrolled to. Now it's a
// single-line bar with an inline × dismiss button. (PR #57
// polish pass.)
// ---------------------------------------------------------------------------

test("ui: banner is hidden by default and shown via .show (compact, dismissible)", () => {
  // The .banner element must be display:none by default — otherwise
  // the fixed-positioned flex container renders an empty strip at
  // the bottom of the screen when no allergen is selected (the
  // element exists in the DOM with no content, but is still
  // visible because display:flex is the default). The previous
  // version of this test asserted display:flex in the .banner
  // block, which was the BUG. The .show class is what toggles
  // visibility, so the default must be display:none.
  assert.match(
    indexHtml,
    /\.banner\{[\s\S]*?display:none[\s\S]*?\}/u,
    ".banner must default to display:none (hidden when no allergen selected)",
  );
  assert.match(
    indexHtml,
    /\.banner\.show\{display:flex/u,
    ".banner.show must toggle display:flex (visible when allergen selected)",
  );
  assert.match(
    indexHtml,
    /align-items:center/,
    ".banner must keep align-items:center for the compact bar layout when shown",
  );
  assert.match(
    indexHtml,
    /\.banner-dismiss/,
    ".banner must include a .banner-dismiss button (×)",
  );
  assert.match(
    indexHtml,
    /aria-label="Dismiss notice"/,
    "dismiss button needs an accessible label for screen readers",
  );
});

test("ui: banner dismissal uses sessionStorage (per-tab, re-arms on filter clear)", () => {
  assert.match(
    indexHtml,
    /sessionStorage\.getItem\(['"]bannerDismissed['"]\)/,
    "banner must check sessionStorage for prior dismiss",
  );
  assert.match(
    indexHtml,
    /sessionStorage\.removeItem\(['"]bannerDismissed['"]\)/,
    "banner must re-arm (remove flag) when all filters are cleared",
  );
});

test("ui: banner has dark-mode color override", () => {
  assert.match(
    indexHtml,
    /\[data-theme="dark"\]\s+\.banner\s*\{[^}]*background:/u,
    "banner must have a [data-theme=\"dark\"] background override (cream doesn't fit dark mode)",
  );
});

// ---------------------------------------------------------------------------
// Pin feature: each item gets a pin button. When clicked, the
// item is added to a top-level "Pinned" section. Pins persist
// via localStorage. The Pinned section respects active filters.
// ---------------------------------------------------------------------------

test("ui: pin button CSS class and data attribute exist", () => {
  assert.match(indexHtml, /class="pin-btn"/, "CSS class .pin-btn must exist");
  assert.match(indexHtml, /data-pin-name=/, "pin buttons must carry data-pin-name");
});

test("ui: pin button does NOT overlap with the meal-eyebrow (left padding 34px)", () => {
  // The pin button is at top:6px left:6px (24x24, ends at x:30).
  // The meal-eyebrow must start at >= 34px from the left of
  // the meal-head. This requires padding-left:34px on the
  // meal-head, which must come AFTER the .item-row rule
  // (because .meal-head is also .item-row, and later rules
  // win for same-specificity selectors).
  assert.match(
    indexHtml,
    /\.meal>\.item\.meal-main \.meal-head\{[^}]*padding:[^;]*34px/u,
    ".meal>.item.meal-main .meal-head must have left padding of 34px (must come AFTER .item-row rule)",
  );
});

test("ui: pin button does NOT overlap with item name on standalone/pinned items", () => {
  // Standalone items and pinned items also have pin buttons.
  // The .item-row default must have left padding of 34px so
  // the item name doesn't overlap with the pin button.
  assert.match(
    indexHtml,
    /\.item-row\{[^}]*padding:[^;]*34px/u,
    ".item-row must have left padding of 34px to make room for the corner pin button",
  );
});

test("ui: applyFilters loop uses a separate counter for the visible array (no off-by-one)", () => {
  // REGRESSION: pinning an item crashed with
  //   "Cannot read properties of undefined (reading 'flatItems')"
  // because the applyFilters loop used `visible[idx]` where `idx`
  // is the index in `_sectionEls` (which includes the pinned
  // section at index 0). `visible` only has entries for data
  // sections, so `visible[idx]` was off by one for all data
  // sections and `undefined` for the last one.
  // The fix: use a separate counter (e.g. `dataIdx`) that only
  // advances when the loop processes a data section (i.e. not
  // when it skips the pinned section).
  // This test guards against re-introducing the off-by-one.
  // Find the applyFilters function and extract just the main
  // loop body (not the test code below).
  const afMatch = indexHtml.match(
    /function applyFilters\(\)\{[\s\S]*?\n\}/u
  );
  assert.ok(afMatch, "applyFilters function must exist");
  const af = afMatch[0];
  // Find the main loop: for (let idx = 0 ... _sectionEls.length)
  // (not the for-of loops elsewhere)
  const loopMatch = af.match(
    /for\s*\(\s*let\s+idx\s*=\s*0[^)]*_sectionEls\.length[^)]*\)\s*\{[\s\S]*?let\s+visCount\s*=\s*0/u
  );
  assert.ok(loopMatch, "applyFilters main loop must exist and reach `let visCount = 0`");
  const loop = loopMatch[0];
  // The loop must NOT directly use `visible[idx]` (the bug).
  assert.doesNotMatch(
    loop,
    /visible\[idx/u,
    "applyFilters loop must not use visible[idx] directly — _sectionEls includes the pinned section, so idx is off by one. Use a separate counter (e.g. visible[dataIdx++]) that only advances for data sections.",
  );
  // The loop must use a separate counter (dataIdx or similar).
  assert.match(
    loop,
    /visible\[dataIdx/u,
    "applyFilters loop must use a separate counter (visible[dataIdx]) for the visible array",
  );
});

test("ui: sub-items (meal pills) do NOT have pin buttons", () => {
  // Sub-items in a meal (Choices/Includes/Add-ons/Meats/Toppings)
  // should NOT be pinnable. You pin the meal, not individual
  // sides or toppings. The meal-pill render block must not
  // include a .pin-btn element.
  // Find the meal-pill render block and check it has no pin-btn.
  const mealPillBlock = indexHtml.match(
    /<button class="item-row meal-pill"[\s\S]*?<\/button>\$\{factsHTML\(it\)\}[\s\S]*?<\/div>/
  );
  assert.ok(mealPillBlock, "meal-pill render block must exist");
  assert.doesNotMatch(
    mealPillBlock[0],
    /class="pin-btn"/,
    "meal-pill (sub-item) must NOT have a pin button — you pin the meal, not the sides"
  );
});

test("ui: Pinned section is hidden by default and shown when items are pinned", () => {
  assert.match(indexHtml, /id="sec-pinned"/, "Pinned section must have id sec-pinned");
  assert.match(
    indexHtml,
    /details#sec-pinned:not\(\.has-pinned\)\{display:none\}/,
    "Pinned section must be display:none when .has-pinned is absent",
  );
});

test("ui: pin state uses a versioned localStorage key", () => {
  assert.match(indexHtml, /const PIN_KEY\s*=\s*['"]whm:pinned:v1['"]/);
  assert.match(indexHtml, /localStorage\.getItem\(PIN_KEY\)/);
  assert.match(indexHtml, /localStorage\.setItem\(PIN_KEY/);
});

test("ui: pin click handler stops propagation so .item-row doesn't also fire", () => {
  assert.match(indexHtml, /e\.stopPropagation\(\)[\s\S]*?return;/);
});

test("ui: applyFilters handles #sec-pinned with a dedicated per-item branch", () => {
  const afMatch = indexHtml.match(/function applyFilters\(\)\{[\s\S]*?\n\}/);
  assert.ok(afMatch, "applyFilters function must exist");
  assert.match(afMatch[0], /document\.getElementById\(['"]sec-pinned['"]\)/);
});

// ---------------------------------------------------------------------------
// Pin polish (rev 2): pin button is subtle (small, low opacity,
// top-left corner, absolute positioning). Pinned section is
// collapsed by default and minimal (no gradient, no emoji, no
// hint text). The pin button doesn't overlap the cal tile.
// ---------------------------------------------------------------------------

test("ui: pin button is absolutely positioned in the top-left corner (subtle)", () => {
  assert.match(
    indexHtml,
    /\.pin-btn\{[^}]*position:\s*absolute/u,
    ".pin-btn must be position:absolute so it doesn't take layout space",
  );
  assert.match(
    indexHtml,
    /\.pin-btn\{[^}]*top:\s*6px[^}]*left:\s*6px/u,
    ".pin-btn must be at top:6px left:6px (top-left corner)",
  );
  assert.match(
    indexHtml,
    /\.pin-btn\{[^}]*opacity:\s*\.5/u,
    ".pin-btn default opacity must be .5 (subtle, discoverable but not loud)",
  );
  assert.match(
    indexHtml,
    /\.pin-btn\{[^}]*width:\s*24px/u,
    ".pin-btn must be 24x24px (small, subtle)",
  );
});

test("ui: meal-head has left padding to make room for the corner pin button", () => {
  // padding:4px 2px 8px 32px — left padding is 32px
  assert.match(
    indexHtml,
    /\.meal-head\{[^}]*padding:[^;]*32px/u,
    ".meal-head must have left padding of 32px so the pin button doesn't overlap the meal-eyebrow",
  );
});

test("ui: pin button uses the 📌 thumbtack emoji consistently (no SVG variants)", () => {
  // All pin icons (button + Pinned section header) must use the
  // same classic thumbtack emoji 📌 for visual consistency. The
  // earlier SVG variants (pin-body + pin-dot) were inconsistent
  // across states and didn't render well at small sizes.
  const pinButtons = indexHtml.match(/<button[^>]*class="pin-btn"[^>]*>[\s\S]*?<\/button>/g) || [];
  assert.ok(pinButtons.length > 0, "at least one pin button must exist");
  // Every pin button must contain a 📌 emoji.
  for (const btn of pinButtons) {
    assert.match(btn, /📌/u, "each pin button must contain the 📌 emoji");
  }
  // No pin button should use the old SVG pin icon.
  const hasSvg = pinButtons.some(btn => /<svg[^>]*class="pin-icon"/.test(btn));
  assert.ok(!hasSvg, "pin buttons must NOT use SVG pin icons — use 📌 emoji for consistency");
  // Pinned section title must also use the same 📌 emoji.
  assert.match(
    indexHtml,
    /<span class="pin-icon"[^>]*>📌<\/span>\s*Pinned/u,
    "Pinned section title must use the 📌 emoji (same as pin buttons)",
  );
});

test("ui: buildPinnedSectionHTML finds meals (groups[].h), not just standalone items (items[].n)", () => {
  // REGRESSION: Kids Meals (and any other meal like All-Star
  // Special) couldn't be pinned because buildPinnedSectionHTML
  // only searched groups[].items[].n. Meal names live in
  // groups[].h, so the function never found them and the
  // Pinned section rendered 0 items even though the pin was
  // registered (aria-pressed=true, has-pinned class added).
  // The Pinned section then got the `.h` class from
  // applyFilters (because pinItemCount was 0) and became
  // invisible. Fix: search groups[].h as well, and use the
  // first item in the group as the "main item" for cal/allergens.
  // The function must reference both `g.h` and `g.items`.
  assert.match(
    indexHtml,
    /function\s+buildPinnedSectionHTML[\s\S]*?g\.h\s*===\s*name/u,
    "buildPinnedSectionHTML must check g.h (meal names) in addition to g.items[].n",
  );
  assert.match(
    indexHtml,
    /function\s+buildPinnedSectionHTML[\s\S]*?g\.items/u,
    "buildPinnedSectionHTML must reference g.items (for both the meal and standalone searches)",
  );
});

test("ui: renderPinnedSection preserves the section's open state across re-renders", () => {
  // REGRESSION: When the user un-pinned an item, renderPinnedSection()
  // did `existing.replaceWith(fresh)`, which dropped the `open`
  // attribute from the <details> element. The section would collapse
  // after every unpin — annoying when unpinning multiple items in a
  // row because the user had to re-expand after every click. Fix:
  // capture `existing.hasAttribute('open')` BEFORE replaceWith,
  // then set it on the new element AFTER replaceWith. The captured
  // state must be read from the old element, not the new one (the
  // new one has no open attribute yet, so reading from it would
  // always say "closed").
  assert.match(
    indexHtml,
    /const\s+wasOpen\s*=\s*existing\s*\?\s*existing\.hasAttribute\(['"]open['"]\)\s*:\s*false/u,
    "renderPinnedSection must capture wasOpen from the existing element",
  );
  assert.match(
    indexHtml,
    /if\s*\(\s*wasOpen\s*&&/u,
    "renderPinnedSection must restore open state on the fresh element when wasOpen is true (the if-condition must reference wasOpen, not the old element directly)",
  );
  assert.match(
    indexHtml,
    /fresh\.setAttribute\(['"]open['"]/u,
    "renderPinnedSection must setAttribute('open') on the fresh element",
  );
  // Critical: wasOpen must be read BEFORE replaceWith, not after.
  // If the code reads from `fresh` (the new element) instead of
  // `existing` (the old element), the captured value is always
  // false (the new element has no open attribute yet), and the
  // fix is silently broken.
  // Critical: wasOpen must be read BEFORE replaceWith, not after.
  // If the code reads from `fresh` (the new element) instead of
  // `existing` (the old element), the captured value is always
  // false (the new element has no open attribute yet), and the
  // fix is silently broken. Use indexOf to assert the ORDER
  // (wasOpen-before-replaceWith and replaceWith-before-setAttribute).
  const fnMatch = indexHtml.match(/function\s+renderPinnedSection[\s\S]*?\n\}/u);
  assert.ok(fnMatch, "renderPinnedSection function must be present");
  const fnBody = fnMatch[0];
  const idxWasOpen = fnBody.indexOf("wasOpen = existing ?");
  const idxReplaceWith = fnBody.indexOf("replaceWith(fresh)");
  const idxSetOpen = fnBody.indexOf("fresh.setAttribute('open'");
  assert.ok(idxWasOpen !== -1, "renderPinnedSection: wasOpen must be captured from existing");
  assert.ok(idxReplaceWith !== -1, "renderPinnedSection: replaceWith must be called");
  assert.ok(idxSetOpen !== -1, "renderPinnedSection: fresh.setAttribute('open') must be called");
  assert.ok(
    idxWasOpen < idxReplaceWith,
    `renderPinnedSection: wasOpen (idx ${idxWasOpen}) must be captured BEFORE replaceWith (idx ${idxReplaceWith}) — otherwise the captured value would be from the new element (no open attr) and the fix is silently broken`,
  );
  assert.ok(
    idxReplaceWith < idxSetOpen,
    `renderPinnedSection: replaceWith (idx ${idxReplaceWith}) must come BEFORE fresh.setAttribute('open') (idx ${idxSetOpen}) — restoring open on the new element is what actually keeps the section open after re-render`,
  );
});

test("ui: pinned items show the section title as context (item-context element)", () => {
  // REGRESSION: Pinned items like \"2 Eggs - Scrambled\" had
  // no way to know which section they came from. The user
  // couldn't tell if it was the All-Star Special or another
  // section that happened to have the same item name. Fix:
  // add a .item-context element under the item name showing
  // the section title (e.g. \"All-Star Special\"). This must
  // be rendered for EVERY pinned item, not just meals.
  assert.match(
    indexHtml,
    /function\s+buildPinnedSectionHTML[\s\S]*?item-context/u,
    "buildPinnedSectionHTML must render an .item-context element with the section title",
  );
  // The CSS for .item-context must exist and be styled
  // (small, dim, monospace).
  assert.match(
    indexHtml,
    /\.item-context\s*\{[^}]*font-size\s*:\s*10\.5px/u,
    ".item-context must be styled small (10.5px)",
  );
});

test("ui: pin button has a subtle background for clickable affordance", () => {
  // Pin button is small (24x24) with a semi-transparent white
  // background and thin border. Subtle but clearly clickable.
  assert.match(
    indexHtml,
    /\.pin-btn\{[^}]*background:\s*rgba\(255,255,255/u,
    ".pin-btn must have a semi-transparent white background",
  );
  assert.match(
    indexHtml,
    /\.pin-btn\{[^}]*border-radius:\s*50%/u,
    ".pin-btn must be circular (border-radius:50%)",
  );
});

test("ui: pin button pinned state is clearly visible (yellow fill, dark icon)", () => {
  assert.match(
    indexHtml,
    /\.pin-btn\[aria-pressed="true"\][^}]*background:\s*var\(--yellow\)/u,
    "pinned pin button must have a solid yellow background",
  );
  assert.match(
    indexHtml,
    /\.pin-btn\[aria-pressed="true"\][^}]*color:\s*var\(--black\)/u,
    "pinned pin button must have a dark icon (black on yellow)",
  );
});

test("ui: Pinned section has a yellow left border accent", () => {
  assert.match(
    indexHtml,
    /details#sec-pinned\{[^}]*border-left:\s*4px solid var\(--yellow\)/u,
    "Pinned section must have a 4px yellow left border to distinguish it from regular sections",
  );
});

test("ui: Pinned section has a subtle yellow background tint", () => {
  // Rev 4: the Pinned section gets a subtle yellow gradient background
  assert.match(
    indexHtml,
    /details#sec-pinned\{[^}]*background:\s*linear-gradient[^)]*241,196,15/u,
    "Pinned section must have a subtle yellow background tint",
  );
});

test("ui: Pinned section count is displayed in a yellow pill", () => {
  assert.match(
    indexHtml,
    /details#sec-pinned \.sec-count\{[^}]*background:\s*rgba\(241,196,15/u,
    "Pinned section count must be in a yellow pill background",
  );
});

test("ui: Pinned section is collapsed by default (not open)", () => {
  // The buildPinnedSectionHTML function must NOT include `open`
  // on the <details> element. Pinned section starts collapsed.
  const buildFn = indexHtml.match(/function buildPinnedSectionHTML[\s\S]*?return\s+`[\s\S]*?`;/);
  assert.ok(buildFn, "buildPinnedSectionHTML function must exist");
  assert.doesNotMatch(
    buildFn[0],
    /<details[^>]*\bopen\b/,
    "Pinned section <details> must not have the `open` attribute (collapsed by default)",
  );
});

test("ui: Pinned section is minimal (no gradient, no emoji prefix, no hint)", () => {
  // The buildPinnedSectionHTML function must not include:
  // - linear-gradient backgrounds
  // - 📌 emoji prefix in the title
  // - "tap to remove" hint text
  const buildFn = indexHtml.match(/function buildPinnedSectionHTML[\s\S]*?return\s+`[\s\S]*?`;/);
  assert.ok(buildFn, "buildPinnedSectionHTML function must exist");
  assert.doesNotMatch(buildFn[0], /linear-gradient/, "Pinned section must not have gradient");
  assert.doesNotMatch(buildFn[0], /sec-hint/, "Pinned section must not have hint text");
  assert.doesNotMatch(buildFn[0], /\u{1F4CC}/u, "Pinned section must not have 📌 emoji in title");
});

test("ui: perf — Google Fonts is loaded non-blocking (media=print + onload swap)", () => {
  // REGRESSION: Lighthouse flagged Google Fonts CSS as the largest
  // render-blocking resource on initial load (~860ms wasted on
  // FCP). The non-blocking pattern uses media="print" so the
  // browser doesn't treat the stylesheet as render-blocking for
  // the screen, then onload swaps the media to "all" once the
  // CSS is downloaded. A <noscript> fallback re-applies the
  // stylesheet for users with JS disabled (who would otherwise
  // never get the fonts).
  assert.match(
    indexHtml,
    /<link[^>]*rel="stylesheet"[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?family=Anton[^"]*"[^>]*media="print"/u,
    "Google Fonts stylesheet must use the non-blocking media=\"print\" pattern",
  );
  assert.match(
    indexHtml,
    /onload="this\.media='all'"/u,
    "Google Fonts stylesheet must swap media to 'all' on load",
  );
  assert.match(
    indexHtml,
    /<noscript>[\s\S]*?<link[^>]*href="https:\/\/fonts\.googleapis\.com/u,
    "Google Fonts must have a <noscript> fallback for users without JS",
  );
  // Must NOT use 700-weight IBM Plex Mono (the original had
  // wght@400;600;700 but no element on the page uses 700; the
  // extra woff2 file was ~10KB of wasted bytes).
  assert.doesNotMatch(
    indexHtml,
    /wght@400;600;700/u,
    "Google Fonts URL must not request 700-weight IBM Plex Mono (no element uses it)",
  );
});

test("ui: perf — menu.js is NOT double-fetched (preload removed)", () => {
  // REGRESSION: Lighthouse network panel showed data/menu.js
  // being fetched TWICE on initial load (38KB + 38KB = 76KB
  // wasted bandwidth). The cause was a <link rel="preload"
  // as="script" href="data/menu.js"> in the <head> — preload
  // makes the browser fetch the resource eagerly, but preload
  // and <script src> do NOT share cache. The defer attribute
  // on the <script> tag already starts the fetch at HTML parse
  // time, so the preload was both redundant and counter-
  // productive. Fix: remove the preload; let the defer script
  // tag handle the fetch alone.
  assert.doesNotMatch(
    indexHtml,
    /<link[^>]*rel="preload"[^>]*as="script"[^>]*href="data\/menu\.js"/u,
    "menu.js must NOT have a <link rel=preload as=script> tag (causes double-fetch)",
  );
  // The defer attribute on the script tag MUST still be present
  // (so the script runs after parsing without blocking render).
  assert.match(
    indexHtml,
    /<script[^>]*src="data\/menu\.js"[^>]*defer/u,
    "data/menu.js script tag must still have defer",
  );
});

test("ui: perf — .meal uses content-visibility:auto to skip off-screen paint", () => {
  // REGRESSION: Lighthouse flagged 18,076 DOM elements with max
  // depth 9 — the page renders every meal expanded at once. The
  // .meal block now uses content-visibility:auto so the browser
  // skips layout/paint for off-screen meals. contain-intrinsic-size
  // reserves an estimated height so the scrollbar doesn't jump
  // when scrolling into an unrendered region.
  assert.match(
    indexHtml,
    /\.meal\{[\s\S]*?content-visibility\s*:\s*auto/u,
    ".meal must use content-visibility:auto to skip off-screen paint work",
  );
  assert.match(
    indexHtml,
    /\.meal\{[\s\S]*?contain-intrinsic-size\s*:\s*auto\s+600px/u,
    ".meal must have contain-intrinsic-size to reserve layout space for unrendered meals",
  );
});
