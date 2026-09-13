import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
	CausalEvidence,
	CausalOccurrence,
	IdentityDomain,
	TransitionContext,
} from "../solutions/causal-occurrence/contracts.js";
import { isEvidenceTerminal } from "../solutions/causal-occurrence/evidence.js";
import {
	canonicalSnapshot,
	sameRef,
	terminalCoverage,
} from "../solutions/causal-occurrence/identity.js";
import { transitionCausalAuthority } from "../solutions/causal-occurrence/transition.js";

function context(): TransitionContext<number> {
	const opts = {
		requiredBranches: [],
		requiredEvidenceKinds: ["a", "b"],
		maxOccurrences: 100,
		maxPending: 100,
		maxEffects: 100,
		maxEvidence: 100,
	};
	return {
		state: transitionCausalAuthority<number>(undefined, [], opts).state,
		opts,
		outputs: [],
		committedViewChanged: false,
	};
}
function occurrence(id: string, revision = 1): CausalOccurrence<number> {
	return canonicalSnapshot({
		revisionDomain: "run",
		occurrenceId: id,
		revision,
		digest: `sha256:${"a".repeat(64)}`,
		sourceRefs: [{ kind: "source", id }],
		value: 1,
	});
}
function evidence(
	o: CausalOccurrence<number>,
	kind: string,
	coverage: CausalEvidence["coverage"] = "included",
): CausalEvidence {
	return canonicalSnapshot({
		occurrence: o,
		evidenceId: "e",
		evidenceKind: kind,
		evidenceDigest: `sha256:${"b".repeat(64)}`,
		coverage,
	});
}
function domain(occurrences: CausalOccurrence<number>[]): IdentityDomain<number> {
	return { watermark: 2, occurrences, sequenceComplete: true, latestAdmitted: new Map() };
}
// Frozen pre-optimization expression: checks semantic equivalence, not the new map layout.
function original(c: TransitionContext<number>, d: IdentityDomain<number>) {
	return (
		![...c.state.pendingEvidence.values()].some(
			(e) => e.occurrence.revisionDomain === "run" && e.occurrence.revision <= d.watermark,
		) &&
		d.occurrences.every((o) =>
			c.opts.requiredEvidenceKinds.every((k) =>
				[...c.state.evidence.values(), ...c.state.coverageGaps.values()].some(
					(e) =>
						sameRef(e.occurrence, o) && e.evidenceKind === k && terminalCoverage.has(e.coverage),
				),
			),
		)
	);
}

describe("D160 retained evidence terminal query", () => {
	it("matches the prior predicate across gaps, duplicate kinds, domains and pending evidence", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.tuple(
						fc.integer({ min: 0, max: 4 }),
						fc.constantFrom("a", "b", "optional"),
						fc.constantFrom("included", "retention-gap", "unavailable"),
						fc.boolean(),
					),
					{ maxLength: 30 },
				),
				fc.integer({ min: 0, max: 5 }),
				fc.boolean(),
				(entries, count, pending) => {
					const c = context();
					const os = Array.from({ length: 5 }, (_, i) => occurrence(`id:${i}`));
					entries.forEach(([i, k, coverage, gap], n) => {
						(gap ? c.state.coverageGaps : c.state.evidence).set(
							String(n),
							evidence(os[i]!, k, coverage as CausalEvidence["coverage"]),
						);
					});
					if (pending)
						c.state.pendingEvidence.set("pending", evidence(occurrence("later", 3), "a"));
					c.state.evidence.set("foreign", evidence({ ...os[0]!, revisionDomain: "other" }, "a"));
					const d = domain(os.slice(0, count));
					const before = structuredClone(c);
					expect(isEvidenceTerminal(c, "run", d)).toBe(original(c, d));
					expect(c).toEqual(before);
				},
			),
			{ numRuns: 500, seed: 160 },
		);
	});
	it("requires exact content identity after restore, including source order and extra data", () => {
		const o = occurrence("a:b");
		for (const changed of [
			{ revisionDomain: "other" },
			{ occurrenceId: "a" },
			{ revision: 2 },
			{ digest: `sha256:${"c".repeat(64)}` },
			{ sourceRefs: [{ kind: "source", id: "different" }] },
			{ sourceRefs: [{ kind: "source", id: "a:b", extra: true }] },
		]) {
			const c = context();
			c.state.evidence.set("a", evidence(o, "a"));
			c.state.evidence.set("b", evidence({ ...o, ...changed }, "b"));
			expect(isEvidenceTerminal(c, "run", domain([o]))).toBe(false);
		}
		const c = context();
		for (const k of ["a", "b"])
			c.state.coverageGaps.set(k, evidence(structuredClone(o), k, "retention-gap"));
		expect(isEvidenceTerminal(c, "run", domain([o]))).toBe(true);
		c.state.pendingEvidence.set("pending", evidence(o, "a"));
		expect(isEvidenceTerminal(c, "run", domain([o]))).toBe(false);
		c.state.pendingEvidence.clear();
		expect(isEvidenceTerminal(c, "run", domain([o]))).toBe(true);
	});
	it("preserves source order and pending checks with empty requirements", () => {
		const c = context();
		const o = canonicalSnapshot({
			...occurrence("ordered"),
			sourceRefs: [
				{ kind: "s", id: "a" },
				{ kind: "s", id: "b" },
			],
		});
		c.state.evidence.set("a", evidence(o, "a"));
		c.state.evidence.set("b", evidence({ ...o, sourceRefs: [...o.sourceRefs].reverse() }, "b"));
		expect(isEvidenceTerminal(c, "run", domain([o]))).toBe(false);
		c.state.evidence.set("b", evidence(structuredClone(o), "b"));
		c.state.pendingEvidence.set("foreign", evidence({ ...o, revisionDomain: "other" }, "a"));
		expect(isEvidenceTerminal(c, "run", domain([o]))).toBe(true);
		const empty = { ...c, opts: { ...c.opts, requiredEvidenceKinds: [] } };
		expect(isEvidenceTerminal(empty, "run", domain([o]))).toBe(true);
		c.state.pendingEvidence.set("active", evidence(o, "a"));
		expect(isEvidenceTerminal(empty, "run", domain([o]))).toBe(false);
		expect(isEvidenceTerminal(c, "run", domain([]))).toBe(false);
	});
});
