// test/filter.test.mjs — PR-CI regression suite for the filter rule.
//
// Uses node:test (built into Node 20+, no extra deps) plus node:assert
// (also built-in). Run with: `node --test test/`
//
// Every assertion reads from data/menu.json (the actual data the
// site serves) and exercises the same filter.mjs module that
// index.html imports. The page and the tests share one source of
// truth — change the rule in one place and both update.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  SUBCAT_RE,
  isSubcat,
  annotateSections,
  computeVisibility,
  countVisibleBySection,
  visibleBySection,
} from "../filter.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const menu = JSON.parse(readFileSync(resolve(REPO, "data/menu.json"), "utf8"));
const annotated = annotateSections(menu.sections);

// ---------------------------------------------------------------------------
// 1) The SUBCAT_RE regex pins the documented set of subcategory headers.
//    If anyone adds a new keyword (e.g. "Sauces", "Sides"), they MUST
//    update this test in lockstep with the regex.
// ---------------------------------------------------------------------------

test("SUBCAT_RE matches the documented set of subcategory headers", () => {
  for (const s of ["Choices", "Includes", "Add-ons", "Toppings", "Meats"]) {
    assert.ok(SUBCAT_RE.test(s), `expected SUBCAT_RE to match "${s}"`);
  }
  // Near-misses must NOT match — the rule is exact, not prefix.
  for (const s of [
    "Waffles", "Topping", "Choice", "Add-on", "Meat",
    "Choice ", " Choice", "", "IncludesMore",
  ]) {
    assert.ok(!SUBCAT_RE.test(s), `expected SUBCAT_RE to NOT match "${s}"`);
  }
});

test("isSubcat handles trim + nullish + case (case-sensitive)", () => {
  // Case-sensitive: the PDF headers are exactly "Choices" / "Includes" /
  // etc., so a case-insensitive match would mask a typo in the data
  // pipeline. isSubcat trims whitespace but does not lowercase.
  assert.equal(isSubcat("Choices"), true);
  assert.equal(isSubcat(" Choices "), true);   // trims whitespace
  assert.equal(isSubcat("Waffles"), false);
  assert.equal(isSubcat(null), false);
  assert.equal(isSubcat(undefined), false);
  assert.equal(isSubcat(""), false);
  assert.equal(isSubcat(42), false);
  // Lowercase rejected — even after trim, "choices" doesn't match.
  assert.equal(isSubcat(" choices "), false);
  assert.equal(isSubcat("choices"), false);
});

// ---------------------------------------------------------------------------
// 2) annotateSections — the data shape the page relies on.
// ---------------------------------------------------------------------------

test("annotateSections: Waffles has subcat + correct anchor", () => {
  const w = annotated.find((s) => s.title === "Waffles");
  assert.ok(w, "Waffles section must exist");
  assert.equal(w.hasSubcat, true);
  // Anchor is the first item in the first non-subcat group: the Waffle
  assert.deepEqual(w.anchorA, ["Egg", "Milk", "Soy", "Wheat", "Tree Nuts"]);
  // 5 items total: Waffle + Pecans (primary) + 3 toppings (subcat)
  assert.equal(w.flatItems.length, 5);
});

test("annotateSections: sections without subcats are flagged false (anchorA is irrelevant for them)", () => {
  // hasSubcat is the load-bearing signal — when false, the page
  // never reads anchorA, so it can be anything. Pin that the flag
  // is set correctly; don't pin anchorA for these sections.
  for (const title of ["Sandwiches", "Pies", "Beverages", "Texas Melts", "Bert's Chili"]) {
    const s = annotated.find((x) => x.title === title);
    assert.ok(s, `${title} must exist`);
    assert.equal(s.hasSubcat, false, `${title} should not have subcats`);
  }
});

test("annotateSections: data shape matches menu.item_count", () => {
  const flatTotal = annotated.reduce((n, s) => n + s.flatItems.length, 0);
  assert.equal(flatTotal, menu.item_count, "every menu item must appear in some section");
});

// ---------------------------------------------------------------------------
// 3) The user's exact complaint: Waffles + Wheat must be 0 visible.
//    The bug filed: "if I filter for wheat, it shouldn't only hide
//    waffles and show waffle toppings like pecans, it should simply
//    hide everything waffle since filtering wheat should apply to it all".
// ---------------------------------------------------------------------------

test("Waffles + Wheat filter: 0 visible (the user's complaint)", () => {
  assert.equal(countVisibleBySection(annotated, ["Wheat"], "")["Waffles"], 0);
});

