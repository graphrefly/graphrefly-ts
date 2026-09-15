/** D164 internal cold seam. Not the final qualified-inbox creating factory; no effect methods. */
import { depBatch } from "../../packages/ts/src/ctx/types.js";
import type { DataIssue } from "../../packages/ts/src/data/index.js";
import type {
	ConstructionScope,
	StartupFact,
} from "../../packages/ts/src/graph/construction-scope.js";
import type { Graph } from "../../packages/ts/src/graph/graph.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import {
	assertCausalCapabilities,
	type CausalBinding,
} from "../../packages/ts/src/solutions/causal-occurrence/capabilities.js";
import {
	assertCausalOccurrenceTopology,
	causalColdNodeNames,
	prepareCausalOptions,
} from "../../packages/ts/src/solutions/causal-occurrence/construction.js";
import { buildAdmission } from "./causal-admission.js";
import { buildBusiness, nodeMaker } from "./causal-business.js";
import {
	frozen,
	materialProfile,
	type SpendingBinding,
	type SpendingInputs,
	validateBinding,
} from "./causal-inputs.js";
import { buildMaterials } from "./causal-material-owner.js";
import { buildSpendingPublication } from "./causal-publication.js";

export const BUSINESS_NAMES = Object.freeze([
	"evaluationSelections",
	"transaction",
	"vendorStats",
	"userProfile",
	"policy",
	"currentFacts",
	"verificationFacts",
	"localFacts",
	"inboxFacts",
	"anomalyScore",
	"thresholdGate",
	"reasonFactors",
	"alertMessage",
	"assessment",
	"requestMaterials",
	"materialStore",
	"materialSnapshot",
	"effectProposals",
	"publicationPolicy",
	"occurrences",
	"occurrenceAdmissions",
	"branchTerminals",
	"effectAdmissions",
	"effectOutcomes",
	"evidence",
	"watermarks",
	"consumerIssues",
]);
export function spendingNodeNames(
	name: string,
	diagnostics: "off" | "summary" = "off",
): readonly string[] {
	return Object.freeze([
		`${name}/startup`,
		...BUSINESS_NAMES.map((n) => `${name}/${n}`),
		...causalColdNodeNames(`${name}/causal`),
		"requestMaterialJoin",
		"publication",
		...(diagnostics === "summary" ? [`${name}/diagnosticSummary`] : []),
	]);
}
export function spendingInputNodes(inputs: SpendingInputs): readonly Node<unknown>[] {
	if (
		!inputs ||
		Object.keys(inputs).sort().join(",") !== "evaluations,inbox,localAuthority,verification" ||
		Object.keys(inputs.evaluations).sort().join(",") !== "arrivals,current,pack" ||
		Object.keys(inputs.verification).join(",") !== "receipts" ||
		Object.keys(inputs.localAuthority).join(",") !== "facts" ||
		Object.keys(inputs.inbox).join(",") !== "facts"
	)
		throw new TypeError("spending requires four exact input groups");
	const nodes = [
		inputs.evaluations.pack,
		inputs.evaluations.arrivals,
		inputs.evaluations.current,
		inputs.verification.receipts,
		inputs.localAuthority.facts,
		inputs.inbox.facts,
	];
	if (nodes.some((n) => !n) || new Set(nodes).size !== 6)
		throw new TypeError("spending requires six distinct input nodes");
	return Object.freeze(nodes);
}
export function buildSpendingPresetNodes(
	ownerGraph: Graph,
	scope: ConstructionScope,
	startup: Node<StartupFact>,
	inputs: SpendingInputs,
	rawBinding: SpendingBinding,
	name: string,
	diagnostics: "off" | "summary" = "off",
) {
	if (diagnostics !== "off" && diagnostics !== "summary")
		throw new TypeError("spending diagnostics");
	const binding = validateBinding(rawBinding);
	spendingInputNodes(inputs);
	scope.assertContext(ownerGraph, startup, binding.compositionEpoch);
	const edges = new Map<Node<unknown>, readonly Node<unknown>[]>(),
		make = nodeMaker(scope, name, edges);
	const business = buildBusiness(make, inputs, binding),
		materials = buildMaterials(make, business, binding),
		admission = buildAdmission(make, inputs, binding, business, materials);
	const causalBinding: CausalBinding = {
		contract: "contract-v2",
		implementationRevision: "construction-v1",
		scope: "full",
		epoch: binding.compositionEpoch,
	};
	const publication = buildSpendingPublication(
		ownerGraph,
		scope,
		startup,
		prepareCausalOptions({
			name: `${name}/causal`,
			occurrences: admission.occurrences,
			admissions: admission.occurrenceAdmissions,
			branchTerminals: admission.branchTerminals,
			effectProposals: materials.effectProposals,
			effectAdmissions: admission.effectAdmissions,
			effectOutcomes: admission.effectOutcomes,
			evidence: admission.evidence,
			watermarks: admission.watermarks,
			requiredBranches: ["assessment", "explanation", "publication-policy"],
			requiredEvidenceKinds: ["spending-input", "spending-code-binding", "spending-verification"],
			maxOccurrences: 64,
			maxPending: 64,
			maxEffects: 64,
			maxEvidence: 512,
		}),
		causalBinding,
		materials.materialSnapshot,
		materialProfile(binding),
	);
	const consumerIssues = make<DataIssue>(
		"consumerIssues",
		[
			business.evaluationSelections,
			admission.currentFacts,
			admission.verificationFacts,
			admission.localFacts,
			admission.inboxFacts,
			materials.requestMaterials,
			materials.materialStore,
			admission.publicationPolicy,
			publication.causal.ports.issues,
		],
		(ctx) => {
			for (let i = 0; i < 9; i++)
				for (const raw of depBatch(ctx, i) ?? []) {
					const value = raw as { kind?: string; issue?: DataIssue; issues?: readonly DataIssue[] };
					if (value.kind === "issue") ctx.down([["DATA", raw]]);
					else {
						if (value.issue) ctx.down([["DATA", value.issue]]);
						for (const issue of value.issues ?? []) ctx.down([["DATA", issue]]);
					}
				}
		},
	);
	const view = Object.freeze({
		assessment: business.assessment,
		publication: publication.publication,
		coverage: publication.causal.ports.coverage,
		issues: consumerIssues,
		startup,
	});
	const consume = Object.freeze({ view, capabilities: publication.causal.full });
	assertCausalCapabilities(ownerGraph, consume.capabilities, causalBinding);
	const diagnosticSummary =
		diagnostics === "summary"
			? make(
					"diagnosticSummary",
					[view.assessment, view.publication, view.coverage, view.issues],
					(ctx) => {
						const arrivals = ctx.waveData.map((_, i) => depBatch(ctx, i)?.length ?? 0);
						ctx.down([["DATA", frozen({ kind: "spending-diagnostic-summary", arrivals })]]);
					},
				)
			: undefined;
	// Assert actual cold edges. The expected references are not a synthetic describe snapshot.
	for (const [node, expected] of edges)
		if (node.deps.length !== expected.length || node.deps.some((dep, i) => dep !== expected[i]))
			throw new TypeError("spending cold topology mismatch");
	assertCausalOccurrenceTopology(scope.readIncoming(), `${name}/causal`);
	return Object.freeze({
		consume,
		roots: publication.causal.roots,
		diagnosticSummary,
		business,
		materials,
		admission,
		publication,
	});
}
export type SpendingAlertsView = ReturnType<typeof buildSpendingPresetNodes>["consume"]["view"];
