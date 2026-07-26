// filter.mjs — pure filter logic for the Waffle Stats menu.
//
// Imported by index.html (via <script type="module">) for the
// runtime filter UI, and by test/filter.test.mjs for the
// regression test suite that runs in PR CI. No DOM access —
// the same module runs in the browser and under node --test.

// Headers that mark a subcategory group.
export const SUBCAT_RE = /^(Choices|Includes|Add-ons|Toppings|Meats)$/u;

// "Required" subcat: items are part of the meal total.
export const REQUIRED_SUBCAT = "Includes";

// "Optional" subcats: items are alternatives the customer picks.
const OPTIONAL_SUBCATS = new Set(["Choices", "Add-ons", "Toppings", "Meats"]);

export function isSubcat(h) {
  return typeof h === "string" && SUBCAT_RE.test(h.trim());
}

export function isRequiredSubcat(h) {
  return h === REQUIRED_SUBCAT;
}

// Category-specific labels for "Choices" groups.
const TOAST_NAMES = new Set([
  "White Toast - 2 Slices", "Wheat Toast - 2 Slices",
  "Raisin Toast - 2 Slices", "Grilled Biscuit", "Texas Toast - 1 Slice"
]);
const SIDE_NAMES = new Set([
  "Grits", "Cheese Grits", "Hashbrowns", "Regular Hashbrowns",
  "Sliced Tomatoes", "Tomatoes"
]);
const MEAT_NAMES = new Set([
  "Bacon", "Bacon - 3 Slices", "Sausage", "Sausage - 2 patties",
  "Chicken Sausage", "Chicken Sausage - 2 patties",
  "Kid's Bacon", "Kid's Sausage", "Kid's Chicken Sausage",
  "City Ham", "City Ham - 1 Slice", "Country Ham", "Country Ham - 1 Slice"
]);

export function choicesLabel(items) {
  if (!items || items.length === 0) return "Choices";
  const names = items.map(it => it.n);
  if (names.every(n => TOAST_NAMES.has(n))) return "Choose Your Bread";
  if (names.every(n => SIDE_NAMES.has(n))) return "Choose Your Side";
  if (names.every(n => MEAT_NAMES.has(n))) return "Choose Your Meat";
  return "Choices";
}

function unionAllergens(items) {
  const out = new Set();
  for (const it of items || []) for (const a of it.a || []) out.add(a);
  return out;
}

/**
 * Walk a section's groups and produce a flat list of items
 * with per-item metadata. A "meal" is one non-subcat group
 * plus any subcat groups that follow it.
 *
 * mealA = union of (main item allergens) + (all "Includes"
 * items' allergens). Used by the filter to gate the whole
 * meal if any of these are filtered.
 */
function flattenSection(sec) {
  const flatItems = [];
  let hasSubcat = false;
  let mealStart = 0;
  let mealA = [];
  let inMeal = false;

  function closeMeal(endIdx) {
    if (!inMeal) return;
    for (let i = mealStart; i < endIdx; i++) {
      flatItems[i].mealA = mealA;
      flatItems[i].inMeal = true;
    }
  }

  for (const gr of sec.groups) {
    const subcat = isSubcat(gr.h);
    if (subcat) {
      hasSubcat = true;
      if (!inMeal) continue;
      if (isRequiredSubcat(gr.h)) {
        for (const a of unionAllergens(gr.items)) {
          if (!mealA.includes(a)) mealA.push(a);
        }
      }
      for (const it of gr.items) {
        flatItems.push({ name: it.n, a: it.a || [], mealA, inMeal: true, subcat: gr.h });
      }
    } else {
      closeMeal(flatItems.length);
      mealStart = flatItems.length;
      const mainItem = gr.items[0];
      mealA = mainItem ? [...(mainItem.a || [])] : [];
      inMeal = true;
      for (const it of gr.items) {
        flatItems.push({ name: it.n, a: it.a || [], mealA, inMeal: true, subcat: null });
      }
    }
  }
  closeMeal(flatItems.length);
  return { flatItems, hasSubcat };
}

export function annotateSections(sections) {
  return sections.map((sec) => {
    const { flatItems, hasSubcat } = flattenSection(sec);
    return { ...sec, hasSubcat, flatItems };
  });
}