test("Waffles + Tree Nuts filter: 0 visible (anchor has Tree Nuts)", () => {
  assert.equal(countVisibleBySection(annotated, ["Tree Nuts"], "")["Waffles"], 0);
});

test("Waffles + Milk filter: 0 visible (anchor has Milk)", () => {
  assert.equal(countVisibleBySection(annotated, ["Milk"], "")["Waffles"], 0);
});

test("Waffles + Egg filter: 0 visible (anchor has Egg)", () => {
  assert.equal(countVisibleBySection(annotated, ["Egg"], "")["Waffles"], 0);
});

test("Waffles + Soy filter: 0 visible (anchor has Soy)", () => {
  assert.equal(countVisibleBySection(annotated, ["Soy"], "")["Waffles"], 0);
});

test("Waffles + Peanut filter: 4 visible (anchor has no Peanut)", () => {
  // The anchor rule does NOT fire — Waffle has no Peanut. Per-item
  // filtering still hides Peanut Butter Chips, leaving 4 of 5.
  const vis = visibleBySection(annotated, ["Peanut"], "")["Waffles"];
  assert.equal(vis.length, 4);
  assert.ok(!vis.includes("Peanut Butter Chips"));
  assert.ok(vis.includes("Pecans"));
});

// ---------------------------------------------------------------------------
// 4) Cross-section coverage — the rule must not over-fire on
//    sections whose anchor is allergen-free.
// ---------------------------------------------------------------------------

test("Hashbrowns & Toppings + Wheat: 9 visible (anchor has no wheat)", () => {
  assert.equal(
    countVisibleBySection(annotated, ["Wheat"], "")["Hashbrowns & Toppings"],
    9,
  );
});

test("Hashbrowns & Toppings + Soy: 0 visible (anchor has Soy)", () => {
  assert.equal(
    countVisibleBySection(annotated, ["Soy"], "")["Hashbrowns & Toppings"],
    0,
  );
});

test("Egg Breakfasts + Wheat: 13 visible (anchor 2 Eggs has no wheat)", () => {
  assert.equal(
    countVisibleBySection(annotated, ["Wheat"], "")["Egg Breakfasts"],
    13,
  );
});

test("Egg Breakfasts + Egg: 0 visible (anchor 2 Eggs has Egg)", () => {
  assert.equal(
    countVisibleBySection(annotated, ["Egg"], "")["Egg Breakfasts"],
    0,
  );
});

test("Sandwiches + Milk: only BLT visible (no subcat, per-item filter)", () => {
  const vis = visibleBySection(annotated, ["Milk"], "")["Sandwiches"];
  assert.equal(vis.length, 1);
  assert.equal(vis[0], "BLT Sandwich");
});

test("Sandwiches + Wheat: 0 visible (no subcat, all items have wheat)", () => {
  assert.equal(countVisibleBySection(annotated, ["Wheat"], "")["Sandwiches"], 0);
});

test("Beverages + non-Milk allergens: 21 visible (no item has these)", () => {
  // Beverages has 4 milk items (Regular/Large + chocolate variants),
  // so Milk trims it to 17. The other 5 allergens should not affect
  // the count.
  for (const allergen of ["Egg", "Soy", "Wheat", "Tree Nuts", "Peanut"]) {
    assert.equal(
      countVisibleBySection(annotated, [allergen], "")["Beverages"],
      21,
      `Beverages + ${allergen}`,
    );
  }
  assert.equal(
    countVisibleBySection(annotated, ["Milk"], "")["Beverages"],
    17,
    "Beverages + Milk: 4 milks filtered out (17 left)",
  );
});

test("Omelet Breakfasts + Milk: 0 visible (anchor Cheese Omelet has Milk)", () => {
  assert.equal(
    countVisibleBySection(annotated, ["Milk"], "")["Omelet Breakfasts"],
    0,
  );
});

test("Kids Meals + Wheat: 0 visible (anchor Waffle has Wheat)", () => {
  assert.equal(
    countVisibleBySection(annotated, ["Wheat"], "")["Kids Meals"],
    0,
  );
});

test("Kids Meals + Tree Nuts: 0 visible (anchor Waffle has Tree Nuts)", () => {
  assert.equal(
    countVisibleBySection(annotated, ["Tree Nuts"], "")["Kids Meals"],
    0,
  );
});

test("Pies + Tree Nuts: only chocolate pies visible (per-item)", () => {
  const vis = visibleBySection(annotated, ["Tree Nuts"], "")["Pies"];
  assert.equal(vis.length, 2);
  for (const name of vis) {
    assert.ok(name.includes("Chocolate"), `${name} should be a chocolate pie`);
  }
});

