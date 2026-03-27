# Design Decision Archive

This directory preserves detailed design discussions from key sessions. These are not casual notes — they capture the reasoning chains, rejected alternatives, and insights that shaped the architecture.

## Predecessor: callbag-recharge

GraphReFly is the successor to [callbag-recharge](https://github.com/nicepkg/callbag-recharge) (TS, 170+ modules) and [callbag-recharge-py](https://github.com/nicepkg/callbag-recharge-py) (Python, Phase 0-1). The full design history of callbag-recharge is preserved in those repos under `src/archive/docs/DESIGN-ARCHIVE-INDEX.md`.

Key sessions from the predecessor that directly informed GraphReFly:

| Session | Date | What it established |
|---------|------|-------------------|
| Type 3 Control Channel (8452282f) | Mar 14 | Separating control from data — evolved into unified message protocol |
| Push-Phase Memoization (ce974b95) | Mar 14 | RESOLVED signal for transitive skip — carried forward |
| Explicit Deps (05b247c1) | Mar 14 | No implicit tracking — carried forward |
| No-Default-Dedup (4f72f2b0) | Mar 15 | Operators transparent by default — carried forward |
| Output Slot (8693d636) | Mar 16 | null→fn→Set optimization — carried forward |
| Lazy Tier 2 (lazy-tier2-option-d3) | Mar 18 | get() doesn't guarantee freshness — evolved into status-based trust |
| Promise Elimination (callbag-native) | Mar 24 | Internal APIs return sources not Promises — carried forward |
| Vision: LLM Actuator (vision-llm-actuator-jarvis) | Mar 26-27 | Three-layer vision, Graph as universal output — directly triggered GraphReFly |

---

## GraphReFly Sessions

### Session graphrefly-spec-design (March 27) — Unified Spec: Protocol, Single Primitive, Graph Container
**Topic:** Designing the GraphReFly unified cross-repo spec through a 7-step process. Radical simplification from callbag-recharge's 6 primitives + 4 callbag types to 1 primitive (`node`) + unified message format.

**Process:** Lessons learned → demands/gaps → functionalities → common patterns → primitives → nice-to-haves → scenario validation.

**Key decisions:**
- **One primitive: `node(deps?, fn?, opts?)`** — behavior from configuration, sugar constructors for readability
- **Unified message format:** always `[[Type, Data?], ...]`, 9 types, no channel separation
- **Unified node interface:** `.get()` (cached, never errors), `.status`, `.down()`, `.up()`, `.unsubscribe()`, `.meta`
- **Meta as companion stores** — each key subscribable, replaces all `with*()` wrappers
- **No separate Knob/Gauge/Inspector** — `describe()` + `observe()` on Graph
- **Pure wire edges** — no transforms, everything is a node
- **Colon namespace** — `"system:payment:validate"`

**Validated scenarios:** LLM cost control, security policy, human-in-the-loop, Excel calculations, multi-agent routing, LLM graph building, git versioning.

**Outcome:** `docs/GRAPHREFLY-SPEC.md` (v0.1.0), `docs/roadmap.md`, new repo decision.

---

## Reading Guide

**For architecture newcomers:** Start with the spec (`docs/GRAPHREFLY-SPEC.md`), then this session.

**For callbag-recharge context:** Read the predecessor archive index in the callbag-recharge repo, focusing on the sessions listed above.

---

## Archive Format

Each session file contains:
- SESSION ID and DATE
- TOPIC
- KEY DISCUSSION (reasoning, code examples, decisions)
- REJECTED ALTERNATIVES (what was considered, why not)
- KEY INSIGHTS (main takeaways)
- FILES CHANGED (implementation side effects)

---

**Created:** March 27, 2026
**Archive Status:** Initial — spec design phase
