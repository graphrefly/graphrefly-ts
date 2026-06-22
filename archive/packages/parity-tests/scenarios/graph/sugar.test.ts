/**
 * R3.2.1 named-sugar parity — `g.set` / `g.invalidate` / `g.complete` /
 * `g.error` write through the namespace and produce the same wave shape as
 * direct `await node.down(...)` calls.
 *
 * Rust port reference: `Graph::set` / `invalidate_by_name` / `complete_by_name`
 * / `error_by_name` (Slice F R3.2.1 wrappers).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.2.1 named-sugar parity — $name", (impl) => {
	test("await g.set(name, v) writes through namespace and updates cache", async () => {
		const g = new impl.Graph("root");
		const s = await g.state<number>("counter", 0);

		expect(s.cache).toBe(0);

		await g.set("counter", 7);
		expect(s.cache).toBe(7);

		await g.set("counter", 42);
		expect(s.cache).toBe(42);

		await g.destroy();
	});

	test("await g.invalidate(name) emits tier-4 INVALIDATE on the named node", async () => {
		const g = new impl.Graph("root");
		const s = await g.state<number>("v", 1);

		const seen: symbol[] = [];
		const unsub = await s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		seen.length = 0; // discard handshake
		await g.invalidate("v");

		expect(seen).toContain(impl.INVALIDATE);

		await unsub();
		await g.destroy();
	});

	test("await g.complete(name) emits tier-5 COMPLETE; subsequent emits are no-ops", async () => {
		const g = new impl.Graph("root");
		const s = await g.state<number>("v", 1);

		const seen: symbol[] = [];
		const unsub = await s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		seen.length = 0;
		await g.complete("v");
		expect(seen).toContain(impl.COMPLETE);

		seen.length = 0;
		await g.set("v", 99);
		// post-COMPLETE emits are silently no-op'd (R1.3.4 terminal monotonicity)
		expect(seen.filter((t) => t === impl.DATA)).toHaveLength(0);

		await unsub();
		await g.destroy();
	});

	test("await g.error(name, err) emits tier-5 ERROR with the supplied payload", async () => {
		const g = new impl.Graph("root");
		const s = await g.state<number>("v", 1);

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});

		seen.length = 0;
		const errPayload = new Error("boom");
		await g.error("v", errPayload);

		const errEvent = seen.find(([t]) => t === impl.ERROR);
		expect(errEvent).toBeDefined();
		expect(errEvent?.[1]).toBe(errPayload);

		await unsub();
		await g.destroy();
	});

	test("g.set chained through derived produces propagated DATA", async () => {
		const g = new impl.Graph("root");
		const s = await g.state<number>("src", 1);
		// Build the derived via impl.map(src, fn) + g.add(name, node) so the
		// scenario runs against both impls (rustImpl's `g.derived(name, deps, fn)`
		// with arbitrary JS fn is out-of-scope per D074 carry-forward; this
		// shape exercises the same observable behavior — named DATA propagation
		// through a transform — against both arms).
		const d = await g.add("dbl", await impl.map(s, (v: number) => v * 2));

		const seen: number[] = [];
		const unsub = await d.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) seen.push(m[1] as number);
		});

		await g.set("src", 5);
		expect(seen).toContain(10);

		await unsub();
		await g.destroy();
	});
});
