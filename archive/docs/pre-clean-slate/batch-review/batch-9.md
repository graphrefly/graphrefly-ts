# Batch 9 — Documentation audit (TypeScript) — follow-up

## Live site: API URLs and 404s

**Issue:** Links such as `https://graphrefly.dev/api/fromEvent` returned 404 on case-sensitive static hosting.

**Cause:** Astro’s content layer builds slugs with GitHub-style slugging per path segment (`fromEvent` → `fromevent`). The real page is `/api/fromevent/`, not `/api/fromEvent`. Bookmarks, JSDoc `{@link}`, and muscle memory from the export name use camelCase.

**Fix attempt 1 (reverted):** Astro `redirects` generated from filename stems (e.g. `/api/fromEvent` → `/api/fromevent/`). This created `fromEvent/index.html` redirect files alongside `fromevent/index.html` content files. On macOS (case-insensitive FS) the redirect overwrote the content page, causing an infinite redirect loop. On Linux CI the files coexist but the approach adds unnecessary build complexity.

**Fix (current):** Inline `<script>` in Starlight `head` config that lowercases `location.pathname` and redirects via `location.replace()`. GitHub Pages serves `404.html` for any path that doesn’t match — the script detects the case mismatch and redirects to the canonical lowercase URL. Works on both case-sensitive (Linux/GitHub Pages) and case-insensitive (macOS) filesystems. No `github-slugger` dependency needed.

## GEN-API registry (`website/scripts/gen-api-docs.mjs`)

- `REGISTRY` includes `fromEvent` → `src/extra/sources.ts`, `fromWebhook` → `src/extra/adapters.ts`, etc.
- Re-run `pnpm docs:gen` (or `prebuild`) after changing JSDoc so `website/src/content/docs/api/*.md` stays in sync; use `pnpm docs:gen:check` in CI if desired.

## Sidebar (`website/astro.config.mjs`)

- Manual sidebar links already use lowercase slugs (e.g. `/api/fromevent`), consistent with generated routes.

## Spot-check

- Generated pages follow JSDoc after regen; `examples/basic-counter.ts` is a separate manual smoke test when core APIs change.

## llms.txt

- Synced into the site via `website/scripts/sync-docs.mjs` from repo root `llms.txt`.
