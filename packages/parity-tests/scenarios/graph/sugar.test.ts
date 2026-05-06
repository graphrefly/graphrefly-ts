/**
 * R3.2.1 named-sugar parity — `g.set` / `g.invalidate` / `g.complete` /
 * `g.error` write through the namespace and produce the same wave shape as
 * direct `node.down(...)` calls.
 *
 * Rust port reference: `Graph::set` / `invalidate_by_name` / `complete_by_name`
 * / `error_by_name` (Slice F R3.2.1 wrappers).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.2.1 named-sugar parity — $name", (impl) => {
	test("g.set(name, v) writes through namespace and updates cache", () => {
		const g = new impl.Graph("root");
		const s = g.state<number>("counter", 0);

		expect(s.cache).toBe(0);

		g.set("counter", 7);
		expect(s.cache).toBe(7);

		g.set("counter", 42);
		expect(s.cache).toBe(42);

		g.destroy();
	});

	test("g.invalidate(name) emits tier-4 INVALIDATE on the named node", () => {
		const g = new impl.Graph("root");
		const s = g.state<number>("v", 1);

		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		seen.length = 0; // discard handshake
		g.invalidate("v");

		expect(seen).toContain(impl.INVALIDATE);

		unsub();
		g.destroy();
	});

	test("g.complete(name) emits tier-5 COMPLETE; subsequent emits are no-ops", () => {
		const g = new impl.Graph("root");
		const s = g.state<number>("v", 1);

		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		seen.length = 0;
		g.complete("v");
		expect(seen).toContain(impl.COMPLETE);

		seen.length = 0;
		g.set("v", 99);
		// post-COMPLETE emits are silently no-op'd (R1.3.4 terminal monotonicity)
		expect(seen.filter((t) => t === impl.DATA)).toHaveLength(0);

		unsub();
		g.destroy();
	});

	test("g.error(name, err) emits tier-5 ERROR with the supplied payload", () => {
		const g = new impl.Graph("root");
		const s = g.state<number>("v", 1);

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});

		seen.length = 0;
		const errPayload = new Error("boom");
		g.error("v", errPayload);

		const errEvent = seen.find(([t]) => t === impl.ERROR);
		expect(errEvent).toBeDefined();
		expect(errEvent?.[1]).toBe(errPayload);

		unsub();
		g.destroy();
	});

	test("g.set chained through derived produces propagated DATA", () => {
		const g = new impl.Graph("root");
		const s = g.state<number>("src", 1);
		const d = g.derived<number>("dbl", [s], (data) => {
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) return [];
			return batch0.map((v) => (v as number) * 2);
		});

		const seen: number[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) seen.push(m[1] as number);
		});

		g.set("src", 5);
		expect(seen).toContain(10);

		unsub();
		g.destroy();
	});
});
