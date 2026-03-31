import { describe, expect, it, vi } from "vitest";
import {
	action,
	atom,
	computed,
	getValue,
	map,
	onMount,
	onStart,
} from "../../compat/nanostores/index.js";

describe("nanostores compat", () => {
	describe("atom", () => {
		it("get and set", () => {
			const count = atom(0);
			expect(count.get()).toBe(0);
			count.set(1);
			expect(count.get()).toBe(1);
		});

		it("subscribe calls immediately", () => {
			const count = atom(0);
			const cb = vi.fn();
			count.subscribe(cb);
			expect(cb).toHaveBeenCalledWith(0);
			count.set(1);
			expect(cb).toHaveBeenCalledWith(1);
		});

		it("listen does not call immediately", () => {
			const count = atom(0);
			const cb = vi.fn();
			count.listen(cb);
			expect(cb).not.toHaveBeenCalled();
			count.set(1);
			expect(cb).toHaveBeenCalledWith(1);
		});

		it("unsubscribe stops updates", () => {
			const count = atom(0);
			const cb = vi.fn();
			const unsub = count.subscribe(cb);
			expect(cb).toHaveBeenCalledWith(0);
			unsub();
			count.set(1);
			expect(cb).toHaveBeenCalledTimes(1);
		});
	});

	describe("computed", () => {
		it("tracks dependency", () => {
			const base = atom(2);
			const doubled = computed(base, (v) => v * 2);
			expect(doubled.get()).toBe(4);
			base.set(5);
			expect(doubled.get()).toBe(10);
		});

		it("tracks multiple dependencies", () => {
			const a = atom(10);
			const b = atom(20);
			const sum = computed([a, b], (va, vb) => va + vb);
			expect(sum.get()).toBe(30);
			a.set(5);
			expect(sum.get()).toBe(25);
			b.set(5);
			expect(sum.get()).toBe(10);
		});

		it("dynamic dependency switching", () => {
			const cond = atom(true);
			const a = atom(1);
			const b = atom(10);
			// Note: result depends on all three, but 'get' in dynamicNode
			// will only record what is actually read during execution if we used tracking.
			// Our computed wrapper uses a fixed dependency list from stores.
			const result = computed([cond, a, b], (c, va, vb) => (c ? va : vb));

			expect(result.get()).toBe(1);
			cond.set(false);
			expect(result.get()).toBe(10);

			// Changing 'a' when cond is false:
			// Since our computed wrapper passes [cond, a, b] to dynamicNode,
			// it will recompute when 'a' changes even if cond is false.
			// This is slightly different from true Jotai-style dynamic tracking,
			// but matches Nanostores 'computed' which takes a fixed array of deps.
			a.set(2);
			expect(result.get()).toBe(10);
		});

		it("diamond resolution", () => {
			const base = atom(2);
			let computations = 0;
			const left = computed(base, (v) => v * 2);
			const right = computed(base, (v) => v + 1);
			const combined = computed([left, right], (l, r) => {
				computations++;
				return l + r;
			});

			expect(combined.get()).toBe(7); // 4 + 3
			expect(computations).toBe(1);

			base.set(10);
			expect(combined.get()).toBe(31); // 20 + 11
			expect(computations).toBe(2);
		});
	});

	describe("map", () => {
		it("get and set", () => {
			const profile = map({ name: "Alice", age: 30 });
			expect(profile.get()).toEqual({ name: "Alice", age: 30 });
			profile.set({ name: "Bob", age: 25 });
			expect(profile.get()).toEqual({ name: "Bob", age: 25 });
		});

		it("setKey updates specific key", () => {
			const profile = map({ name: "Alice", age: 30 });
			profile.setKey("age", 31);
			expect(profile.get()).toEqual({ name: "Alice", age: 31 });
		});

		it("emits on key change", () => {
			const profile = map({ name: "Alice" });
			const cb = vi.fn();
			profile.listen(cb);
			profile.setKey("name", "Alice");
			// Since we use equals: () => false, it should emit.
			expect(cb).toHaveBeenCalled();
		});
	});

	describe("utilities", () => {
		it("getValue returns current value", () => {
			const count = atom(42);
			const doubled = computed(count, (v) => v * 2);
			const profile = map({ name: "Alice" });

			expect(getValue(count)).toBe(42);
			expect(getValue(doubled)).toBe(84);
			expect(getValue(profile)).toEqual({ name: "Alice" });
		});

		it("action batches updates", () => {
			const count = atom(0);
			const cb = vi.fn();
			count.listen(cb);

			const incrementTwice = action(count, "inc", () => {
				count.set(count.get() + 1);
				count.set(count.get() + 1);
				return "done";
			});

			const result = incrementTwice();
			expect(result).toBe("done");
			// In GraphReFly, batch() defers DATA until the end of the batch block,
			// but it does not deduplicate them. Both emissions happen after the batch concludes.
			expect(cb).toHaveBeenCalledTimes(2);
			expect(cb).toHaveBeenNthCalledWith(1, 1);
			expect(cb).toHaveBeenNthCalledWith(2, 2);
		});
	});

	describe("lifecycle", () => {
		it("onMount/onStart/onStop", () => {
			const count = atom(0);
			const startCb = vi.fn();
			const stopCb = vi.fn();

			onMount(count, () => {
				startCb();
				return () => stopCb();
			});

			expect(startCb).not.toHaveBeenCalled();

			const unsub = count.listen(() => {});
			expect(startCb).toHaveBeenCalledTimes(1);
			expect(stopCb).not.toHaveBeenCalled();

			unsub();
			expect(stopCb).toHaveBeenCalledTimes(1);
		});

		it("multiple listeners share mount lifecycle", () => {
			const count = atom(0);
			const startCb = vi.fn();
			onStart(count, startCb);

			const unsub1 = count.subscribe(() => {});
			expect(startCb).toHaveBeenCalledTimes(1);

			const unsub2 = count.subscribe(() => {});
			expect(startCb).toHaveBeenCalledTimes(1);

			unsub1();
			unsub2();
			// Should still only have started once.
		});
	});
});
