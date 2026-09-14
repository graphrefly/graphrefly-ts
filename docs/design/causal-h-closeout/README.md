# H-B: historical integrity and current offline behavior

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS; D159 remains unchanged. User continued the recommended qualification repair after cf1e255e. This implements the H-B portion of the existing causal-offline-closeout-design. L-B lint provenance classification remains incomplete. No new decision, qualification, permission, provider/live/spend action or owner completion claim is created.

## Result

The two recurring D159 default-test failures are repaired by separating their assertions, not by refreshing the frozen implementation digest or historical bytes:

- Historical artifacts are checked against the fixed marker SHA-256 from git f42fb43e12e351dc86601d184ae26e45cf8ed909. Member names, content digests, marker stability and exact directory membership are checked. Symlinks/non-files are rejected. Result explicitly says historical-integrity and currentQualified:false.
- Current graph describe/observe/run-summary behavior still executes the original no-network fixture. The private diagnostic returns measured current implementation identity, qualified:false, and an explicitly unqualified summary. It returns no qualification or artifact-set publication object.
- Original artifact generation and strict regeneration remain guarded by the frozen manifest before execution and by stability verification after generation. The real strict command still rejects current manifest drift. Live/credential/claim/grant code is untouched.

The shared observation computation was extracted without changing the offline executor or graph lifecycle. Its strict publication caller retains the old qualification assembly. The diagnostic caller exposes observation data only, never an allowDrift bypass. Existing historical structure/digest assertions remain, and controlled manifest mutation now tests rejection without asserting that current code must forever differ from history.

Commands:

```sh
pnpm run eval:root:artifacts:historical-check
node --import tsx packages/ts/evals/graph-native-rerun-avoidance/generate-root-eval-artifacts.ts --diagnostic
pnpm run eval:root:artifacts:check
```

The last command is intentionally still strict and currently rejects drift. The diagnostic writes only to stdout; this run redirected it into the excluded attempt directory. No retained artifact was overwritten.

## Verification

- Full default offline tests: **2571 passed, four skipped**, no failures.
- Five historical tests cover intact history, missing member, extra member, changed content, and attacker-recomputed internal marker. The fixed external anchor rejects a resigned marker.
- Controlled manifest drift rejects the original generation entry before graph work. Existing offline live-authority/credential/claim/grant rejection tests remain in the full suite.
- Package test types, example type gates and async-boundary checks pass. Build and package export check pass. Changed TS/package files pass scoped Biome.
- Actual historical CLI passes. Actual current diagnostic executes with measured source identity and unqualified labels. Actual strict artifact check fails with the required manifest-drift reason.
- Independent read-only review verified the git anchor and found no H-B boundary regression. No runtime semantic or protocol change required a new conformance amendment.

The historical check proves retained-byte integrity, not historical-source execution replay or current D159 qualification. Repeated marker reads detect observed replacement, not every possible adversarial filesystem race; this is an offline artifact check, not a hostile-filesystem transaction mechanism. Existing snapshot reader bounds remain, and the new initial marker read is bounded too.

## L-B remains explicit

An unmodified-root Biome inventory found326 errors,18 warnings and34 informational diagnostics across324 files:296 JSON files,27 MJS tools and one JS file. The inventory retains paths, tracked status, byte hashes, categories and severities. Classification is explicitly unresolved: these suffixes alone do not establish that a file is frozen evidence or a maintainable tool.

No exclusions or formatting of those files were applied. The next bounded step is to bind each candidate frozen path to its actual retained archive member, distinguish maintained tools, then implement exact exclusions plus integrity checks. Broad docs/design exclusion, rewriting frozen receipts, or presenting the existing strict artifact gate as green remain outside H-B/L-B.

Formal performance qualification, heavy duplicate latency, graded exports and B121 user/agent evidence also remain unfinished. This closes the H default-regression gap, not the complete assembly work.

## Evidence

The archive retains full/targeted/negative test logs, type/build/lint logs, actual diagnostic output, the rejected strict check, original historical artifacts, changed source, and the full lint inventory. Archive extraction verifies every inventoried member and independently checks the historical marker/member digests against the fixed git anchor. This archive check does not rerun source tests or claim historical execution replay.
