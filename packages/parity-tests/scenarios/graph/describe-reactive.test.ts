/**
 * R3.6.1 — `g.describe({ reactive: true })` push-on-subscribe + namespace
 * change events.
 *
 * **Phase E (D074): SKIPPED.** Both impls would need a `describe(opts)`
 * shape that returns `{ node, dispose }` for the reactive variant.
 * Legacy supports it; `BenchGraph` exposes `describeJson()` (static
 * snapshot only). Reactive describe wiring is a carry-forward to the
 * next slice — see `~/src/graphrefly-rs/docs/porting-deferred.md`
 * "BenchGraph reactive methods" entry.
 *
 * The widened `Impl.Graph.describe()` shape stays static-only for this
 * slice. Tests below are `test.skip`'d uniformly so neither impl runs
 * them; they re-activate when the abstract `Impl.Graph.describe(opts)`
 * is widened to support reactive returns AND BenchGraph adds the
 * reactive surface.
 */

import { describe, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.6.1 describe-reactive parity — $name", (_impl) => {
	test.skip("describe({ reactive: true }) pushes initial snapshot on subscribe", async () => {
		// reactive describe — see file docstring.
	});
	test.skip("describe({ reactive: true }) emits a fresh snapshot when a node is added", async () => {
		// reactive describe — see file docstring.
	});
	test.skip("describe({ reactive: true }) emits a fresh snapshot when a node is removed", async () => {
		// reactive describe — see file docstring.
	});
});
