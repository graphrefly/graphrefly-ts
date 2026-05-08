/**
 * R3.6.2 — `g.observe({ reactive: true })` auto-subscribe semantics.
 *
 * **Phase E (D074): SKIPPED for both impls.** The abstract
 * `Impl.Graph` doesn't include `observe()` / `observeAll()` reactive
 * methods. Both legacy and rust would need a richer surface; rust would
 * also need new `BenchGraph` reactive methods (`observe_all_reactive`).
 *
 * Carry-forward to a follow-on slice — see
 * `~/src/graphrefly-rs/docs/porting-deferred.md` "BenchGraph reactive
 * methods" entry.
 */

import { describe, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.6.2 observe-all-reactive parity — $name", (_impl) => {
	test.skip("observe({ reactive: true }) — deferred to follow-on slice", async () => {
		// reactive observe-all — see file docstring.
	});
});
