import { COMPLETE, ERROR } from "@graphrefly/pure-ts/core";
import { describe, expect, it, vi } from "vitest";
import { Signal } from "../../compat/signals/index.js";

describe("compat/signals", () => {
	it("State sets and gets values synchronously", () => {
		const count = new Signal.State(0);
		expect(count.get()).toBe(0);

		count.set(1);
		expect(count.get()).toBe(1);
	});

	it("Computed evaluates reactively based on State changes", () => {
		const count = new Signal.State(2);
		const doubled = new Signal.Computed(() => count.get() * 2);

		expect(doubled.get()).toBe(4);

		count.set(3);
		expect(doubled.get()).toBe(6);
	});

	it("Computed tracks deps globally and fires cb only on genuine value changes", () => {
		// Focus: value correctness + cb count correctness.
		// Fn call counts are an implementation detail and not asserted.
		const a = new Signal.State("a");
		const b = new Signal.State("b");
		const useA = new Signal.State(true);

		const trackedResult = new Signal.Computed(() => (useA.get() ? a.get() : b.get()));

		const seen: string[] = [];
		const unsub = Signal.sub(trackedResult, (v) => seen.push(v));

		// Initial value
		expect(trackedResult.get()).toBe("a");
		expect(seen).toEqual([]); // Signal.sub skips the initial push

		// b is not in the currently-used branch, so mutating it must not
		// change the observed value and must not fire the subscriber.
		b.set("b2");
		expect(trackedResult.get()).toBe("a");
		expect(seen).toEqual([]);

		// Flip the branch — value changes, subscriber fires exactly once
		// with the current value of b.
		useA.set(false);
		expect(trackedResult.get()).toBe("b2");
		expect(seen).toEqual(["b2"]);

		// a is no longer the active branch. Mutating it must not fire the
		// subscriber — the user-visible value is still b's value.
		a.set("a2");
		expect(trackedResult.get()).toBe("b2");
		expect(seen).toEqual(["b2"]);

		// Flip back — the re-activated a branch must reflect a's CURRENT
		// value "a2", not a stale snapshot from when a was last read.
		useA.set(true);
		expect(trackedResult.get()).toBe("a2");
		expect(seen).toEqual(["b2", "a2"]);

		// Setting a to the same value must not fire the subscriber.
		a.set("a2");
		expect(seen).toEqual(["b2", "a2"]);

		unsub();
	});

	it("Nested Computed properties track correctly", () => {
		const count = new Signal.State(1);
		const doubled = new Signal.Computed(() => count.get() * 2);
		const quadrupled = new Signal.Computed(() => doubled.get() * 2);

		expect(quadrupled.get()).toBe(4);

		count.set(2);
		expect(quadrupled.get()).toBe(8);
	});

	it("Signal.sub listens to DATA emissions and returns a cleanup function", () => {
		const count = new Signal.State(0);
		const cb = vi.fn();
		const unsub = Signal.sub(count, cb);

		count.set(1);
		count.set(2);

		expect(cb).toHaveBeenCalledTimes(2);
		expect(cb).toHaveBeenNthCalledWith(1, 1);
		expect(cb).toHaveBeenNthCalledWith(2, 2);

		unsub();
		count.set(3);
		expect(cb).toHaveBeenCalledTimes(2); // no more calls
	});

	it("Signal.sub supports optional terminal hooks", () => {
		const count = new Signal.State(0);
		const data = vi.fn();
		const error = vi.fn();
		const complete = vi.fn();
		const unsub = Signal.sub(count, { data, error, complete });
		count.set(1);
		(count as unknown as { _node: { down: (msgs: unknown[]) => void } })._node.down([
			[ERROR, "boom"],
		]);
		(count as unknown as { _node: { down: (msgs: unknown[]) => void } })._node.down([[COMPLETE]]);
		expect(data).toHaveBeenCalledTimes(1);
		expect(data).toHaveBeenCalledWith(1);
		expect(error).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledWith("boom");
		expect(complete).toHaveBeenCalledTimes(1);
		unsub();
	});

	it("Signal.State respects equals in set()", () => {
		const count = new Signal.State(1, { equals: (a, b) => a === b });
		const cb = vi.fn();
		const unsub = Signal.sub(count, cb);
		count.set(1);
		count.set(2);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb).toHaveBeenCalledWith(2);
		unsub();
	});

	it("Signal.get does not throw after upstream error", () => {
		const count = new Signal.State(1);
		const doubled = new Signal.Computed(() => {
			const value = count.get();
			if (value === 2) {
				throw new Error("boom");
			}
			return value * 2;
		});
		const unsub = Signal.sub(doubled, () => {});
		expect(doubled.get()).toBe(2);
		count.set(2);
		expect(() => doubled.get()).not.toThrow();
		expect(doubled.get()).toBe(2);
		unsub();
	});

	it("Diamond patterns resolve without glitches", () => {
		// Focus: the diamond must produce the correct final value and
		// fire the subscriber EXACTLY ONCE per base update (not twice —
		// that would be the glitch we care about).
		const base = new Signal.State(1);
		const left = new Signal.Computed(() => base.get() * 2);
		const right = new Signal.Computed(() => base.get() + 2);
		const final = new Signal.Computed(() => left.get() + right.get());

		const seen: number[] = [];
		const unsub = Signal.sub(final, (v) => seen.push(v));

		expect(final.get()).toBe(5); // left(2) + right(3)
		expect(seen).toEqual([]); // Signal.sub skips initial push

		base.set(2);
		expect(final.get()).toBe(8); // left(4) + right(4)
		// Exactly one cb fire with the final diamond-resolved value —
		// no intermediate glitch values like 6 (left=4, right=3 stale)
		// or 7 (left=2 stale, right=4).
		expect(seen).toEqual([8]);

		base.set(3);
		expect(final.get()).toBe(11); // left(6) + right(5)
		expect(seen).toEqual([8, 11]);

		unsub();
	});
});
