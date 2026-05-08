/**
 * R3.6.1 — `g.describe({ reactive: true })` push-on-subscribe + namespace
 * change events.
 *
 * Slice X2 (Phase E2) — un-skipped now that `BenchGraph::describe_reactive`
 * is wired through the JS adapter on both arms. The handle exposes
 * `subscribe(sink)` (push-on-subscribe per R3.6.1; sink fires immediately
 * with the initial snapshot, then on every namespace mutation) and
 * `dispose()` (idempotent; runs the underlying unsubscribe on a tokio
 * blocking thread for the rust impl per the BenchCore::dispose discipline).
 */

import { describe, expect, test } from "vitest";
import type { ReactiveDescribeHandle } from "../../impls/types.js";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.6.1 describe-reactive parity — $name", (impl) => {
	test("describe({ reactive: true }) pushes initial snapshot on subscribe", async () => {
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);

		const handle = (await g.describe({ reactive: true })) as ReactiveDescribeHandle;
		const snapshots: unknown[] = [];
		const unsub = handle.subscribe((s) => {
			snapshots.push(s);
		});

		// Push-on-subscribe: must have at least one snapshot already.
		expect(snapshots.length).toBeGreaterThanOrEqual(1);
		// First snapshot includes the named node "a". Per spec R3.6.1
		// Appendix B, the field is `nodes` (singular schema; no `names`
		// fallback — the prior `names ?? nodes` shape masked any future
		// schema regression on either impl).
		const first = snapshots[0] as { nodes?: Record<string, unknown> };
		expect(first.nodes).toBeDefined();

		unsub();
		await handle.dispose();
		await g.destroy();
	});

	test("describe({ reactive: true }) emits a fresh snapshot when a node is added", async () => {
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);

		const handle = (await g.describe({ reactive: true })) as ReactiveDescribeHandle;
		const snapshots: unknown[] = [];
		const unsub = handle.subscribe((s) => {
			snapshots.push(s);
		});
		const initialCount = snapshots.length;

		// Adding a new named node should fire a fresh snapshot.
		await g.state<number>("b", 2);

		// Allow microtask drain in case impl batches.
		await new Promise((r) => setTimeout(r, 0));
		expect(snapshots.length).toBeGreaterThan(initialCount);

		unsub();
		await handle.dispose();
		await g.destroy();
	});

	test("describe({ reactive: true }) stops firing after dispose()", async () => {
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);

		const handle = (await g.describe({ reactive: true })) as ReactiveDescribeHandle;
		const snapshots: unknown[] = [];
		const unsub = handle.subscribe((s) => {
			snapshots.push(s);
		});

		unsub();
		await handle.dispose();

		const countAfterDispose = snapshots.length;

		// Mutating the graph after dispose should NOT fire the sink.
		await g.state<number>("c", 3);
		await new Promise((r) => setTimeout(r, 0));

		expect(snapshots.length).toBe(countAfterDispose);

		await g.destroy();
	});
});
