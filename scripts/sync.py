#!/usr/bin/env python3
"""
Sync Waffle House nutritionals.

1. Discover the latest nutritionals PDF by scraping the stable page
   https://www.wafflehouse.com/nutrition/ (the upload path changes per
   release, e.g. /wp-content/uploads/2026/05/Menu-Nutritionals-2026-05-05.pdf,
   but the /nutrition/ page always links the current one).
2. Download it and compare sha256 against data/meta.json.
3. Parse the PDF into structured menu data.
4. Write data/menu.json, data/menu.js (same payload as a JS global so the
   site also works from file://), data/meta.json, and cache data/latest.pdf.

Exit codes: 0 = success (changed or unchanged), 1 = hard failure.
Prints "CHANGED" or "UNCHANGED" on the last line for the workflow.
"""
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

DISCOVERY_PAGES = [
    "https://www.wafflehouse.com/nutrition/",
    "https://www.wafflehouse.com/menus/",
    "https://www.wafflehouse.com/",
]
PDF_LINK_RE = re.compile(
    r"https://www\.wafflehouse\.com/wp-content/uploads/[^\s\"'<>]+?\.pdf", re.I
)
HEADERS = {
    # wafflehouse.com sits behind Cloudflare; the default python-requests UA
    # gets challenged, a browser-ish UA does not (as of 2026-07).
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Minimum parsed items for the output to be considered sane. If a future PDF
# redesign breaks the parser, fail loudly instead of publishing junk.
MIN_ITEMS = 100

NUM = r"-?\d+(?:\.\d+)?"
ITEM_RE = re.compile(
    rf"^(?P<name>.+?)\s+(?P<nums>{NUM}(?:\s+{NUM}){{9}})\s*(?P<all>[A-Za-z][A-Za-z ,.&-]*)?$"
)
CONT_RE = re.compile(rf"^(?P<nums>{NUM}(?:\s+{NUM}){{9}})\s*(?P<all>[A-Za-z][A-Za-z ,.&-]*)?$")
SKIP_RE = re.compile(r"^(Name Cal\b|\(g\) \(mg\)|Updated \d{2}/\d{2}/\d{2}\b|#N/A|2,000 CALORIES)")
UPDATED_RE = re.compile(r"Updated (\d{2}/\d{2}/\d{2})")
GROUP_LABEL_RE = re.compile(
    r"^(Toppings|Add-?Ons?|Meats|Includes|Plus your choice of)\s*:?\s*", re.I
)

# Canonical section key -> display title. Keys are normalized (lowercase, no
# trademark glyphs, "continued" stripped). Covers section names seen across
# PDF revisions; unknown ALL-CAPS lines still become sections via fallback.
SECTIONS = {
    "breakfast all-star special": "All-Star Special",
    "all-star special": "All-Star Special",
    "breakfast hashbrown bowls": "Breakfast Hashbrown Bowls",
    "egg breakfasts": "Egg Breakfasts",
    "waffles": "Waffles",
    "hashbrowns and toppings": "Hashbrowns & Toppings",
    "breakfast sides": "Breakfast Sides",
    "grilled biscuits": "Grilled Biscuits",
    "breakfast sandwiches and melts": "Breakfast Sandwiches & Melts",
    "kids meals": "Kids Meals",
    "toddle house omelet breakfasts": "Omelet Breakfasts",
    "lunch/dinner hashbrown bowls": "Lunch & Dinner Hashbrown Bowls",
    "classic dinners": "Classic Dinners",
    "usda choice steak dinners": "USDA Choice Steak Dinners",
    "texas melts": "Texas Melts",
    "regular bert's chili": "Bert's Chili",
    "100% angus beef hamburgers": "Angus Beef Hamburgers",
    "sandwiches": "Sandwiches",
    "pies": "Pies",
    "salads": "Salads",
    "beverages": "Beverages",
}

NAME_FIXUPS = {
    "Waffle House Regular": "Regular Hashbrowns",
    "Hashbrowns: Large": "Large Hashbrowns",
    "Triple": "Triple Hashbrowns",
}


def log(*a):
    print(*a, file=sys.stderr)


def get(url, **kw):
    last = None
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30, **kw)
            if r.status_code == 200:
                return r
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after retries: {last}")


