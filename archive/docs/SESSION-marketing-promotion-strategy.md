# Marketing, Promotion & Domain Strategy

**SESSION DATE:** April 3, 2026
**TOPIC:** Comprehensive marketing strategy for GraphReFly — package descriptions, keywords, domain setup, site architecture, callbag-recharge deprecation plan, and phased promotion roadmap.

---

## Context

GraphReFly has two implementations (TypeScript, Python) approaching publishable state. The predecessor `callbag-recharge` has a mature VitePress blog (30 posts, 8 arcs) and marketing research. This session established the public-facing identity, discoverability infrastructure, and promotion plan.

## Key Decisions

### 1. Package & Repo Descriptions

**npm (`@graphrefly/graphrefly-ts`):**
> ~~Reactive graph protocol for human + LLM co-operation. Composable nodes, glitch-free diamond resolution, two-phase push, framework adapters (React/Vue/Svelte/Solid/NestJS), durable streaming. Zero dependencies.~~ *(original — architecture-first)*
>
> **Revised (per first-principles audit):**
> Describe automations in plain language. Review them visually. Run them persistently. Trace every decision. A reactive graph engine for human + LLM co-operation — zero dependencies.

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

### 6. Three Positioning Pillars *(revised per first-principles audit)*

> **Rationale for revision:** The original pillars were architecture-first ("The Missing Middle", "Durable by Default", "Inspectable AI Orchestration"). HN feedback confirmed this didn't land — "sounds like a good idea but I'm not sure I fully understand what the solution is." The audit (SESSION-first-principles-audit.md) mandates leading with user pain points, not protocol features.

**Original pillars (archived):**
1. ~~"The Missing Middle"~~ — architecture framing (signals vs streams)
2. ~~"Durable by Default"~~ — infrastructure framing (checkpoints, resume)
3. ~~"Inspectable AI Orchestration"~~ — developer tooling framing (observable state)

**New pillars — pain-point-first:**

1. **"Stop Drowning in Information"** — You're buried under emails, alerts, feeds, messages. You can't process it all and you're terrified of missing something important. GraphReFly is a **universal reduction engine**: describe what matters in plain language, and it watches, filters, prioritizes, and alerts — persistently and reactively. *(Targets: ordinary people, knowledge workers, small business owners. Maps to: Part 9 of audit — "protect attention via empowerment.")*

2. **"Trust AI by Understanding It"** — You don't trust AI output because you can't explain *why* it decided something. GraphReFly makes every decision traceable: ask "why was this flagged?" and get a causal chain from source to conclusion — not a log dump, but structural causality that persists across sessions. *(Targets: both companies (compliance/audit) and individuals (understanding/trust). Maps to: Part 8 of audit — "causal chain persistence is the killer argument.")*

3. **"Describe It, Don't Code It"** — Tell an LLM what you need in plain English. It composes a graph (like SQL for data flows). You review a simplified flow view (not code). It runs. You tweak by talking, not coding. GraphReFly constrains the LLM's error space to structural operations — like SQL constraining database operations — so it gets it right the first time. *(Targets: non-technical users AND developers. Maps to: Part 7 of audit — "Graph > Functions for LLM composition" and the SQL analogy.)*

**Pillar hierarchy:** Lead with #1 (pain) in all consumer-facing copy. Lead with #3 (capability) in developer/HN contexts. #2 (trust) is the bridge between audiences.

### 7. callbag-recharge Deprecation Plan

| Step | Action |
|------|--------|
| npm deprecation | `npm deprecate @callbag-recharge/callbag-recharge "Succeeded by @graphrefly/graphrefly-ts"` |
| README banner | Prominent redirect to GraphReFly |
| Blog migration | Port 30 chronicle posts to graphrefly.dev, reframe as "predecessor story leading to GraphReFly" |
| GitHub archive | Archive repo (read-only) after migration guide published |

### 8. Phased Promotion Roadmap *(revised per first-principles audit)*

> **Key change:** Demo 0 ("The Existential Demo": NL → Graph → Flow → Run → Persist → Explain) is now the promotional centerpiece. Nothing ships to HN/Reddit without a working Demo 0 video/GIF. The audit (Part 11) established: "If this works, the library justifies itself. If not, nothing else matters."

