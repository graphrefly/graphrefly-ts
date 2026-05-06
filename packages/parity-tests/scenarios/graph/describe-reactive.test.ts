/**
 * R3.6.1 — `g.describe({ reactive: true })` push-on-subscribe + namespace
 * change events.
 *
 * The reactive describe handle pushes the current snapshot synchronously on
 * subscribe (per R3.6.1 / spec §2.5.2 push-on-subscribe), then pushes a fresh
 * snapshot on every namespace mutation (add / remove / mount / unmount /
 * destroy).
 *
 * Rust port reference: `Graph::describe_reactive` (Slice F) + Slice F /qa P7
 * (initial snapshot synchronously before listener install).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.6.1 describe-reactive parity — $name", (impl) => {
	test("describe({ reactive: true }) pushes initial snapshot on subscribe", () => {
		const g = new impl.Graph("root");
		g.state<number>("seed", 1);

		// describe({ reactive: true }) returns a Node<GraphDescribeOutput>.
		const handle = g.describe({ reactive: true });
		const snaps: unknown[] = [];

		const unsub = handle.node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) snaps.push(m[1]);
			}
		});

		// Initial snapshot must arrive on the handshake (push-on-subscribe).
		expect(snaps.length).toBeGreaterThanOrEqual(1);
		const first = snaps[0] as { nodes: Record<string, unknown> };
		expect(first.nodes).toHaveProperty("seed");

		unsub();
		handle.dispose();
		g.destroy();
	});

	test("describe({ reactive: true }) emits a fresh snapshot when a node is added", () => {
		const g = new impl.Graph("root");
		const handle = g.describe({ reactive: true });
		const snaps: Array<{ nodes: Record<string, unknown> }> = [];

		const unsub = handle.node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) snaps.push(m[1] as { nodes: Record<string, unknown> });
			}
		});

		const initialCount = snaps.length;

		g.state<number>("late", 42);

		expect(snaps.length).toBeGreaterThan(initialCount);
		const latest = snaps[snaps.length - 1];
		expect(latest.nodes).toHaveProperty("late");

		unsub();
		handle.dispose();
		g.destroy();
	});

	test("describe({ reactive: true }) emits a fresh snapshot when a node is removed", () => {
		const g = new impl.Graph("root");
		g.state<number>("temp", 1);

		const handle = g.describe({ reactive: true });
		const snaps: Array<{ nodes: Record<string, unknown> }> = [];

		const unsub = handle.node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) snaps.push(m[1] as { nodes: Record<string, unknown> });
			}
		});

		const beforeRemove = snaps.length;
		g.remove("temp");

		expect(snaps.length).toBeGreaterThan(beforeRemove);
		const latest = snaps[snaps.length - 1];
		expect(latest.nodes).not.toHaveProperty("temp");

		unsub();
		handle.dispose();
		g.destroy();
	});
});
