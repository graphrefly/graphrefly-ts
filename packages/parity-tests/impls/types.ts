/**
 * The narrow public surface a parity scenario uses, parameterized over impls.
 *
 * Each scenario imports `Impl` and asserts identical behavior across every
 * registered impl row. The shape grows per Rust-milestone close (M2 Slice E
 * adds Graph methods, M3 close adds operators, etc.). Keep imports minimal
 * to avoid coupling parity scenarios to internal helpers.
 */

import type * as legacy from "@graphrefly/legacy-pure-ts";

// Public surface used by current scenarios. Widen as Rust milestones close.
// All symbols are pulled from `@graphrefly/legacy-pure-ts` so the type carries
// the canonical signatures; the rust-via-napi arm asserts the same shape via
// structural typing.
export interface Impl {
	readonly name: string;

	// M1 dispatcher surface
	readonly node: typeof legacy.node;
	readonly DATA: typeof legacy.DATA;
	readonly RESOLVED: typeof legacy.RESOLVED;
	readonly DIRTY: typeof legacy.DIRTY;

	// M2 Graph surface (added by the M2 parity-tests widening — D6 in
	// `~/src/graphrefly-rs/docs/porting-deferred.md`).
	readonly Graph: typeof legacy.Graph;

	// Tier-1/2/4/5/6 message constants used by signal() and observe assertions.
	readonly INVALIDATE: typeof legacy.INVALIDATE;
	readonly PAUSE: typeof legacy.PAUSE;
	readonly RESUME: typeof legacy.RESUME;
	readonly COMPLETE: typeof legacy.COMPLETE;
	readonly ERROR: typeof legacy.ERROR;
	readonly TEARDOWN: typeof legacy.TEARDOWN;

	// M3 Slice C-1 — transform operators (Rust port: `graphrefly-operators`,
	// landed 2026-05-06 per `~/src/graphrefly-rs/docs/migration-status.md`).
	// TS legacy carries the existing derived-fn shapes from
	// `packages/legacy-pure-ts/src/extra/operators/transform.ts`. When the
	// Rust napi binding ships an operator surface, the rustImpl arm wires
	// these up against the napi factories.
	readonly map: typeof legacy.map;
	readonly filter: typeof legacy.filter;
	readonly scan: typeof legacy.scan;
	readonly reduce: typeof legacy.reduce;
	readonly distinctUntilChanged: typeof legacy.distinctUntilChanged;
	readonly pairwise: typeof legacy.pairwise;

	// M3 Slice C-2 — combinator operators (Rust port: `graphrefly-operators`,
	// landed 2026-05-06 per `~/src/graphrefly-rs/docs/migration-status.md`).
	// TS legacy from `packages/legacy-pure-ts/src/extra/operators/combine.ts`.
	readonly combine: typeof legacy.combine;
	readonly withLatestFrom: typeof legacy.withLatestFrom;
	readonly merge: typeof legacy.merge;

	// M3 Slice C-3 — flow operators (Rust port: `graphrefly-operators`,
	// landed 2026-05-06 per `~/src/graphrefly-rs/docs/migration-status.md`).
	// TS legacy from `packages/legacy-pure-ts/src/extra/operators/take.ts`.
	// `takeUntil` is intentionally NOT included — Rust port defers it to a
	// later subscription-managed slice (D020 category B).
	readonly take: typeof legacy.take;
	readonly skip: typeof legacy.skip;
	readonly takeWhile: typeof legacy.takeWhile;
	readonly last: typeof legacy.last;
	readonly first: typeof legacy.first;
	readonly find: typeof legacy.find;
	readonly elementAt: typeof legacy.elementAt;
}
