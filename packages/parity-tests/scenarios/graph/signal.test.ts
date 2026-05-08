/**
 * R3.7.1 — `await g.signal(messages)` general broadcast.
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
	test("signal([[INVALIDATE]]) reaches every named node", async () => {
		const g = new impl.Graph("root");
		const a = await g.state<number>("a", 1);
		const b = await g.state<number>("b", 2);

		const aSeen: symbol[] = [];
		const bSeen: symbol[] = [];
		const unsubA = await a.subscribe((msgs) => {
			for (const m of msgs) aSeen.push(m[0] as symbol);
		});
		const unsubB = await b.subscribe((msgs) => {
			for (const m of msgs) bSeen.push(m[0] as symbol);
		});

		aSeen.length = 0;
		bSeen.length = 0;
		await g.signal([[impl.INVALIDATE]]);

		expect(aSeen).toContain(impl.INVALIDATE);
		expect(bSeen).toContain(impl.INVALIDATE);

		await unsubA();
		await unsubB();
		await g.destroy();
	});

	test("signal() recurses into mounted subgraphs", async () => {
		const g = new impl.Graph("root");
		const top = await g.state<number>("top", 1);
		const child = await g.mount("child");
		const inner = await child.state<number>("inner", 2);

		const topSeen: symbol[] = [];
		const innerSeen: symbol[] = [];
		const unsub1 = await top.subscribe((msgs) => {
			for (const m of msgs) topSeen.push(m[0] as symbol);
		});
		const unsub2 = await inner.subscribe((msgs) => {
			for (const m of msgs) innerSeen.push(m[0] as symbol);
		});

		topSeen.length = 0;
		innerSeen.length = 0;
		await g.signal([[impl.INVALIDATE]]);

		expect(topSeen).toContain(impl.INVALIDATE);
		expect(innerSeen).toContain(impl.INVALIDATE);

		await unsub1();
		await unsub2();
		await g.destroy();
	});

	test("signal() rejects tier-3 (DATA) externally", async () => {
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);

		// DATA is a tier-3 message; signal() must throw on external broadcast.
		await expect(g.signal([[impl.DATA, 99]])).rejects.toThrow();

		await g.destroy();
	});
});
