/**
 * M1 dispatcher parity — `set_deps` dependency replacement.
 *
 * D5 (post-rustImpl-activation parity cleanup): the M1 milestone-coverage
 * table claims a `set_deps` dep-replacement surface, but it is **not
 * writable as a parity scenario today** — and silently omitting it would
 * leave the README claim unbacked. The blockers, precisely:
 *
 *  1. The public `Impl` / `ImplNode` contract (`impls/types.ts`) exposes
 *     NO `setDeps` / `set_deps`. Adding it is a public-API decision
 *     (the `Impl` interface IS the substrate contract, per its own
 *     header) — a cross-track-ledger item, NOT test scaffolding.
 *  2. `@graphrefly/pure-ts` only ships `_setDeps` (internal,
 *     underscore-prefixed; `packages/pure-ts/src/core/node.ts`) — there
 *     is no public `setDeps` to wrap.
 *  3. `@graphrefly/native`'s shipped wrapper (`wrapper.d.ts`) exposes no
 *     `setDeps` at all, so a rust arm could not satisfy the scenario
 *     even if `Impl` were widened on the TS side.
 *
 * Per `project_rewire_gap`, `node.setDeps()` is TLA+-verified and
 * scheduled to land with the Phase 13.7 M1 Rust port. When it ships
 * publicly on BOTH arms + the `Impl` contract is widened (cross-track
 * ledger), replace this `todo` with the real cascade scenario:
 * rewire a dependent from dep A → dep B, assert DIRTY→DATA reflects B
 * and the old A edge no longer drives it.
 *
 * Tracked: docs/optimizations.md (post-rustImpl-activation parity
 * cleanup → D5) + docs/cross-track-ledger.md (Impl `setDeps` widening).
 */

import { describe, test } from "vitest";

describe("M1 set_deps parity", () => {
	test.todo(
		"setDeps rewires a dependent's upstream — BLOCKED: no public setDeps on Impl/pure-ts/native (see file header; cross-track Impl widening required)",
	);
});
