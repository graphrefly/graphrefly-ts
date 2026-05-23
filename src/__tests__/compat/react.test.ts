/**
 * @vitest-environment jsdom
 */

import { DATA, node } from "@graphrefly/pure-ts/core";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { useStore, useSubscribe, useSubscribeRecord } from "../../compat/react/index.js";

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

	it("useSubscribe is stable under StrictMode (no fresh-closure re-subscribe loop)", () => {
		// Regression for memo:Re Story 3.6 finding: fresh subscribe/getSnapshot
		// closures per render caused useSyncExternalStore to re-subscribe each
		// render, and push-on-subscribe nodes would loop into "Maximum update
		// depth exceeded". The useCallback([node]) memoization fixes it.
		const testNode = node({ initial: 42 });
		let renderCount = 0;
		const { result } = renderHook(
			() => {
				renderCount++;
				return useSubscribe(testNode);
			},
			{ wrapper: StrictMode },
		);

		expect(result.current).toBe(42);
		// StrictMode doubles the initial mount renders; bound is generous but
		// catches any unbounded re-subscribe loop.
		expect(renderCount).toBeLessThanOrEqual(5);

		const before = renderCount;
		act(() => {
			testNode.down([[DATA, 43]]);
		});
		expect(result.current).toBe(43);
		// Exactly one settled update should produce a small bounded delta.
		expect(renderCount - before).toBeLessThanOrEqual(4);
	});

	it("useStore provides state and setter", () => {
		const testNode = node({ initial: 10 });
		const { result } = renderHook(() => useStore(testNode));

		expect(result.current[0]).toBe(10);

		act(() => {
			result.current[1](20);
		});

		expect(result.current[0]).toBe(20);
		expect(testNode.cache).toBe(20);
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
