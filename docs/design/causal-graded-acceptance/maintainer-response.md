Maintainer walk-through: **partially complete**. Read order was **M → P → G**. I traced the original graph and offline ownership boundary, but did not execute a demo, construct two instances, or establish full consumer verification. This is an evidence interpretation exercise, not a blind or human study.

All paths below are relative to `/Users/davidchenallio/src/graphrefly-ts-latency-review`.

**Q1 — supported: minimum maintainer access**

An existing application must retain the original `graph` and composed `app`; a maintainer needs graph structure plus host records, not just the display view:

```ts
const topology = maintainerExample(graph); // graph.describe()
const vendorStats = graph.find("alerts/vendorStats");
const authority = graph.find("alerts/causal/authority");
const records = app.inspect().records;
// Each record contains request, admission, and optional outcome.
```

Sources: `examples/spending-alerts/causal-audience.examples.ts:27`, `causal-graded-demo.ts:120`, `causal-focused-host.ts:567`. The demo itself uses `graph.find` at line 166.

For initial creation, the application supplies five actual input Nodes—pack, arrivals, current policy, verification receipts, local permission—and an `OfflineAlertResource` carrying its validated binding and asynchronous write callback. `causal-graded-demo.ts:33–60` supplies a concrete example. These input and verification responsibilities have not disappeared behind the preset.

**Q2 — supported, with isolation verification unknown**

Configuration validates and freezes defaults; it does not compose (`causal-entry.ts:47–75`). Compose prepares construction, claims the resource, builds nodes, seals and transfers ownership, starts construction, then schedules host facts (`causal-focused-host.ts:103–137`, `554–561`). The first UI subscription observes the five existing ports; it does not establish application ownership (`causal-view-binding.ts:16–50`).

M performs the same sequence explicitly (`scripts/fixtures/spending-focused-host-direct.ts:34–78`).

Fresh host records and counters are allocated per builder invocation (`causal-focused-host.ts:165–174`). Capabilities receive unique instance identity and enforce original graph, epoch, issued objects and lineage (`packages/ts/src/solutions/causal-occurrence/capabilities.ts:67–89`, `122–146`). A transferred resource cannot be claimed again (`causal-focused-host.ts:55–77`); the six final input lanes must use distinct Nodes (`causal-preset.ts:73–93`).

**Unknown:** I did not construct two instances or inspect the permitted-but-unlisted construction implementation, so I cannot certify every name collision, graph input ownership, or epoch reuse case. Reusing copied capabilities or treating another graph’s capabilities as local is explicitly rejected; this is not a security sandbox.

**Q3 — supported: UI detach does not discharge ownership**

Unsubscribe removes view subscriptions only (`causal-view-binding.ts:32–35`). The graph-owned roots include the guard and end-readiness node; host records and promise continuations persist separately (`causal-focused-host.ts:464–488`, `550–580`). Therefore the application owner remains responsible while an admitted request awaits its outcome.

Normal completion requires more than a successful write: pack frontier covered; explicit local stop; lifecycle and retained-evidence quiescence; no pending occurrences/effects; settled outcomes excluding `unknown` and `reconcile-required`; no host fault, in-flight write, scheduled delivery or active delivery (`causal-focused-host.ts:520–544`, `570–571`).

The saved demo implementation specifically checks completion while detached, reconnect without another write, then stop before normal-end readiness (`causal-graded-demo.ts:99–119`). I read those assertions; I did not independently run them.

**Q4 — supported change and bounded consequences; authorship beyond recorded operation unknown**

The concrete source edit is `vendorStats`’ amount extraction:

```ts
e.prefix.map((t) => t.amount)
// transformed to:
e.prefix.map(({ amount }) => amount)
```

The original computation is at `causal-business.ts:307–309`. Its affected downstream relationships are `vendorStats → anomalyScore → thresholdGate → reasonFactors → alertMessage`, with assessment and request-material branches (`causal-business.ts:312–399`; `source-binding.json:results.fresh.topology.edges`). Publication, evidence and final guard retain separate authority dependencies (`causal-preset.ts:120–144`; `causal-focused-host.ts:299–307`).

