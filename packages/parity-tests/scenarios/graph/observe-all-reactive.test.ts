/**
 * R3.6.2 — `g.observe(undefined, { reactive: true })` auto-subscribe semantics.
 *
 * Slice X2 (Phase E2) — un-skipped now that `BenchGraph::observe_all_reactive`
 * is wired through the JS adapter. The reactive variant auto-subscribes
 * named nodes added AFTER the initial subscribe (canonical R3.6.2 reactive
 * mode). The sink-style default mode (`observe()` / `observe(path)`)
 * snapshots the namespace at call time and does NOT auto-subscribe; the
 * reactive mode does.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";
import type { ObserveSubscription } from "../../impls/types.js";

describe.each(impls)("R3.6.2 observe-all-reactive parity — $name", (impl) => {
	test("observe(undefined, { reactive: true }) receives messages from initially-named nodes", async () => {
		const g = new impl.Graph("root");
		const a = await g.state<number>("a", 1);

		const handle = (await g.observe(undefined, {
			reactive: true,
		})) as ObserveSubscription;

		const events: Array<{ path: string; msgCount: number }> = [];
		const unsub = handle.subscribe((pathOrMsgs, msgs) => {
			if (typeof pathOrMsgs === "string" && msgs) {
				events.push({ path: pathOrMsgs, msgCount: msgs.length });
			}
		});

		// Emit on the initially-named node.
		await a.down([[impl.DATA, 42]]);
		// Allow microtask drain.
		await new Promise((r) => setTimeout(r, 0));

		// At least one event should have arrived for path "a" with DATA.
		const aEvents = events.filter((e) => e.path === "a");
		expect(aEvents.length).toBeGreaterThanOrEqual(1);

		unsub();
		await handle.dispose();
		await g.destroy();
	});

	// Slice W (2026-05-13): cross-impl parity — both pure-ts and Rust
	// port auto-subscribe to nodes added AFTER the initial namespace
	// snapshot. Pure-ts achieves this via a `_topologyEmitters` hook in
	// `_observeReactive`; Rust port via `GraphObserveAllReactive`
	// subscribing to `Core::subscribe_topology`.
	test("observe(undefined, { reactive: true }) auto-subscribes late-added nodes", async () => {
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);

		const handle = (await g.observe(undefined, {
			reactive: true,
		})) as ObserveSubscription;

		const events: Array<{ path: string }> = [];
		const unsub = handle.subscribe((pathOrMsgs, msgs) => {
			if (typeof pathOrMsgs === "string" && msgs && msgs.length > 0) {
				events.push({ path: pathOrMsgs });
			}
		});

		// Add a late node AFTER subscribe — Rust auto-subscribes it.
		const b = await g.state<number>("b", 2);
		await new Promise((r) => setTimeout(r, 0));

		await b.down([[impl.DATA, 99]]);
		await new Promise((r) => setTimeout(r, 0));

		const bEvents = events.filter((e) => e.path === "b");
		expect(bEvents.length).toBeGreaterThanOrEqual(1);

		unsub();
		await handle.dispose();
		await g.destroy();
	});

	test("observe(undefined, { reactive: true }) stops firing after dispose()", async () => {
		const g = new impl.Graph("root");
		const a = await g.state<number>("a", 1);

		const handle = (await g.observe(undefined, {
			reactive: true,
		})) as ObserveSubscription;

		const events: string[] = [];
		const unsub = handle.subscribe((pathOrMsgs, msgs) => {
			if (typeof pathOrMsgs === "string" && msgs && msgs.length > 0) {
				events.push(pathOrMsgs);
			}
		});

		unsub();
		await handle.dispose();

		const countAfterDispose = events.length;

		// Emission after dispose should NOT reach the sink.
		await a.down([[impl.DATA, 100]]);
		await new Promise((r) => setTimeout(r, 0));

		expect(events.length).toBe(countAfterDispose);

		await g.destroy();
	});
});
