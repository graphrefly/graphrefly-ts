# Together candidate — no-network qualification

This is a package-private preparation receipt, not a new D#, execution grant,
live result, or efficacy finding. The user approved investigating Together first
through the existing OpenRouter key, retaining the exact model and privacy
requirements; DeepInfra remains a backup, not an automatic fallback.

## Exact boundary

- Model: `deepseek/deepseek-v4-flash-0731`; model revision `0731`.
- Candidate route: `together`; response provider identity: `Together`.
- Same target and enhancement-profile digests as the current Fireworks profile:
  medium reasoning, 65536 inspection / 16384 mutation output ceilings, strict
  JSON Schema content carrying an exact replacement proposal. This is not native
  tool calling.
- Request routing remains one exact `order` / `only` provider with
  `allow_fallbacks: false`, `require_parameters: true`, `data_collection: deny`,
  and `zdr: true`.
- Graph admission reconstructs the exact qualified tuple. It rejects mixed
  provider catalogs, foreign qualifications, caller eligibility and unqualified
  providers. No Work Item / Memory lifecycle, node, edge, operator flag or
  domain-ordering timer was changed.

The public OpenRouter catalog and ZDR registry were inspected on 2026-09-02:
[0731 endpoints](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints),
[ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr).
Together advertised structured output and reasoning support, at USD 0.14 / 0.28
per million input / output tokens. These observations identify a candidate;
they do not establish live availability, account limits or response quality.
Fresh route/pricing admission is still required for a subsequent paid run.

## Executable evidence

The existing root-eval live test file now runs an injected Together response
sequence through five real source Work Items and thirty real target Work Items,
the existing Memory bridge/application/use path, exact-tool admission, isolated
workspaces, behavioral verifiers, Graph settlement and cleanup. All 35 proposals
are intentionally correct fixtures. All six arms pass five tasks, so the result
is `no-positive-differential`, not evidence of LLM learning or efficacy.

| Contract | Executable check |
| --- | --- |
| Same model/profile, distinct provider binding | `model-harness-profile-current.test.ts`: candidate target/profile equality; separate binding and qualification; current route remains Fireworks |
| One provider and no implicit fallback | Mixed catalogs, foreign qualifications and DeepInfra-as-unqualified-candidate reject at root admission |
| Exact response identity | Together accepts only Together under its admitted route and the pinned revision; Fireworks/DeepInfra/wrong revision and legacy tool-call shapes reject |
| Actual candidate effect path | 35 injected provider responses, 30 target completions, exact tools and hidden verifiers; empty workspace directory after cleanup |
| Conservative cost | Synthetic reported cost is 35 × 168 = 5880 microusd; no unreported holds for the successful fixture sequence |
| Together 429 cost boundary | Missing usage retains the admitted reservation; valid `usage.cost` takes precedence; D154's policy-qualified nonbillable proof stays Fireworks-only |
| No authorization transfer | Genuine Together Graph effect under a valid Fireworks claim rejects before materialization/dispatch: zero requests, zero cost, no dispatch receipt |

QA's two static reviewers independently found the last authorization-transfer
hazard. It was fixed in the common live / injected-transport boundary, then both
reviewers found no remaining issue. The separate no-network candidate executor
does not use credentials or provider fetch.

Focused checks passed 47 tests (80 nonmatching tests excluded by that focused
selection). After fixing a mistaken topology/live qualification digest reference,
the complete suite passed in clean committed state at `3d2b1c45` with
`NODE_ENV=test pnpm test`: 2190 passed, four existing skips, 133 test files passed
and one existing skipped file. No test was disabled for this change. The logged
run completed with exit zero at 2026-09-02 23:30:40 PDT in 657 seconds:
`.runlog/run-20260902-231943-87897.log`.

Lint, eval typecheck, package build, ESM/CJS/DTS export smoke, raw-artifact
reproduction and diff checks passed. The root retains 311 node identities and
413 identical edges. Private ledger digest remains
`sha256:ac37f63e1a6964966e15b24d2a906b81a0690095d0fe0ef3d212db6a63b8305a`.
This QA closeout changes documentation only; the frozen runtime closure is unchanged.
Ownership checkpoints were skipped at the user's request: delivered, not yet
ownership-verified.

## Freeze and next boundary

- Implementation v71:
  `sha256:6ae46d7d48866e245c69532fcf90a692abe4bb15a5cd313017f5820c513a8d67`.
- Live-boundary qualification v49; topology qualification v43; root topology v22
  and evidence v27 unchanged.
- The regenerated [raw describe](artifacts/root-eval-describe.json) still describes
  the current Fireworks catalog. It must not be presented as a Together live run.
- `createCurrentExactModelHarnessProfileInput`, current live authorization,
  credential configuration, private ledger and consumed development-3 artifacts
  remain unchanged. No settings were edited and no paid requests were made.
- Development-3's last closeout leaves USD 4.164244 under the approved USD 40
  development partition; that remaining room is not a new execution grant.

Next is a separately bounded Together live qualification, followed by an exactly
authorized fresh campaign if qualification succeeds. It must not reuse consumed
development-3, manufacture an unsupported development-4 task bank, silently mix
providers, or count qualification probes as efficacy evidence.
