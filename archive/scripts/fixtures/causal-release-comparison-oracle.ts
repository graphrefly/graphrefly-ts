/** Independent P2 projection, using the existing plain instance; zero Graph access/factories. */
import assert from "node:assert/strict";
import type { PlainSpending } from "./spending-preset-plain.js";
import { oracleCanonical, oracleRows } from "./spending-publication-oracle.js";
export function expectedSnapshot(plain: PlainSpending) {
	const evaluations = [...plain.evaluations.values()];
	assert.equal(evaluations.length, 1);
	assert.equal(plain.issues.length, 0);
	const e = evaluations[0],
		business = plain.assessments.get(e.evaluationRef)!;
	const effects = plain.snapshot(),
		evidence = plain.evidenceSnapshot();
	const { runRef: _run, evidenceMode: _mode, ...profile } = plain.binding;
	const committed = {
		kind: "causal-committed-effects" as const,
		authorityId: "spending/causal/authority",
		binding: {
			contract: "contract-v2" as const,
			implementationRevision: "construction-v1" as const,
			scope: "full" as const,
			epoch: plain.binding.compositionEpoch,
		},
		effects: effects.map((r) => ({
			proposal: r.proposal,
			...(r.admission ? { admission: r.admission } : {}),
			...(r.outcome ? { outcome: r.outcome } : {}),
		})),
		retention: [],
	};
	const publicationRows = oracleRows(committed, [...plain.materials.values()]);
	const admitted = effects.filter((r) => r.admission?.state === "admitted");
	const count = (state: string) => admitted.filter((r) => r.outcome?.state === state).length;
	const required = ["spending-input", "spending-code-binding", "spending-verification"];
	const byKind = new Map(evidence.map((v) => [v.evidenceKind, v]));
	const missingKinds = required.filter((k) => !byKind.has(k));
	return {
		effects,
		evidence: evidence.map((x) => oracleCanonical(x)).sort(),
		obligations: plain
			.obligationSnapshot()
			.map((x) => oracleCanonical(x))
			.sort(),
		view: {
			startup: {
				kind: "graph-startup",
				instance: "spending",
				epoch: plain.binding.compositionEpoch,
				state: "started",
			},
			assessment: {
				rows: [
					{
						evaluation: e,
						value: {
							kind: "spending-alerts/assessment",
							evidenceMode: "fixture-observations",
							binding: plain.binding,
							evaluationRef: e.evaluationRef,
							occurrence: e.occurrence,
							inputDigest: e.inputDigest,
							policyDigest: e.policyDigest,
							flagged: business.flagged,
							score: business.score,
							reason: business.reason,
							message: business.message,
						},
					},
				],
				issues: [],
				valid: true,
			},
			publication: {
				kind: "spending-alerts/publication",
				authorityId: committed.authorityId,
				binding: committed.binding,
				asOf: profile,
				retention: [],
				materialFrame: "valid",
				unmatchedMaterials:
					plain.materials.size - publicationRows.filter((r) => r.material === "matched").length,
				rows: publicationRows,
			},
			coverage: {
				kind: "causal-evidence-coverage",
				occurrence: e.occurrence,
				complete: missingKinds.length === 0,
				entries: evidence,
				missingKinds,
				terminalGapKinds: required.filter((k) => {
					const v = byKind.get(k);
					return v && v.coverage !== "included" && v.coverage !== "external-only";
				}),
			},
			conservation: {
				kind: "causal-effect-conservation",
				occurrence: e.occurrence,
				proposed: effects.length,
				pendingAdmission: effects.filter((r) => r.admission === null).length,
				rejected: effects.filter((r) => r.admission?.state === "rejected").length,
				admitted: admitted.length,
				active: admitted.filter((r) => r.outcome === null).length,
				succeeded: count("succeeded"),
				failed: count("failed"),
				cancelled: count("cancelled"),
				reconcileRequired: count("reconcile-required"),
				unknown: count("unknown"),
			},
		},
	};
}
