---
name: graph-animation
description: "Create GraphReFly concept explanation videos using HyperFrames. Use when asked to generate animated diagrams of reactive graph topologies — node activations, START/DIRTY/DATA/COMPLETE message flow, diamond resolution, batch mode, operators, etc. Supports two modes: default = concept-explainer (captioned, beat-structured, 30–90s); `--mode ambient-hero` = silent looping landing-page background (8-stage canonical storyboard, ~42s seamless loop). Invokes /hyperframes for composition authoring and /gsap for deterministic animation. Run /hyperframes-cli for preview/render commands."
argument-hint: "[--mode ambient-hero] [concept to animate, e.g. 'diamond resolution', 'batch mode', 'node lifecycle']"
---

You are executing the **graph-animation** workflow for **GraphReFly**.

The user's request: `$ARGUMENTS`

This skill produces a HyperFrames HTML composition that animates GraphReFly reactive graph concepts — topology diagrams with animated message flow, node activations, and tier-coded signals. It wraps `/hyperframes` and `/gsap` with GraphReFly-specific knowledge so you don't have to explain the domain each time.

---

## Mode detection

If `$ARGUMENTS` contains `--mode ambient-hero` (or the user asks for a "hero", "landing-page", "background video", or "loop"), use **ambient-hero mode** — skip directly to the "Mode B: ambient hero" section near the bottom. The 8-stage canonical storyboard is fully specified there; do not re-derive it.

Otherwise, treat the request as **concept-explainer mode** (default) and follow Steps 1–4 below.

---

## Step 1 — Understand the concept (concept-explainer mode only)

If `$ARGUMENTS` is vague or empty, ask the user ONE question: which concept or workflow do you want to animate? Give them these options as examples:

- Node lifecycle (START → DATA → COMPLETE → TEARDOWN)
- Message propagation through a linear chain (A → B → C)
- Diamond resolution (fan-out + fan-in, single recomputation)
- Batch mode (DIRTY cascades, DATA deferred until batch end)
- Reactive timer source feeding a derived node
- Operator pipeline (map → filter → combine)
- Human-in-the-loop gate (promptNode / valve pattern)
- Multi-agent subgraph ownership (L0–L3 staircase)

If `$ARGUMENTS` names a concept already, proceed directly to Step 2.

---

## Step 2 — GraphReFly visual language

Use these conventions consistently across all GraphReFly animation videos.

### Node shapes (canonical sugar names — `graph.state/producer/derived/effect`)

| Sugar | Role | Shape | Color |
|---|---|---|---|
| `state` | Mutable cell, no deps | Circle | `#14B8A6` (teal) |
| `producer` | Push source (timer, event, async) | Diamond / pill | `#10B981` (emerald) |
| `derived` | Pure fn of deps | Circle | `#6C63FF` (violet) |
| `effect` | Sink / side-effect | Rounded rect | `#F59E0B` (amber) |
| External / human | Out-of-graph input | Hexagon | `#64748B` (slate) |

Border stroke: `2px solid rgba(255,255,255,0.2)`. Inactive fill: 30% opacity of the node color. Active fill: 100% opacity. The underlying primitive `node()` exists below these four sugars; videos should use sugar names for vocabulary teaching.

### Message symbols (canonical — `core/messages.ts`)

The full protocol exports `START / DIRTY / DATA / RESOLVED / COMPLETE / TEARDOWN / INVALIDATE / PAUSE / RESUME / ERROR`. For videos, use the **foundational subset** unless a specific concept requires more:

| Symbol | Color | Visual | When to show |
|---|---|---|---|
| `START` | `#94A3B8` (slate-light) | Thin pulse from src→dst, edge brightens | First message on a new connection (handshake) |
| `DIRTY` | `#FBBF24` (yellow) | Dashed pulse traveling along edge | Upstream may have changed; dep marks dirty |
| `DATA` | `#34D399` (green) | Solid dot traveling along edge; triggers node fn on arrival | Value flowing |
| `RESOLVED` | `#60A5FA` (blue) | Ring ripple on destination node | Diamond-resolution wave only (skip in beginner videos) |
| `COMPLETE` | `#94A3B8` (slate) | Edge fades, dst node dims | Producer finished emitting |
| `TEARDOWN` | `#A78BFA` (purple) | Edge erases backwards from dst→src | Subscription cancelled / dispose |
| `BATCH_*` | `#A78BFA` (purple) | Bracket sweep across topology | Batch-mode beats |

