# Release-local subscriber counting implementation

Approval: user agreed to `2f19cc0d`, release-counting-v1 §§2–4; see approval.json. Unique work remains `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. No new durable decision, public API, protocol behavior or performance run.

The production change is one private accounting block in Graph._releaseNodes. After the first member passes quiescence, a multi-member release builds one local count map from active members' current dependency occurrences. Each target still undergoes quiescence then subscriber checking in original order. Self-dependencies are excluded; repeated occurrences remain counted. Empty/singleton groups allocate no count map. No map survives return or rejection.

The graph remains responsible for lifecycle. Removing a presentation subscriber does not settle an authority obligation or perform release. Actual release still rejects an external dependent first, rejects a nonquiescent or externally subscribed member in entry order, and only then enters the original registry/runtime/owner/event commit. Runtime cleanup continues after a member fails and retains original first-error and ownership evidence.

Verification has three levels:

- Diff: only the private Graph accounting block changes in hand-written production source. Guard/accessor/runtime/owner/group source remains unchanged. Ordinary Graph, operator, construction and restore paths create Node/StateNode with read-only dependency access; no supported reentrant guard accessor was found. Two static reviews returned clear.
- Behavior: independent target-wise oracle covers 1,036 finite states and two same-host retry checks; nine actual loaded-source mutations fail on observable assertions. Fifteen additional cases load the real quiescence predicate, exercise each rejecting term and prove registry preservation before allocation. Five operation-count cases distinguish empty/singleton/large groups and first-member rejection. No timing claim is made from instrumentation.
- Trace: the real two-source fan-out/fan-in test accepts internal subscriptions and rejects only the joined sink's external subscriber. Rewire after rejection uses fresh live deps. Explicit release after disconnection removes all five nodes from describe/find/profile/checkpoint, emits exactly five release events and retires names. Competing errors retain their original order.

Gate commands, exits and byte-exact logs are retained beside this report. The receipt supplies final counts and source/artifact hashes. Existing D159 manifest failures remain explicit; their frozen source and artifacts are not regenerated to disguise drift.

Performance remains unmeasured. Controlled hosts confirm 60 activity reads for a 60-member release, versus the original equation's 3,540, but multi-member release adds transient map allocation. Tiny groups may cost more. Neither net elapsed improvement nor the original cold-p95 root cause is established. D169 qualification and graded-entry usability evidence remain incomplete. The next possible batch is a separately reviewed finite performance comparison; this grant does not dispatch it.

Ownership handoff: the user's earlier prediction placed ownership in Graph and required active obligations to survive display detachment; this implementation preserves that boundary. The correction from source inspection is that quiescence itself was already checked once per node—the repeated work was internal-subscriber accounting. Delivered, not yet ownership-verified: implementation tests do not prove human understanding or user-tier ergonomics.

Teach-back: explain why caching these counts across release calls would become stale after a rejected attempt followed by rewire, while one synchronous invocation can share them.

Next-day recall:
1. Where does the public topology-group release enter Graph's private validation?
2. Which failure is reported when an early node has an external subscriber and a later node is dirty?
3. Why must duplicate dependency occurrences survive counting?
4. Why does display detachment not settle an active authority obligation?
5. Which evidence is still required before claiming improved performance?

Final gates: full TS 2,550 passed / two existing D159 manifest failures / four skipped; root soak 221 passed. Counting qualification, scoped Biome, no-raw-async, implementation and test typechecks, build and ESM/CJS/DTS subpath smoke passed. Artifact check still rejects the existing frozen D159 manifest drift.

The complete lint command is NOT green: after fixing new exit-record formatting, full Biome reports seven formatting errors in the prior release-boundaries batch's immutable JSON evidence. Those bytes and their receipt bindings remain unchanged. The initial lint command stopped at Biome; its remaining gates were therefore executed separately and passed. No lint exclusion or configuration weakening was added. The generated local-untrusted-js runner was rebuilt and contains only the corresponding release-method change; no other hand-written production file changed.
