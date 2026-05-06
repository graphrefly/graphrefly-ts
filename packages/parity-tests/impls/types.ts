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
}
