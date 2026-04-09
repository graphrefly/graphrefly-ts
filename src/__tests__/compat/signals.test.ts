import { describe, expect, it, vi } from "vitest";
import { Signal } from "../../../src/compat/signals/index.js";
import { COMPLETE, ERROR } from "../../../src/core/messages.js";

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

	it("Computed dependencies are tracked globally during execution", () => {
		const a = new Signal.State("a");
		const b = new Signal.State("b");
		const useA = new Signal.State(true);

		const computeSpy = vi.fn(() => (useA.get() ? a.get() : b.get()));
		const trackedResult = new Signal.Computed(computeSpy);

		// To truly test reactivity changes without reading we need a subscriber to keep it connected
		const unsub = Signal.sub(trackedResult, () => {});

		// first read sets up tracking - subscription triggers initial eval
		expect(trackedResult.get()).toBe("a");
		expect(computeSpy).toHaveBeenCalledTimes(1);

		b.set("b2"); // shouldn't trigger recompute because b is not tracked
		expect(computeSpy).toHaveBeenCalledTimes(1);

		useA.set(false); // triggers tracking change
		expect(computeSpy).toHaveBeenCalledTimes(2);
		expect(trackedResult.get()).toBe("b2");

		a.set("a2"); // shouldn't trigger recompute because a is no longer tracked
		expect(computeSpy).toHaveBeenCalledTimes(2);

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
		const base = new Signal.State(1);
		const left = new Signal.Computed(() => base.get() * 2);
		const right = new Signal.Computed(() => base.get() + 2);

		const computeSpy = vi.fn();
		const final = new Signal.Computed(() => {
			computeSpy();
			return left.get() + right.get();
		});

		// subscribe to keep the network active
		const unsub = Signal.sub(final, () => {});
		expect(final.get()).toBe(5); // left(2) + right(3)
		// Initial activation goes through the ROM/RAM + rewire-buffer path:
		// first fn run reads undefined from disconnected compute deps,
		// rewire activates them, discrepancy triggers one stabilizing re-run.
		expect(computeSpy).toHaveBeenCalledTimes(2);

		// Update base — diamond resolution: final should recompute exactly
		// once when both left and right settle in the same wave.
		base.set(2);

		expect(computeSpy).toHaveBeenCalledTimes(3);
		expect(final.get()).toBe(8); // left(4) + right(4)

		unsub();
	});
});
