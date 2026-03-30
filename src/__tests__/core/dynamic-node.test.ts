import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { dynamicNode } from "../../core/dynamic-node.js";
import { DATA, DIRTY, type Messages, RESOLVED } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { state } from "../../core/sugar.js";

function collect(n: Node) {
	const batches: Messages[] = [];
	const unsub = n.subscribe((msgs) => batches.push(msgs));
	return { batches, unsub };
}

function dataValues(batches: Messages[]): unknown[] {
	return batches.flatMap((b) => b.filter((m) => m[0] === DATA).map((m) => m[1]));
}

describe("dynamicNode", () => {
	it("tracks deps via get() proxy", () => {
		const a = state(1);
		const b = state(2);

		const d = dynamicNode((get) => {
			return (get(a) as number) + (get(b) as number);
		});

		const { batches, unsub } = collect(d);
		const vals = dataValues(batches);
		expect(vals).toContain(3);
		unsub();
	});

	it("conditional deps — switches deps based on runtime value", () => {
		const cond = state(true);
		const a = state(10);
		const b = state(20);

		const d = dynamicNode((get) => {
			return get(cond) ? get(a) : get(b);
		});

		const { batches, unsub } = collect(d);
		expect(dataValues(batches)).toContain(10);

		// Switch condition
		batch(() => {
			cond.down([[DIRTY]]);
			cond.down([[DATA, false]]);
		});

		const vals = dataValues(batches);
		expect(vals).toContain(20);
		unsub();
	});

	it("dep set changes — adds new deps", () => {
		const a = state(1);
		const b = state(2);
		const c = state(3);
		const useC = state(false);

		const d = dynamicNode((get) => {
			const sum = (get(a) as number) + (get(b) as number);
			if (get(useC)) return sum + (get(c) as number);
			return sum;
		});

		const { batches, unsub } = collect(d);
		expect(dataValues(batches)).toContain(3); // 1 + 2

		// Enable c
		batch(() => {
			useC.down([[DIRTY]]);
			useC.down([[DATA, true]]);
		});

		expect(dataValues(batches)).toContain(6); // 1 + 2 + 3
		unsub();
	});

	it("emits RESOLVED when value unchanged", () => {
		const a = state(1);
		const d = dynamicNode((get) => {
			const v = get(a) as number;
			return v > 0 ? "positive" : "non-positive";
		});

		const { batches, unsub } = collect(d);
		expect(dataValues(batches)).toContain("positive");

		// Change a to 2 — result is still "positive"
		batch(() => {
			a.down([[DIRTY]]);
			a.down([[DATA, 2]]);
		});

		// Should have RESOLVED, not a second DATA with "positive"
		const lastBatch = batches[batches.length - 1];
		expect(lastBatch.some((m) => m[0] === RESOLVED)).toBe(true);
		unsub();
	});

	it("diamond resolution — recomputes once when shared ancestor changes", () => {
		const root = state(1);
		const left = node([root], ([v]) => (v as number) * 2);
		const right = node([root], ([v]) => (v as number) + 10);

		let computeCount = 0;
		const d = dynamicNode((get) => {
			computeCount++;
			return [get(left) as number, get(right) as number];
		});

		const { batches, unsub } = collect(d);
		computeCount = 0; // reset after initial

		// Change root — both left and right fire DIRTY then settle
		batch(() => {
			root.down([[DIRTY]]);
			root.down([[DATA, 5]]);
		});

		// Should recompute once (not twice — once for left, once for right)
		expect(computeCount).toBe(1);
		expect(dataValues(batches).pop()).toEqual([10, 15]);
		unsub();
	});

	it("cleanup on disconnect", () => {
		const a = state(1);
		const d = dynamicNode((get) => get(a));
		const { unsub } = collect(d);
		expect(d.status).not.toBe("disconnected");
		unsub();
		expect(d.status).toBe("disconnected");
	});

	it("get() returns current cached value", () => {
		const a = state(42);
		const d = dynamicNode((get) => get(a));
		collect(d);
		expect(d.get()).toBe(42);
	});
});
