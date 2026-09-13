# Existing arrival granularity: diagnostic delivery

Owner context: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Implements the bounded private diagnostic proposed in `docs/design/causal-unprofiled-latency/input-granularity-review.md`; no product/semantic/API change or new authority record. Product baseline remains `20ba5883` (optimized `b30ae176`), worktree branch `codex/causal-unprofiled-latency`. Original formal D168/D169 rows and qualification remain unchanged/incomplete. About 100 ms is the user's interactive expectation, not an adopted formal gate.

## Completed result

48/48 processes completed in 730.37 s, with 1,008 observations including 720 measured. All timed-instance checks and per-job preflights passed. Five reindexed semantic corruptions were rejected by the independent verifier.

| Candidate operation | P3 full → last-ref (ms) | P6 full → last-ref (ms) |
|---|---:|---:|
| One-new, single DATA | 23.85 → 17.43 | 498.16 → 459.77 |
| One-new, double DATA | 161.80 → 116.83 | 1757.66 → 1500.54 |
| Duplicate, single DATA | 18.61 → 13.20 | 129.17 → 81.42 |
| Duplicate, double DATA | 147.52 → 116.84 | 956.70 → 727.89 |

Medians above are medians of three process medians. The P6 last-ref one-new action includes arrival about 148.62 ms and verification about 310.90 ms; independent median components need not sum exactly to the median total. Plain one-new verification remains about 203 ms. Selecting one reference improves some paths, but does not meet the 100 ms expectation for new P6 work or repeated double DATA. P6 last-ref duplicate single DATA is below 100 ms in these observations; no tail guarantee follows.

No new delta API is needed. Do not shift responsibility to users to build a diff registry. The next targeted optimization candidate is repeated evidence association/authority work under identical fact semantics, followed by before/after evidence. This result does not authorize silently merging waves or dropping duplicated facts.

## Method and what it proves

P3 (16 evaluations) and P6 (64), one-new and duplicate prehistories, full-list and last-reference arrivals, one/two DATA: 16 recipes × three fresh processes = 48. Candidate, reference, plain positions rotate; each arm uses two warmup and five measured fresh instances. Arrival and subsequent verification are separately timed; total includes both. Preparation/construction and correctness checks are excluded. P6 one-new retains verification absence until after arrival, then sends the original full verification frame. Other recipes have no verification step; their verificationMs measures timer/empty-loop overhead only.

Original immutable input files and bundled product source are retained. All recipes first compare candidate/reference/plain effects, evidence and obligations after each input step; Graph arms also compare complete authority state and publication. Single-reference/full-list valid recipes compare these final Graph consequences and ordered distinct emitted authority fact/effect changes. Consecutive identical trace entries are suppressed: exact repeated notification multiplicity is not proved. Business rows are checked with the independent deterministic oracle, and detach/reconnect preserves retained state. These valid-prehistory comparisons do not justify automatically replacing arbitrary full inputs with subsets after invalidation.

The original 149 consumer/reference tests were rerun, plus 16 actual loaded consumer mutations (baseline passed; all 16 detected). They are unchanged-product regression evidence, not mutation qualification specifically of the new recipes. The design's proposed new-recipe mutation battery remains unimplemented; this limits equivalence claims and bars using this diagnostic alone to justify a product propagation rewrite. No actual external executor, provider or spend operation ran.

Independent Python verification checks inventories, hashes, recipe metadata, process identity, observations and summary arithmetic. It does not independently replay business behavior or prove clock placement; fixture/source review and executed checks supply that evidence. Hash binding is consistency with the captured freeze, not external authentication. All repeats must be retained; median results are not a qualified p95 or an end-to-end UI guarantee. These runs have no identical-reference controls and cannot establish small relative preset overheads as causal improvements.

## Repairs and review

Before timing, fixed a fixture parse error and a test invocation from the wrong working directory (which discovered zero tests, not a pass). Independent QA found and repaired missing intermediate facts/full state/publication checks, dropped partial observations, and missing/stale failed-process records. The collector persists completed observations outside clocks, resets active process metadata per job, and retains launched failures. Initial and repaired check-only bundles are preserved separately from the final timed bundle. No timed retry occurred.

The independent reviewer found no remaining blocker for this diagnostic, with the proof limits above. Scoped Biome and Python syntax checks were run. No whole-library test/build pass is newly claimed for a tools-only change; historical product qualification gaps remain.

## Review order

1. `summary.json`: all 16 recipes, three arm medians and repeat totals.
2. `scripts/fixtures/causal-granularity.ts`: existing-input selection, correctness gates, actual clock boundaries.
3. `scripts/run-causal-granularity.py`: serial bounds and failure retention.
4. `scripts/verify-causal-granularity.py` and `negative-verification.json`: independent arithmetic/integrity validation and reindexed corruptions.

The evidence archive contains raw timed samples, preflight attempts, regression/mutation reports, frozen sources and verifier tools. No authority ledger is advanced by this isolated evidence delivery.

## Source-level follow-up, not a new root-cause percentage

`examples/spending-alerts/causal-admission.ts:415` iterates retained evaluations and then verification receipts, even when a newly selected arrival contains one reference. `causal-material-owner.ts:102` also distinguishes existing-material comparisons from insertion/snapshot work. These code paths explain why a subset input does not imply only one row of total downstream work. This diagnostic measures phase costs, not exclusive node costs; it cannot assign a percentage to either loop.

A subsequent optimization should first examine call-local exact receipt association/redundant work within the existing node. Preserve all currently required classifications and emitted facts, invalidation/currentness semantics and complete policy replacement. No persistent cache/index, selector side registry, or unproved wave aggregation follows from these timings. The full-list workload remains a required observation.