**Phase A (Foundation):**
- Domain, npm org (done), PyPI org (pending), GitHub org, `llms.txt`, docs site
- **NEW:** Rewrite README and landing page to lead with pain points (pillar #1), not architecture
- **NEW:** Build Demo 0 (NL → GraphSpec → flow view → run → persist → explain) — this gates Phase B

**Phase B (Soft Launch — requires working Demo 0):**
- npm publish v0.1.0
- **NEW:** Show HN post leads with: "I built a tool that lets you describe automations in plain English, reviews them visually, runs them persistently, and explains every decision" — NOT "reactive graph protocol"
- **NEW:** Demo 0 video/GIF embedded in HN post and README
- Reddit: r/typescript, r/javascript — dev audience sees pillar #3 ("Describe it, don't code it")
- Dev.to syndication, callbag-recharge deprecation

**Phase C (Growth — two-track):**
- **Developer track:** AI-focused Reddit (r/AI_Agents, r/LangChain, r/LocalLLaMA), X threads, Discord server, comparison pages (vs Zustand/RxJS/XState/LangGraph), migration guide. Lead with pillar #3 and the SQL analogy.
- **NEW — Consumer track:** r/productivity, r/selfhosted, r/ADHD, r/personalfinance, r/SmallBusiness. Lead with pillar #1 ("Stop drowning in information"). Demo scenarios: email triage, spending alerts, personal knowledge management.
- **NEW:** "Why was this flagged?" explainability demo for trust/compliance audiences (pillar #2)

**Phase D (Sustained):**
- Weekly blog cadence, compat wrappers as adoption Trojan horse
- Conference talks (TSConf, React Summit, ViteConf) — **NEW:** also target AI/productivity conferences (AI Engineer, Productivity Summit)
- Product Hunt at v1.0
- **NEW:** Three-layer DX/UX as explicit roadmap milestones:
  - Layer 1 (LLM-DX): GraphSpec schema docs, few-shot examples, validation tooling
  - Layer 2 (Dev-DX): 5-min setup, sugar constructors, progressive complexity
  - Layer 3 (End-user UX): NL → graph → simplified flow view — **this is the real moat**

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

## 10. README Overhaul *(revised per first-principles audit)*

> **Key change:** README must lead with *what users can do*, not protocol internals. The audit (Insight #6) established: "Callbag died from DX neglect. The protocol is necessary but not sufficient." Structure below front-loads pain points and Demo 0.

New README structure:
1. **One-line tagline** — pain-point-first: "Describe what matters. It watches, filters, and explains — persistently." + badges
2. **NEW: Demo 0 GIF/video** — NL → flow view → running → "why was this flagged?" (the existential proof, above the fold)
3. **NEW: Three scenarios** (30 words each) — email triage, spending alerts, knowledge management. Ordinary person can self-identify.
4. Quick start (install + 6-line code example)
5. **NEW: "How it works" (3 sentences)** — You describe. LLM composes a graph. Graph runs reactively, checkpoints state, traces every decision.
6. Comparison table (vs Zustand/Jotai/RxJS/XState/LangGraph — **add LangGraph**, 8 dimensions)
7. One primitive — sugar constructors
8. Streaming & operators
9. Graph container
10. AI & orchestration
11. Framework adapters (React/Vue/Svelte/Solid/NestJS)
12. Tree-shaking imports
13. Resilience & checkpoints
14. Project layout
15. Scripts
16. **Acknowledgments** — credits to Callbag (Staltz), callbag-recharge (predecessor), Pretext (Cheng Lou), OpenViking (decay formula), David Harel (statecharts), TC39 Signals Proposal

**Decision on credits:** Include them. Builds trust, shows landscape awareness, community goodwill, and potential amplification from cited project authors.

## 11. Revision Summary (April 4, 2026 — per first-principles audit)

**Trigger:** `SESSION-first-principles-audit.md` identified that the marketing strategy was architecture-first when it should be pain-point-first.

**Sections revised:**
- **§1 Package description** — new pain-point-first npm description drafted
- **§6 Three Positioning Pillars** — replaced architecture pillars with pain-point pillars: (1) Stop Drowning in Information, (2) Trust AI by Understanding It, (3) Describe It, Don't Code It
- **§8 Phased Promotion Roadmap** — Demo 0 gates Phase B; added consumer track in Phase C; two-audience strategy (developer + ordinary people)
- **§10 README Overhaul** — Demo 0 GIF above fold, scenarios before code, "How it works" in 3 sentences

**Not yet executed (requires separate sessions):**
- Actual README rewrite
- Landing page redesign
- npm description update in `package.json`
- Show HN draft rewrite
- Demo 0 implementation (blocked on Phase 7.3 roadmap items)

## 12. Pain-Point Reply Marketing — All Platforms (added April 4, 2026)

### Core Strategy

**Approach:** Proactively search social platforms for posts discussing problems GraphReFly solves. Reply with empathy + our specific claims. This is higher-ROI than cold posting because we're entering conversations where the pain is already articulated.

**Principles:**
- Lead with validation of the poster's insight ("this is exactly right")
- Connect their pain to our specific solution — not architecture, but what it *does*
- Keep it short, authentic, non-spammy — one reply per thread, no copy-paste blasts
- Link to repo or demo, not landing page walls of text
- Adapt tone to platform culture (HN: technical rigor; Reddit: casual + helpful; X: punchy; 小红书: analytical)

### Platform-Specific Playbooks

#### HN (Hacker News)

**Search keywords:** "agent state management", "LLM context window", "agent memory", "CLI agent limitations", "vibe coding", "AI orchestration", "reactive AI", "agent workspace"

**Where to reply:** Show HN threads for agent frameworks, "Ask HN" about agent architecture, comments on LangGraph/CrewAI/AutoGen posts, discussions about AI reliability/trust.

**Reply template (adapt per thread):**

> This hits on something we've been working on — the problem isn't the tools, it's the state model. CLI gives agents a transcript (frozen snapshots accumulating in context), not a workspace (live state that updates in-place).
>
> We built GraphReFly as a reactive graph runtime for this: state pushes downstream automatically (no re-reading), nodes have lifecycles (not infinite append), and every decision has a traceable causal chain. Describe what you want in NL → LLM composes the graph → runs persistently → you can ask "why was this flagged?"
>
> Open source, zero deps: github.com/graphrefly/graphrefly-ts

#### Reddit

**Subreddits & search keywords:**

| Track | Subreddits | Keywords |
|-------|-----------|----------|
| Developer | r/AI_Agents, r/LangChain, r/LocalLLaMA, r/typescript, r/javascript, r/programming | "agent state", "LLM memory", "context window problem", "agent reliability", "vibe coding bad" |
| Consumer | r/productivity, r/selfhosted, r/ADHD, r/personalfinance, r/SmallBusiness, r/Automate | "information overload", "too many notifications", "automation tool", "AI I can trust", "IFTTT alternative" |

**Developer reply template:**

> This is the exact problem we're trying to solve with GraphReFly. The core insight: agents shouldn't re-read the world every turn. State should push to dependents reactively.
>
> It's a reactive graph runtime — nodes with declared dependencies, automatic propagation, causal tracing. Think of it like SQL for data flows: constrain the LLM to structural composition so it gets things right the first time.
>
> github.com/graphrefly/graphrefly-ts — happy to answer questions.

**Consumer reply template:**

> I feel this. The problem is that every app is a silo — your emails, alerts, finances, notes don't talk to each other, so *you* become the integration layer.
>
> We're building something called GraphReFly that lets you describe what matters in plain language ("watch my inbox, flag urgent ones from my team, summarize newsletters weekly"), and it watches, filters, and explains persistently. You can ask "why was this flagged?" and get a real answer, not a black box.
>
> Still early but open source: github.com/graphrefly/graphrefly-ts

#### X (Twitter)

**Search keywords:** "agent memory problem", "CLI agent limits", "LLM state management", "vibe coding", "agent computer interface", "AI trust", "agent workspace"

**Reply style:** Punchy, 1-2 tweets max. Quote-tweet or reply.

> This. CLI gives agents a transcript, not a workspace. Every `cat file.txt` is a frozen snapshot — agents waste tokens reconstructing reality from stale output.
>
> We're building the reactive layer underneath: state pushes, nodes have lifecycles, every decision is traceable.
>
> github.com/graphrefly/graphrefly-ts

### Cadence (all English platforms combined)

| Phase | Activity |
|-------|----------|
| Phase B | 3-5 replies/week across HN + Reddit + X. Focus on high-relevance threads only. |
| Phase C | Daily scanning. 5-10 replies/week. Start original posts on X (threads) and Reddit. |
| Phase D | Delegate scanning to community members / automation. Focus on original thought-leadership content. |

### Tracking

Maintain a lightweight log of replies (platform, thread URL, date, engagement) to identify which pain points and framings resonate. Feed insights back into positioning pillars.

---

## 13. 小红书 / Chinese-Language Promotion (added April 4, 2026)

**Trigger:** A viral 小红书 post ("Agent Computer Interface 的终局，不会是 CLI", ~4200 words) independently articulated the exact problem GraphReFly solves — CLI gives agents stale snapshots instead of a living workspace. This validates that the pain point resonates with Chinese-speaking AI practitioners.

### 小红书 as a Channel

| Aspect | Details |
|--------|---------|
| Audience | Chinese-speaking AI engineers, indie hackers, product managers, AI enthusiasts |
| Format | Long-form image-text posts (fits our pain-point storytelling approach) |
| Tone | Analytical, first-principles, opinionated — aligns with our audit-style content |
| Strengths | High engagement on "insight" posts; comments are substantive; posts have long shelf life via search |

### Strategy: Pain-Point Reply Marketing

**Approach:** Search 小红书 for posts discussing these pain points, then reply with our claims/product description:

**Search keywords:**
- `Agent CLI 局限` / `Agent workspace`
- `AI Agent 状态管理` / `Agent 上下文`
- `LLM 工具调用` / `Agent Computer Interface`
- `vibe coding 问题` / `AI 可信度`
- `信息过载 自动化` / `个人知识管理`
- `reactive programming AI` / `Agent App`

**Reply template (adapt per post):**

> 说得太对了。我们正在做的 GraphReFly 就是想解决这个问题 —— 一个 reactive graph runtime，让 Agent 工作在持续更新的状态图里，而不是不断重读冻结的快照。
>
> 核心区别：
> - 状态是 push-based 的，变了自动通知下游，不需要反复 poll
> - 节点有生命周期（创建→更新→销毁），不是无限追加的 transcript
> - 每个决策都有因果链，可以追溯"为什么这样判断"
> - 用自然语言描述需求 → LLM 组装图 → 可视化审查 → 持久运行
>
> 开源的：github.com/graphrefly/graphrefly-ts
> 欢迎交流！

**Cadence:**
- Phase B: 1-2 replies/week on high-relevance posts + 1 original post (pain-point framing, not architecture)
- Phase C: Weekly original posts, daily reply scanning
- Original post topics: "为什么 CLI 不是 Agent 的终局" (our take), "信息过载的 reactive 解法", "LLM 写代码为什么需要图结构"

### Also Post Original Content on 小红书

Add 小红书 to the posting platforms alongside HN, Reddit, Dev.to:

| Phase | 小红书 Action |
|-------|-------------|
| Phase B (Soft Launch) | Original post: pain-point framing + Demo 0 GIF. Reply to 3-5 relevant existing posts. |
| Phase C (Growth) | Weekly original posts (Chinese). Cross-post translated versions of blog content. Engage in comments. |
| Phase D (Sustained) | Build following. Community Q&A. Case study posts (Chinese users' automations). |

---

## 14. Ecosystem Infiltration Strategy (added April 5, 2026)

**Trigger:** Competitive analysis of DeerFlow 2.0 and LangChain Deep Agents (`SESSION-deerflow-deepagents-comparison.md`) revealed that every major agent framework shares the same structural weakness: ad-hoc state coordination (shared state dicts, file systems, conversation threads). GraphReFly can enter through this gap.

### Playbook: Adapter → Adoption → Substrate

1. **Enter as adapter/plugin** — lightweight integration that adds reactive coordination to existing frameworks
2. **Prove value on unsolvable pain points** — consistency between sub-agents, causal chain tracing, structural observability
3. **Gradually replace internals** — file coordination → propagation, shared state → graph, skills → reactive skills
4. **Host framework becomes thin shell** — execution sandbox + deployment channels over a GraphReFly coordination core

### Priority entry points (highest ROI first)

| Priority | Entry point | Target audience | Why |
|---|---|---|---|
| **1** | **MCP Server** (`graphrefly-mcp-server`) | All MCP clients (Claude Code, Cursor, Windsurf, DeerFlow, custom) | One implementation, universal reach. MCP is 2026's distribution wind. Zero-commitment trial. |
| **1b** | **OpenClaw Context Engine** (`@graphrefly/openclaw-context-engine`) | All OpenClaw users (250k+ stars, 20+ messaging platforms) | Deeper integration than MCP — controls what the agent remembers. Lower effort (3 hooks vs 6 tools). Proves reactive memory thesis directly. Existing plugins are all static/imperative. Design ref: `SESSION-openclaw-context-engine-research.md`. |
| **2** | **Workspace bridge** (`fromWorkspace()`) | File-based agents (DeerFlow, Claude Code, Deep Agents) | Zero agent code changes. Silently adds causality + consistency to existing file coordination. |
| **3** | **LangGraph adapter** (`graphrefly-langgraph`) | LangChain ecosystem (DeerFlow, Deep Agents, custom LangGraph agents) | Largest ecosystem. Agent sees tools, GraphReFly provides coordination underneath. |
| **4** | **Framework-specific adapters** | CrewAI, OpenAI Agents SDK, AutoGen | Expand coverage after proving the pattern with LangGraph. |

### Integration with promotion roadmap

| Promotion phase | Infiltration action |
|---|---|
| **Phase A (Foundation)** | Build MCP Server alongside Demo 0 |
| **Phase B (Soft Launch)** | Ship MCP Server. "Try it with Claude Code in 2 minutes" as onboarding hook. |
| **Phase C (Growth)** | Ship `fromWorkspace()` bridge + `graphrefly-langgraph`. Target DeerFlow and LangChain community channels. |
| **Phase D (Sustained)** | Framework-specific adapters. Standalone harness (GraphReFly + E2B + lightweight UI) proves independence. |

### Positioning nuance

**Public framing:** "GraphReFly works great with DeerFlow / LangGraph / Claude Code — add reactive coordination to your agents."

**Architectural truth:** GraphReFly replaces the coordination core. Host frameworks retain execution sandbox + deployment channels + UI — commodity infrastructure, not moats.

**Why the indirection matters:** Direct competition with 32k-star ByteDance projects is suicidal for a pre-1.0 library. Enter as complement, grow into substrate.

### Key insight: MCP Server as strategic priority

MCP Server should be built **alongside Demo 0**, not after it. Reasons:
1. Demo 0 proves end-to-end value (NL → graph → run → persist → explain)
2. MCP Server proves ecosystem fit (works with any agent, zero migration)
3. Together they answer both questions: "why would I want this?" (Demo 0) and "how do I use this today?" (MCP Server)

---

## 15. Harness Engineering Wave Strategy (added April 6, 2026)

**Trigger:** Research into "harness engineering" (the 2026 trend named by Mitchell Hashimoto, adopted by OpenAI/Anthropic/Fowler) revealed that GraphReFly already covers the execution substrate better than any competitor — but has zero mindshare in the conversation. The window to claim the category vocabulary is now, before LangGraph/CrewAI/OpenAI absorb it.

**Key insight:** Don't announce "we built a harness." Announce **proof artifacts** that make the harness story self-evident. Three waves, each self-contained and publishable.

### Wave-Based Announcement Plan

#### Wave 1: "The Eval Story" (Weeks 1-3) — LOW RISK, HIGH CREDIBILITY

**What to announce:** "We built an eval system that found real schema bugs — and we fixed them."

**Why this first:** The harness engineering community is hungry for engineering discipline content. This doesn't reveal full architecture — it shows eval rigor. Safest possible first move.

**Content deliverables:**
- Blog post: "How our eval harness found two schema bugs LLMs couldn't work around" (the T6 feedback + T8 template story)
- Open-source eval runner (already in repo — make prominent in README)
- Multi-model comparison results (Claude vs GPT-4o vs Gemini)
- "Reproduce our evals" guide using portable prompts (anyone can verify)
- Multi-model comparison page

**Channels:** Dev.to, HN comment replies (not Show HN yet), r/MachineLearning, r/AI_Agents, X thread. 小红书: "我们用 eval 发现了 LLM 的 schema 盲区" (analytical tone).

**What NOT to reveal:** Full GraphReFly architecture, all 20+ adapters, domain templates.

**Marketing actions during Wave 1:**
- Begin reply marketing (§12) on harness engineering threads specifically — add keywords: "harness engineering", "agent harness", "agent reliability", "eval harness"
- Update npm keywords: add `harness-engineering`, `agent-harness`, `causal-trace`
- Update GitHub topics on all 3 repos
- Update `llms.txt` with harness vocabulary

#### Wave 2: "The Harness Layer" (Weeks 4-9) — CLAIMS THE CATEGORY

**What to announce:** "GraphReFly: the reactive harness layer for agent workflows."

**Why now:** Wave 1 established eval credibility. Now plant the flag.

**Content deliverables:**
- `@graphrefly/mcp-server` published on npm + submitted to MCP registry, Cline Marketplace, PulseMCP
- Harness scorecard page at `graphrefly.dev/scorecard` (weekly-updated KPIs)
- "GraphReFly vs LangGraph" comparison page
- Blog: "Why agent harnesses need reactive graphs, not static DAGs"
- "Try it with Claude Code in 2 minutes" MCP quickstart

**Marketing actions at Wave 2 launch:**
- **README rewrite** — change headline to harness engineering vocabulary: "GraphReFly makes agent workflows reactive, resumable, and causally explainable"
- **Landing page redesign** — lead with harness engineering positioning, scorecard prominently linked
- **npm description update**: "Reactive harness layer for agent workflows. Causal tracing, policy enforcement, persistent checkpoints. Zero dependencies."
- **Website keywords/SEO** — target "harness engineering", "agent harness framework", "reactive agent orchestration"
- Intensify reply marketing on harness engineering content (HN, Reddit, X, 小红书)
- Submit GraphReFly to `harness-engineering.ai` knowledge graph (883 entities — get in it)

**Channels:** HN comment replies (still not Show HN — save for Wave 3), r/AI_Agents, r/ClaudeCode, r/typescript. X original thread: "What harness engineering requires and why we built GraphReFly." 小红书: "Agent Harness 需要 reactive graph 的 5 个理由."

#### Wave 3: "The Existential Demo" (Weeks 10-15) — FULL LAUNCH

**What to announce:** "Describe an automation in English. Review it visually. Run it. Ask why."

**Content deliverables:**
- Demo 0 video/GIF (NL → flow view → running → "why was this flagged?")
- `@graphrefly/ai-sdk` middleware (Vercel AI SDK)
- `@graphrefly/langgraph` tools (if needed beyond MCP)
- 3 golden template repos
- Demo 6: AI Agent Observatory showcase

**Marketing actions at Wave 3 launch:**
- **Show HN** post: "Show HN: GraphReFly — describe automations in plain English, review visually, run persistently, trace every decision [harness scorecard inside]"
  - Lead with Demo 0 GIF above the fold
  - Link to scorecard, comparison page, template repos
- **Reddit original posts:**
  - r/AI_Agents: "We built a reactive harness layer for long-running agent workflows — here's our eval scorecard"
  - r/typescript: "GraphReFly: reactive graph engine that makes agent workflows explainable and resumable"
  - r/ClaudeCode: "MCP server that adds causal tracing to any Claude Code workflow"
  - r/selfhosted: "Open-source tool: describe what matters in plain English, it watches and explains"
- **小红书 original post:** "用自然语言描述自动化 → 可视化审查 → 持久运行 → 追溯因果链"
- **X/Twitter thread:** Demo 0 walkthrough + scorecard highlights
- **Product Hunt** — schedule for v1.0 milestone (post-Wave 3)
- **Dev.to/Medium syndication** of all three wave blog posts
- **Conference CFP submissions:** AI Engineer Summit, TSConf

### Revised Promotion Phase Mapping

| Old phase | New mapping | Gate |
|---|---|---|
| Phase A (Foundation) | Done — domain, npm org, robots.txt, llms.txt | — |
| Phase B (Soft Launch) | **Wave 1** (eval story) + **Wave 2** (harness + MCP) | Eval CI running + MCP server shipped |
| Phase C (Growth) | **Wave 3** (Demo 0 + Show HN + framework packages) | Demo 0 working + scorecard live |
| Phase D (Sustained) | Post-Wave 3: conference talks, consumer track, community | 20+ design partner calls |

### Revised Pillar Hierarchy (harness-first)

The three positioning pillars from §6 remain valid. **New ordering for harness engineering audience:**

1. **Lead with #3 ("Describe It, Don't Code It") in all developer/HN contexts** — this is the GraphSpec + LLM composition story. Harness engineering audience understands "declarative spec" value.
2. **Follow with #2 ("Trust AI by Understanding It")** — the `explainPath` + causal trace + scorecard story. This is what "harness" means concretely.
3. **Defer #1 ("Stop Drowning in Information")** — consumer track. Revisit post-Wave 3 when Demo 0 exists.

### Ecosystem Infiltration Timing (update to §14)

| Wave | Infiltration action | Distribution channel |
|---|---|---|
| Wave 1 | Update keywords/topics/llms.txt only | Search discoverability |
| Wave 2 | **Ship MCP Server** — universal adapter reaching all MCP clients | npm + MCP registries (official, Cline, PulseMCP) |
| Wave 2 | Reply marketing on harness engineering threads | HN, Reddit, X, 小红书 |
| Wave 3 | **Ship `@graphrefly/ai-sdk`** middleware | npm, Vercel ecosystem |
| Wave 3 | **Ship `@graphrefly/langgraph`** tools (if MCP insufficient) | npm, LangChain ecosystem |
| Wave 3 | **Submit to `harness-engineering.ai`** knowledge graph | Direct community placement |
| Wave 3 | **3 golden template repos** | GitHub discoverability |
| Post-Wave 3 | CrewAI, OpenAI Agents SDK adapters | Expand as demanded by users |
| Post-Wave 3 | A2A Agent Card (Google protocol) | Enterprise multi-agent positioning |

---

## 16. Competitive Intelligence: Future AGI (added April 7, 2026)

**Trigger:** Cold outreach email from Future AGI CEO (Nikhil Pareek) offering pre-launch repo access. Analyzed their open-source stack (`traceAI`, `ai-evaluation`, `agent-opt`, `futureagi-sdk`, `simulate-sdk`) and docs site (`docs.futureagi.com`) for marketing tactics and technical overlap.

### What They Are

Open-core AI agent reliability platform. Open-source libraries (tracing, evaluation, prompt optimization) feed into commercial platform at `app.futureagi.com`. India-based startup, small internal team (~6 contributors), ~370 total GitHub stars. Pre-public-launch as of April 2026.

### Marketing Tactics Worth Adopting

#### A. Pre-Launch Contributor Recruitment (Cold Email)

Nikhil's email is a textbook play:

| Tactic | How it works | Our adaptation |
|---|---|---|
| **Personalized GitHub stalking** | "I saw your work" — targets people whose repos overlap | Before Wave 1: identify 20-30 people from harness engineering blogs, LangGraph/CrewAI contributors, reactive programming maintainers (Staltz, RxJS team), agent reliability researchers. Send personalized emails referencing their specific repos/posts. |
| **Exclusivity + scarcity** | "small group of contributors before it goes wide" | Create a "design partner" program pre-Wave 1: "We're giving early access to 15 people who understand reactive agent coordination." |
| **Low-commitment ask** | "even a quick look and honest feedback" | Don't ask for PRs — ask for 15 minutes of feedback. Funnel: feedback → interest → contributor → advocate. |
| **Urgency without pressure** | "about a week from public launch" | Time outreach 1-2 weeks before each Wave launch. |
| **CEO-signed** | Personal authority, not a project account | David sends these personally, not from @graphrefly. |

**Email template for Wave 1:**

> Hi [name],
>
> I saw your [specific work — blog post / repo / talk]. That's directly relevant to what we're building.
>
> We're open-sourcing GraphReFly — a reactive graph runtime for agent workflows. It covers coordination, causal tracing, policy enforcement, and persistent checkpoints. We just published our first eval results showing how catalog quality is the #1 lever for LLM output quality.
>
> Before the public launch, we're giving early repo access to a small group of people whose work overlaps. Would love your honest feedback — even 15 minutes looking at the eval methodology would be valuable.
>
> [link to eval blog post / scorecard]
>
> No pressure at all.
>
> Cheers,
> David

**Target list (20-30 people):**
- Harness engineering blog authors (check harness-engineering.ai knowledge graph)
- LangGraph core contributors
- CrewAI / AutoGen maintainers
- André Staltz (callbag creator — predecessor story)
- RxJS team members
- Agent reliability researchers (Reflexion, LATS paper authors)
- MCP ecosystem builders (Cline maintainers, PulseMCP)
- DevRel at Anthropic/OpenAI who write about agent patterns

#### B. Integration Pages as SEO Surface Area

Future AGI has 30+ individual integration pages (one per framework: OpenAI, Anthropic, LangChain, etc.). Each page targets "[framework] + observability" keywords.

**Our adaptation:** Create individual doc pages per adapter (`fromOTel`, `fromKafka`, `toPostgres`, `fromMCP`, etc.). We have 20+ adapters — each becomes a search landing page targeting "[system] + reactive" or "[system] + agent orchestration."

#### C. "Quickstart in 2 Minutes" Gating

traceAI's setup is 3 lines of code. Every README and landing page must have a "try in 2 minutes" path.

**Our adaptation:** MCP Server (§9.3) quickstart must be ≤5 lines. Every doc page starts with a copy-pasteable example.

#### D. Cookbooks/Templates as Discovery

They have a separate `cookbooks` repo with example projects. Template repos are individually discoverable on GitHub.

**Our adaptation:** Accelerate the 3 golden template repos from Wave 3 (§9.6). Consider shipping 1 template alongside Wave 1 to have something tangible.

### Technical Overlap & Gaps

| Capability | Future AGI | GraphReFly | Assessment |
|---|---|---|---|
| **Tracing** | traceAI: OTel-based, 50+ framework instrumentors | `fromOTel`, causal chain, `explainPath` | They: breadth. We: causal depth. |
| **Evaluation** | ai-evaluation: 50+ metrics, guardrails, LLM-as-judge | Eval runner (T1-T20), multi-model matrix, schema bug detection | They: metric breadth. We: structural eval (graph correctness). |
| **Optimization** | agent-opt: 6 algorithms (Random, Bayesian, ProTeGi, Meta-Prompt, PromptWizard, GEPA) | Catalog auto-generation + auto-refine (9.1b) | **Gap.** They have general prompt optimization. We have catalog-specific refinement. See §17 for algorithm analysis + roadmap item. |
| **Guardrails** | ai-evaluation: jailbreak, PII, code injection scanners (<10ms) | `policyEnforcer` (§9.2, not yet shipped) | Parallel tracks — theirs is content-level, ours is structural/access-level. |
| **Platform** | futureagi-sdk: datasets, prompts, knowledge base | MCP Server (§9.3), GraphSpec compiler | Different architectures. |

### Their Weaknesses (Our Advantages)

1. **No reactive coordination.** Passive observation, not active orchestration. They instrument — we orchestrate.
2. **Weak community.** ~370 stars, all internal contributors. "Open source" as distribution, not community.
3. **Licensing mess.** GPL-3.0 on ai-evaluation contaminates agent-opt (no license file). Enterprise-unfriendly.
4. **Platform lock-in.** traceAI defaults to their endpoint, SDK requires API keys. Funnel, not product.
5. **Superlative claims without proof.** "World's most accurate" — no benchmarks. Our eval story leads with reproducible results.

### What NOT to Copy

- Emoji-heavy READMEs (futureagi-sdk is over-decorated)
- Superlative claims without proof ("world's most accurate")
- GPL licensing on core libraries
- Platform lock-in disguised as open source
- Multi-language spread too thin (4 languages with small team)

---

## 17. Prompt Optimization Algorithms — Analysis & Roadmap (added April 7, 2026)

**Trigger:** Future AGI's `agent-opt` repo implements 6 prompt optimization algorithms. Our catalog automation (§9.1b) covers catalog *description* quality, but not general prompt/instruction optimization. This section documents the algorithms and a roadmap for GraphReFly-native optimization.

### The 6 Algorithms (from agent-opt source code analysis)

#### 1. Random Search
**Mechanism:** Teacher LLM generates N diverse prompt variations in one shot. Evaluate each, pick the best. No iteration.

- **Best for:** Quick baselines, sanity checks
- **Strengths:** Cheapest (one teacher call + N evaluations). Simple.
- **Weaknesses:** No learning across iterations. No error analysis. Diversity depends entirely on teacher model creativity.
- **Cost:** 1 teacher call + (N × dataset_size) eval calls

#### 2. Bayesian Search (Optuna TPE)
**Mechanism:** Uses Optuna's Tree-structured Parzen Estimator to optimize **few-shot example selection** — NOT the prompt text itself. Searches over which dataset examples to include as demonstrations and how many.

- **Best for:** When instruction is good but few-shot examples need tuning. Classification tasks, QA.
- **Strengths:** Principled Bayesian exploration vs exploitation. Supports eval subsetting for speed. Most configurable.
- **Weaknesses:** Only optimizes example selection, not instruction text. If the instruction is bad, this cannot help.
- **Reference:** Akiba et al., 2019 (Optuna)
- **Cost:** N_trials × (subset_size) eval calls

#### 3. ProTeGi (Textual Gradients + Beam Search)
**Mechanism:** Iterative beam search where the teacher analyzes errors to produce "textual gradients" (critiques), then uses those critiques to generate improved prompts. Analog to gradient descent — error-driven refinement.

- **Per round:** (1) Run prompt on 32 examples, identify errors (score < 0.5). (2) Teacher generates N critiques per prompt ("gradients"). (3) Teacher applies each critique to produce improved prompts. (4) Score all candidates, keep top beam_size.
- **Best for:** Prompts that work partially but fail on specific patterns. Structured output tasks.
- **Strengths:** Error-driven — focuses improvement where it matters. Beam maintains diversity. Interpretable critiques.
- **Weaknesses:** Expensive per round. Inference model hardcoded (`gpt-4o-mini`). Error threshold (0.5) not configurable.
- **Reference:** Pryzant et al., 2023 — "Automatic Prompt Optimization with 'Gradient Descent' and Beam Search"
- **Cost:** rounds × (beam × 32 evals + beam gradient calls + beam × gradients apply calls + all_candidates × subset evals)

#### 4. Meta-Prompt
**Mechanism:** Single teacher model acts as prompt engineering expert. Each round: score current prompt → format annotated performance data (per-example scores + reasons) → teacher generates hypothesis + improved prompt. Failed attempts tracked to avoid repetition.

- **Best for:** Complex tasks where error analysis matters more than search breadth. Works well with powerful teacher models.
- **Strengths:** Simplest iterative approach. Rich performance data (scores + reasons). Hypothesis step forces structured reasoning. Low cost per round.
- **Weaknesses:** Single-path search (no beam, no population). Can get stuck in local optima. Very dependent on teacher quality.
- **Reference:** Related to Zhou et al., 2022 — "Large Language Models Are Human-Level Prompt Engineers"
- **Cost:** rounds × (1 teacher call + subset_size eval calls)

#### 5. PromptWizard (Mutation + Critique + Refinement)
**Mechanism:** Three-phase pipeline: (1) Mutation via 8 "thinking styles" (step-by-step, critical thinking, systems thinking, etc.) generates diverse candidates. (2) Score and select top beam_size. (3) Critique errors, refine prompts based on critique.

- **Best for:** Thorough exploration when budget allows. Complex tasks needing both structural and semantic improvements.
- **Strengths:** Most comprehensive pipeline. Thinking styles inject cognitive diversity. Critique provides targeted feedback.
- **Weaknesses:** Very expensive (mutation × scoring × critique × refinement). Default beam_size=1 loses diversity fast.
- **Reference:** Microsoft Research, 2024 — "PromptWizard: Task-Aware Agent-Driven Prompt Optimization Framework"
- **Cost:** iterations × (mutate_rounds × 8 mutations + all_candidates × subset evals + beam × critique + beam × refine)

#### 6. GEPA (Genetic Evolution + Pareto Optimization)
**Mechanism:** Delegates to external `gepa` library. Evolutionary/genetic approach with Pareto-based selection. Reflection model analyzes evaluation trajectories and generates mutations. Only algorithm supporting true multi-objective optimization.

- **Best for:** Complex landscapes with multiple competing objectives. Large eval budgets.
- **Strengths:** Population-based exploration. Pareto handles multi-objective. Reflection-guided mutation.
- **Weaknesses:** Black-box external dependency. Most expensive (default 150 metric calls). Hard to debug.
- **Reference:** "Genetic Evolution with Pareto Optimization for Automated Prompt Engineering"
- **Cost:** up to max_metric_calls (default 150) evaluations

### Implementation Quality Issues (agent-opt)

1. **Hardcoded inference models:** ProTeGi, Meta-Prompt, PromptWizard hardcode `"gpt-4o-mini"` for scoring, ignoring user config
2. **No parallelism:** All evaluation is sequential list comprehension — slow for large datasets
3. **No caching:** Same prompt evaluated multiple times in beam search without memoization
4. **Error threshold hardcoded:** ProTeGi and PromptWizard both use `score < 0.5` — not configurable
5. **Bayesian Search is narrow:** Only few-shot selection, not instruction optimization (misleading name)

### The Real Insight: The Loop Is the Product, Not the Strategies

All 6 algorithms decompose to the same feedback loop:

```
candidates = seed(artifact)
loop:
  scores     = evaluate(candidates, dataset)
  feedback   = analyze(scores, errors)         ← strategy (pluggable)
  candidates = generate(feedback, candidates)  ← strategy (pluggable)
  if converged: break
return best(candidates)
```

BMAD-METHOD (github.com/bmad-code-org/BMAD-METHOD) proves this at scale — they have **50 heterogeneous elicitation strategies** (Socratic questioning, Red Team, First Principles, 5 Whys, Tree of Thoughts, etc.) all plugged into one present→select→apply→approve loop via a CSV registry. The strategies are just prompt templates + a selection heuristic. The loop is the infrastructure.

**What we should build:** The reactive feedback loop as a Graph — budget gating, eval caching, parallel evaluation, causal tracing, multi-objective scoring, checkpoint/resume. This is infrastructure that `feedback()` + `scorer()` + `budgetGate()` + `autoCheckpoint()` already provide.

**What we should NOT build:** 6 monolithic optimization algorithms. Instead, provide a `RefineStrategy` interface (analyze + generate) and a strategy registry (like BMAD's CSV but reactive). Ship 2-3 built-in strategies as examples. Let users/community/LLMs bring their own strategies — or pick from a registry at runtime.

**The differentiator is not "we have ProTeGi too" — it's "our optimization trajectory is observable, resumable, budget-gated, and causally traceable."** No existing tool offers this.

### GraphReFly Optimization Roadmap

**Phase 1 — Catalog optimization (9.1b, in progress):**
Already implemented: `generateCatalogPrompt()` → `llmCompose()` → `validateSpecAgainstCatalog()` → `maxAutoRefine` loop. This is already a Meta-Prompt-style feedback loop.

**Phase 2 — General optimization loop (roadmap §9.8: `refineLoop`):**
- `refineLoop(seed, evaluator, strategy, opts?)` → `RefineGraph` — the universal loop as a Graph
- `RefineStrategy<T>` interface: `{ analyze, generate, select? }` — thin, pluggable
- Built-in strategies as examples: `blindVariation` (Random Search), `errorCritique` (ProTeGi/Meta-Prompt), `mutateAndRefine` (PromptWizard)
- Strategy registry: `reactiveMap` of named strategies with metadata, LLM can pick the right one per phase
- Loop infrastructure leverages existing primitives: `feedback()`, `scorer()`, `budgetGate()`, `cascadingCache()`, `funnel()`, `autoCheckpoint()`

**Phase 3 — Workflow topology optimization (future):**
- `refineLoop(graphSpec, evaluator, topologyStrategy)` — mutations are structural (add/remove nodes, rewire edges, swap operators)
- GraphSpec + `compileSpec()` + `decompileGraph()` become the optimization substrate

### Revised Promotion Phase Mapping

Add optimization to Wave 2-3 story:
- **Wave 2:** Blog post: "The feedback loop is the product — why we don't ship 6 optimization algorithms"
- **Wave 3:** Ship `refineLoop()` with 2-3 built-in strategies + strategy registry. Demo: catalog auto-optimization

---

### Anti-Stealth Rationale

The idea of going stealth to prevent competitors from copying the reactive graph protocol was considered and rejected:

1. **The code isn't copiable in meaningful timeframe** — Phases 0-8 represent 6+ months of focused work. 20+ adapters, domain templates, GraphSpec compiler, ABAC, CQRS, agent memory, reactive layout... someone reading the roadmap today couldn't replicate this in under a year.
2. **The real moat isn't code — it's category ownership.** The harness engineering conversation is hardening RIGHT NOW (30+ articles in 8 weeks, March-April 2026). LangGraph, CrewAI, OpenAI are absorbing all search traffic. Every week of silence means the narrative sets without GraphReFly in it.
3. **Integrations are already substantial.** `fromOTel`, `fromKafka`, `toPostgres`, `fromWebhook`, `toSSE`, `fromMCP`, `fromRedisStream`, `toClickHouse`, `toS3`, `fromPulsar`, `fromNATS`, `fromRabbitMQ`... the Cursor research recommended 5 integrations — we have 20+.
4. **Stealth costs the only thing we're short on: mindshare.** Visibility is the gap, not code.

---

## 18. Blog Content Plan — Session Archive to Published Posts (added April 9, 2026)

Maps session archive (`archive/docs/`) to publishable blog posts across the three waves. Each entry identifies source sessions, target keyword, blog type, and wave timing.

### Status

| # | Blog | Status | File |
|---|---|---|---|
| 32 | "Why AI Can't Debug What It Can't See — And How We Fixed That" | **DONE** | `website/src/content/docs/blog/32-debugging-with-your-own-tools.md` |

### Wave 1 Blogs (eval credibility)

Blog 32 covers the Wave 1 eval story. No additional Wave 1 blogs needed — the eval CI + scorecard are the other Wave 1 deliverables.

### Wave 2 Blogs (claims the category)

| # | Title | Source Sessions | Keywords | Type | Words |
|---|---|---|---|---|---|
| 33 | "Building a Reactive Harness Layer for Agent Workflows" | `SESSION-reactive-collaboration-harness.md` (7-stage loop, gate.modify(), strategy model), `SESSION-harness-engineering-strategy.md` (8 requirements, coverage analysis, vs LangGraph) | `reactive harness layer`, `agent orchestration`, `human-in-the-loop agents` | Ultimate Guide | 3000-4000 |
| 34 | "Why Agent Harnesses Need Reactive Graphs, Not Static DAGs" | `SESSION-harness-engineering-strategy.md` (Part 7 — vs LangGraph), `SESSION-deerflow-deepagents-comparison.md` (DeerFlow 2.0 trajectory, tool-as-agent vs topology-as-program) | `harness engineering`, `reactive graph`, `LangGraph alternative` | Opinion/Thought | 1500-2000 |
| 35 | "The Feedback Loop Is the Product — Why We Don't Ship 6 Optimization Algorithms" | §17 prompt optimization analysis, `SESSION-reactive-collaboration-harness.md` (strategy model — rootCause×intervention→successRate) | `agent optimization`, `feedback loop`, `prompt optimization` | Opinion/Thought | 1200-1500 |
| 36 | "One Primitive, One Protocol: Why We Killed Six Abstractions" | `SESSION-graphrefly-spec-design.md` (7-step spec process, radical simplification), `SESSION-first-principles-audit.md` (irreducible core, is-it-necessary audit) | `reactive primitives`, `protocol design`, `software simplification` | Opinion/Thought | 1200-1500 |

### Wave 3 Blogs (full launch)

| # | Title | Source Sessions | Keywords | Type | Words |
|---|---|---|---|---|---|
| 37 | "Describe, Run, Explain: Building Demo 0" | `SESSION-first-principles-audit.md` (Demo 0 design, three-layer DX/UX), `SESSION-marketing-promotion-strategy.md` (Wave 3 deliverables) | `NL to graph`, `agent demo`, `causal explanation` | Tutorial | 2500-3000 |
| 38 | "Static Topology, Flowing Data: The Kafka Insight for Agent Loops" | `SESSION-reactive-collaboration-harness.md` (Part 2 — Kafka insight, cursor reading as 降维), `SESSION-demo-test-strategy.md` (three-pane shell) | `agent architecture`, `static topology`, `data flow` | Opinion/Thought | 1200-1500 |
| 39 | "The Universal Reduction Layer: From Massive Info to Actionable Items" | `SESSION-universal-reduction-layer.md` (stratified reduction, 10 advantages), `SESSION-agentic-memory-research.md` (4 strategies, default agentMemory) | `information reduction`, `reactive middleware`, `LLM orchestration` | Guide | 2500-3000 |
| 40 | "Built-in Access Control for Reactive Graphs" | `SESSION-access-control-actor-guard.md` (Actor/Guard/Policy, CASL comparison, Web3 identity) | `ABAC`, `access control`, `reactive security` | How-to | 2000-2500 |

### Post-Wave 3 (sustained)

| # | Title | Source Sessions | Keywords | Type |
|---|---|---|---|---|
| 41 | "Web3 Meets Reactive Graphs: Security, OMS, Agent Commerce" | `SESSION-web3-integration-research.md`, `SESSION-web3-research-type-extensibility.md` | `Web3 reactive`, `agent commerce`, `chain monitoring` | Guide |
| 42 | "From callbag-recharge to GraphReFly: A Migration Story" | `SESSION-graphrefly-spec-design.md`, predecessor sessions (#1-8), `SESSION-first-principles-audit.md` (HN callbag feedback) | `callbag`, `reactive migration`, `protocol evolution` | Story |
| 43 | "Agentic Memory: Four Strategies, One Composable Factory" | `SESSION-agentic-memory-research.md` (SOTA synthesis, 4 strategies, 5 unique advantages) | `agentic memory`, `agent memory management`, `LLM memory` | Guide |

### Writing approach

Use the `write-blog` skill (in `~/.claude/skills-backup/write-blog/`) for SEO optimization. Key adaptations for GraphReFly blogs:
- E-E-A-T signals are genuine — first-hand experience building and debugging the system
- Keyword targets align with harness engineering conversation participants (§15 Part 9 thread discovery)
- Each blog should reference eval data or code examples, not just architecture
- Lead with user pain point (per first-principles audit: "don't lead with architecture")

---

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
