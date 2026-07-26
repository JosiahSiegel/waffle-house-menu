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
    const flatItems = sec.flatItems.map((it) => {
      // Meal-level gate: if the item is in a meal whose mealA
      // overlaps the avoid set, hide the item. Applies to main
      // and ALL subcat items in the meal.
      if (!invert && avoidSet.size > 0 && it.inMeal && it.mealA.some(a => avoidSet.has(a))) {
        return { ...it, visible: false };
      }
      const okA = invert
        ? it.a.some(a => avoidSet.has(a))
        : !it.a.some(a => avoidSet.has(a));
      const okQ = !qLower || it.name.toLowerCase().includes(qLower);
      return { ...it, visible: okA && okQ };
    });
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
