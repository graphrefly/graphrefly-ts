import { describe, expect, it, vi } from "vitest";
import { atom, type GetFn, type SetFn } from "../../compat/jotai/index.js";

describe("jotai compat", () => {
	it("primitive atom: get and set", () => {
		const count = atom(0);
		expect(count.get()).toBe(0);
		count.set(1);
		expect(count.get()).toBe(1);
	});

	it("primitive atom: update", () => {
		const count = atom(10);
		count.update((c) => c + 5);
		expect(count.get()).toBe(15);
	});

	// FLAG: v5 behavioral change — needs investigation
	// dynamicNode([], ...) now throws "untracked dep" when track() is called on deps not in allDeps
	it("read-only derived atom: tracks dependencies", () => {
		const base = atom(2);
		const doubled = atom((get: GetFn) => get(base)! * 2);

		expect(doubled.get()).toBe(4);
		base.set(5);
		expect(doubled.get()).toBe(10);
	});

	// FLAG: v5 behavioral change — needs investigation
	// dynamicNode([], ...) now throws "untracked dep" when track() is called on deps not in allDeps
	it("read-only derived atom: dynamic dependency switching", () => {
		const cond = atom(true);
		const a = atom(1);
		const b = atom(10);
		const result = atom((get: GetFn) => (get(cond) ? get(a) : get(b)));

		expect(result.get()).toBe(1);
		cond.set(false);
		expect(result.get()).toBe(10);

		// Changing 'a' when cond is false should not trigger re-read from 'a'
		a.set(2);
		expect(result.get()).toBe(10);
	});

	// FLAG: v5 behavioral change — needs investigation
	// dynamicNode([], ...) now throws "untracked dep" when track() is called on deps not in allDeps
	it("writable derived atom: custom write logic", () => {
		const base = atom(5);
		const clamped = atom(
			(get: GetFn) => get(base)!,
			(_get, set, val: number) => {
				set(base, Math.max(0, Math.min(10, val)));
			},
		);

		expect(clamped.get()).toBe(5);
		clamped.set(20);
		expect(base.get()).toBe(10);
		clamped.set(-5);
		expect(base.get()).toBe(0);
	});

	it("atom subscribe: receives updates", () => {
		const count = atom(0);
		const cb = vi.fn();
		count.subscribe(cb);

		count.set(1);
		expect(cb).toHaveBeenCalledWith(1);
		count.set(2);
		expect(cb).toHaveBeenCalledWith(2);
	});

	it("atom subscribe: returns unsubscribe function", () => {
		const count = atom(0);
		const cb = vi.fn();
		const unsub = count.subscribe(cb);

		count.set(1);
		expect(cb).toHaveBeenCalledWith(1);
		unsub();

		count.set(2);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("atom options: name", () => {
		const a = atom(0, { name: "my-atom" });
		expect(a._node.name).toBe("my-atom");
	});

	it("atom options: meta", () => {
		const a = atom(0, { meta: { description: "test counter" } });
		expect(a.meta.description).toBeDefined();
		expect(a.meta.description.cache).toBe("test counter");
	});

	it("derived atom options: meta", () => {
		const a = atom(0);
		const b = atom((get: GetFn) => (get(a) ?? 0) * 2, { meta: { tag: "derived" } });
		expect(b.meta.tag).toBeDefined();
		expect(b.meta.tag.cache).toBe("derived");
	});

	// FLAG: v5 behavioral change — needs investigation
	// dynamicNode([], ...) now throws "untracked dep" when track() is called on deps not in allDeps
	it("derived atom: error handling", () => {
		const a = atom(1);
		const b = atom((get: GetFn) => {
			const val = get(a);
			if (val === 0) throw new Error("Zero division");
			return 10 / (val ?? 1);
		});

		expect(b.get()).toBe(10);
		a.set(0);

		// While sentinel, it won't recompute or show 'errored' until pulled.
		expect(b._node.status).toBe("sentinel");

		// Trigger pull via get() and check throwing behavior.
		expect(() => b.get()).toThrow("Zero division");

		// After get() throws, it returns to sentinel in GraphReFly.
		expect(b._node.status).toBe("sentinel");

		// Verify it stays errored while subscribed.
		const unsub = b.subscribe(() => {});
		expect(b._node.status).toBe("errored");
		unsub();
	});

	// FLAG: v5 behavioral change — needs investigation
	// dynamicNode([], ...) now throws "untracked dep" when track() is called on deps not in allDeps
	it("derived atom: diamond resolution", () => {
		const base = atom<number>(2);
		let computations = 0;
		const left = atom<number>((get: GetFn) => get(base) * 2);
		const right = atom<number>((get: GetFn) => get(base) + 1);
		const combined = atom<number>((get: GetFn) => {
			computations++;
			const l = get(left);
			const r = get(right);
			return l + r;
		});

		expect(combined.get()).toBe(7); // (2*2) + (2+1) = 4 + 3 = 7
		// Under ROM/RAM, derived-atom reads trigger an initial pass with
		// undefined dep values (compute nodes clear cache on disconnect),
		// followed by a rewire-buffer re-run once the lazy deps emit their
		// real values. Stabilizes at 2 computations for the initial read.
		expect(computations).toBe(2);

		base.set(10);
		expect(combined.get()).toBe(31); // (10*2) + (10+1) = 20 + 11 = 31
		// Each `.get()` triggers a fresh `pull(combined._node)` which
		// subscribes-then-unsubs. The second `.get()` starts from a
		// sentinel compute node and repeats the two-phase (discover +
		// stabilize) cycle, so we see another +2 computations.
		expect(computations).toBe(4);
	});

	// FLAG: v5 behavioral change — needs investigation
	// dynamicNode([], ...) now throws "untracked dep" when track() is called on deps not in allDeps
	it("writable derived atom: update logic", () => {
		const base = atom<number>(10);
		const derived = atom<number>(
			(get: GetFn) => get(base),
			(_get: GetFn, set: SetFn, val: number) => set(base, val),
		);

		derived.update((c) => c + 5);
		expect(base.get()).toBe(15);
		expect(derived.get()).toBe(15);
	});
});