`source-binding.json:provenance` records **Codex qualification tool**, an **in-memory esbuild transformation**, and `productionSourceEdited:false`. This attributes the recorded experiment, not the original production author or arbitrary algorithm changes.

I compared the complete saved control/fresh topology objects: they are exactly equal, containing 62 nodes and 101 edges. Nevertheless, source and executed-bundle digests change; request reference, proposal digest and admission reference also change. Control and fresh runs record identical payload bytes and successful simulated outcomes (`source-binding.json:bundles`, `results.control`, `results.fresh`).

Thus **topology unchanged does not mean implementation or evidence identity unchanged**. This particular equivalent extraction plausibly preserves numerical inputs; saved observations support its one exercised consequence. Arbitrary algorithm changes could alter scores, flags, payloads and authorization matching despite identical edges.

**Unknown:** general behavioral equivalence, authenticated human authorship, real inbox success, or independent reproduction of the qualification tool. `scope`, `digestMethod` and `realInboxIO` expressly bound the evidence. The ordinary demo’s fixture digests are not loaded-source attestation (`causal-graded-demo.ts:150–158`).

**Q5 — supported protections; some execution coverage unknown**

- **Old receipt:** saved `staleBoth`, `staleSource`, and `staleRuntime` cases each show zero calls and zero host records; fresh evidence yields one call. The guard matches source/runtime/input/policy/request digests and verifier/domain (`causal-focused-host.ts:385–395`).
- **Wrong admission:** the host checks proposal/material association and recomputes the admission reference before writing (`causal-focused-host.ts:335–352`, `413–443`). `mutations.json:results[name=accept-counterfeit-admission]` reports its control passing and mutant killed.
- **Replay:** retained proposal-keyed records prevent another write; changed admission on an existing key becomes a fault (`causal-focused-host.ts:370–375`). The replay mutation is killed, but its observed difference is a spurious cancellation; that result alone should not be paraphrased as proof of duplicate external I/O.
- **No alert:** Plain skips material/effect creation when unflagged and still emits publication-policy terminal handling (`spending-preset-plain.ts:231`, `429–438`). Graph computes an unflagged assessment and normal message (`causal-business.ts:328–399`). **Unknown:** complete Graph no-alert execution through material suppression, retained evidence and normal-end completion was not established by my permitted readings; the material/admission implementations were not permitted files.

**Q6 — supported / not-comparable**

G and M are a valid bounded comparison of preset creation convenience versus manual orchestration of the **same Graph nodes and host builder**. They are not independent implementations.

P independently maintains business/effect/evidence state and exposes `push`, `invalidate`, and snapshots (`spending-preset-plain.ts:90–158`, `491–559`). It has no corresponding owned resource, asynchronous host writer, UI subscription lifecycle or host-level normal-end predicate in that class. **G/P full host experience is not-comparable.** No performance or general cognitive-benefit conclusion follows.

For full consumer verification, missing proof includes comparable Plain host obligations, actual consumer construction/interaction results, broader behavior-changing edits, verified no-alert completion, and a qualified real host’s failure/reconciliation behavior. This evidence cannot independently close B121 or establish human comprehension gains.

Friction: manual assembly immediately required construction/ownership concepts; the entry alone was insufficient. `graph.describe()` supplies structure, while source provenance and consequences require separate artifacts and code. A large JSON read was truncated; I recovered relevant fields with a focused read.

Minimum concepts: original node identities and edges; occurrence/request/admission/outcome identity; graph/epoch ownership; digest-bound receipts; retained obligations versus observation.

Audit: **8 tool calls**, read-only; no demo, network, writes or performance sampling. Looked at protocol; direct fixture; Plain fixture; entry; view binding; graded demo; audience examples; focused host; source-binding and mutation JSON; business; preset; capabilities; and targeted lines in README, publication and inputs. No previous reviews or other agents’ answers were read.
