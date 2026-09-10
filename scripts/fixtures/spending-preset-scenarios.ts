/** Frozen consumer scenario construction. Oracle work and fixture issuance happen outside timing. */
import type { Evaluation } from "../../examples/spending-alerts/causal-inputs.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
} from "./spending-preset-harness.js";
import {
	oracleCanonical as canonical,
	oracleFreeze as freeze,
	oracleBusiness,
	oracleHash,
} from "./spending-preset-oracle.js";
import type { ReferenceLane } from "./spending-preset-reference-input.js";
export interface InputStep {
	lane: ReferenceLane;
	values: unknown[];
}
export function rebindEvaluation(
	base: Evaluation,
	change: Partial<Omit<Evaluation, "occurrence">> = {},
	domain = base.occurrence.revisionDomain,
	revision = base.occurrence.revision,
): Evaluation {
	const { occurrence: old, ...initial } = base;
	const value = { ...initial, ...change };
	value.inputDigest = oracleHash(
		canonical({ profileRef: value.profileRef, profile: value.profile, prefix: value.prefix }),
	);
	value.policyDigest = oracleHash(canonical(value.policy));
	const { digest: _digest, ...ref } = old;
	const identity = { ...ref, revisionDomain: domain, revision };
	return freeze({
		...value,
		occurrence: {
			...identity,
			digest: oracleHash(
				canonical({
					schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
					...identity,
					value,
				}),
			),
		},
	});
}
export const PERF_PROFILES = [
	{ id: "P1", count: 1, prefix: 1 },
	{ id: "P2", count: 1, prefix: 64 },
	{ id: "P3", count: 16, prefix: 16 },
	{ id: "P4", count: 64, prefix: 1 },
	{ id: "P5", count: 64, prefix: 64 },
	{ id: "P6", count: 64, prefix: 64 },
] as const;
export function profileScenario(id: (typeof PERF_PROFILES)[number]["id"]) {
	const p = PERF_PROFILES.find((p) => p.id === id)!;
	const evaluations = Array.from({ length: p.count }, (_, i) => {
		let e = evaluationFixture(
			i,
			i % 2 ? "tea" : "coffee",
			p.prefix,
			id === "P2" || id === "P6" || i % 2 === 1,
		);
		if (id === "P4" && i % 2 === 1)
			e = rebindEvaluation(e, { prefix: e.prefix.map((t) => ({ ...t, category: "unfamiliar" })) });
		if (id === "P5" && i % 2 === 0)
			e = rebindEvaluation(e, { policy: { ...e.policy, zThreshold: oracleBusiness(e).zScore } });
		// Independent occurrence domains permit all declared evaluations to be simultaneously current.
		return rebindEvaluation(e, {}, `profile-${id}-${i}`, 1);
	});
	const facts = evaluations.map((e) => policyFacts(e));
	const combined = {
		current: { binding: presetBinding, current: facts.flatMap((f) => f.current.current) },
		verification: {
			binding: presetBinding,
			receipts: facts.flatMap((f) => f.verification.receipts),
		},
		local: {
			binding: presetBinding,
			tick: 1,
			stop: false,
			grants: facts.flatMap((f) => f.local.grants),
		},
		inbox: facts[0].inbox,
	};
	const arrivals = {
		packRef: presetBinding.packRef,
		evaluationRefs: (id === "P6" ? [...evaluations].reverse() : evaluations).map(
			(e) => e.evaluationRef,
		),
	};
	const setup: InputStep[] = [
		{ lane: "pack", values: [evaluationPack(evaluations)] },
		{ lane: "current", values: [combined.current] },
		{ lane: "local", values: [combined.local] },
		{ lane: "inbox", values: [combined.inbox] },
	];
	const receipt = { lane: "verification" as const, values: [combined.verification] },
		arrival = { lane: "arrivals" as const, values: [arrivals] };
	const steps =
		id === "P6"
			? [
					...setup,
					arrival,
					{
						lane: "verification" as const,
						values: [
							{
								...combined.verification,
								receipts: [...combined.verification.receipts].reverse().slice(0, 32),
							},
							{
								...combined.verification,
								receipts: [...combined.verification.receipts].reverse().slice(32),
							},
						],
					},
					receipt,
				]
			: [...setup, receipt, arrival];
	return freeze({ id, evaluations, combined, arrivals, setup, steps });
}
