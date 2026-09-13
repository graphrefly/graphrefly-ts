# Root soak timeout audit and focused recheck

2026-09-12 · owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS` · candidate `9c30967c`.
User continuation authorized diagnosis and necessary bounded offline recheck. This is attempt/evidence
under the same work, not a new decision, deadline policy or performance execution grant.

## Finding

The previous soak ran20:16:04–20:50:15 PDT. Retained macOS power events show clamshell sleep at20:29:46,
DarkWake at20:29:49, maintenance sleep at20:30:34, DarkWake at20:43:35, maintenance sleep at20:44:20,
and DarkWake at20:47:19. This independently establishes interruption of the test environment.
The failed development-3/target test reported786386ms against its420000ms limit; development-4/target
reported194755ms and a subprocess deadline failure. These elapsed values cannot establish a library
performance regression. Sleep is a supported explanation for interrupted execution and delayed timer
handling, not a reconstruction of every subprocess or proof of the only cause. Earlier logs lack the
specific timed-out child command and per-test absolute start clocks; no exact command attribution is claimed.

`root-eval-task.ts:315` pins fixture checkout to `dea57bdeb4b370dddbbe2505bd05f9e3551b26c6`.
`root-eval-live.ts:1632` clones locally and checks out that commit. The qualification at:1847 loops
through five mechanisms, applying ambiguous and correct candidate text in separate workspaces and
running public/hidden verifiers. `root-eval-task.ts:1110` generates a simple expression-returning fixture
with a type-only contract import; :1139 generates its direct Vitest assertions. This is historical fixture
qualification, not a measurement of the current makeDepBookkeeping implementation. The host helper,
task generator and test file have no diff from8253488b through9c30967c. Current package loading must not
be conflated with the frozen checkout used by the verifier child.

## Focused evidence

One run selected exactly development-3/target and development-4/target with the existing root-soak
config and test-name filter. Both passed,219 other cases skipped, exit0,56.414s whole command.
Case durations:27.230s and25.754s. Original420s test and existing120s/300s verifier subprocess deadlines
were unchanged. No library, test, fixture, system sleep policy or evaluator code changed.
Post-run power-log lookup found no Sleep/DarkWake/Wake transitions within the recheck window.
Source hashes match the precheck. This resolves the two failed-case readiness questions; it is not a
fresh221/221 whole-soak pass. The earlier219-pass/2-fail receipt remains untouched.

The supervisor receipt's monotonic duration includes the post-run power-log read, whereas its wall
start/end delimit the test command. Do not subtract them to infer clock drift or suspension duration.
The historical power extract retains only Sleep/DarkWake/Wake event lines; Wake Requests metadata
matched by the initial broad parser was removed from that extract before archiving. No relevant event
line was discarded and the recheck's empty event extract was unchanged.

## Evidence and next boundary

`receipt.json`, `verification.json` and `source-binding.json` give command/selection, assertions and
current source coordinates. Raw JSON test results, logs, runner and exact selected power events are in
`archive/evals/causal-soak-timeout-audit-v1/evidence.tar.gz`; every indexed member was hash-verified.
Archive checking does not rerun the tests. No performance samples or provider/live/spend calls occurred.

The next step is the already described finite, uninstrumented comparison tooling preparation. The two
timeouts no longer justify treating this candidate as a regression or rerunning the entire soak.
Do not widen a timeout or introduce a library profiler to address host suspension. Future measurement
must retain host suspension evidence and fail/stop according to its predeclared policy when continuity
is lost, rather than treating interrupted wall time as library cost. Exact awake-host enforcement and
its qualification belong in preparation; this audit does not silently amend a frozen method.

Known full-lint and frozen-manifest failures remain separately recorded. Overall work/D169 qualification
and graded public exports remain incomplete; the single-pass candidate is still unmeasured.
