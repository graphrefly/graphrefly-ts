# Marketing, Promotion & Domain Strategy

**SESSION DATE:** April 3, 2026
**TOPIC:** Comprehensive marketing strategy for GraphReFly — package descriptions, keywords, domain setup, site architecture, callbag-recharge deprecation plan, and phased promotion roadmap.

---

## Context

GraphReFly has two implementations (TypeScript, Python) approaching publishable state. The predecessor `callbag-recharge` has a mature VitePress blog (30 posts, 8 arcs) and marketing research. This session established the public-facing identity, discoverability infrastructure, and promotion plan.

## Key Decisions

### 1. Package & Repo Descriptions

**npm (`@graphrefly/graphrefly-ts`):**
> Reactive graph protocol for human + LLM co-operation. Composable nodes, glitch-free diamond resolution, two-phase push, framework adapters (React/Vue/Svelte/Solid/NestJS), durable streaming. Zero dependencies.

**npm keywords (20):** reactive, graph, state-management, signals, streaming, llm, ai-agents, observable, derived-state, diamond-resolution, orchestration, durable-workflow, callbag, framework-agnostic, react, vue, svelte, solid, nestjs, zero-dependency.

**GitHub topics** set for all three repos (graphrefly, graphrefly-ts, graphrefly-py) with language-specific and shared topics.

### 2. Domain & Site Architecture

**Decision: Single Starlight site per language, shared apex domain.**

| Domain | Repo | Purpose |
|--------|------|---------|
| `graphrefly.dev` | graphrefly-ts | Main site — TS API docs, spec, blog, comparisons |
| `py.graphrefly.dev` | graphrefly-py | Python API docs, spec, Pyodide lab |

**Rejected alternatives:**
- Separate apex site in `~/src/graphrefly` spec repo — rejected because it fragments SEO authority and adds build complexity for a repo that is internal-only (spec + workspace)
- Subpath (`graphrefly.dev/python/`) — rejected because it couples two repo builds and complicates CI
- Cloudflare Pages instead of GitHub Pages — rejected for now; GitHub Pages already works, CF sits in front as DNS/CDN proxy regardless

**Header nav:** `[TS] [PY]` pill-style language switcher added to both sites' Starlight headers, linking cross-domain.

### 3. Cloudflare Configuration (graphrefly.dev)

Domain registered on Cloudflare. Key settings:

| Category | Setting | Value |
|----------|---------|-------|
| SSL/TLS | Mode | Full (Strict) |
| SSL/TLS | Minimum TLS | 1.2 |
| SSL/TLS | TLS 1.3, 0-RTT, Always HTTPS | ON |
| DNS | DNSSEC | ON |
| DNS | SPF | `v=spf1 -all` (no-send domain) |
| DNS | DMARC | `v=DMARC1; p=reject; adkim=s; aspf=s;` |
| DNS | Null MX | `0 .` |
| Security | Bot Fight Mode | ON (monitor for Googlebot false positives) |
| Security | Block AI Bots | **OFF** (want AI crawler discoverability) |
| Performance | HTTP/3, Early Hints, Tiered Cache | ON |

### 4. AI Discoverability Strategy

**Permissive `robots.txt`** — explicitly allows GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, CCBot. Sitemap reference included.

**`llms.txt`** — curated AI-readable entry point to docs/API.

**Both files live at repo root** (single source of truth) and are synced to `website/public/` by `sync-docs.mjs` during build.

### 5. Build Pipeline Updates

`sync-docs.mjs` extended to copy `robots.txt` and `llms.txt` from repo root to `website/public/`. Both files gitignored in `website/.gitignore`. `--check` mode validates staleness in CI.

### 6. Three Positioning Pillars

1. **"The Missing Middle"** — between simple signals (Jotai/Zustand) and heavy stream processors (RxJS/XState). GraphReFly gives composable reactive graphs with signal DX and stream power.
2. **"Durable by Default"** — LLM token streams that survive network failures, checkpointable graph state, resumable workflows. No external infrastructure required.
3. **"Inspectable AI Orchestration"** — every node has observable state. Debug multi-agent systems with granular transparency. The trust layer that agentic AI needs.

### 7. callbag-recharge Deprecation Plan

| Step | Action |
|------|--------|
| npm deprecation | `npm deprecate @callbag-recharge/callbag-recharge "Succeeded by @graphrefly/graphrefly-ts"` |
| README banner | Prominent redirect to GraphReFly |
| Blog migration | Port 30 chronicle posts to graphrefly.dev, reframe as "predecessor story leading to GraphReFly" |
| GitHub archive | Archive repo (read-only) after migration guide published |

### 8. Phased Promotion Roadmap

**Phase A (Foundation):** Domain, npm org (done), PyPI org (pending), GitHub org, killer README, `llms.txt`, docs site.

**Phase B (Soft Launch):** npm publish v0.1.0, Show HN, Reddit (r/typescript, r/javascript, r/reactjs), Dev.to syndication, callbag-recharge deprecation.

