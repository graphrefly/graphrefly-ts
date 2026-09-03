# D152 development-3 execution authorization

2026-09-02. Execution authorization and preparation evidence, not a new durable
decision. Unique owner: graphrefly-ts package-private root efficacy Eval.

The user approved the immediately preceding exact proposal: development cumulative
hard cap USD 40; development-3 generation hard cap USD 4.179695; confirmatory
unchanged at USD 6. The resulting combined partition ceiling is USD 46. This
supersedes the earlier conditional development-3 grant that required releasing
USD 4 of development-2 reservations. No reserve release is now requested or made.

- Action: one fresh D152 development-3, five matched replicates × six fixed arms.
- Generation: `root-eval-development-2026-09-01-d152-v3`.
- Execution binding: `user-authorized:d152-development-3:usd-4.179695:development-usd-40`.
- Governing architecture: graphrefly-ts:D151/D152/D153/D154; stable operator
  configuration workflow: graphrefly-ts:D149.
- Development accounted spend before execution: USD 35.820305, including the
  unchanged USD 4 unknown-response hold. Remaining authorized amount: USD 4.179695.
- Prior ledger digest: `sha256:bc1bdd67b7ebad4e04547ace592fb9bc2c2f80ca85a13d5e66443bcf006ad00a`.
- Preserve original generation-1/2 partition identities and record bytes. New
  generation-3 records use `development-usd-40`; no history migration or rebinding.
- Same DeepSeek V4 Flash model on OpenRouter/Fireworks, task mechanism family,
  prompts, source/target provenance, verifiers, six-arm order and efficacy threshold.
- Existing bounded adaptive retries are part of this one campaign. No automatic
  later generation, confirmatory dispatch, provider switch or settings mutation.
- Single-use fail-closed claim and atomic evidence/ledger persistence remain.
  Readiness and offline qualification grant no additional spend authority.
- Fresh committed-state no-network gates precede private credential admission,
  current-key/pricing/ZDR reads, claim and provider dispatch. Stable browser
  settings are not re-inspected unless explicitly changed or contradicted.

Baseline implementation: `95aa60e2fe2e56fdff59e0fd43d12fc505ce8b01`.
Its clean committed-state full sweep passed 2169 tests, with four existing skips
(`.runlog/run-20260902-090212-5227.log`). The execution-binding update receives
its own no-network review and the normal full precredential gates before live.

## Preparation attempt — blocked before credentials

Execution-binding commit: `ec69f477`. Five focused budget/authority/history
tests passed; lint/typecheck and artifact reproduction passed. Static control
and financial QA found no blocker in that binding diff. No full-suite result
for this binding commit is claimed: the normal entry stopped before long gates.

The 2026-09-02 18:23:53 America/Los_Angeles entry failed while preparing the task
manifest: `createRootEvalTaskManifest` supports only the two predeclared variant
banks for development-1/2. Development-3 has no bank and is correctly rejected;
the existing tests only exercised the first two materializable generations.
This should have been checked before presenting the live preparation as ready.

Log: `.runlog/run-20260902-182353-35287.log`, exit 1 after one second.
No credential admission, control-plane call, claim, provider dispatch, evidence
transaction or generation consumption occurred. Prior ledger digest and
USD 35.820305 accounted spend are unchanged. The development-3 authorization
has not been spent or replayed.

Next boundary: explicit approval to supply a new five-mechanism development-3
fixture bank under the existing D152 schema and discrimination/disjointness
contracts, followed by full no-network QA before this same unconsumed run.
Do not alias development-1/2, merely rename old mechanisms, alter the threshold,
or infer permission to modify experimental material from a budget grant alone.
