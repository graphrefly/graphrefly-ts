# Next comparison preparation — proposal, no execution grant

Owner: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS. Baseline: 8253488b (factory unchanged from
7a229382); candidate: the commit containing this report. Exact candidate commit and full input closure
must be resolved and frozen by preparation before any run. This document is not a runnable claim.

Question: does single-pass eager initialization reduce actual P2 summary consumer construction cost,
without transferring cost into first activation/inputs, duplicate handling, cleanup or lifecycle total?
No object-count reduction is expected. No performance observation has been made for this candidate.

Reuse the established currentness before/after driver, semantic preflight, retained P2 input, eight
lifecycle clocks, parent supervision and independent verifier, adapting only the source pair. The exact
P2 input SHA256 is 44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079.
Preparation must prove sole handwritten library difference is makeDepBookkeeping, bind generated runner
separately, rebuild bundles reproducibly, and exclude profiler, forced GC and production instrumentation.
It must correct the previously documented Darwin verifier handling BEFORE freezing, not mid-run.

Proposed fixed schedule: P2-lifecycle and inactive-1; per row control, four main pairs, control;
two repetitions per pair, complementary U/V fresh processes per repetition. 48 serial children,
20 warmup + 50 measured samples in each of two slots per process: 6720 lifecycles total,
1920 warmup / 4800 measured, plus 384 untimed semantic preflight instances. Freeze 24 order bits.
Use same baseline / byte-identical baseline-copy for controls. Do not combine these with historical
samples. Inactive-1 times release after construction; it is a negative timing-path control, not an
untouched process: its setup also calls the changed factory. Report that limitation explicitly.

Retain all absolute phase p50/p95/sums, process/order positions, matched C/B ratios, action-sum and wall
span. Primary outcome construction; first six inputs, duplicate and cleanup expose displaced cost.
Do not adopt the change merely because constructor microbenchmarks improve. Report each metric
separately: stable matching controls require every control pair-position median in [1/1.05,1.05];
consistent decrease requires all eight main pair-position medians below1, increase analogously above1;
otherwise mixed/unqualified. These descriptive rules reuse the earlier comparison, not D169 acceptance
or statistical significance. 50-sample p95 is noisy. No post-hoc averaging away failed controls.

Proposed resource limits: 30s/child, 900s whole run, 256MiB observed child RSS, 100ms target polling with
actual maximum gap retained. Stop on input/runtime drift, semantic failure, malformed/missing clocks,
process failure or resource violation. No retries, outlier deletion, replacement or extension.
Independently verify each child before proceeding. Save failed prefixes and all not-run coordinates.

Before seeking execution approval, qualify adapted tooling with synthetic counts/order/resource/stop
failures, verify frozen source and runtime identities, and prepare the exact reviewable command,
manifest and bounded execution claim. Keep mutable logs outside every hashed input directory.
Archive replay must verify hashes and independently reproduce the report without executing consumers.
This batch has prepared the comparison scope only; adapted tooling and actual capture remain undone.
If construction controls again fail, retain the unqualified result and stop this comparison direction.
No more same-kind sampling follows automatically; no claim about public graded exports or global RSS.

Readiness blocker from implementation verification: root-soak development-3/target and development-4/target timed out. Resolve or bound their relationship to this candidate before freezing new capture tooling; do not increase deadlines or classify them as pre-existing without evidence.
