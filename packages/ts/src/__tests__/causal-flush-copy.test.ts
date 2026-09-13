import { expect, it } from "vitest";
import type { Arrival, TransitionOptions } from "../solutions/causal-occurrence/contracts.js";
import { causalOccurrenceDigest, refKey } from "../solutions/causal-occurrence/identity.js";
import { transitionCausalAuthority } from "../solutions/causal-occurrence/transition.js";

const opts: TransitionOptions = {
	requiredBranches: ["a"],
	requiredEvidenceKinds: ["proof"],
	maxOccurrences: 1,
	maxPending: 8,
	maxEffects: 8,
	maxEvidence: 8,
};
function arrival(revision: number, rejected = false): Arrival<number>[] {
	const material = {
		revisionDomain: "run",
		occurrenceId: `o${revision}`,
		revision,
		sourceRefs: [{ kind: "input", id: `i${revision}` }],
		value: revision,
	};
	const occurrence = { ...material, digest: causalOccurrenceDigest(material) };
	return [
		{ lane: "occurrences", values: [occurrence] },
		{
			lane: "admissions",
			values: [
				{
					occurrence,
					state: rejected ? "rejected" : "admitted",
					decisionId: `d${revision}`,
					decisionDigest: `sha256:${"a".repeat(64)}`,
				},
			],
		},
		{ lane: "watermarks", values: [{ revisionDomain: "run", revision }] },
	];
}
it("preserves no-op pass separation between emitted projections and retained state", () => {
	const first = transitionCausalAuthority(undefined, arrival(1), opts);
	const current = first.outputs.find((v) => v.kind === "currentness")!;
	const quiet = first.outputs.find((v) => v.kind === "quiescence")!;
	if (current.kind !== "currentness" || quiet.kind !== "quiescence") throw Error("missing facts");
	const retained = first.state.currentness.get(refKey(current.value.occurrence))!;
	const retainedQuiet = first.state.quiescence.get("run")!;
	expect(current.value).not.toBe(retained);
	expect(quiet.value).not.toBe(retainedQuiet);
	expect(quiet.value.pendingOccurrenceRefs).not.toBe(retainedQuiet.pendingOccurrenceRefs);
	expect(quiet.value.pendingEffectIds).not.toBe(retainedQuiet.pendingEffectIds);
	expect(Object.isFrozen(retainedQuiet.pendingOccurrenceRefs)).toBe(true);
	expect(current.value.occurrence).toBe(retained.occurrence);
	Object.assign(current.value, { state: "stale" });
	Object.assign(quiet.value, { lifecycle: true });
	expect(transitionCausalAuthority(first.state, [], opts).outputs).toEqual([]);
});
it("also separates nested retention-gap projections after eviction", () => {
	const first = transitionCausalAuthority(undefined, arrival(1, true), opts);
	const second = transitionCausalAuthority(first.state, arrival(2), opts);
	const fact = second.outputs.find(
		(v) => v.kind === "currentness" && v.value.state === "unverifiable",
	)!;
	if (fact.kind !== "currentness" || fact.value.state !== "unverifiable")
		throw Error("missing gap");
	const retained = second.state.currentness.get(refKey(fact.value.occurrence))!;
	if (retained.state !== "unverifiable") throw Error("missing retained gap");
	expect(fact.value.gapRef).toBeDefined();
	expect(fact.value.gapRef).not.toBe(retained.gapRef);
	expect(fact.value.gapRef!.evidenceRef).not.toBe(retained.gapRef!.evidenceRef);
	const before = structuredClone(retained);
	Object.assign(fact.value.gapRef!.evidenceRef, { id: "consumer-mutation" });
	expect(retained).toEqual(before);
});
