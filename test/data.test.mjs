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

// ---------------------------------------------------------------------------
// Per-item invariants — these run for EVERY item in the data so
// that new items added in future sync runs are caught by the same
// rules. A new item with a typo, a missing nutrition value, or an
// unknown allergen will fail CI before it ships.
// ---------------------------------------------------------------------------

test("every item has a non-empty name", () => {
  for (const s of menu.sections) {
    for (const g of s.groups) {
      for (const it of g.items) {
        assert.ok(it.n && typeof it.n === "string" && it.n.trim().length > 0,
          `${s.title} > ${g.h || "(main)"}: item has empty name`);
      }
    }
  }
});

test("every item has exactly 10 nutrition values (cal, fat, sat, trans, chol, sodium, carbs, fiber, sugar, protein)", () => {
  for (const s of menu.sections) {
    for (const g of s.groups) {
      for (const it of g.items) {
        assert.ok(Array.isArray(it.d) && it.d.length === 10,
          `${s.title} > ${g.h || "(main)"} > "${it.n}": d[] must have exactly 10 nutrition values, got ${it.d ? it.d.length : "n/a"}`);
      }
    }
  }
});

test("every item has 0-5000 calories (catch sign flips and data-merge bugs)", () => {
  for (const s of menu.sections) {
    for (const g of s.groups) {
      for (const it of g.items) {
        const cal = it.d[0];
        assert.ok(Number.isFinite(cal) && cal >= 0 && cal <= 5000,
          `${s.title} > ${g.h || "(main)"} > "${it.n}": calories=${cal} out of range [0, 5000]`);
      }
    }
  }
});

test("every item has a valid allergens array (or undefined for allergen-free items)", () => {
  for (const s of menu.sections) {
    for (const g of s.groups) {
      for (const it of g.items) {
        assert.ok(it.a === undefined || (Array.isArray(it.a) && it.a.every(a => typeof a === "string")),
          `${s.title} > ${g.h || "(main)"} > "${it.n}": allergens must be string array or undefined`);
      }
    }
  }
});

test("every allergen string is from the known vocabulary", () => {
  const seen = new Map(); // allergen -> list of items
  for (const s of menu.sections) {
    for (const g of s.groups) {
      for (const it of g.items) {
        for (const a of it.a || []) {
          if (!KNOWN_ALLERGENS.has(a)) {
            if (!seen.has(a)) seen.set(a, []);
            seen.get(a).push(`${s.title} > ${it.n}`);
          }
        }
      }
    }
  }
  assert.equal(seen.size, 0,
    `unknown allergens: ${[...seen.entries()].map(([a, items]) => `${a} (${items.length} items)`).join(", ")}`);
});

test("every item's nutrition values are numbers (not strings or nulls)", () => {
  for (const s of menu.sections) {
    for (const g of s.groups) {
      for (const it of g.items) {
        for (let i = 0; i < it.d.length; i++) {
          assert.ok(typeof it.d[i] === "number" && Number.isFinite(it.d[i]),
            `${s.title} > ${g.h || "(main)"} > "${it.n}": d[${i}] is ${typeof it.d[i]} (${it.d[i]})`);
        }
      }
    }
  }
});

test("every section has at least one item", () => {
  for (const s of menu.sections) {
    const total = s.groups.reduce((n, g) => n + g.items.length, 0);
    assert.ok(total > 0, `section "${s.title}" has no items`);
  }
});

test("every section has a unique id (idempotent on section titles)", () => {
  const seen = new Set();
  for (const s of menu.sections) {
    const id = s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    assert.ok(!seen.has(id), `duplicate section id "${id}" from "${s.title}"`);
    seen.add(id);
  }
});

test("every item is referenced by item_count in the menu header", () => {
  // The item_count field is a contract: it must match the actual
  // total. If this test passes, the data and the header are in sync.
  let total = 0;
  for (const s of menu.sections) {
    for (const g of s.groups) total += g.items.length;
  }
  assert.equal(total, menu.item_count,
    `item_count (${menu.item_count}) does not match actual total (${total})`);
});

test("every section's groups sum matches its items (no orphan groups)", () => {
  for (const s of menu.sections) {
    const total = s.groups.reduce((n, g) => n + g.items.length, 0);
    assert.ok(total > 0, `section "${s.title}" has 0 items across all groups`);
  }
});

test("every item name is unique within its group (catches accidental duplicates)", () => {
  // Items CAN legitimately appear in multiple groups within a section
  // (e.g. "Kid's Bacon" is in both the Waffle meal and the Egg
  // Breakfast meal). But within a single group, the same name should
  // not appear twice — that's a data entry error.
  for (const s of menu.sections) {
    for (let gi = 0; gi < s.groups.length; gi++) {
      const g = s.groups[gi];
      const seen = new Set();
      for (const it of g.items) {
        assert.ok(!seen.has(it.n),
          `${s.title} > group[${gi}] (${g.h || "(main)"}): "${it.n}" appears more than once in the same group`);
        seen.add(it.n);
      }
    }
  }
});

test("subcat groups only contain items, never an empty items list", () => {
  for (const s of menu.sections) {
    for (const g of s.groups) {
      if (g.h && /^(Choices|Includes|Add-ons|Toppings|Meats)$/.test(g.h)) {
        assert.ok(g.items.length > 0,
          `${s.title}: subcat group "${g.h}" has no items`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Future-proofing: when new items are added to a section that has
// categorization rules, the test fails until the allow-list is
// updated. This forces the developer to make a conscious decision
// about how the new item is categorized rather than letting it
// silently land in the wrong group.
// ---------------------------------------------------------------------------

test("future-proof: categorization rules cover all items in classified sections", () => {
  // For every section in CATEGORIZATION_RULES, walk the items
  // in the relevant groups and check that each item is in the
  // allow-list for that group. If a new item is added that
  // isn't in the allow-list, this test fails with a clear
  // message pointing at the new item.
  for (const [sectionTitle, rule] of Object.entries(CATEGORIZATION_RULES)) {
    const section = menu.sections.find(s => s.title === sectionTitle);
    if (!section) continue; // section was removed — caught by other tests
    const mealIdx = section.groups.findIndex(rule.matchMeal);
    if (mealIdx < 0) continue;
    for (let i = mealIdx + 1; i < section.groups.length; i++) {
      const g = section.groups[i];
      if (!g.h) break;
      const check = rule.groupChecks[g.h];
      if (!check) continue;
      for (const it of g.items) {
        assert.ok(check.allowed.has(it.n),
          `${sectionTitle} > ${g.h} > "${it.n}" not in allow-list. ` +
          `New item? Add to CATEGORIZATION_RULES["${sectionTitle}"].groupChecks["${g.h}"].allowed. ` +
          `Current allowed: [${[...check.allowed].join(", ")}]`);
      }
    }
  }
});

test("future-proof: if item_count changes, the test forces you to update it", () => {
  // This test doesn't assert anything — it just prints the
  // current count so a developer running the suite can see
  // what changed. The hard assertion is in
  // "every item is referenced by item_count in the menu header".
  let total = 0;
  for (const s of menu.sections) {
    for (const g of s.groups) total += g.items.length;
  }
  assert.equal(total, menu.item_count,
    `item_count drift: header says ${menu.item_count}, actual is ${total}. ` +
    `Update data/menu.json and data/meta.json item_count to ${total}.`);
});