export function computeVisibility(annotatedSections, avoid, q, opts) {
  const avoidSet = new Set(avoid || []);
  const qLower = (q || "").toLowerCase();
  const invert = !!(opts && opts.invert);
  return annotatedSections.map((sec) => {
    // Meal-level gate only applies to sections with subcats.
    // For standalone sections (Sandwiches, Pies, Beverages, etc.)
    // every item is its own "meal" and the per-item check is
    // sufficient. Grouping by mealA would incorrectly merge
    // unrelated items that happen to share allergens (e.g. all
    // 17 allergen-free Beverages items have mealA=[] and would
    // be treated as one meal).
    const useMealGate = sec.hasSubcat && avoidSet.size > 0;

    // Section-level add-on rule (applies to sections WITHOUT
    // subcats that follow the "mains + add-ons" PDF pattern).
    // A "section-level add-on" is an item in a null-h group with
    // empty allergens positioned AFTER the section's main items —
    // e.g. "Add Bacon" in Texas Melts or "Angus Patty" in Angus
    // Burgers. The PDF positions these as general add-ons that
    // apply to ANY of the section's main items, not to a specific
    // one. So when the user filters an allergen that hides every
    // main item in the section, the add-ons must also hide —
    // "Add Bacon" without a melt to add to is meaningless UX.
    //
    // The "mains + add-ons" pattern in the data:
    //   - Section has null-h groups with allergens at the start
    //     (a contiguous block)
    //   - Then null-h groups with no allergens at the end
    //   - NO allergen-free groups BEFORE the first allergen group
    //     (this distinguishes Texas Melts/Angus Burgers from
    //     Beverages, where allergen-free items are interleaved)
    //
    // In normal mode, an add-on is hidden iff NO main item in the
    // section is visible after per-item + meal-gate checks.
    // In invert mode, this rule doesn't apply — the per-item
    // check is the authority (add-ons without the allergen would
    // already be hidden by per-item).
    const addOnIdx = new Set();
    if (!sec.hasSubcat && avoidSet.size > 0 && !invert) {
      // Walk flatItems, classify each as 'all' (has allergens),
      // 'free' (no allergens), or 'subcat' (subcat != null). The
      // section matches the add-on pattern iff:
      //   - there's at least one 'all' item
      //   - all 'all' items come before all 'free' items
      //   - there are no 'subcat' items
      let firstAllIdx = -1, lastAllIdx = -1, firstFreeIdx = -1;
      for (let i = 0; i < sec.flatItems.length; i++) {
        const it = sec.flatItems[i];
        if (it.subcat !== null) { firstAllIdx = -2; break; } // not applicable
        if (it.a && it.a.length > 0) {
          if (firstAllIdx === -1) firstAllIdx = i;
          lastAllIdx = i;
        } else {
          if (firstFreeIdx === -1) firstFreeIdx = i;
        }
      }
      // Pattern matches: at least one allergen item, allergen
      // items come before any allergen-free item, no subcats.
      if (firstAllIdx >= 0 && (firstFreeIdx === -1 || firstAllIdx < firstFreeIdx)) {
        for (let i = lastAllIdx + 1; i < sec.flatItems.length; i++) {
          const it = sec.flatItems[i];
          if (it.subcat === null && (!it.a || it.a.length === 0)) {
            addOnIdx.add(i);
          }
        }
      }
    }

    // Pre-compute which meals are "active" (should be shown as a
    // unit). A meal is active when:
    //   - Normal mode: no avoided allergen is in the meal's required
    //     components (mealA). If the meal is safe, show it whole.
    //   - Invert mode: at least one item in the meal has an avoided
    //     allergen. The user is looking for items with the allergen,
    //     so a meal that contains one is worth showing whole.
    // Items in an inactive meal are hidden entirely; items in an
    // active meal all show (the meal is a unit).
    const inactiveMeals = new Set();
    if (useMealGate) {
      // Walk flatItems in order. A "meal" is a contiguous run of
      // items that share the same mealA (the main item starts a
      // new meal; subcat items belong to the current meal). This
      // is more precise than grouping by mealA because two meals
      // can share the same mealA (e.g. two allergen-free Kids
      // Meals have the same mealA=[] but are separate meals).
      let i = 0;
      while (i < sec.flatItems.length) {
        const start = i;
        const mealA = sec.flatItems[i].mealA;
        // Advance until we hit a different meal or end of section.
        while (i < sec.flatItems.length && sec.flatItems[i].mealA === mealA) {
          i++;
        }
        // The items [start, i) belong to one meal.
        const mealItems = sec.flatItems.slice(start, i);
        const mealHasAllergen = mealItems.some(it => it.a.some(a => avoidSet.has(a)));
        if (invert) {
          if (!mealHasAllergen) inactiveMeals.add(mealA.join("\0") + "@" + start);
        } else {
          if (mealA.some(a => avoidSet.has(a))) inactiveMeals.add(mealA.join("\0") + "@" + start);
        }
      }
    }

    const flatItems = sec.flatItems.map((it, idx) => {
      if (useMealGate) {
        // Find which meal this item belongs to. Walk backward
        // while the current item is a subcat item (subcat !== null);
        // stop when we reach the main item (subcat === null), which
        // is the meal start.
        let mealStart = idx;
        while (mealStart > 0 && sec.flatItems[mealStart].subcat !== null) {
          mealStart--;
        }
        const mealA = sec.flatItems[mealStart].mealA;
        const mealKey = mealA.join("\0") + "@" + mealStart;
        if (inactiveMeals.has(mealKey)) return { ...it, visible: false };
        // In invert mode, when a meal is active (contains the
        // allergen), show ALL items in the meal — the user is
        // looking for the meal, not individual items. The per-item
        // check is skipped.
        if (invert) {
          const okQ = !qLower || it.name.toLowerCase().includes(qLower);
          return { ...it, visible: okQ };
        }
      }
      // Normal mode: apply per-item allergen check + search query.
      const okA = !it.a.some(a => avoidSet.has(a));
      const okQ = !qLower || it.name.toLowerCase().includes(qLower);
      const baseVisible = okA && okQ;
      // Section-level add-on rule: if this is a section-level
      // add-on (null-h, empty allergens) and the rule is active,
      // also require at least one main item in the section to be
      // visible. The check is done in a second pass below so the
      // visibility of other items is known first.
      if (addOnIdx.has(idx)) {
        return { ...it, _isAddOn: true, visible: baseVisible };
      }
      return { ...it, visible: baseVisible };
    });

    // Section-level add-on second pass: if any add-on is in the
    // list, decide whether to hide all add-ons by checking if any
    // main item in the section is visible.
    if (addOnIdx.size > 0) {
      const anyMainVisible = flatItems.some((it, idx) => !addOnIdx.has(idx) && it.visible);
      if (!anyMainVisible) {
        for (let i = 0; i < flatItems.length; i++) {
          if (addOnIdx.has(i)) flatItems[i] = { ...flatItems[i], visible: false };
        }
      }
      // Strip the temporary _isAddOn marker.
      for (let i = 0; i < flatItems.length; i++) {
        if (flatItems[i]._isAddOn) delete flatItems[i]._isAddOn;
      }
    }

    return { ...sec, flatItems };
  });
}

