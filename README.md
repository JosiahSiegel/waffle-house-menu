# Waffle House Menu

Mobile-friendly Waffle House menu with per-item nutrition and allergen data,
auto-synced from the official nutritionals PDF on wafflehouse.com.

**Why sync is non-trivial:** Waffle House uploads each revision to a new
WordPress path (`/wp-content/uploads/YYYY/MM/<name>.pdf`) that can't be
guessed ahead of time. Instead of guessing, `scripts/sync.py` scrapes the
stable page **https://www.wafflehouse.com/nutrition/**, which always links
the current PDF, then downloads and parses it.

## How it works

```
.github/workflows/sync.yml   weekly cron (Mon 09:17 UTC) + manual trigger
scripts/sync.py              discover -> download -> sha256 diff -> parse
data/menu.json               parsed menu (sections/groups/items + allergens)
data/menu.js                 same payload as window.MENU_DATA (used by the site)
data/meta.json               source URL, sha256, timestamps
data/latest.pdf              cached copy of the source PDF
index.html                   static site, renders data/menu.js
```

- The parser extracts every item's 10 nutrition columns plus the allergen
  list, de-duplicates the repeated "plus your choice of" blocks, and fails
  loudly (sanity check: >= 100 items) if the PDF layout ever changes enough
  to break parsing — so a bad parse never gets published.
- The site has an **Avoid** filter chip for every allergen present in the
  PDF's allergen column (currently Egg, Milk, Soy, Wheat, Tree Nuts, Peanut;
  chips appear automatically if future PDFs add Fish, Shellfish, or Sesame).
  Selected allergens hide any item that lists them. Driven entirely by the
  PDF's own data, not name heuristics.
- The workflow commits `data/` only when the PDF's sha256 or parsed output
  changes.

## Setup

1. Push this repo to GitHub.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Settings → Actions → General → Workflow permissions → "Read and write
   permissions" (needed for the sync commit).
4. Run the "Sync Waffle House nutritionals" workflow manually once, or wait
   for Monday.

## Local run

```bash
pip install -r requirements.txt
python scripts/sync.py
# then open index.html
```

## Notes

- wafflehouse.com is behind Cloudflare. A browser-like User-Agent gets
  through today; if the workflow ever starts failing with HTTP 403, that's
  Cloudflare tightening up, and the fetch step will need a headless-browser
  fallback (e.g. playwright).
- Not affiliated with Waffle House, Inc. Data belongs to them.
