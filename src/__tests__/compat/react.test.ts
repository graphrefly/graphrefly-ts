/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStore, useSubscribe, useSubscribeRecord } from "../../compat/react/index.js";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("React bindings", () => {
	it("useSubscribe reads value and updates", () => {
		const testNode = node({ initial: 0 });
		const { result } = renderHook(() => useSubscribe(testNode));

		expect(result.current).toBe(0);

		act(() => {
			testNode.down([[DATA, 1]]);
		});

		expect(result.current).toBe(1);
	});

	it("useStore provides state and setter", () => {
		const testNode = node({ initial: 10 });
		const { result } = renderHook(() => useStore(testNode));

		expect(result.current[0]).toBe(10);

		act(() => {
			result.current[1](20);
		});

		expect(result.current[0]).toBe(20);
		expect(testNode.get()).toBe(20);
	});

	it("useSubscribeRecord tracks multiple nodes and re-subscribes properly", () => {
		const a = node({ initial: "A" });
		const b = node({ initial: "B" });
		const keysNode = node<string[]>({ initial: ["a"] });

		const factory = (key: string) => ({ val: key === "a" ? a : b });

		const { result } = renderHook(() => useSubscribeRecord(keysNode, factory));

		expect(result.current).toEqual({ a: { val: "A" } });

		act(() => {
			a.down([[DATA, "A+"]]);
		});

		expect(result.current).toEqual({ a: { val: "A+" } });

		act(() => {
			keysNode.down([[DATA, ["a", "b"]]]);
		});

		expect(result.current).toEqual({ a: { val: "A+" }, b: { val: "B" } });

		act(() => {
			b.down([[DATA, "B+"]]);
		});
		expect(result.current).toEqual({ a: { val: "A+" }, b: { val: "B+" } });
	});
});
