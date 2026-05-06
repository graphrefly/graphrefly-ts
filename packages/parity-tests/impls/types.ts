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
	readonly node: typeof legacy.node;
	readonly DATA: typeof legacy.DATA;
}
