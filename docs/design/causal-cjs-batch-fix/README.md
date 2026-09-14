# CJS public-entry batch fix

The user approved repairing the reproduced cross-entry CommonJS defect after withdrawing the broader public spending API proposal. Baseline: `ba68578b`. Runtime source, protocol, package exports, private flagship capabilities and lifecycle semantics are unchanged.

## Change and reason

`packages/ts/tsup.config.ts` enables existing tsup `splitting: true`. ESM already used splitting by default; CJS previously bundled separate batch and wave-boundary state into each entry. The installed tsup explicitly supports CJS shared chunks through its `cjsSplitting` transform. Publishing the complete `dist` includes those chunks. This repairs same-format root/graph/core composition without a new registry or public API. It does not establish mixed ESM/CJS instance interoperability.

The export gate now runs `scripts/check-ts-package-batch.mjs`. It copies actual package artifacts into a temporary installed layout and uses public package imports/requires, in separate format workers. No source aliases or prospective exports are used.

## Evidence

- Preserved original package: ESM 32/32; CJS 9/32, **23 failures**, exit 1 (`baseline-regression.log`). Same-root arithmetic and all ESM controls pass.
- Candidate installed package: **64/64 pass**, both formats, included in `exports.log` (exit 0).
- Covers DATA commit, explicit rollback, callback throw/recovery, both nested batch directions, nested rollback, INVALIDATE commit/rollback, deferred rewire and following waves. Rewire rollback/throw checks prevent a request from being queued; they do not establish cancellation of a previously queued task.
- Full TS offline suite: **2669 passed, 4 skipped**, 160 passing files / 1 skipped (`tests.log`, exit 0).
- Fresh build, ESM/CJS/DTS export smoke, lint, layer/typechecks, test typecheck and historical artifact integrity pass. Historical integrity retains `currentQualified: false`; this is not fresh consumer performance qualification.
- Independent blind and edge-case reviews found no concrete blocker. Verification-gap review requested boundary/INVALIDATE coverage; those cases were added and the reviewer confirmed the gap closed.

Initial regression assertions incorrectly required rollback to emit no derived DATA. Existing rollback/RESOLVED behavior allows re-emission of unchanged value 3. Corrected checks require original source caches 1/2, no changed values, and next-batch recovery. `baseline-initial-expectation.log` preserves that attempt; `baseline-34-cases.log` preserves the intermediate matrix. Neither is the final acceptance result.

## Bounded packaging cost

CJS emitted bytes fall from 8,108,513 to 3,631,031 (**−55.2%**); CJS file count rises from 71 to 135. All JS bytes fall from 11,427,072 to 6,949,590. These are uncompressed artifact sizes, not application bundle or heap sizes.

Twelve alternating baseline/candidate pairs in fresh Node v24.18.0 processes required root, graph and core entry artifacts. OS cache was uncontrolled; no statistical confidence or formal budget claim is made. Observed p50: **16.09 → 19.05 ms**; sample p95: **16.50 → 19.43 ms**. Loaded package modules: 4 → 46 (includes package metadata). More module loading is consistent with extra import cost, but this experiment does not isolate causality. Process RSS ranges: baseline 54.1–55.3 MiB, candidate 51.7–52.0 MiB; these include Node and are not retained library heap measurements.

The first import run had an invalid baseline module count because macOS `/var` resolved to `/private/var`. Its raw observations remain in `import-observations-initial.json`. The worker now canonicalizes the package path and the full paired run was repeated (`import-observations.json`); the first run also showed slower candidate imports. This correction did not change the package or select a faster candidate result.

## Reproduce

From this worktree, build the package and run `node scripts/check-ts-package-exports.mjs`. The standalone batch gate accepts an optional preserved package directory containing `package.json` and `dist`.

For import observations: `node docs/design/causal-cjs-batch-fix/measure-imports.mjs <baseline-package> <candidate-package> <output.json>`. Build identical source revisions/toolchain first. Original artifact hashes and candidate hashes are retained in `artifact-manifests.json`; the temporary baseline copy was an exact pre-fix build snapshot, not an independent reference implementation.

The public spending promotion remains withdrawn. This fix completes only the CJS composition defect; it does not close B121, supply a second general-purpose consumer, or restart the performance matrix.
