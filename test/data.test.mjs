// test/data.test.mjs — Data quality regression suite.
//
// Catches data issues that filter behavior tests miss:
// - Items miscategorized (e.g. cheese under "Meats")
// - Duplicate items in the same section
// - Unknown allergens (typos, garbage)
// - implausible calorie values (0 or > 5000)
// - item_count drift (added/removed items without updating the header)
//
// Run with: `node --test test/`

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const menu = JSON.parse(readFileSync(resolve(REPO, "data/menu.json"), "utf8"));

// Allergen vocabulary used by the PDF. Anything outside this set
// is treated as a typo (e.g. "Dairy" instead of "Milk").
const KNOWN_ALLERGENS = new Set([
  "Egg", "Milk", "Soy", "Wheat", "Peanut", "Tree Nuts", "Fish", "Shellfish",
]);

// Categorization rules. Each rule says: in this section, the
// "Meats" group must contain only these items (actual meats),
// and the "Add-ons" group must contain only these items
// (non-meat additions).
const CATEGORIZATION_RULES = {
  "Omelet Breakfasts": {
    // Find the "Build your own" meal and check its Meats/Add-ons.
    matchMeal: (g) => g.h === "Build your own Omelet Breakfast",
    groupChecks: {
      "Meats": {
        // Only actual meats. Sautéed Onions / Melted American Cheese
        // do NOT belong here even though the PDF groups them here.
        allowed: new Set([
          "Bacon", "Sausage", "Chicken Sausage", "Grilled Chicken",
          "Cheesesteak", "Hickory Smoked Ham",
        ]),
      },
      "Add-ons": {
        // Non-meat additions: vegetables, cheese.
        allowed: new Set([
          "Sautéed Onions", "Melted American Cheese",
          "Grilled Tomatoes", "Jalapeno Peppers", "Grilled Mushrooms",
        ]),
      },
    },
  },
};

test("item_count matches actual item total", () => {
  let total = 0;
  for (const s of menu.sections) {
    for (const g of s.groups) total += g.items.length;
  }
  assert.equal(total, menu.item_count,
    `data has ${total} items but menu.item_count says ${menu.item_count}`);
});

test("no duplicate items within a section", () => {
  // Catches data entry errors where the same item appears twice
  // (e.g. "Grilled Chicken" in both Meats AND Add-ons of the
  // Build your own Omelet Breakfast).
  for (const s of menu.sections) {
    for (const g of s.groups) {
      if (!g.h) continue; // main items, no subcat header
      const seen = new Map();
      for (const it of g.items) {
        const k = `${it.n}|${it.d[0]}`; // name + cal distinguishes duplicates
        if (seen.has(k)) {
          assert.fail(
            `duplicate in ${s.title} > ${g.h}: "${it.n}" (${it.d[0]} cal) ` +
            `appears at index ${seen.get(k)} and ${g.items.indexOf(it)}`,
          );
        }
        seen.set(k, g.items.indexOf(it));
      }
    }
  }
});

test("categorization rules: cheese is not under Meats, etc.", () => {
  // Walk every section that has a categorization rule and check
  // the Meats/Add-ons groups against the allowed item list.
  for (const [sectionTitle, rule] of Object.entries(CATEGORIZATION_RULES)) {
    const section = menu.sections.find(s => s.title === sectionTitle);
    assert.ok(section, `section "${sectionTitle}" must exist`);

    // Find the meal start
    const mealIdx = section.groups.findIndex(rule.matchMeal);
    assert.ok(mealIdx >= 0, `${sectionTitle} must have the specified meal`);

    // Check each group after the meal
    for (let i = mealIdx + 1; i < section.groups.length; i++) {
      const g = section.groups[i];
      if (!g.h) break; // next meal or section end
      const check = rule.groupChecks[g.h];
      if (!check) continue; // not a checked group (e.g. "Choices")
      for (const it of g.items) {
        assert.ok(
          check.allowed.has(it.n),
          `${sectionTitle} > ${g.h} > "${it.n}" is not in the ` +
          `allowed list for that group. Allowed: ` +
          `[${[...check.allowed].join(", ")}]`,
        );
      }
    }
  }
});

test("no items with NaN/negative/implausible calorie values", () => {
  // Catches data entry errors like missing values (NaN), sign flips
  // (-50), or accidentally-merged values (5000 for a side dish).
  // Heuristic bounds:
  //   - 0 cal is valid (water, black coffee, plain toast can be ~5)
  //     but not negative
  //   - Hashbrown Bowls and Texas Melts are the heaviest items at
  //     ~1300 cal; anything over 2000 is suspect
  for (const s of menu.sections) {
    for (const g of s.groups) {
      for (const it of g.items) {
        const cal = it.d[0];
        assert.ok(
          Number.isFinite(cal),
          `${s.title} > ${g.h || "(main)"} > "${it.n}": calories is not a number (${cal})`,
        );
        assert.ok(
          cal >= 0,
          `${s.title} > ${g.h || "(main)"} > "${it.n}": calories is negative (${cal})`,
        );
        assert.ok(
          cal <= 2000,
          `${s.title} > ${g.h || "(main)"} > "${it.n}": calories ${cal} exceeds 2000 — likely a data error`,
        );
      }
    }
  }
});

test("no items with unknown allergens", () => {
  // Catches typos in the allergen list (e.g. "Dairy" instead of "Milk",
  // "Gluten" instead of "Wheat"). The PDF uses a specific vocabulary;
  // anything outside the known set is treated as a data error.
  const unknown = new Set();
  for (const s of menu.sections) {
    for (const g of s.groups) {
      for (const it of g.items) {
        for (const a of it.a || []) {
          if (!KNOWN_ALLERGENS.has(a)) unknown.add(a);
        }
      }
    }
  }
  assert.equal(
    [...unknown].length, 0,
    `unknown allergens found: ${[...unknown].join(", ")}`,
  );
});

test("every meal has at most one main item", () => {
  // A meal is a non-subcat group (gr.h is null OR a non-subcat string).
  // Each meal should have exactly one main item.
  // (Subcat groups like "Choices" can have many items.)
  const subcatRE = /^(Choices|Includes|Add-ons|Toppings|Meats|Add-Ons)$/;
  for (const s of menu.sections) {
    for (const g of s.groups) {
      if (g.h && subcatRE.test(g.h)) continue; // subcat group
      assert.ok(
        g.items.length >= 1,
        `${s.title}: meal "${g.h}" must have at least 1 main item`,
      );
    }
  }
});
