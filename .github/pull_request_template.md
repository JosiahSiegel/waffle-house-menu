## What

<!-- One-paragraph summary of the change. -->

## Why

<!-- Link to the issue, the user request, or the bug report that motivated this. -->

## Preview

<!-- REQUIRED: paste the deployed preview URL here before requesting review.
     Agent (or human) must run `node scripts/snap.mjs <url>` against the
     preview to confirm the change works end-to-end before opening the PR. -->

🔗 **Preview URL:** https://\<paste-preview-url\>.space.minimax.io/

## Test plan

- [ ] `node --test "test/*.test.mjs"` passes (73/73)
- [ ] `python -m pytest test/` passes (18/18)
- [ ] `node scripts/snap.mjs <preview-url>` confirms expected DOM state
- [ ] Manual smoke test in browser (search, filter, jump-nav, invert, clear)

## Screenshots

<!-- Optional: attach before/after screenshots from the preview. -->
