#!/usr/bin/env python3
"""
Regression test for the allergen anchor filter in index.html.

The site has a subcategory-aware filter rule: when a section has
subcategory groups (Toppings, Add-ons, Choices, Includes, Meats),
the first non-subcategory item is the section's "anchor". If an
allergen filter hides the anchor, the entire section is hidden,
because subcategory items are useless without the main item the
customer is actually ordering (e.g. you can't order waffle toppings
without ordering a waffle).

This script loads data/menu.json, replicates the exact rule from
index.html's render() + applyFilters(), and asserts a handful of
known-true cases. The point isn't to test the page rendering — the
page is what users see — but to make sure any future change to
SUBCAT_RE or the anchor rule does not silently regress the Waffles
case the user filed.

Run: python scripts/test-allergen-anchor.py
Exit: 0 if all assertions pass, 1 otherwise.
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MENU = REPO / "data" / "menu.json"

# MUST match the regex in index.html. If you change one, change both.
SUBCAT_RE = re.compile(r"^(Choices|Includes|Add-ons|Toppings|Meats)$", re.IGNORECASE)


def is_subcat(h):
    return isinstance(h, str) and bool(SUBCAT_RE.match(h.strip()))


def build_sections(menu):
    """Mirror the render() data flow: flat item list per section + anchor."""
    out = []
    for sec in menu["sections"]:
        has_subcat = False
        anchor_a = None
        items = []
        for gr in sec["groups"]:
            subcat = is_subcat(gr.get("h"))
            if subcat:
                has_subcat = True
            for it in gr["items"]:
                a = it.get("a", [])
                if anchor_a is None and not subcat:
                    anchor_a = a
                items.append({"name": it["n"], "a": a, "subcat": subcat})
        out.append({
            "title": sec["title"],
            "has_subcat": has_subcat,
            "anchor_a": anchor_a or [],
            "items": items,
        })
    return out


def visible_count(sections, avoid):
    avoid = set(avoid)
    counts = {}
    for sec in sections:
        anchor_filtered = (
            sec["has_subcat"]
            and avoid
            and any(a in avoid for a in sec["anchor_a"])
        )
        n = 0
        for it in sec["items"]:
            if anchor_filtered:
                continue
            if any(a in avoid for a in it["a"]):
                continue
            n += 1
        counts[sec["title"]] = n
    return counts


def assert_eq(label, actual, expected):
    ok = actual == expected
    mark = "OK " if ok else "FAIL"
    print(f"  [{mark}] {label}: got {actual}, expected {expected}")
    return ok


def main():
    if not MENU.exists():
        print(f"FAIL: {MENU} not found. Run scripts/sync.py first.", file=sys.stderr)
        return 1
    menu = json.loads(MENU.read_text())
    sections = build_sections(menu)

    failures = 0
    print("== Wheat filter ==")
    c = visible_count(sections, ["Wheat"])
    failures += not assert_eq("Waffles section hidden entirely (anchor = Waffle has Wheat)", c.get("Waffles", -1), 0)
    failures += not assert_eq("Hashbrowns & Toppings: hashbrowns stay, subcat filtered per-item", c.get("Hashbrowns & Toppings", -1), 9)
    failures += not assert_eq("Sandwiches section hidden (no subcat, but every item has Wheat)", c.get("Sandwiches", -1), 0)
    failures += not assert_eq("Pies section hidden (no subcat, all items have Wheat)", c.get("Pies", -1), 0)
    failures += not assert_eq("Beverages unchanged (no allergens)", c.get("Beverages", -1), 21)

    print("== Tree Nuts filter ==")
    c = visible_count(sections, ["Tree Nuts"])
    failures += not assert_eq("Waffles hidden (anchor Waffle has Tree Nuts)", c.get("Waffles", -1), 0)
    failures += not assert_eq("Kids Meals hidden (anchor Waffle has Tree Nuts)", c.get("Kids Meals", -1), 0)
    failures += not assert_eq("Pies shows only chocolate pies (no subcat, per-item)", c.get("Pies", -1), 2)

    print("== Peanut filter ==")
    c = visible_count(sections, ["Peanut"])
    failures += not assert_eq("Waffles stays (Waffle has no Peanut), only Peanut Butter Chips hidden", c.get("Waffles", -1), 4)
    failures += not assert_eq("Pies unchanged (no item has Peanut)", c.get("Pies", -1), 4)

    print("== Milk filter ==")
    c = visible_count(sections, ["Milk"])
    failures += not assert_eq("Waffles hidden (anchor has Milk)", c.get("Waffles", -1), 0)
    failures += not assert_eq("Omelet Breakfasts hidden (anchor Cheese Omelet has Milk)", c.get("Omelet Breakfasts", -1), 0)
    failures += not assert_eq("Sandwiches: only BLT visible (no Milk)", c.get("Sandwiches", -1), 1)

    print("== Soy filter ==")
    c = visible_count(sections, ["Soy"])
    failures += not assert_eq("Egg Breakfasts hidden (anchor 2 Eggs has Soy)", c.get("Egg Breakfasts", -1), 0)
    failures += not assert_eq("Hashbrowns & Toppings hidden (anchor Regular Hashbrowns has Soy)", c.get("Hashbrowns & Toppings", -1), 0)

    print("== No filter (sanity) ==")
    c = visible_count(sections, [])
    failures += not assert_eq("All 19 sections visible", len(c), 19)
    failures += not assert_eq("Total item count matches menu.item_count", sum(c.values()), menu["item_count"])

    if failures:
        print(f"\n{failures} assertion(s) failed.")
        return 1
    print(f"\nAll assertions passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
