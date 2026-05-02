# DS-13.5 implementation sub-plans

Per-DS implementation guides for the design sessions locked during the **DS-13.5 lock-down session 2026-05-01**. Each file is self-contained for handoff to an unfamiliar implementer.

**Parent doc:** [docs/implementation-plan.md, "Phase 13.5 — Locked design sessions awaiting implementation"](../implementation-plan.md)

**Per-DS files:**

| DS | Scope | Status | File |
|---|---|---|---|
| **A** | INVALIDATE protocol redesign — Q1–Q16 locked | Implementation-ready | [DS-13.5.A.md](DS-13.5.A.md) |
| **B** | Reactive-options widening for 5 resilience primitives + StatusValue/GateState central enums | Implementation-ready | [DS-13.5.B.md](DS-13.5.B.md) |
| **C** | MemoryRetrievalGraph keepalive + state plumbing fix (alt A) | Implementation-ready | [DS-13.5.C.md](DS-13.5.C.md) |
| **D** | JobFlow remaining sub-issues (D.2 widen-not-wrap, D.3 JSDoc, D.4 per-claim eval mount) | Implementation-ready | [DS-13.5.D.md](DS-13.5.D.md) |
| **E** | Messaging audit-record schemas (4 records, alt A) | Implementation-ready | [DS-13.5.E.md](DS-13.5.E.md) |
| **F** | `retention.score` side-effect extraction (D1 fix, alt A) | Implementation-ready | [DS-13.5.F.md](DS-13.5.F.md) |
| **G** | `extends Graph` consistency sweep | ✅ Closed without action (2026-05-01) | [DS-13.5.G.md](DS-13.5.G.md) |

**Recommended implementation order** (cross-DS dependencies):

1. **A first** — Q16 (TEARDOWN auto-precedes with COMPLETE/ERROR) is a load-bearing change for C, D.4, and the per-call-subgraph pattern. Land Q16 as the first discrete change inside A.
2. **B in parallel with A** — independent scope (resilience primitives), no dependency on A.
3. **C, D, E, F** — can land in parallel once A's Q16 has shipped.
4. **G** — no work; lock note already in implementation-plan.md.

**After all DS-13.5 implementation lands:** Phase 13.6 opens (rules/invariants audit + library-wide cleanup pass). See:
- [docs/implementation-plan-13.6-prep-inventory.md](../implementation-plan-13.6-prep-inventory.md) — precursor inventory of 247 rules from spec + COMPOSITION-GUIDE + memory feedback.
- Implementation-plan §"Phase 13.6 — Rules/invariants audit + library-wide cleanup pass" — phase placement and structure.

---

## File anatomy (each DS-13.5.{A-F}.md contains)

1. **Status + scope summary**
2. **Locked decisions** (verbatim from implementation-plan.md, no paraphrase)
3. **COMPOSITION-GUIDE pointers** (rule IDs from the precursor inventory)
4. **Files to touch** (with line anchors from Explore findings)
5. **Watch-outs** (Q6 hidden invariants from each 9Q walk)
6. **Memory pointers** (file paths only, no duplication)
7. **Acceptance criteria** (Q9 coverage matrix)
8. **Required tests** (per [docs/test-guidance.md](../test-guidance.md): protocol-level assertions, observation patterns, RESOLVED/skip checks, regression-test format)
9. **Implementation order**

DS-13.5.G is shorter — closing-audit reference only.
