# GraphReFly docs site (Astro + Starlight)

Ports the callbag-recharge visual language (dark aqua palette, hero motion, typography) onto [Starlight](https://starlight.astro.build/). This repo is **graphrefly-ts**; browser Python / Pyodide lives in **graphrefly-py** (`website/` there).

## Commands

```bash
pnpm install
pnpm sync-docs    # copies ../docs/*.md into src/content/docs/ with frontmatter
pnpm dev          # predev runs sync-docs
pnpm build        # prebuild runs sync-docs
pnpm preview
```

## GitHub Pages

Set the site URL and base path when building (project pages use `/repo-name/`):

```bash
ASTRO_SITE_URL=https://your-org.github.io ASTRO_BASE_PATH=/graphrefly-ts/ pnpm build
```

Deploy the `dist/` output (e.g. `peaceiris/actions-gh-pages` with `publish_dir: website/dist`).