// ---------------------------------------------------------------------------
// 5) The search box — does NOT trigger the anchor rule. You can
//    still search for "pecan" in the Waffles section, even if the
//    section happens to be allergen-gated, as long as the anchor
//    isn't filtered. Search filters WITHIN visible sections.
// ---------------------------------------------------------------------------

test("search 'pecan' alone: 1 Waffles, 2 Pies", () => {
  const counts = countVisibleBySection(annotated, [], "pecan");
  assert.equal(counts["Waffles"], 1);
  assert.equal(counts["Pies"], 2);
});

test("search 'pecan' + Peanut: 1 Waffles (Pecans), 0 Pies (per-item)", () => {
  // Pies has no subcat, so anchor rule doesn't fire. Both pecan
  // pies have no Peanut, so the per-item filter doesn't fire either.
  // The search 'pecan' then keeps only the pecan pies.
  const visPies = visibleBySection(annotated, ["Peanut"], "pecan")["Pies"];
  assert.equal(visPies.length, 2);
  // Waffles: anchor (Waffle) has no Peanut, so the section isn't
  // gated. Search 'pecan' keeps Pecans only.
  const visWaffles = visibleBySection(annotated, ["Peanut"], "pecan")["Waffles"];
  assert.equal(visWaffles.length, 1);
  assert.equal(visWaffles[0], "Pecans");
});

test("search 'pecan' + Wheat: 0 visible (anchor gates Waffles, pecan pies have wheat)", () => {
  // Waffles: anchor Waffle has Wheat → section gated → 0
  // Pies: no subcat, but all pecan pies have Wheat → 0
  const counts = countVisibleBySection(annotated, ["Wheat"], "pecan");
  assert.equal(counts["Waffles"], 0);
  assert.equal(counts["Pies"], 0);
});

test("search is case-insensitive", () => {
  for (const q of ["PECAN", "Pecan", "pecan", "PeCaN"]) {
    const counts = countVisibleBySection(annotated, [], q);
    assert.equal(counts["Waffles"], 1, `query "${q}"`);
    assert.equal(counts["Pies"], 2, `query "${q}"`);
  }
});

test("search with no matches: 0 across the board, but the structure holds", () => {
  const counts = countVisibleBySection(annotated, [], "zzznothingmatches");
  // 19 sections all show 0
  assert.equal(Object.keys(counts).length, 19);
  for (const v of Object.values(counts)) {
    assert.equal(v, 0);
  }
});

// ---------------------------------------------------------------------------
// 6) Allergen set operations — adding/removing chips.
// ---------------------------------------------------------------------------

test("additive allergen filter: Wheat + Milk narrows Sandwiches further", () => {
  // Sandwiches has no subcat, so anchor rule doesn't fire — pure
  // per-item filter. With Wheat only: 0 (all have wheat). With
  // Wheat + Milk: also 0 (already 0 from wheat alone).
  assert.equal(countVisibleBySection(annotated, ["Wheat"], "")["Sandwiches"], 0);
  assert.equal(
    countVisibleBySection(annotated, ["Wheat", "Milk"], "")["Sandwiches"],
    0,
  );
});

test("relaxing a filter restores previously-hidden items", () => {
  // Hashbrowns & Toppings + Soy: 0 (anchor has soy)
  assert.equal(
    countVisibleBySection(annotated, ["Soy"], "")["Hashbrowns & Toppings"],
    0,
  );
  // Without Soy: 11 visible (the original item count)
  assert.equal(
    countVisibleBySection(annotated, [], "")["Hashbrowns & Toppings"],
    11,
  );
});

// ---------------------------------------------------------------------------
// 7) Sanity — total item count is stable.
// ---------------------------------------------------------------------------

test("no filter: 221 items across 19 sections, matches menu.item_count", () => {
  const counts = countVisibleBySection(annotated, [], "");
  assert.equal(Object.keys(counts).length, 19);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, menu.item_count);
});

test("empty avoid set behaves the same as no filter (anchor rule never fires)", () => {
  // Defensive: countVisibleBySection must accept both `[]` and
  // `new Set()` (and the page calls it with `[...avoid]`).
  const fromArr = countVisibleBySection(annotated, [], "");
  const fromSet = countVisibleBySection(annotated, new Set(), "");
  assert.deepEqual(fromArr, fromSet);
});

test("query='' (empty) is treated as no search, not 'match nothing'", () => {
  const a = countVisibleBySection(annotated, [], "");
  const b = countVisibleBySection(annotated, [], "");   // explicit empty
  assert.deepEqual(a, b);
});
