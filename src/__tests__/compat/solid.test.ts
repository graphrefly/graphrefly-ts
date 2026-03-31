/**
 * @vitest-environment jsdom
 */
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { useStore, useSubscribe, useSubscribeRecord } from "../../compat/solid/index.js";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("Solid bindings", () => {
	it("useSubscribe reads value and updates", () => {
		const testNode = node({ initial: "hello" });

		createRoot((dispose: () => void) => {
			const accessor = useSubscribe(testNode);

			expect(accessor()).toBe("hello");

			testNode.down([[DATA, "world"]]);
			expect(accessor()).toBe("world");

			dispose();

			testNode.down([[DATA, "ignored"]]);
			expect(accessor()).toBe("world");
		});
	});

	it("useStore provides state and setter", () => {
		const testNode = node({ initial: 10 });

		createRoot((dispose: () => void) => {
			const [accessor, setter] = useStore(testNode);

			expect(accessor()).toBe(10);

			setter(42);
			expect(accessor()).toBe(42);
			expect(testNode.get()).toBe(42);

			dispose();
		});
	});

	it("useSubscribeRecord syncs dynamic values", () => {
		const a = node({ initial: 1 });
		const b = node({ initial: 2 });
		const keysNode = node<string[]>({ initial: ["a"] });

		const factory = (key: string) => ({ item: key === "a" ? a : b });

		createRoot((dispose: () => void) => {
			const accessor = useSubscribeRecord(keysNode, factory);

			expect(accessor()).toEqual({ a: { item: 1 } });

			a.down([[DATA, 10]]);
			expect(accessor()).toEqual({ a: { item: 10 } });

			keysNode.down([[DATA, ["a", "b"]]]);
			expect(accessor()).toEqual({ a: { item: 10 }, b: { item: 2 } });

			b.down([[DATA, 20]]);
			expect(accessor()).toEqual({ a: { item: 10 }, b: { item: 20 } });

			dispose();
		});
	});
});
