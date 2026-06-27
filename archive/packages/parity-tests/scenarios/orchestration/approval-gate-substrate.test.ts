/**
 * Orchestration substrate parity scenarios (Unit 3 of
 * `archive/docs/SESSION-rust-port-layer-boundary.md`, D195).
 *
 * Per the locked layering predicate, `patterns/orchestration` lives
 * in `@graphrefly/graphrefly` (presentation). `approvalGate` is the
 * meatiest pattern (~150 LOC state machine), but every piece is
 * substrate already in Rust — `valve` (Slice U) + `reactiveList`
 * (M5.A) + `reactiveLog` (M5.A) + `mutate` (binding-side decorator
 * over reactiveLog). These scenarios exercise the substrate combo
 * cross-impl so a future PY port of approvalGate has the same
 * behavioral receipts.
 *
 * Substrate confirmed: D195 — "no new Rust crate for
 * patterns/orchestration".
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("orchestration substrate — approval-gate building blocks — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())(
		"reactiveList as pending queue: enqueue → emit snapshot per change",
		async () => {
			const pending = impl.structures!.reactiveList<{ id: number; title: string }>();

			const snapshots: ReadonlyArray<{ id: number; title: string }>[] = [];
			const unsub = await pending.node.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === impl.DATA) {
						snapshots.push(m[1] as ReadonlyArray<{ id: number; title: string }>);
					}
				}
			});

			try {
				snapshots.length = 0;
				await pending.append({ id: 1, title: "alpha" });
				await pending.append({ id: 2, title: "beta" });
				await pending.pop(0); // approve first → remove from queue

				// 3 mutations → 3 snapshots; final snapshot has only beta.
				expect(snapshots.length).toBe(3);
				expect(snapshots[snapshots.length - 1]).toEqual([{ id: 2, title: "beta" }]);
			} finally {
				await unsub();
			}
		},
	);

	test.runIf(hasStructures())(
		"reactiveLog as audit trail: each decide() append survives as immutable record",
		async () => {
			type Decision = {
				kind: "approve" | "reject" | "modify";
				value: string;
				ts: number;
			};
			const decisions = impl.structures!.reactiveLog<Decision>();

			await decisions.append({ kind: "approve", value: "PR-100", ts: 1 });
			await decisions.append({ kind: "reject", value: "PR-101", ts: 2 });
			await decisions.append({ kind: "modify", value: "PR-102", ts: 3 });

			// All decisions persist; order preserved.
			expect(decisions.size).toBe(3);
			expect(decisions.at(0)).toEqual({ kind: "approve", value: "PR-100", ts: 1 });
			expect(decisions.at(1)).toEqual({ kind: "reject", value: "PR-101", ts: 2 });
			expect(decisions.at(2)).toEqual({ kind: "modify", value: "PR-102", ts: 3 });
		},
	);

	test.runIf(hasStructures())(
		"reactiveList drop-oldest pattern: bounded queue via maxSize-equivalent (manual pop)",
		async () => {
			// approvalGate({ maxPending: 3, drop: 'oldest' }) — when 4th item
			// arrives, drop the oldest. Substrate primitives: append + pop(0).
			const pending = impl.structures!.reactiveList<number>();
			const MAX = 3;

			async function enqueueWithBound(value: number) {
				if (pending.size >= MAX) await pending.pop(0);
				await pending.append(value);
			}

			await enqueueWithBound(1);
			await enqueueWithBound(2);
			await enqueueWithBound(3);
			await enqueueWithBound(4); // displaces 1
			await enqueueWithBound(5); // displaces 2

			expect(pending.size).toBe(3);
			expect(pending.at(0)).toBe(3);
			expect(pending.at(1)).toBe(4);
			expect(pending.at(2)).toBe(5);
		},
	);
});