export function countVisibleBySection(annotatedSections, avoid, q, opts) {
  const out = {};
  for (const sec of computeVisibility(annotatedSections, avoid, q, opts)) {
    out[sec.title] = sec.flatItems.filter((it) => it.visible).length;
  }
  return out;
}

export function visibleBySection(annotatedSections, avoid, q, opts) {
  const out = {};
  for (const sec of computeVisibility(annotatedSections, avoid, q, opts)) {
    out[sec.title] = sec.flatItems.filter((it) => it.visible).map((it) => it.name);
  }
  return out;
}

export function buildStructuredData(data) {
  const website = {
    "@context": "https://schema.org", "@type": "WebSite",
    "name": "Waffle Stats", "url": "https://wafflestats.com/",
    "description": "Full Waffle House menu with per-item calories and the chain's own allergen column.",
  };
  const menu = {
    "@context": "https://schema.org", "@type": "Menu",
    "name": "Waffle House Menu", "inLanguage": "en",
    "hasMenuSection": (data.sections || []).map((sec) => ({
      "@type": "MenuSection", "name": sec.title,
      "hasMenuItem": sec.groups.flatMap((g) => g.items).map((it) => {
        const n = {
          "@type": "MenuItem", "name": it.n,
          "nutrition": { "@type": "NutritionInformation",
            "calories": String(it.d[0] || 0),
            "fatContent": (it.d[1] || 0) + " g",
            "saturatedFatContent": (it.d[2] || 0) + " g",
            "transFatContent": (it.d[3] || 0) + " g",
            "cholesterolContent": (it.d[4] || 0) + " mg",
            "sodiumContent": (it.d[5] || 0) + " mg",
            "carbohydrateContent": (it.d[6] || 0) + " g",
            "fiberContent": (it.d[7] || 0) + " g",
            "sugarContent": (it.d[8] || 0) + " g",
            "proteinContent": (it.d[9] || 0) + " g" },
        };
        if (it.note) n.description = it.note;
        if (it.a && it.a.length) n.suitableForDiet = `Avoid: ${it.a.join(", ")}`;
        return n;
      }),
    })),
  };
  return [website, menu];
}
