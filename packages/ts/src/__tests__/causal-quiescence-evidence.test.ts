import { expect, it } from "vitest";
import type { Arrival, TransitionOptions } from "../solutions/causal-occurrence/contracts.js";
import { causalOccurrenceDigest } from "../solutions/causal-occurrence/identity.js";
import { transitionCausalAuthority } from "../solutions/causal-occurrence/transition.js";

const opts: TransitionOptions = {
	requiredBranches: ["a"],
	requiredEvidenceKinds: ["proof"],
	maxOccurrences: 4,
	maxPending: 4,
	maxEffects: 4,
	maxEvidence: 4,
};
const material = {
	revisionDomain: "run",
	occurrenceId: "one",
	revision: 1,
	sourceRefs: [{ kind: "input", id: "one" }],
	value: 1,
};
const occurrence = { ...material, digest: causalOccurrenceDigest(material) };
const evidence: Arrival<number> = {
	lane: "evidence",
	values: [
		{
			occurrence,
			evidenceId: "proof",
			evidenceKind: "proof",
			evidenceDigest: `sha256:${"a".repeat(64)}`,
			coverage: "included",
		},
	],
};
const terminal: Arrival<number> = {
	lane: "branch-terminals",
	values: [{ occurrence, branch: "a", state: "completed", result: { kind: "ok", value: 1 } }],
};
const setup = () =>
	transitionCausalAuthority<number>(
		undefined,
		[
			{ lane: "occurrences", values: [occurrence] },
			{
				lane: "admissions",
				values: [
					{
						occurrence,
						decisionId: "d",
						decisionDigest: `sha256:${"b".repeat(64)}`,
						state: "admitted",
					},
				],
			},
			{ lane: "watermarks", values: [{ revisionDomain: "run", revision: 1 }] },
		],
		opts,
	);
it("retains evidence and emits coverage before lifecycle ends, then recognizes retained completeness", () => {
	const initial = setup();
	expect(initial.state.quiescence.get("run")).toMatchObject({
		lifecycle: false,
		retainedEvidence: false,
	});
	const proof = transitionCausalAuthority(initial.state, [evidence], opts);
	expect(proof.state.evidence.size).toBe(1);
	expect(proof.outputs.filter((v) => v.kind === "coverage")).toHaveLength(1);
	expect(proof.state.quiescence.get("run")).toMatchObject({
		lifecycle: false,
		retainedEvidence: false,
	});
	const settled = transitionCausalAuthority(proof.state, [terminal], opts);
	expect(settled.state.quiescence.get("run")).toMatchObject({
		lifecycle: true,
		retainedEvidence: true,
	});
	expect(settled.outputs.filter((v) => v.kind === "terminal")).toHaveLength(1);
	expect(settled.outputs).toContainEqual({
		kind: "quiescence",
		value: settled.state.quiescence.get("run"),
	});
});
it("does not mistake lifecycle settlement for evidence completeness and still checks later evidence", () => {
	const settled = transitionCausalAuthority(setup().state, [terminal], opts);
	expect(settled.state.quiescence.get("run")).toMatchObject({
		lifecycle: true,
		retainedEvidence: false,
	});
	const proven = transitionCausalAuthority(settled.state, [evidence], opts);
	expect(proven.state.quiescence.get("run")).toMatchObject({
		lifecycle: true,
		retainedEvidence: true,
	});
	expect(proven.outputs).toContainEqual({
		kind: "quiescence",
		value: proven.state.quiescence.get("run"),
	});
	const replay = transitionCausalAuthority(proven.state, [evidence, terminal], opts);
	expect(replay.state).toEqual(proven.state);
	expect(replay.outputs).toEqual([]);
});