**Phase C (Growth):** AI-focused Reddit (r/AI_Agents, r/LangChain, r/LocalLLaMA), X threads, Discord server, comparison pages (vs Zustand/RxJS/XState/LangGraph), migration guide.

**Phase D (Sustained):** Weekly blog cadence, compat wrappers as adoption Trojan horse, conference talks (TSConf, React Summit, ViteConf), Product Hunt at v1.0.

## Predecessor Research Incorporated

- `~/src/callbag-recharge/src/archive/docs/callbag-marketing-research-20260321-161450.md` — Gemini deep research on market positioning, competitor analysis, niche communities
- `~/src/callbag-recharge/docs/blog-strategy.md` — 30-post chronicle plan, discovery strategy, growth flywheel model, VitePress site architecture

## Current Status (as of session date)

| Asset | Status |
|-------|--------|
| graphrefly.dev domain | Registered on Cloudflare, DNS configured |
| py.graphrefly.dev subdomain | Configured, GitHub Pages + Cloudflare proxy |
| GitHub repo descriptions + topics | Set for all 3 repos |
| npm package.json description + keywords | Updated |
| robots.txt + llms.txt pipeline | Implemented and building |
| Language switcher nav | Added to both TS and PY sites |
| GitHub Actions workflows | Updated for custom domains |
| npm org (@graphrefly) | Created |
| PyPI org (GraphReFly) | Pending community application |
| callbag-recharge deprecation | Not yet executed |
| Blog migration | Plan complete — 14 port, 10 rewrite, 6 drop |
| README overhaul | Done — comparison table, quick start, acknowledgments |
| Show HN / Reddit posts | Not yet drafted |
| Discord server | Not yet created |

## 9. Blog Migration Plan

**Triage of 30 callbag-recharge chronicle posts:**

- **Tier 1 — Port directly (14 posts):** Universal concepts carried forward into GraphReFly. Minimal reframe — replace "callbag-recharge" with "GraphReFly's predecessor", update code examples. Includes: #3 Signals Are Not Enough, #8 Two-Phase Push, #12 RESOLVED, #14 Output Slot, #17 Bitmask Flag Packing, #18 Diamond Resolution, #22 Promises Are the New Callback Hell, #26 The Missing Middle, #28 Skip DIRTY, #30 Why We Don't Use queueMicrotask, and 4 more.
- **Tier 2 — Rewrite substantially (10 posts):** Reference callbag-specific concepts (Type 0/1/2, 6 primitives) that GraphReFly replaced. Story becomes "here's what we learned, here's how GraphReFly does it better." Includes: #1 Callbag Is Dead (becomes "The Road to GraphReFly"), #13 Five Primitives (now ONE primitive), #21 Cost of Correctness (update benchmarks), #25 From Zustand (update to GR compat wrappers).
- **Tier 3 — Drop / archive (6 posts):** Too tied to callbag-recharge internals that don't exist in GraphReFly. Keep on archived callbag-recharge site. Includes: #15 ADOPT Protocol, #16 Lazy Tier 2, #19 Dedup Semantics, #20 Benchmark Regression, #27 switchMap Bug, #29 Bitmask Overflow.

**Also port:** 7 comparison pages (Zustand, Jotai, RxJS, LangGraph, n8n, Airflow, Vercel AI SDK) — rewrite as "GraphReFly vs X". High SEO value.

**Migration execution order:** Comparison pages first → Tier 1 posts → Tier 2 posts → Recipes → Capstone post ("From callbag-recharge to GraphReFly: Why We Started Over").

## 10. README Overhaul

New README structure (following XState/Zustand patterns):
1. One-line tagline + badges (npm, license)
2. Quick start (install + 6-line code example)
3. Comparison table (vs Zustand/Jotai/RxJS/XState/Signals — 8 dimensions)
4. One primitive — sugar constructors
5. Streaming & operators
6. Graph container
7. AI & orchestration
8. Framework adapters (React/Vue/Svelte/Solid/NestJS)
9. Tree-shaking imports
10. Resilience & checkpoints
11. Project layout
12. Scripts
13. **Acknowledgments** — credits to Callbag (Staltz), callbag-recharge (predecessor), Pretext (Cheng Lou), OpenViking (decay formula), David Harel (statecharts), TC39 Signals Proposal

**Decision on credits:** Include them. Builds trust, shows landscape awareness, community goodwill, and potential amplification from cited project authors.

## Files Changed

- `package.json` — description, keywords
- `docs/docs-guidance.md` — site architecture section, public asset sync docs, metadata update guidance
- `website/scripts/sync-docs.mjs` — public asset sync (robots.txt, llms.txt)
- `website/.gitignore` — generated public assets
- `website/src/components/Header.astro` — language switcher nav
- `.github/workflows/pages.yml` — custom domain URL + base path
- `robots.txt` — new (repo root)
- `llms.txt` — moved from website/public/ to repo root
- `archive/docs/SESSION-marketing-promotion-strategy.md` — this file
- `README.md` — full overhaul with comparison table, quick start, acknowledgments
- `archive/docs/DESIGN-ARCHIVE-INDEX.md` — updated with this session
