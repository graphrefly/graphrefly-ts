/**
 * M1 dispatcher parity scenario.
 *
 * The most basic dispatcher invariant: a `node` value source should emit a
 * single `[DATA, value]` message on subscribe (push-on-subscribe semantics
 * per spec §2.2). Both impls — pure-TS and Rust-via-napi — must agree on
 * this exactly.
 *
 * This scenario is the seed scenario for the Phase 13.9.A acceptance bar:
 * "at least the M1 + M2-Slice-D scenarios (Core dispatcher + Graph
 * container) running against both impls and green." Until `@graphrefly/native`
 * publishes (`impls/rust.ts`), only the legacy-pure-ts arm runs.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M1 dispatcher parity — $name", (impl) => {
	test("node([], { initial }) replays cached DATA on subscribe (push-on-subscribe, spec §2.2)", () => {
		const n = impl.node<number>([], { initial: 42, name: "answer" });

		expect(n.cache).toBe(42);

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsubscribe = n.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			const data = seen.find(([t]) => t === impl.DATA);
			expect(data).toBeDefined();
			expect(data?.[1]).toBe(42);
		} finally {
			unsubscribe();
		}
	});
});
