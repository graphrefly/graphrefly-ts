/**
 * Messaging substrate parity scenarios (Unit 2 of
 * `archive/docs/SESSION-rust-port-layer-boundary.md`, D194).
 *
 * Per the locked layering predicate, `patterns/messaging` lives in
 * `@graphrefly/graphrefly` (presentation) and composes over
 * substrate already shipped in Rust — `reactiveLog` (M5.A/M5.B),
 * `state` (Core), `derived` (Graph). These scenarios exercise the
 * substrate combo cross-impl so a future PY port of the messaging
 * patterns has the same behavioral receipts.
 *
 * Substrate confirmed: D194 — "no new Rust crate for
 * patterns/messaging".
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("messaging substrate — topic via reactiveLog — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())(
		"reactiveLog as topic.entries: publish-events round-trip through snapshot stream",
		async () => {
			const topic = impl.structures!.reactiveLog<{ id: string; payload: number }>();

			const snapshots: ReadonlyArray<{ id: string; payload: number }>[] = [];
			const unsub = await topic.node.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === impl.DATA) {
						snapshots.push(m[1] as ReadonlyArray<{ id: string; payload: number }>);
					}
				}
			});

			try {
				snapshots.length = 0;
				await topic.append({ id: "a", payload: 1 });
				await topic.append({ id: "b", payload: 2 });
				await topic.append({ id: "c", payload: 3 });

				// Each publish triggers a snapshot. Final snapshot has all 3.
				expect(snapshots.length).toBe(3);
				expect(snapshots[snapshots.length - 1]).toEqual([
					{ id: "a", payload: 1 },
					{ id: "b", payload: 2 },
					{ id: "c", payload: 3 },
				]);
			} finally {
				await unsub();
			}
		},
	);

	test.runIf(hasStructures())(
		"appendMany batches multiple publishes into one snapshot (TS hub.publish behavior)",
		async () => {
			const topic = impl.structures!.reactiveLog<string>();

			const snapshots: ReadonlyArray<string>[] = [];
			const unsub = await topic.node.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === impl.DATA) snapshots.push(m[1] as ReadonlyArray<string>);
				}
			});

			try {
				snapshots.length = 0;
				await topic.appendMany(["a", "b", "c"]);

				expect(snapshots.length).toBe(1);
				expect(snapshots[0]).toEqual(["a", "b", "c"]);
			} finally {
				await unsub();
			}
		},
	);

	test.runIf(hasStructures())(
		"reactiveLog.at supports cursor-based subscription replay (subscription pattern substrate)",
		async () => {
			const topic = impl.structures!.reactiveLog<string>();
			await topic.appendMany(["msg-0", "msg-1", "msg-2", "msg-3"]);

			// Simulate a subscription cursor at position 2 — replay from there.
			const cursor = 2;
			const replayed: string[] = [];
			for (let i = cursor; i < topic.size; i++) {
				const entry = topic.at(i);
				if (entry !== undefined) replayed.push(entry);
			}

			expect(replayed).toEqual(["msg-2", "msg-3"]);
		},
	);
});
