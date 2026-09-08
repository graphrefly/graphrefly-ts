import { describe, expect, it } from "vitest";
import type { AuthorityFact, TransitionOptions } from "../solutions/causal-occurrence/contracts.js";
import { receiveEvidence } from "../solutions/causal-occurrence/evidence.js";
import {
	causalOccurrenceDigest,
	receiveAdmissions,
} from "../solutions/causal-occurrence/identity.js";
import { transitionCausalAuthority } from "../solutions/causal-occurrence/transition.js";

const opts: TransitionOptions = {
	requiredBranches: ["a", "b"],
	requiredEvidenceKinds: ["proof"],
	maxOccurrences: 2,
	maxPending: 2,
	maxEffects: 2,
	maxEvidence: 1,
};
const material = {
	revisionDomain: "run",
	occurrenceId: "one",
	revision: 1,
	sourceRefs: [{ kind: "input", id: "one" }],
	value: 1,
};
const occurrence = { ...material, digest: causalOccurrenceDigest(material) };
const admission = {
	occurrence,
	decisionId: "decision",
	decisionDigest: `sha256:${"a".repeat(64)}`,
	state: "admitted" as const,
};
const admitted = () =>
	transitionCausalAuthority<number>(
		undefined,
		[
			{ lane: "occurrences", values: [occurrence] },
			{ lane: "admissions", values: [admission] },
			{ lane: "watermarks", values: [{ revisionDomain: "run", revision: 1 }] },
		],
		opts,
	).state;

describe("D160 private authority responsibility boundaries", () => {
	it("does not mutate a previously committed snapshot, including nested terminal maps", () => {
		const first = transitionCausalAuthority(
			admitted(),
			[
				{
					lane: "branch-terminals",
					values: [
						{ occurrence, branch: "a", state: "completed", result: { kind: "ok", value: "a" } },
					],
				},
			],
			opts,
		).state;
		const before = structuredClone(first);
		const next = transitionCausalAuthority(
			first,
			[
				{
					lane: "branch-terminals",
					values: [
						{ occurrence, branch: "b", state: "completed", result: { kind: "ok", value: "b" } },
					],
				},
			],
			opts,
		);
		expect(first).toEqual(before);
		expect([...first.terminals.values()][0]?.size).toBe(1);
		expect([...next.state.terminals.values()][0]?.size).toBe(2);
		expect(next.outputs.filter((fact) => fact.kind === "terminal")).toHaveLength(1);
	});

	it("identity admission alone cannot fabricate a release, terminal, effect or evidence", () => {
		const { state } = transitionCausalAuthority<number>(undefined, [], opts);
		const outputs: AuthorityFact<number>[] = [];
		receiveAdmissions({ state, opts, outputs }, { lane: "admissions", values: [admission] });
		expect(state.admissions.size).toBe(1);
		expect(state.byRevision.size).toBe(0);
		expect(state.effects.size).toBe(0);
		expect(state.evidence.size).toBe(0);
		expect(outputs).toEqual([]);
	});

	it("evidence capacity records a gap without changing identity or settling lifecycle obligations", () => {
		const state = admitted();
		const before = structuredClone(state);
		const outputs: AuthorityFact<number>[] = [];

		for (const evidenceId of ["first", "overflow"])
			receiveEvidence(
				{ state, opts, outputs },
				{
					lane: "evidence",
					values: [
						{
							occurrence,
							evidenceKind: "proof",
							evidenceId,
							evidenceDigest: `sha256:${"b".repeat(64)}`,
							coverage: "included",
						},
					],
				},
			);
		expect(state.byRevision).toEqual(before.byRevision);
		expect(state.admissions).toEqual(before.admissions);
		expect(state.effects).toEqual(before.effects);
		expect(state.emittedTerminals).toEqual(before.emittedTerminals);
		expect(state.evidence.size).toBe(1);
		expect(outputs.at(-1)).toMatchObject({
			kind: "coverage",
			value: { complete: false, terminalGapKinds: ["proof"] },
		});
		expect(outputs.every((fact) => fact.kind === "issue" || fact.kind === "coverage")).toBe(true);
	});
});
