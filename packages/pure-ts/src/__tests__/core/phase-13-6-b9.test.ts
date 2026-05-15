/**
 * Phase 13.6.B Batch 9 — patterns + testing.
 *
 * - Lock 3.A — `awaitSettled` accepts a `kick` callback (subscribe-before-kick
 *   is structurally enforced; firstWhere subscribes synchronously before the
 *   Promise constructor runs).
 * - Lock 3.B — `assertDirtyPrecedesTerminalData` shipped at
 *   `@graphrefly/graphrefly/testing`. Detailed coverage in
 *   `__tests__/testing/assertions.test.ts`.
 * - Lock 3.C — `withBudgetGate` auto-wires adapter abort: budget exhaustion
 *   fires AbortController on every in-flight call.
 * - Lock 4.B (A) — `mutate` accepts `down` hook for closure-state
 *   rollback. Lock 4.B (B) `registerMutable` and (C) dev-mode Proxy are
 *   deferred carries (see docs/optimizations.md).
 * - Lock 1.A retest — audit-only; no code change in this batch.
 */

import { describe, expect, it } from "vitest";
import { mutate } from "../../../../../src/base/mutation/index.js";
import { firstWhere } from "../../../../../src/base/sources/settled.js";
import { node } from "../../core/node.js";

describe("Phase 13.6.B B9 — Lock 3.A awaitSettled / firstWhere `kick` callback", () => {
	it("kick fires after subscribe — synchronous emission lands in the Promise", async () => {
		const src = node<number>([], { initial: null });
		const result = await firstWhere(src, (v) => typeof v === "number" && v > 0, {
			skipCurrent: true,
			kick: () => src.emit(42),
		});
		expect(result).toBe(42);
	});

	it("kick that throws rejects the returned Promise without leaking subscription", async () => {
		const src = node<number>([], { initial: null });
		await expect(
			firstWhere(src, (v) => typeof v === "number" && v > 0, {
				skipCurrent: true,
				kick: () => {
					throw new Error("kick boom");
				},
			}),
		).rejects.toThrow(/kick boom/);
	});

	it("no-kick form still works (caller fires emit after the call returns)", async () => {
		const src = node<number>([], { initial: null });
		const settled = firstWhere(src, (v) => typeof v === "number" && v > 0, {
			skipCurrent: true,
		});
		// External event arrives after the helper returns.
		setTimeout(() => src.emit(7), 0);
		const result = await settled;
		expect(result).toBe(7);
	});
});

describe("Phase 13.6.B B9 — Lock 4.B (A) mutate `down` hook", () => {
	it("fires down on action throw, after batch rollback", () => {
		const out: string[] = [];
		const myMap = new Map<string, number>();
		const action = mutate(
			{
				up: (key: string, value: number) => {
					myMap.set(key, value); // closure-state mutation
					out.push(`set ${key}=${value}`);
					if (value < 0) throw new Error("negative not allowed");
					return value;
				},
				down: () => {
					out.push("down");
					myMap.clear();
				},
			},
			{ frame: "transactional" },
		);

		// Success path — down is NOT fired.
		action("a", 1);
		expect(myMap.get("a")).toBe(1);
		expect(out).toEqual(["set a=1"]);

		// Failure path — down fires.
		expect(() => action("b", -1)).toThrow(/negative/);
		expect(out).toEqual(["set a=1", "set b=-1", "down"]);
		expect(myMap.size).toBe(0); // down cleared the closure map
	});

	it("down that throws does NOT mask the original action error", () => {
		const action = mutate(
			{
				up: () => {
					throw new Error("original error");
				},
				down: () => {
					throw new Error("down boom");
				},
			},
			{ frame: "transactional" },
		);
		// Original error wins.
		expect(() => action()).toThrow(/original error/);
	});

	it("down is not fired on successful action", () => {
		let fired = 0;
		const action = mutate(
			{
				up: () => 42,
				down: () => {
					fired += 1;
				},
			},
			{ frame: "transactional" },
		);
		expect(action()).toBe(42);
		expect(fired).toBe(0);
	});
});
