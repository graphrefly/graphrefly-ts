/**
 * R3.7.1 — `g.signal(messages)` general broadcast.
 *
 * Delivers a message batch to every registered node in this graph and,
 * recursively, in mounted child graphs. Tier 3 (DATA / RESOLVED) is rejected
 * externally; INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN all
 * have legitimate broadcast semantics.
 *
 * R3.7.2 — Meta filtering. INVALIDATE explicitly skips meta companions.
 *
 * Rust port reference: `Graph::signal(SignalKind)` (Slice F R3.7.1).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.7.1 signal parity — $name", (impl) => {
	test("signal([[INVALIDATE]]) reaches every named node", () => {
		const g = new impl.Graph("root");
		const a = g.state<number>("a", 1);
		const b = g.state<number>("b", 2);

		const aSeen: symbol[] = [];
		const bSeen: symbol[] = [];
		const unsubA = a.subscribe((msgs) => {
			for (const m of msgs) aSeen.push(m[0] as symbol);
		});
		const unsubB = b.subscribe((msgs) => {
			for (const m of msgs) bSeen.push(m[0] as symbol);
		});

		aSeen.length = 0;
		bSeen.length = 0;
		g.signal([[impl.INVALIDATE]]);

		expect(aSeen).toContain(impl.INVALIDATE);
		expect(bSeen).toContain(impl.INVALIDATE);

		unsubA();
		unsubB();
		g.destroy();
	});

	test("signal() recurses into mounted subgraphs", () => {
		const g = new impl.Graph("root");
		const top = g.state<number>("top", 1);
		const child = g.mount("child");
		const inner = child.state<number>("inner", 2);

		const topSeen: symbol[] = [];
		const innerSeen: symbol[] = [];
		const unsub1 = top.subscribe((msgs) => {
			for (const m of msgs) topSeen.push(m[0] as symbol);
		});
		const unsub2 = inner.subscribe((msgs) => {
			for (const m of msgs) innerSeen.push(m[0] as symbol);
		});

		topSeen.length = 0;
		innerSeen.length = 0;
		g.signal([[impl.INVALIDATE]]);

		expect(topSeen).toContain(impl.INVALIDATE);
		expect(innerSeen).toContain(impl.INVALIDATE);

		unsub1();
		unsub2();
		g.destroy();
	});

	test("signal() rejects tier-3 (DATA) externally", () => {
		const g = new impl.Graph("root");
		g.state<number>("a", 1);

		// DATA is a tier-3 message; signal() must throw on external broadcast.
		expect(() => g.signal([[impl.DATA, 99]])).toThrow();

		g.destroy();
	});
});
