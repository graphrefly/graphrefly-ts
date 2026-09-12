# Real-source build qualification and recorder guard repair

The user continued after `a5f4af8e`. This batch narrowed continuation to an offline B/C build and independent rebuild, with no generated-module import, real consumer factory, preflight or performance sampling. Same owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`; no new decision or work identity.

## Observed outcome

The repaired entry resolver successfully loaded the real B dependency sources from `2f19cc0d`. The build-only check then stopped after **3.195502 seconds** because the private builder rejected any occurrence of `performance.now()` in a bundle. B's artifact was not written by that version of the builder; C construction and independent rebuild did not run. There were **zero consumer factories and zero performance samples**. The original 60-process capture was not restarted.

The blanket test is incompatible with the frozen library: `Dispatcher.invoke` contains two clock reads behind its existing `_recording` branch, default false. `Graph` enables recording only when `opts.profile` is truthy; the frozen candidate preset and these micro fixtures do not request it. This finding identifies a checker defect. It does not establish how many clock sites were in the discarded bundle, that the original timed worker was fully eliminated, or a performance benefit/regression.

## Repair and verification

The builder now compares the retained `invoke` method's AST with the method transpiled from the exact frozen dispatcher source, including the early return for recording off. It permits only the two performance references inside that matching method. Independent rebuilding and raw verification retain source/commit binding and reject extra clock counts and computed performance accesses. Bundle and metafile bytes are now saved before checking, so a later rejected artifact remains inspectable. No library source or profiling API was changed or removed.

Loaded tests verify the guard against seven inserted/removed/relocated/aliased/computed clock mutations. The actual `invoke` method on a countable fake host records **off: 0 reads; on: 2 reads**, with one pool call in each case. This proves branch behavior, not zero CPU overhead for the recorder switch. Existing private entry, timer, resolver, lifecycle, numeric, raw-evidence, PID, timeout and RSS failure tests remain passing. New scoped formatting passes. Two static QA reviewers report no remaining blockers after fixing computed-property access coverage.

The failed build's original tool/source bytes and command outputs are indexed in `archive/evals/causal-release-comparison-build-v1/evidence.tar.gz`. Its raw source files are compared to the frozen git commit independently. The earlier capture failure archive, root dirty files, library, examples and generated runner remain unchanged. The repaired guard has not been run again on the complete real B/C build in this batch.

## Remaining step

Complete a fresh, bounded full B/C build and independent byte-for-byte rebuild before treating tooling as ready for real semantic preflight or a renewed performance capture. Keep the same frozen revisions, consumer, five rows and comparison method; do not reopen A/B/C or change D169. The earlier single-use 60-process grant remains consumed. This build-only evidence grants no later sampling, retry, public API/protocol or provider/live/spend action. The owner work and graded hiding/ownership evidence remain incomplete.
