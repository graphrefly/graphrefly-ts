/**
 * M1 dispatcher parity — TEARDOWN cascade (spec §1.5 / §2.3).
 *
 * D5 (post-rustImpl-activation parity cleanup): pins the teardown
 * propagation both impls MUST agree on — tearing down an upstream
 * source delivers TEARDOWN to its transitive dependent's sink.
 *
 * Built on an operator factory (`impl.map`) + a standalone source —
 * `graph.derived(arbitrary fn)` is intentionally NOT used (rejected by
 * the native `BenchGraph` surface; operators are the cross-impl
 * composition primitive).
 *
 * Rust port reference: Core TEARDOWN propagation + RAII Subscription
 * drop (Slice M1).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M1 TEARDOWN cascade parity — $name", (impl) => {
	test("teardown(upstream source) reaches a transitive dependent's sink", async () => {
		const src = await impl.node<number>([], { initial: 1, name: "src" });
		const b = await impl.map(src, (x: number) => x + 100);

		const bSeen: symbol[] = [];
		const unsub = await b.subscribe((msgs) => {
			for (const m of msgs) bSeen.push(m[0] as symbol);
		});
		try {
			expect(b.cache).toBe(101);

			bSeen.length = 0;
			await src.teardown();

			expect(bSeen).toContain(impl.TEARDOWN);
		} finally {
			await unsub();
		}
	});
});
