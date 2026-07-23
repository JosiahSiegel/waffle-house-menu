// filter.mjs — pure filter logic for the Waffle Stats menu.
//
// Imported by index.html (via <script type="module">) for the
// runtime filter UI, and by test/filter.test.mjs for the
// regression test suite that runs in PR CI. No DOM access —
// the same module runs in the browser and under node --test.

// Headers that mark a subcategory group. These are the groups
// in the parsed PDF that are *conditional add-ons* to a main
// item in the same section (e.g. "Toppings", "Add-ons"). They
// make no sense without the main item the customer is actually
// ordering — you can't order waffle toppings without ordering
// a waffle. If anyone adds a new subcategory keyword (e.g.
// "Sauces", "Sides"), they MUST update this regex in lockstep
// with the test in test/filter.test.mjs, otherwise the anchor
// filter won't fire and the original Waffles bug returns.
export const SUBCAT_RE = /^(Choices|Includes|Add-ons|Toppings|Meats)$/u;

export function isSubcat(h) {
  return typeof h === "string" && SUBCAT_RE.test(h.trim());
}

/**
 * Attach hasSubcat + anchorA + flatItems to each section.
 *   - hasSubcat: section has at least one subcategory group
 *   - anchorA:   allergens of the first item in the first
 *                non-subcategory group. The "anchor" for the
 *                section. If an allergen filter hides the
 *                anchor, the whole section is hidden.
 *   - flatItems: a flat list of all items in display order,
 *                tagged with whether they live in a subcat
 *                group. Used by computeVisibility.
 *
 * Returns a new structure; the caller's input is not mutated.
 */
export function annotateSections(sections) {
  return sections.map((sec) => {
    let hasSubcat = false;
    let anchorA = null;
    const flatItems = [];
    for (const gr of sec.groups) {
      const subcat = isSubcat(gr.h);
      if (subcat) hasSubcat = true;
      for (const it of gr.items) {
        const a = it.a || [];
        if (anchorA === null && !subcat) anchorA = a;
        flatItems.push({ name: it.n, a, subcat });
      }
    }
    return {
      ...sec,
      hasSubcat,
      anchorA: anchorA || [],
      flatItems,
    };
  });
}

/**
 * Decide which items are visible after applying the avoid set
 * and the search query. Pure: same input, same output. The
 * result mirrors the annotated input, with each flatItem
 * gaining a `visible` boolean.
 *
 * The "anchor rule" fires only when an allergen filter is
 * active and the section has subcategory groups: if the
 * anchor's allergens overlap the avoid set, every item in
 * the section is hidden. The search query is not part of the
 * anchor rule — you can still search for "pecan" inside a
 * section that an allergen filter has not gated.
 */
export function computeVisibility(annotatedSections, avoid, q) {
  const avoidSet = new Set(avoid || []);
  const qLower = (q || "").toLowerCase();
  return annotatedSections.map((sec) => {
    const anchorFiltered =
      sec.hasSubcat &&
      avoidSet.size > 0 &&
      sec.anchorA.some((a) => avoidSet.has(a));
    const flatItems = sec.flatItems.map((it) => {
      if (anchorFiltered) return { ...it, visible: false };
      const okQ = !qLower || it.name.toLowerCase().includes(qLower);
      const okA = !it.a.some((a) => avoidSet.has(a));
      return { ...it, visible: okQ && okA };
    });
    return { ...sec, flatItems };
  });
}

/**
 * Convenience: map of section title -> number of visible items
 * after filtering. Used by tests and by the section count
 * chip in the header.
 */
export function countVisibleBySection(annotatedSections, avoid, q) {
  const out = {};
  for (const sec of computeVisibility(annotatedSections, avoid, q)) {
    out[sec.title] = sec.flatItems.filter((it) => it.visible).length;
  }
  return out;
}

/**
 * List of visible item names per section. Used by tests for
 * more specific assertions than a count alone.
 */
export function visibleBySection(annotatedSections, avoid, q) {
  const out = {};
  for (const sec of computeVisibility(annotatedSections, avoid, q)) {
    out[sec.title] = sec.flatItems.filter((it) => it.visible).map((it) => it.name);
  }
  return out;
}

/**
 * Build the JSON-LD structured-data blocks for SEO. Returns an
 * array of `{ type, payload }` objects; the page appends them as
 * <script type="application/ld+json"> tags. We return a 2-tuple
 * — WebSite + Menu — so a future addition (e.g. Organization)
 * drops in without breaking the contract.
 *
 * The Menu schema mirrors the data the page renders, so the
 * rich-results data never drifts from the on-page menu.
 */
export function buildStructuredData(data) {
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Waffle Stats",
    "url": "https://wafflestats.com/",
    "description":
      "Full Waffle House menu with per-item calories and the chain's own allergen column.",
  };
  const menu = {
    "@context": "https://schema.org",
    "@type": "Menu",
    "name": "Waffle House Menu",
    "inLanguage": "en",
    "hasMenuSection": (data.sections || []).map((sec) => ({
      "@type": "MenuSection",
      "name": sec.title,
      "hasMenuItem": sec.groups
        .flatMap((g) => g.items)
        .map((it) => {
          const n = {
            "@type": "MenuItem",
            "name": it.n,
            "nutrition": {
              "@type": "NutritionInformation",
              "calories": String(it.d[0] || 0),
              "fatContent": (it.d[1] || 0) + " g",
              "saturatedFatContent": (it.d[2] || 0) + " g",
              "transFatContent": (it.d[3] || 0) + " g",
              "cholesterolContent": (it.d[4] || 0) + " mg",
              "sodiumContent": (it.d[5] || 0) + " mg",
              "carbohydrateContent": (it.d[6] || 0) + " g",
              "fiberContent": (it.d[7] || 0) + " g",
              "sugarContent": (it.d[8] || 0) + " g",
              "proteinContent": (it.d[9] || 0) + " g",
            },
          };
          if (it.note) n.description = it.note;
          if (it.a && it.a.length) n.suitableForDiet = `Avoid: ${it.a.join(", ")}`;
          return n;
        }),
    })),
  };
  return [website, menu];
}
