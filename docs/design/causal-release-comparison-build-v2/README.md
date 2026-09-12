# Complete frozen-source build qualification

Same owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. User continuation after `29a00d49` authorized completion of offline build verification and commit. No public API, library source, wave protocol, consumer execution or performance sampling changed.

## Result

Full B (`2f19cc0d79937bee0faa462cc9f2cf5209b62111`) and C (`907eec8138cddce9f8ff0e74d9f19d60db8c5b96`) builds passed. Independent rebuilding from retained loaded sources reproduced both bundles and metafiles byte-for-byte. Each closure has 62 files: 60 frozen git sources and two private comparison inputs. Independent source verification confirms that only graph.ts differs between arms, exclusively inside `_releaseNodes`; the worker projection transform is exact and B-copy equals B.

This batch retained three offline builder invocations: two B guard failures followed by one successful B/C build, then one independent rebuild. The first failure exposed esbuild's local `key` → `key2` renaming. The second counted an unused aliased performance import as executable instrumentation. Both are private checker compatibility defects. The archive preserves all three tool versions, original outputs and source bytes (288 files). No performance capture was retried: consumer factories and new performance samples are both zero.

## Checker and review

The recorder comparison canonicalizes local names in an isolated method; free identifiers, properties and control flow remain checked. Performance import declarations are excluded from execution counts, while their local binding names are collected so calls through arbitrary aliases remain rejected. Positive alpha-renaming/unused-import cases and negative free-name/property/clock-alias cases pass alongside existing clock and comparison-tool mutations. Fake-host recorder coverage remains off: zero reads, on: two reads. This establishes branch behavior, not zero recorder CPU cost.

The successful build used the retained intermediate guard. After static QA identified the arbitrary-import-alias blind spot, the final guard was separately applied to those unchanged real B/C bundles; `retained-guard-verification.json` binds the final builder digest and both artifact hashes. The build was not silently rerun or relabeled. Two independent static reviewers examined the repair; the final alias fix was confirmed without blocking findings. JS and Python private-tool qualifications passed. Full runtime qualification and long-running soak were not rerun for this tooling-only change; earlier D159 failures remain unchanged.

## Boundary and next step

Build qualification is now complete. Actual untimed consumer semantic preflight is still pending, followed by separately authorized measurement if preflight passes. This batch supplies no performance ratio or performance acceptance. The original single-use 60-process capture grant remains consumed; D169, the five comparison rows and frozen revisions remain unchanged. Owner work, graded hiding and human/agent ownership evidence remain incomplete. Root dirty files, historical archives and receipts, library, examples and generated runner were preserved.
