import { describe, expect, it } from "vitest";
import type { CausalOccurrenceRef } from "../solutions/causal-occurrence/contracts.js";
import {
	canonicalSnapshot,
	dataKey,
	refKey,
	sameRef,
} from "../solutions/causal-occurrence/identity.js";

const ref = (i: number): CausalOccurrenceRef =>
	canonicalSnapshot({
		revisionDomain: `domain:${i % 3}`,
		occurrenceId: `id[${i % 7}]`,
		revision: i + 1,
		digest: `sha256:${"a".repeat(64)}`,
		sourceRefs: [
			{ kind: "input", id: `x"${i}`, extra: { b: i, a: [true, null] } },
			{ kind: "policy", id: "p" },
		],
	});
const priorSame = (a: CausalOccurrenceRef, b: CausalOccurrenceRef) =>
	refKey(a) === refKey(b) &&
	a.digest === b.digest &&
	dataKey(a.sourceRefs) === dataKey(b.sourceRefs);

describe("D160 exact reference canonical equality", () => {
	it("preserves full source data, order, digest and every identity coordinate", () => {
		for (let i = 0; i < 100; i++) {
			const a = ref(i);
			const cases: [CausalOccurrenceRef, boolean][] = [
				[structuredClone(a), true],
				[{ ...a, revisionDomain: `${a.revisionDomain}!` }, false],
				[{ ...a, occurrenceId: `${a.occurrenceId}!` }, false],
				[{ ...a, revision: a.revision + 1 }, false],
				[{ ...a, digest: `sha256:${"b".repeat(64)}` }, false],
				[{ ...a, sourceRefs: [...a.sourceRefs].reverse() }, false],
				[
					{
						...a,
						sourceRefs: [
							{ ...a.sourceRefs[0]!, extra: { a: [true, null], b: i } },
							a.sourceRefs[1]!,
						],
					},
					true,
				],
				[
					{
						...a,
						sourceRefs: [
							{ ...a.sourceRefs[0]!, extra: { a: [true, null], b: i + 1 } },
							a.sourceRefs[1]!,
						],
					},
					false,
				],
			];
			for (const [b, expected] of cases) {
				expect(sameRef(a, b)).toBe(expected);
				expect(sameRef(a, b)).toBe(priorSame(a, b));
			}
		}
	});
	it("continues rejecting noncanonical nested source data", () => {
		const a = ref(0);
		for (const extra of [undefined, NaN, () => 1]) {
			const b = { ...a, sourceRefs: [{ kind: "input", id: "x", extra }] };
			expect(() => sameRef(a, b)).toThrow();
			expect(() => priorSame(a, b)).toThrow();
		}
	});
});