Default foundational subset for hero / intro videos: **`START → DIRTY → DATA → COMPLETE`**. Add `RESOLVED` only when teaching diamond resolution; add `TEARDOWN` only when teaching lifecycle.

### Edge conventions

- Directed arrows from producer to consumer.
- Edge color matches the tier of the in-flight message.
- Resting state: `rgba(255,255,255,0.15)` gray.
- Animate as SVG `<path>` or a CSS `clip-path` wipe so timing is seekable.

### Layout

- Canvas: **1920×1080** (landscape), dark background `#0F172A`.
- Nodes: minimum 80px diameter circles, 24px sans-serif label inside.
- Edges: 3px stroke with arrowhead marker.
- Label overlay: bottom-left, `font-size: 28px`, `color: #E2E8F0`, describes what is happening.

### Timing budget

- 2–4 seconds per "beat" (one message hop or one lifecycle phase).
- Total target: **30–90 seconds** for a concept clip.
- Add 1.5s of static "intro frame" showing the graph topology before any animation begins.

---

## Step 3 — Scaffold the composition

Use `npx hyperframes init <concept-slug>` to scaffold a new project directory, OR create the file inline if the user prefers a single-file drop.

A minimal starting template (adapt to the specific concept):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1920px; height: 1080px; background: #0F172A; overflow: hidden; font-family: 'Inter', sans-serif; }

    .node { position: absolute; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 600; color: #fff; opacity: 0.3; transition: none; }
    .node.active { opacity: 1; }
    .label { position: absolute; bottom: 60px; left: 80px; font-size: 28px; color: #E2E8F0; opacity: 0; max-width: 900px; line-height: 1.4; }

    svg.edges { position: absolute; top: 0; left: 0; width: 1920px; height: 1080px; }
  </style>

  <!-- GSAP via CDN (deterministic, seekable) -->
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/MotionPathPlugin.min.js"></script>
</head>
<body>
  <!-- Stage -->
  <div id="stage"
    data-composition-id="graphrefly-concept"
    data-start="0"
    data-width="1920"
    data-height="1080">

    <!-- SVG edges layer -->
    <svg class="edges" id="edges">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="rgba(255,255,255,0.15)" />
        </marker>
      </defs>
      <!-- edges drawn here as <path> elements -->
    </svg>

    <!-- Nodes -->
    <!-- Example: -->
    <!-- <div class="node" id="n-source" style="width:90px;height:90px;background:#10B981;left:200px;top:495px;">src</div> -->
    <!-- <div class="node" id="n-derived" style="width:90px;height:90px;background:#6C63FF;left:900px;top:495px;">node</div> -->

    <!-- Animated message dots (positioned by GSAP MotionPath) -->
    <div id="msg-dirty"  style="position:absolute;width:18px;height:18px;border-radius:50%;background:#FBBF24;opacity:0;border:2px dashed #fff;"></div>
    <div id="msg-data"   style="position:absolute;width:18px;height:18px;border-radius:50%;background:#34D399;opacity:0;"></div>

    <!-- Caption label -->
    <div class="label" id="caption"></div>
  </div>

  <script>
    gsap.registerPlugin(MotionPathPlugin);

    const tl = gsap.timeline();

    // --- helpers ---
    function activate(id) {
      return tl.to(`#${id}`, { opacity: 1, scale: 1.1, duration: 0.25, yoyo: true, repeat: 1, ease: 'power2.out' }, '<');
    }
    function caption(text, at) {
      tl.to('#caption', { opacity: 1, duration: 0.3 }, at)
        .call(() => { document.getElementById('caption').textContent = text; }, [], at)
        .to('#caption', { opacity: 0, duration: 0.3 }, `+=${text.length * 0.04 + 2}`);
    }
    function sendMsg(dotId, path, color, duration) {
      const dot = document.getElementById(dotId);
      dot.style.background = color;
      tl.to(dot, { opacity: 1, duration: 0.1 })
        .to(dot, { motionPath: { path, align: path, autoRotate: false }, duration, ease: 'none' })
        .to(dot, { opacity: 0, duration: 0.1 });
    }

    // --- build your timeline below ---
    // Example: 1.5s static intro
    tl.to({}, { duration: 1.5 });
    // ... animate your concept here

    // Register the timeline with HyperFrames for seekable rendering
    window.__hfGsapTimeline = tl;
  </script>
</body>
</html>
```

---

## Step 4 — Mode A: concept-explainer patterns

### Diamond resolution

```
     A
    / \
   B   C
    \ /
     D (recomputes once)
```

Sequence:
1. A emits DATA → DIRTY cascades to B and C simultaneously (two yellow dashes)
2. B and C each emit DIRTY to D
3. D receives both DIRTYs — stays dirty, does NOT recompute yet
4. A emits RESOLVED → B resolves → C resolves → D resolves
5. D recomputes **once** (green DATA dot appears from D)
6. Caption: "Diamond resolved — one recomputation, zero double-fires"

### Batch mode

Sequence:
1. `batch(() => ...)` bracket appears — purple "BATCH_START" ring
2. Multiple sources emit DATA — nodes flash DIRTY but DATA dots are held (shown as queued dots stacked at source)
3. batch end — all deferred DATA releases simultaneously
4. Caption: "Batch defers DATA, not DIRTY — downstream sees one coherent update"

### Node lifecycle

Sequence:
1. Node dims (initial)
2. Subscription arrives → node brightens
3. Upstream emits DATA → node pulses green
4. RESOLVED ripple out
5. Unsubscribe → teardown ring (purple) → node dims again

### Operator pipeline

Show 3–4 nodes in a horizontal chain (map → filter → combine). Animate a value token flowing left to right, label each node with its transform (`×2`, `> 5`, `merge`).

---

## Step 5 — Run the dev loop

```bash
# from the composition project directory:
npx hyperframes lint        # validate timing/structure
npx hyperframes preview     # live browser preview with hot reload
npx hyperframes render      # output MP4
```

Use `/hyperframes-cli` skill for detailed CLI guidance.
Use `/gsap` skill for advanced GSAP timeline patterns.
Use `/hyperframes-media` skill if you need TTS narration or audio.

---

## Step 6 — Quality checks before render

- [ ] All nodes have correct shape + color per the visual language table above
- [ ] Message colors match the canonical table (START=slate-light, DIRTY=yellow, DATA=green, COMPLETE=slate, RESOLVED=blue if shown, TEARDOWN=purple if shown)
- [ ] Timeline registers `window.__hfGsapTimeline = tl` (required for seekable render)
- [ ] Caption text is ≤ 80 chars per line and readable at 1080p (concept-explainer mode only)
- [ ] `npx hyperframes lint` passes with no errors
- [ ] Preview scrubbing doesn't stutter (all animations are on the GSAP timeline, not setTimeout)

---

## Mode B: ambient hero (canonical 8-stage landing-page loop)

This mode produces the **GraphReFly landing-page background video** — a silent, looping, atmospheric reactive-graph composition. Use it whenever the user asks for a "hero", "landing-page", "background video", or passes `--mode ambient-hero`.

### Mode-B rules (differ from concept-explainer)

| Rule | Value | Why |
|---|---|---|
| Length | ~42s seamless loop | Hero convention 15–60s; matches the 8-stage plan |
| Audio | none | Plays muted; hero conventions |
| Captions | none over the topology | Headline text overlays the hero on the page; captions would compete |
| Small floating labels | OK, ≤ 4 words, ≤ 22px font | E.g. `graph.describe()`, `graph.observe()`, `batch()` — vocabulary pre-teach |
| Pacing | slow / ambient | No frantic motion; eye should rest |
| Loop seam | **Stage 8 ends at exactly the same camera/node positions as Stage 1 starts** | Imperceptible loop |
| Contrast | reduced — palette at ~70% saturation, bg `#0F172A` | Headline text on page must dominate |
| Render output | MP4 + a WebM/VP9 variant for `<video>` autoplay-muted-loop | Web embedding |

### The 8-stage canonical storyboard (~42s total)

#### Stage 1 — Connection protocol (6s)

**Topology:** two nodes, side by side, mid-canvas. Left = `producer` (emerald diamond), right = `derived` (violet circle). Single edge between them.

Beat-by-beat:
- 0.0–1.0s: Both nodes appear dim. Edge draws in as a gray line.
- 1.0–1.8s: `START` pulse (slate-light, thin) travels src→dst. Edge brightens to active. Both nodes pulse subtly (handshake established). Tiny label appears below: `START`.
- 1.8–2.8s: `DIRTY` dashed yellow pulse travels src→dst. Destination node briefly outlines yellow (marked dirty). Label: `DIRTY`.
- 2.8–4.0s: `DATA` solid green dot travels src→dst. **On arrival, the destination node's interior briefly displays the literal text `fn(...)` then snaps back** — this teaches "DATA arrival triggers the node's fn". Label: `DATA`.
- 4.0–5.5s: Repeat one more DIRTY+DATA cycle (faster, no label) to show the steady-state rhythm.
- 5.5–6.0s: `COMPLETE` slate pulse travels src→dst. Edge fades. Destination dims slightly. Label: `COMPLETE`.

**Marketing payload:** "this is the connection lifecycle. START → DIRTY → DATA → COMPLETE." Foundational subset shown.

#### Stage 2 — Diamond (5s)

**Topology:** add two more nodes to form a diamond. The producer from Stage 1 becomes `A` (top). Stage 1's derived becomes `D` (bottom). Two new derived nodes `B` and `C` appear left and right.

```
       A
      / \
     B   C
      \ /
       D
```

Beat-by-beat:
- 0.0–1.0s: Nodes `B` and `C` fade in; edges `A→B`, `A→C`, `B→D`, `C→D` draw.
- 1.0–2.0s: `A` emits DIRTY → cascades to B and C simultaneously (two yellow dashes leaving A). Both B and C outline yellow.
- 2.0–2.8s: Both B and C emit DIRTY toward D (two yellow dashes converging on D). D outlines yellow but does **not** recompute yet — visually emphasized by D pulsing yellow twice without firing.
- 2.8–3.8s: `A` emits DATA → green dot to B and C in parallel; B fires (interior `fn(...)` flash), C fires.
- 3.8–4.5s: B and C each emit DATA → both green dots converge on D simultaneously. D fires **once** (single `fn(...)` flash) — emphasize by halting motion for 200ms after the fire.
- 4.5–5.0s: All nodes settle, edges return to resting gray.

**Marketing payload:** "the DIRTY-then-DATA wave guarantees D recomputes once, not twice."

#### Stage 3 — Zoom into one node (5s)

**Topology:** camera dollies into node `D` from Stage 2. It grows to ~60% of canvas height. Other nodes fade out.

Beat-by-beat:
- 0.0–1.5s: Camera zoom + other nodes fade. `D` now reveals its internal anatomy as labeled segments:
  - **Center**: large `fn(...)` glyph
  - **Top wedge**: `down ▼` — outgoing edge ports
  - **Bottom wedge**: `up ▲` — incoming dep ports
  - **Left wedge**: `cache` — small dotted box showing a value
  - **Right wedge**: `version: 3` — a small numeric ticker
  - **Outer ring**: `guard` — a thin guard-ring with a small lock icon
- 1.5–3.5s: One by one, each anatomy label highlights briefly (~400ms each) in this order: `up ▲` → `fn` → `cache` (a value gets written into the dotted box) → `version: 3 → 4` (ticker increments) → `down ▼` → `guard` (lock briefly clasps).
- 3.5–5.0s: All anatomy labels fade back to baseline, leaving the node visible as a labeled diagram.

**Marketing payload:** "every node is the same primitive — cache + version + guard + up/down."

#### Stage 4 — Node taxonomy (Y-shape, 5s)

**Topology:** starts with the single node from Stage 3.

Beat-by-beat:
- 0.0–2.0s: The center label cycles its text every 500ms: `state` (teal flash) → `producer` (emerald flash) → `derived` (violet flash) → `effect` (amber flash). The node's fill color matches each kind as the label changes.
- 2.0–3.5s: Camera pulls back. The single node splits/morphs into a **Y-shape**:
  ```
   state (teal)    ──┐
                     ├──► derived (violet) ──► effect (amber)
   producer (emer) ──┘
  ```
  Edges draw in left-to-right.
- 3.5–5.0s: A real flow runs once through the Y — `state` and `producer` both emit DIRTY (two yellow dashes converging on `derived`), then both emit DATA (two green dots converging). `derived` fires **once** (`fn(...)` flash; this is a mini-diamond callback to Stage 2). Then `derived` emits DATA → green dot to `effect`; `effect` fires (amber ring ripple = side effect).

**Marketing payload:** "four sugars, one primitive — state/producer feed derived; derived feeds effect."

#### Stage 5 — Graph level (8s, 4 beats)

##### 5a — Population (1.5s)
Camera dollies further back. The single Y-chain replicates into 3–4 parallel chains, with cross-edges weaving between them. The topology resolves into a richer connected mesh of ~20 nodes. No messages flowing yet — just structure crystallizing.

##### 5b — describe() blueprint + observe() magnifier (3s)
- 0.0–1.0s: All nodes drain of color; the topology becomes a faint dotted **blueprint** — pure structure, no signal. Small label fades in top-left: `graph.describe()` with a thin arrow → tiny annotation `"the map"`.
- 1.0–2.2s: A circular **magnifier lens** (glassy, thin ring border) glides in from the right and hovers over a cluster of 3–4 blueprint nodes. *Inside the lens only*, the blueprint becomes vivid and live message dots (DIRTY yellow + DATA green) flow along the edges within the lens's field of view. Label updates: `graph.observe(path)` → `"the magnifier"`.
- 2.2–3.0s: The lens drifts to a different cluster, dots flow there instead. Then lens fades; topology re-colorizes fully.

**Marketing payload:** "describe is the map. observe is the magnifier. The graph is its own data." (DS-14.5.A spec-as-projection reframe embodied.)

##### 5c — batch() sweep (2s)
A purple `BATCH_START` bracket sweeps left-to-right across the entire graph. Multiple producers fire DIRTY *simultaneously* (yellow dashes cascading everywhere); green DATA dots queue up *visibly held* at the producers, glowing brighter as they accumulate. Then a `BATCH_END` bracket sweeps back, and all held DATA releases at once as a synchronized wave rippling through the topology.

**Marketing payload:** "batch defers DATA, not DIRTY — one coherent update."

##### 5d — Subgraph carve (1.5s, hands off to Stage 6)
Two or three translucent capsule outlines appear around clusters of nodes — each capsule has its own slow-pulsing border color (different agent owners; e.g. cyan capsule, magenta capsule). The bridge nodes between capsules glow brighter — these become the messaging hubs in Stage 6. Capsules persist into Stage 6.

#### Stage 6 — Domain level: orchestration + messaging (6s, 2 beats)

##### 6a — Orchestration (2.5s)
Inside one capsule, a sequential pipeline animation runs: 4 nodes lit in succession (left-to-right) like a small assembly line — `gate → action → check → action`. Each node fires (`fn(...)` flash) when the green DATA arrives; the next one lights when this one completes. Small label: `pipeline`.

##### 6b — Messaging hub + cursor (3.5s)
A **central hub node** appears in the gap between the two capsules — distinct visual: a vertical pill shape with a "stream" of small horizontal tokens (items) inside, stacked top-to-bottom. Each capsule has a **cursor marker** (small `▌` glyph) at a position in the hub's stream.

Beat-by-beat:
- 0.0–1.5s: New tokens fall in from the top of the hub (publishers in one capsule pushing). The hub's stream grows.
- 1.5–3.0s: Each capsule's cursor independently advances upward, "consuming" tokens. The cursors move at different rates (one capsule reads faster than the other). As a cursor passes a token, the token glows then dims, and a DATA dot leaves the hub edge toward a node inside that capsule.
- 3.0–3.5s: A small floating label: `hub + cursor`. Beneath in smaller faded text: `static graph, dynamic data`.

**Marketing payload:** the 降维 idea — the graph topology is static, but the hub's stream carries dynamic content; cursors decouple consumers' read pace from publishers' write pace. This is the substrate for higher-level patterns.

#### Stage 7 — Agent loop + memory + "?" (5s)

##### 7a — Agent loop (1.8s)
Inside one capsule, a closed cyclic subgraph lights up: `agent → tool → result → agent` (a tight loop of 3-4 nodes arranged in a circle). A DATA dot circulates around the loop 2–3 times.

##### 7b — Agentic memory (1.7s)
A second node appears off the agent loop labeled `memory`. As the agent loop runs, small tokens stream from the loop into `memory`, accumulating visibly (the memory node grows or its interior fills up with stacked tokens).

##### 7c — "?" extensibility (1.5s)
Several **hexagonal nodes labeled `?`** appear at the periphery of the canvas, each connected to the existing topology by a single edge that trails off into faded space. They pulse gently.

**Marketing payload:** "agent loop, memory — and these are just examples. The substrate is open." (Anti-stealth thesis embodied — the library shows its primitives, not just packaged solutions.)

#### Stage 8 — Loop seam (2s)

Camera zooms back in. All decorations (capsules, hub, `?` nodes, memory, agent loop) fade out. The topology reduces back to the **exact two-node arrangement of Stage 1**: producer (emerald diamond, left) + derived (violet circle, right), same canvas positions, edge resting.

The last frame at t=42s must match the first frame at t=0s pixel-for-pixel for an invisible loop seam.

### Mode-B implementation notes

- **Single GSAP timeline** spans all 8 stages. Use `gsap.timeline({ repeat: -1 })` so the seam loops in preview automatically.
- **Position parameter** is your friend — use absolute timeline labels (`stage1`, `stage2`, ...) at each stage boundary so timing tweaks don't cascade.
- **No `setTimeout`, no `requestAnimationFrame`** — everything goes through the GSAP timeline (HyperFrames seeking requirement, also project invariant from AGENTS.md "no raw async primitives").
- **Camera zoom/pan**: implement as GSAP-animated CSS `transform: scale() translate()` on a wrapper `<div>` containing the topology — *not* by reflowing nodes individually. Keeps motion frame-rate-stable.
- **Loop-seam validation**: at the end, evaluate `tl.time(0)` vs `tl.time(tl.duration())` visually in preview. The two frames must be indistinguishable.
- **Render to two formats**: MP4 for downloads/social, WebM (VP9, transparent if your design allows) for `<video autoplay muted loop playsinline>` embedding on the landing page.
- **Headline test**: after rendering, drop the video into the actual hero slot on the live `website/` and verify the planned headline text is readable over the most visually busy frames (likely Stages 2, 5c, 6b). If contrast fails, increase the overlay darken to 50% rather than dimming the video itself.

### Mode-B quality checks (in addition to Step 6)

- [ ] Total duration is 40–48s
- [ ] Stage 8's final frame matches Stage 1's opening frame (loop seam invisible)
- [ ] Sugar names used as labels are exactly: `state`, `producer`, `derived`, `effect` (no `node` in user-facing labels)
- [ ] Message labels used are exactly: `START`, `DIRTY`, `DATA`, `COMPLETE` (foundational subset)
- [ ] No captions over the topology (small floating labels of ≤4 words OK; full sentences are forbidden in this mode)
- [ ] Both MP4 and WebM/VP9 outputs render successfully
- [ ] Headline-readability test on a live `website/` page passes
