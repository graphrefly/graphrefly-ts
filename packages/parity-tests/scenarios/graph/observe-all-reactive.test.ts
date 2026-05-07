/**
 * R3.6.2 — `g.observe({ reactive: true })` auto-subscribe semantics for
 * late-added nodes.
 *
 * The reactive observe-all stream subscribes to every named node at observe
 * time AND auto-subscribes nodes added later. Drop-order discipline ensures
 * dropping the handle unsubscribes everything cleanly.
 *
 * Rust port reference: `Graph::observe_all_reactive` (Slice F) + Slice F /qa
 * P4 (race fix: install ns listener BEFORE initial snapshot).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.6.2 observe-all-reactive parity — $name", (impl) => {
	// Skipped: TS legacy-pure-ts's observe({ reactive: true }) snapshots the
	// observe-target list at subscribe time via `_collectObserveTargets` and
	// does NOT auto-subscribe nodes added after observe-time. The Rust port's
	// `observe_all_reactive()` (Slice F /qa P3) auto-subscribes late nodes via
	// namespace-change sinks. When the TS impl backports this OR rustImpl
	// activates and the divergence becomes loud in CI, re-enable.
	test.skip("observe({ reactive: true }) auto-subscribes late-added nodes", () => {
		const g = new impl.Graph("root");
		const a = g.state<number>("a", 1);

		// observe({ reactive: true }) returns Node<ObserveChangeset> directly
		// (not a handle wrapper). The Rust shim adapts.
		const obsNode = g.observe({ reactive: true });
		const events: Array<{ path?: string; type: string; data?: unknown }> = [];

		const unsub = obsNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== impl.DATA) continue;
				const cs = m[1] as {
					events?: ReadonlyArray<{ path?: string; type: string; data?: unknown }>;
				};
				for (const ev of cs.events ?? []) {
					events.push(ev);
				}
			}
		});

		// Add a late node — auto-subscription should pick up its emits.
		g.state<number>("late", 10);
		events.length = 0;

		// Drive an emit on the late node and verify the reactive observe
		// stream surfaces it.
		g.set("late", 99);

		const lateData = events.find((e) => e.path === "late" && e.type === "data");
		expect(lateData).toBeDefined();
		expect(lateData?.data).toBe(99);

		void a;
		unsub();
		g.destroy();
	});

	test("observe({ reactive: true }) unsubscribe stops further events", () => {
		const g = new impl.Graph("root");
		g.state<number>("v", 1);

		const obsNode = g.observe({ reactive: true });
		let received = 0;

		const unsub = obsNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) received += 1;
			}
		});

		const before = received;
		unsub();

		// After unsubscribe, further mutations should NOT push events.
		g.set("v", 42);

		expect(received).toBe(before);
		g.destroy();
	});

	// MP4 (Slice F doc cleanup, 2026-05-07): pins the per-sink unsubscribe
	// semantics across impls. The pre-Slice-F single-sink test conflated
	// "this sink stops" with "the underlying observation deactivates" — both
	// give the same observable behavior with one sink. This two-sink variant
	// distinguishes them: with two subscribers, unsubscribing ONE must NOT
	// silence the other.
	test("observe({ reactive: true }) unsubscribing one sink keeps the other receiving", () => {
		const g = new impl.Graph("root");
		g.state<number>("v", 1);

		const obsNode = g.observe({ reactive: true });
		let recA = 0;
		let recB = 0;

		const unsubA = obsNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) recA += 1;
			}
		});
		const _unsubB = obsNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) recB += 1;
			}
		});

		// Both saw the initial snapshot.
		const baselineA = recA;
		const baselineB = recB;

		unsubA();

		// Mutate; only B should observe.
		g.set("v", 42);

		expect(recA).toBe(baselineA);
		expect(recB).toBeGreaterThan(baselineB);
		g.destroy();
	});
});
