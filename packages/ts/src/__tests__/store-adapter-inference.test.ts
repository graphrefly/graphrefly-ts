/**
 * WritableNode.set takes NoInfer<T>: an adapter given a state node infers T from the node's value,
 * not T | ((prev) => T) from StateNode.set's function form.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { jotaiAtom, type WritableJotaiAtom, zustandStore } from "../adapters/store.js";
import { graph } from "../index.js";

describe("store adapters infer the node's value type from a state node", () => {
	it("jotaiAtom and zustandStore over g.state", () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const atom = jotaiAtom(count);
		expectTypeOf(atom).toEqualTypeOf<WritableJotaiAtom<number>>();
		atom.set(2);
		expect(count.cache).toBe(2);
		const store = zustandStore(g.state({ n: 1 }, { name: "s" }));
		expectTypeOf(store.getState()).toEqualTypeOf<{ n: number }>();
	});
});
