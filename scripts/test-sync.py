#!/usr/bin/env python3
"""Offline parser regressions; run with python3 scripts/test-sync.py."""
import copy
import json
import unittest
from unittest.mock import MagicMock, patch

import sync


class SyncTests(unittest.TestCase):
    def parse_text(self, text):
        pdf = MagicMock()
        pdf.__enter__.return_value.pages = [MagicMock()]
        pdf.__enter__.return_value.pages[0].extract_text.return_value = text
        with patch.object(sync.pdfplumber, "open", return_value=pdf), \
                patch.object(sync, "MIN_ITEMS", 1):
            return sync.parse_pdf("fixture.pdf")

    def test_centered_bread_labels_preserve_meals_and_nutrition(self):
        menu = self.parse_text("""
EGG BREAKFASTS
First Breakfast: Eggs 180 14 4 1 338 176 2 0 2 12 Egg, Soy.
White Toast - 2 Slices 130 2 0 0 0 260 25 1 3 4 Milk, Soy, Wheat.
Wheat Toast - 2 Slices 120 2 0 0 0 250 26 4 2 6 Milk, Soy, Wheat.
Raisin Toast - 2 Slices 220 3 0 0 0 280 42 2 16 6 Milk, Soy, Wheat.
Plus your choice of:
Grilled Biscuit 300 15 9 0 0 800 34 1 2 5 Egg, Milk, Soy, Wheat.
Second Breakfast: Eggs 180 14 4 1 338 176 2 0 2 12 Egg, Soy.
White Toast - 2 Slices 130 2 0 0 0 260 25 1 3 4 Milk, Soy, Wheat.
Plus your choice of: Wheat Toast - 2 Slices 120 2 0 0 0 250 26 4 2 6 Milk, Soy, Wheat.
""")
        groups = menu["sections"][0]["groups"]
        self.assertEqual([g["h"] for g in groups],
                         ["First Breakfast", "Choices", "Second Breakfast", "Choices"])
        self.assertEqual([len(g["items"]) for g in groups], [1, 4, 1, 2])
        self.assertEqual(groups[1]["items"][0], groups[3]["items"][0])
        self.assertEqual(groups[1]["items"][0]["d"], [130, 2, 0, 0, 0, 260, 25, 1, 3, 4])

    def test_wrapped_bowl_description_starts_a_new_meal(self):
        menu = self.parse_text("""
EGG BREAKFASTS
Breakfast: Eggs 180 14 4 1 338 176 2 0 2 12 Egg, Soy.
Plus your choice of: Hashbrowns 190 7 3 0 0 240 29 3 0 3 Soy.
Fiesta Protein Bowl: Grilled Chicken, 3 Eggs - Scrambled, 2 Cheese, 1 OPT
535 32 11 1 613 2279 15 1 7 53 Egg, Soy.
""")
        groups = menu["sections"][0]["groups"]
        self.assertEqual([g["h"] for g in groups],
                         ["Breakfast", "Choices", "Fiesta Protein Bowl"])
        self.assertEqual(groups[-1]["items"][0]["n"], "Fiesta Protein Bowl")
        self.assertEqual(groups[-1]["items"][0]["note"],
                         "Grilled Chicken, 3 Eggs - Scrambled, 2 Cheese, 1 OPT")

    def test_centered_toppings_and_serving_qualified_hashbrowns(self):
        menu = self.parse_text("""
Waffles
Classic Waffle House Waffle 410 18 10 0 50 870 55 2 15 8 Egg, Milk, Soy, Tree Nuts, Wheat.
Pecans - 0.75-oz 150 15 2 0 0 0 3 2 1 2 Tree Nuts.
ToppingsChocolate Chips - 0.75-oz 95 5 3 0 0 0 14 1 11 1 Soy.
Hashbrowns and Toppings
Waffle House Regular 190 7 3 0 0 240 29 3 0 3 Soy.
Hashbrowns: Large - 2 orders 380 14 6 0 0 480 58 6 0 6 Soy.
Triple - 3 orders 570 21 8 0 0 720 87 9 0 9 Soy.
Sautéed Onions - 1.5-oz 15 0 0 0 0 0 3 1 1 0
ToppingsHickory Smoked Ham - 1.5-oz 70 3 1 0 25 630 2 0 1 9
""")
        waffles, hashbrowns = [s["groups"] for s in menu["sections"]]
        self.assertEqual([g["h"] for g in waffles], [None, "Toppings"])
        self.assertEqual(waffles[1]["items"][0]["n"], "Pecans - 0.75-oz")
        self.assertEqual([g["h"] for g in hashbrowns], [None, None, None, "Toppings"])
        self.assertEqual([g["items"][0]["n"] for g in hashbrowns[:3]],
                         ["Regular Hashbrowns", "Large Hashbrowns - 2 orders",
                          "Triple Hashbrowns - 3 orders"])
        self.assertEqual(hashbrowns[-1]["items"][0]["n"], "Sautéed Onions - 1.5-oz")

    def test_wrapped_add_ons_classify_and_deduplicate_within_meal(self):
        menu = self.parse_text("""
Toddle House© Omelet Breakfasts
Build your own Omelet Breakfast
2 Egg Omelet 180 14 4 1 338 176 2 0 2 12 Egg, Soy.
Meats:Grilled Chicken - 1 breast 130 1 0 0 80 930 2 0 0 29
Sautéed Onions - 1.5-oz 15 0 0 0 0 0 3 1 1 0
Add-
Ons: Grilled Tomatoes - 1.5-oz 5 0 0 0 0 0 2 0 1 0
Grilled Chicken - 1 breast 130 1 0 0 80 930 2 0 0 29
""")
        groups = menu["sections"][0]["groups"]
        self.assertEqual([g["h"] for g in groups],
                         ["Build your own Omelet Breakfast", "Meats", "Add-ons"])
        self.assertEqual([i["n"] for i in groups[1]["items"]], ["Grilled Chicken - 1 breast"])
        self.assertEqual([i["n"] for i in groups[2]["items"]],
                         ["Sautéed Onions - 1.5-oz", "Grilled Tomatoes - 1.5-oz"])
        self.assertEqual(menu["item_count"], 4)

    def test_add_ons_preserve_their_own_allergens(self):
        menu = self.parse_text("""
100% Angus Beef Hamburgers
Hamburger 370 19 7 1 60 295 30 2 5 19 Milk, Soy, Wheat, Sesame.
Angus Patty 220 17 7 1 60 100 0 0 0 16
Bun 130 2 0 0 0 190 25 1 4 4 Soy, Wheat, Sesame.
Add Bacon - 2 slices 90 8 3 0 20 250 0 0 0 6
""")
        items = [g["items"][0] for g in menu["sections"][0]["groups"]]
        self.assertNotIn("addOn", items[0])
        self.assertTrue(all(i["addOn"] for i in items[1:]))
        self.assertEqual(items[2]["a"], ["Soy", "Wheat", "Sesame"])

    def test_cached_pdf_reproduces_committed_payloads(self):
        menu = sync.parse_pdf(sync.DATA / "latest.pdf")
        payload = json.loads((sync.DATA / "menu.json").read_text())
        meta = json.loads((sync.DATA / "meta.json").read_text())
        self.assertEqual(menu["sections"], payload["sections"])
        self.assertEqual(menu["item_count"], payload["item_count"])
        self.assertEqual(menu["item_count"], meta["item_count"])
        self.assertEqual(menu["updated"], payload["source_updated"])
        self.assertEqual((sync.DATA / "menu.js").read_text(),
                         "window.MENU_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n")
        self.assertEqual(sync.normalize_sections(copy.deepcopy(menu["sections"])), menu["sections"])


if __name__ == "__main__":
    unittest.main()