def discover_pdf_url():
    for page in DISCOVERY_PAGES:
        try:
            html = get(page).text
        except RuntimeError as e:
            log(f"discovery: {e}")
            continue
        links = list(dict.fromkeys(PDF_LINK_RE.findall(html)))
        nutrition = [u for u in links if re.search(r"nutrit", u, re.I)] or links
        if nutrition:
            log(f"discovery: found {nutrition[0]} on {page}")
            return nutrition[0]
    meta_path = DATA / "meta.json"
    if meta_path.exists():
        prev = json.loads(meta_path.read_text()).get("source_url")
        if prev:
            log(f"discovery: falling back to last known URL {prev}")
            return prev
    raise RuntimeError("could not discover a nutritionals PDF URL on any page")


# ---------------------------------------------------------------- parsing

def section_key(line):
    s = re.sub(r"[™©®]", "", line).strip().lower()
    s = re.sub(r"\s+continued$", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def clean_allergens(raw):
    if not raw:
        return []
    known = ["Egg", "Milk", "Soy", "Wheat", "Tree Nuts", "Peanut",
             "Fish", "Shellfish", "Sesame"]
    return [k for k in known if re.search(rf"\b{re.escape(k)}\b", raw, re.I)]


def parse_nums(s):
    out = []
    for tok in s.split():
        v = float(tok)
        out.append(int(v) if v.is_integer() else v)
    return out


def clean_name(name):
    name = re.sub(r"\(\s+", "(", name)
    name = re.sub(r"\s+\)", ")", name)
    return re.sub(r"\s+", " ", name).strip()


def split_name(raw):
    """Return (group_or_none, name_or_none, note_or_none)."""
    name = clean_name(raw)
    name = re.sub(r"^:\s*", "", name)
    inline_group = None
    m = GROUP_LABEL_RE.match(name)
    if m:
        label = m.group(1)
        inline_group = ("Choices" if label.lower().startswith("plus")
                        else label.title().replace("Add-Ons", "Add-ons"))
        name = name[m.end():].strip() or None
        if name is None:
            return inline_group, None, None
    m = re.match(r"^(Toppings|Add-?Ons?|Meats|Includes)([A-Z].+)$", name or "")
    if m:
        inline_group = m.group(1).title()
        name = m.group(2).strip()
    name = NAME_FIXUPS.get(name, name)
    note, group = None, inline_group
    if name and ": " in name:
        left, right = (p.strip() for p in name.split(": ", 1))
        if "," in right:
            name, note = left, right          # "Bowl: component, list, ..."
        else:
            group, name = left, right         # "Meal Name: Item"
    return group, name, note


def titlecase_fallback(s):
    t = re.sub(r"[™©®]", "", s).strip().title()
    t = re.sub(r"'([A-Z])", lambda m: "'" + m.group(1).lower(), t)
    return t


def parse_pdf(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        lines, updated = [], None
        for page in pdf.pages:
            for ln in (page.extract_text() or "").split("\n"):
                ln = ln.strip()
                if not ln:
                    continue
                if updated is None:
                    m = UPDATED_RE.search(ln)
                    if m:
                        updated = m.group(1)
                lines.append(ln)

    sections, cur_sec, cur_group, pending = [], None, None, None

    def ensure_section(title):
        nonlocal cur_sec, cur_group
        for s in sections:
            if s["title"] == title:
                cur_sec, cur_group = s, None
                return
        cur_sec = {"title": title, "groups": []}
        sections.append(cur_sec)
        cur_group = None

    def add_item(name, nums, allergens, note=None, group=None):
        nonlocal cur_group
        if cur_sec is None:
            ensure_section("Menu")
        if group is not None:
            cur_group = group
        # a new "... Bowl" total line ends any Includes component block
        if cur_group == "Includes" and group is None and re.search(r"Bowl$", name):
            cur_group = None
        key = (name, tuple(nums))
        for g in cur_sec["groups"]:
            for it in g["items"]:
                if (it["n"], tuple(it["d"])) == key:
                    return  # de-dup repeated choice blocks within a section
        grp = next((g for g in cur_sec["groups"] if g["h"] == cur_group), None)
        if grp is None:
            grp = {"h": cur_group, "items": []}
            cur_sec["groups"].append(grp)
        item = {"n": name, "d": nums, "a": allergens}
        if note:
            item["note"] = note
        grp["items"].append(item)

    def handle_non_item(ln):
        nonlocal cur_group
        key = section_key(ln)
        if key in SECTIONS:
            ensure_section(SECTIONS[key])
        elif ln == ln.upper() and 8 < len(ln) < 60 and not re.search(r"\d", ln):
            ensure_section(titlecase_fallback(ln))   # unknown future section
        else:
            g, n, _ = split_name(ln)
            cur_group = n or g or ln

    for ln in lines:
        if SKIP_RE.match(ln):
            continue
        if pending is not None:
            m = CONT_RE.match(ln)
            if m:
                group, name, note = split_name(pending)
                pending = None
                if name:
                    add_item(name, parse_nums(m.group("nums")),
                             clean_allergens(m.group("all")), note, group)
                continue
            prev, pending = pending, None
            handle_non_item(prev)

        m = ITEM_RE.match(ln)
        if m:
            group, name, note = split_name(m.group("name"))
            if name:
                add_item(name, parse_nums(m.group("nums")),
                         clean_allergens(m.group("all")), note, group)
            elif group:
                cur_group = group
            continue
        if section_key(ln) in SECTIONS:
            handle_non_item(ln)
        elif 3 <= len(ln) <= 90:
            pending = ln   # group header, wrapped item name, or new section

    if pending is not None:
        handle_non_item(pending)

    sections = [
        {"title": s["title"],
         "groups": [g for g in s["groups"] if g["items"]]}
        for s in sections
    ]
    sections = [s for s in sections if s["groups"]]
    n_items = sum(len(g["items"]) for s in sections for g in s["groups"])
    if n_items < MIN_ITEMS:
        raise RuntimeError(
            f"parse sanity check failed: only {n_items} items parsed "
            f"(minimum {MIN_ITEMS}). PDF layout may have changed.")
    return {"updated": updated, "sections": sections, "item_count": n_items}


# ---------------------------------------------------------------- main

def main():
    url = discover_pdf_url()
    pdf_bytes = get(url).content
    if not pdf_bytes.startswith(b"%PDF"):
        raise RuntimeError(f"downloaded content from {url} is not a PDF")
    sha = hashlib.sha256(pdf_bytes).hexdigest()

    meta_path = DATA / "meta.json"
    prev_sha = None
    if meta_path.exists():
        prev_sha = json.loads(meta_path.read_text()).get("sha256")

    pdf_path = DATA / "latest.pdf"
    pdf_path.write_bytes(pdf_bytes)

    menu = parse_pdf(pdf_path)
    payload = {
        "source_url": url,
        "source_updated": menu["updated"],
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": sha,
        "item_count": menu["item_count"],
        "sections": menu["sections"],
    }
    (DATA / "menu.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False))
    (DATA / "menu.js").write_text(
        "window.MENU_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n")
    meta_path.write_text(json.dumps(
        {"source_url": url, "sha256": sha, "fetched_at": payload["fetched_at"],
         "source_updated": menu["updated"], "item_count": menu["item_count"]},
        indent=1))

    log(f"parsed {menu['item_count']} items across "
        f"{len(menu['sections'])} sections (source updated {menu['updated']})")
    print("CHANGED" if sha != prev_sha else "UNCHANGED")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERROR: {e}")
        sys.exit(1)
