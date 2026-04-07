/**
 * Regression tests for spec-verified behaviors.
 * Each test names the bug and anchors it to a spec section.
 *
 * Note: Many PY regression scenarios are already covered in other TS test files:
 * - RESOLVED transitive skip → node.test.ts
 * - Diamond recompute count → node.test.ts, operators.test.ts
 * - describe() Appendix B → graph.test.ts
 * - switchMap forward_inner duplicate → operators.test.ts
 *
 * This file collects additional regression scenarios surfaced by cross-repo parity.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA, DIRTY } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("regressions", () => {
	// Spec: GRAPHREFLY-SPEC §1.2 — bare [DATA] without payload is a protocol violation.
	it("bare [DATA] tuple (missing payload) is silently skipped", () => {
		const source = node<number>({ initial: 0 });
		const unsub = source.subscribe(() => undefined);
		// Bare [DATA] should not crash or update the cached value.
		source.down([[DATA] as unknown as [symbol, number]]);
		expect(source.get()).toBe(0);
		expect(source.status).toBe("settled"); // unchanged from initial
		unsub();
	});

	// Spec: batch drain — AggregateError when multiple callbacks throw (parity with PY ExceptionGroup).
	it("batch drain collects multiple errors into AggregateError", () => {
		const a = node<number>({ initial: 0 });
		const b = node<number>({ initial: 0 });
		const errA = new Error("error-a");
		const errB = new Error("error-b");
		// Subscribers that only throw when DATA arrives (deferred during batch drain).
		a.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === DATA)) throw errA;
		});
		b.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === DATA)) throw errB;
		});

		let caught: unknown;
		try {
			batch(() => {
				a.down([[DIRTY], [DATA, 1]]);
				b.down([[DIRTY], [DATA, 2]]);
			});
		} catch (e) {
			caught = e;
		}

		expect(caught).toBeInstanceOf(AggregateError);
		const agg = caught as AggregateError;
		expect(agg.errors).toHaveLength(2);
		expect(agg.errors).toContain(errA);
		expect(agg.errors).toContain(errB);
	});

	// Verify single error still throws unwrapped (backward compat).
	it("batch drain with single callback error throws unwrapped", () => {
		const a = node<number>({ initial: 0 });
		const singleErr = new Error("single");
		a.subscribe(() => {
			throw singleErr;
		});

		let caught: unknown;
		try {
			a.down([[DIRTY], [DATA, 1]]);
		} catch (e) {
			caught = e;
		}

		expect(caught).toBe(singleErr);
	});
});
