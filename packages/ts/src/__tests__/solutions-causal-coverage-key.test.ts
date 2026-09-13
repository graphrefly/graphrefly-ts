import { expect, it } from "vitest";
import type {
	AuthorityFact,
	CausalEvidence,
	CausalOccurrenceRef,
	TransitionOptions,
} from "../solutions/causal-occurrence/contracts.js";
import { emitCoverage } from "../solutions/causal-occurrence/evidence.js";
import { canonicalSnapshot } from "../solutions/causal-occurrence/identity.js";
import { transitionCausalAuthority } from "../solutions/causal-occurrence/transition.js";

const opts: TransitionOptions = {
	requiredBranches: [],
	requiredEvidenceKinds: ["proof"],
	maxOccurrences: 20,
	maxPending: 20,
	maxEffects: 20,
	maxEvidence: 20,
};
const ref = {
	revisionDomain: "run",
	revision: 1,
	occurrenceId: "one",
	digest: `sha256:${"a".repeat(64)}`,
	sourceRefs: [{ kind: "input", id: "one", detail: { b: 2, a: 1 } }],
};
const record = (
	id: string,
	occurrence: CausalOccurrenceRef = ref,
	coverage: CausalEvidence["coverage"] = "included",
): CausalEvidence =>
	canonicalSnapshot({
		occurrence,
		evidenceKind: "proof",
		evidenceId: id,
		evidenceDigest: `sha256:${"b".repeat(64)}`,
		coverage,
	});
it("keeps exact reference filtering, record order, gap precedence and repeated outputs", () => {
	const state = transitionCausalAuthority(undefined, [], opts).state;
	const first = record("first");
	const second = record("second");
	const gap = record("gap", ref, "retention-gap");
	state.evidence.set("1", first);
	state.evidence.set(
		"wrong-metadata",
		record("wrong", { ...ref, sourceRefs: [{ kind: "input", id: "one", detail: { b: 3, a: 1 } }] }),
	);
	state.evidence.set("2", second);
	state.coverageGaps.set("gap", gap);
	const outputs: AuthorityFact<unknown>[] = [];
	const before = structuredClone(state);
	const query = canonicalSnapshot({
		...ref,
		sourceRefs: [{ kind: "input", id: "one", detail: { a: 1, b: 2 } }],
	});
	emitCoverage({ state, opts, outputs }, query);
	emitCoverage({ state, opts, outputs }, query);
	expect(outputs).toEqual(
		[0, 1].map(() => ({
			kind: "coverage",
			value: {
				kind: "causal-evidence-coverage",
				occurrence: query,
				complete: false,
				entries: [first, second, gap],
				missingKinds: [],
				terminalGapKinds: ["proof"],
			},
		})),
	);
	expect(state).toEqual(before);
});
it("preserves the empty scan without encoding the unused query", () => {
	const state = transitionCausalAuthority(undefined, [], opts).state;
	const outputs: AuthorityFact<unknown>[] = [];
	const query = { ...ref, sourceRefs: undefined } as unknown as CausalOccurrenceRef;
	expect(() => emitCoverage({ state, opts, outputs }, query)).not.toThrow();
	expect(outputs).toHaveLength(1);
});
