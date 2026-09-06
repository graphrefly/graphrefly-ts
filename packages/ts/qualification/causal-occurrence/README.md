# Causal occurrence TS arm qualification

This package-private qualification covers `graphrefly:D791` contract-v2 and the original
`graphrefly-ts:CAUSAL-OCCURRENCE-TS` work. It does not qualify a consumer's external host,
the future layered API/preset, source-to-node binding, or the B121 product proof.

Run from the repository root:

```sh
pnpm --filter @graphrefly/ts exec vitest run src/__tests__/solutions-causal-occurrence.d791.test.ts
pnpm test:causal-occurrence:qualification --output /tmp/causal-occurrence-mutations.json
```

The runner checks unchanged and structure-guard-isolated baselines, then mutates real
temporary source modules. It removes each of 29 required runtime edges twice: once to
test topology validation and once to test observable behavior with only the construction
guard isolated. Another 15 mutations alter authorization, result, conservation, retention,
or progress semantics. Behavior mutants must fail an assertion; compiler, module-loading,
unexpected runtime errors, timeouts, empty runs, and surviving mutants are failures of
qualification. `--filter` supports focused development runs; a subset never receives
`complete: true`. Neither the checkout nor the production factory has a mutation switch.

The mutation report binds source, tests, runner, toolchain, runtime, executed tests, and
failing oracles. Test fixtures release output and helper subscriptions and remove graph
registrations through the existing topology-group API. Each candidate runs in a child
process which must exit; the runner removes its temporary directory and checks that the
original source and tests are unchanged. This verifies fixture/process cleanup, not a
new public bundle-disposal API.

The repaired bounded behavior is intentional:

- `maxOccurrences` also bounds distinct retained revision domains across every input
  lane, including watermark-only and pending-only domains. Domain tombstones are not
  recycled when an occurrence is evicted; new domains over the lifetime bound receive
  `causal-occurrence/domain-bound` DATA issues.
- Evidence at `maxEvidence` produces a persistent explicit coverage gap through the
  same transition for direct and pending arrivals. Overflow retains at most one gap per
  occurrence/required evidence kind and one optional-kind representative. It cannot
  erase a prior gap or imply complete coverage; this is not an exhaustive overflow log.
- Proposals blocked by `maxEffects` remain in the existing bounded pending storage.
  Capacity issues do not mean an effect was admitted or settled. Pending obligations
  prevent occurrence eviction; available capacity drains exact proposal/admission/outcome
  facts synchronously, preserving the first retained proposal against conflicting replay.
- Occurrence eviction retains the existing fail-closed retention-gap behavior. These
  repairs do not invent restoration of lost contiguous currentness evidence.

`ts-v3-mutations.json` is the current qualification result. `ts-v3-receipt.json` binds
the final checks and implementation closure; historical ts-v1 receipts remain in the
original work record. Runtime qualification and root contract-definition completion
remain separate from B121 integration completion.

Pre-commit QA found two additional paths: a new domain’s first pending revision must drain when capacity returns, and an independently invalid outcome state/result pair must be rejected before reserving domain capacity. These are repaired and requalified in ts-v3. The ts-v2 receipt and mutation report are preserved as historical evidence; `ts-v2-inputs.json` preserves their original file bytes. Their older passing tests did not cover these two defects and are not current full qualification.
