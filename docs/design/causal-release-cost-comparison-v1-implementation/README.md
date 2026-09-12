# Release comparison: preparation failed, no performance result

Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. The user approved fc5acae0 §§2–6 with “继续”. That single-use attempt stopped during preparation, before any timed child or real consumer preflight: **0 / 60 timed children, 0 / 144,000 samples, 0 retries; elapsed 0.366003 seconds**. Every scheduled performance row remains not-run. No inference about cleanup benefit, construction regression, tiny-group cost or control stability is available.

## Cause and bounded repair

The new private builder compared the literal entry path to `scripts/fixtures/causal-release-comparison.ts`. esbuild supplied `./scripts/fixtures/causal-release-comparison.ts`; the missing normalization misclassified this new private wrapper as a file to read from the frozen historical git commit. `git show` correctly failed because the wrapper is not in that commit. This is a tooling defect and an offline qualification coverage gap, not a library failure or performance-budget rejection.

The failed tool bytes, original qualification, command stdout/stderr and terminal result are preserved in the indexed 22-file archive. The current builder and independent rebuilder normalize entry paths with `path.posix.normalize`. The added test loads each real resolver callback and runs real esbuild against a virtual constant module, checking both entry spellings and catching both reverted source mutations. It imports no Graph or real consumer and creates no performance samples. The real frozen source closure has **not** been rebuilt after the failure. The original `qualification.json` intentionally describes the archived pre-attempt tool bytes; `repair-qualification.json` separately binds the repaired sources and new test evidence. Neither authorizes another attempt.

## Delivered private tools and evidence

- Identical B/C wrapper, independent P2 expected snapshot derived from the existing plain instance, graph-owned micro fixtures, external timer driver and child entry.
- Git-object/source binding, independent bundle rebuild, fixed complementary schedule, exact source/slot/position identities, single-use resource guards and independent raw arithmetic/terminal verifier.
- Offline baseline qualifications: five fake row shapes, 4,800 coordinate checks, eight clock-failure positions, nine driver mutants, one business-arm mutant, five loaded child mutants, four numeric mutants, twelve raw-evidence negatives, PID reuse and failed-terminal retention, process-group timeout and RSS-monitor failure. These are synthetic evidence, not runtime performance measurements.
- Two static reviewers; their concrete findings were fixed before the attempt. The post-failure repair adds two loaded resolver mutants and real virtual-module bundler handshake tests.
- Reused library counting regression: 1,036 oracle cases, 15 actual guard cases, two same-host retries, five operation-count cases, nine loaded semantic mutants; real Graph regression: 33 tests. New scoped Biome, no-raw-async, implementation and test type checks passed.
- Fresh archive extraction verifies every indexed regular file and obtains identical terminal outputs from workspace and archived verifiers, with zero new samples. A consistent failed-attempt receipt is not successful performance qualification.

## Preserved limits and next boundary

No library algorithm, generated runner, public API, protocol, provider/live/spend or formal CSP11/D169 matrix change. Prior full-suite evidence remains 2,550 pass / two existing D159 failures / four skipped, with the previous 221-test soak; those unchanged broad runs were not repeated for private tools. Full formatting still has the seven previously byte-bound JSON errors, and the historical D159 artifact drift remains; no all-green claim. The six pre-existing dirty root files and previous receipts are preserved.

The 60-process grant is consumed even though dispatch never began. Do not delete/reuse its exclusive run directory, silently rerun, or use a temporary directory for real-consumer retries. A later bounded build/qualification/capture requires an explicit fresh scope and artifact location. D169 remains unqualified; the owner work, graded hiding, and human/agent ownership evidence remain incomplete.
