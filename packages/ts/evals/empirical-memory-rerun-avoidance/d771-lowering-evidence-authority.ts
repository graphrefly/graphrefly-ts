import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import { deriveD771ModelExposure } from "./d771-arm-aware-positive-gate.js";
import {
	consumeD771CriterionLoweringProposal,
	type D771CriterionLoweringProposalV1,
} from "./d771-criterion-continuation-lowering.js";
import type { D771CanonicalGraphEvidenceV1 } from "./d771-graph-completion-memory-insight.js";

export const D771_LOWERING_FACT_SCHEMA = "graphrefly.b112.d771.lowering-admission-fact.v1" as const;
export const D771_LOWERING_EVIDENCE_SCHEMA =
	"graphrefly.b112.d771.lowering-graph-evidence.v1" as const;

export interface D771LoweringAdmissionFactV1 {
	readonly schemaVersion: typeof D771_LOWERING_FACT_SCHEMA;
	readonly runSequence: number;
	readonly effectSequence: number;
	readonly requestDigest: string;
	readonly logicalRequestDigest: string;
	readonly attemptOrdinal: number;
	readonly contextDigest: string;
	readonly contextAdmissionDigest: string;
	readonly graphEvidenceDigest: string;
	readonly graphDirectiveDigest: string;
	readonly loweredBodyDigest: string;
	readonly requiredToolName: "replace_exact" | null;
	readonly conversationDigest: string;
	readonly modelVisibleMessagesDigest: string;
	readonly exposureEvidenceDigest: string;
	readonly admissionDigest: string;
	readonly resultDigest: string;
	readonly reconciliationDigest: string;
	readonly proposalDigest: string;
	readonly factDigest: string;
}

export interface D771LoweringGraphEvidenceV1 {
	readonly schemaVersion: typeof D771_LOWERING_EVIDENCE_SCHEMA;
	readonly facts: readonly D771LoweringAdmissionFactV1[];
	readonly evidenceDigest: string;
}

export interface D771LoweringEvidenceAuthorityV1 {
	readonly revision: "graphrefly.b112.d771.lowering-evidence-authority.v1";
}

const authorities = new WeakMap<
	object,
	{
		readonly proposalNode: ReturnType<ReturnType<typeof graph>["node"]>;
		readonly facts: D771LoweringAdmissionFactV1[];
	}
>();

function validateFact(value: unknown, path: string): D771LoweringAdmissionFactV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"admissionDigest",
			"attemptOrdinal",
			"contextDigest",
			"contextAdmissionDigest",
			"conversationDigest",
			"effectSequence",
			"exposureEvidenceDigest",
			"factDigest",
			"graphEvidenceDigest",
			"graphDirectiveDigest",
			"logicalRequestDigest",
			"loweredBodyDigest",
			"modelVisibleMessagesDigest",
			"proposalDigest",
			"reconciliationDigest",
			"requestDigest",
			"requiredToolName",
			"resultDigest",
			"runSequence",
			"schemaVersion",
		],
		path,
	);
	literal(candidate.schemaVersion, D771_LOWERING_FACT_SCHEMA, `${path}.schemaVersion`);
	safeInteger(candidate.runSequence, `${path}.runSequence`, { max: 11 });
	safeInteger(candidate.effectSequence, `${path}.effectSequence`, { max: 511 });
	safeInteger(candidate.attemptOrdinal, `${path}.attemptOrdinal`, { min: 1, max: 2 });
	for (const key of [
		"admissionDigest",
		"contextDigest",
		"contextAdmissionDigest",
		"conversationDigest",
		"exposureEvidenceDigest",
		"factDigest",
		"graphEvidenceDigest",
		"graphDirectiveDigest",
		"logicalRequestDigest",
		"loweredBodyDigest",
		"modelVisibleMessagesDigest",
		"proposalDigest",
		"reconciliationDigest",
		"requestDigest",
		"resultDigest",
	] as const)
		digest(candidate[key], `${path}.${key}`);
	if (candidate.requiredToolName !== null)
		literal(candidate.requiredToolName, "replace_exact", `${path}.requiredToolName`);
	const expectedDirectiveDigest = empiricalStrictJsonDigest({
		revision: "graphrefly.b112.d771.graph-criterion-route-directive.v1",
		requestDigest: candidate.requestDigest,
		admissionDigest: candidate.admissionDigest,
		contextAdmissionDigest: candidate.contextAdmissionDigest,
		contextDigest: candidate.contextDigest,
		conversationDigest: candidate.conversationDigest,
		modelVisibleMessagesDigest: candidate.modelVisibleMessagesDigest,
		exposureEvidenceDigest: candidate.exposureEvidenceDigest,
	});
	literal(candidate.graphDirectiveDigest, expectedDirectiveDigest, `${path}.graphDirectiveDigest`);
	const expectedProposalDigest = empiricalStrictJsonDigest({
		revision: "graphrefly.b112.d771.criterion-lowering-proposal.v1",
		requestDigest: candidate.requestDigest,
		logicalRequestDigest: candidate.logicalRequestDigest,
		attemptOrdinal: candidate.attemptOrdinal,
		contextDigest: candidate.contextDigest,
		contextAdmissionDigest: candidate.contextAdmissionDigest,
		graphDirectiveDigest: candidate.graphDirectiveDigest,
		loweredBodyDigest: candidate.loweredBodyDigest,
		requiredToolName: candidate.requiredToolName,
		conversationDigest: candidate.conversationDigest,
		modelVisibleMessagesDigest: candidate.modelVisibleMessagesDigest,
		exposureEvidenceDigest: candidate.exposureEvidenceDigest,
	});
	literal(candidate.proposalDigest, expectedProposalDigest, `${path}.proposalDigest`);
	const { factDigest, ...material } = candidate;
	literal(factDigest, empiricalStrictJsonDigest(material), `${path}.factDigest`);
	return strictSnapshot(candidate) as unknown as D771LoweringAdmissionFactV1;
}

function authorityState(authority: D771LoweringEvidenceAuthorityV1) {
	const state = authorities.get(authority);
	if (state === undefined) throw new TypeError("D771 lowering authority is not Graph-constructed");
	return state;
}

export function createD771LoweringEvidenceAuthority(): D771LoweringEvidenceAuthorityV1 {
	const owner = graph({ name: "d771/lowering-evidence-authority" });
	const proposalNode = owner.node<unknown>([], null, {
		name: "d771/lowering-proposals",
	});
	const admissionNode = owner.node<D771LoweringAdmissionFactV1>(
		[proposalNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", validateFact(raw, "d771.fact")]]);
		},
		{
			name: "d771/lowering-admissions",
			factory: "d771LoweringAdmission",
		},
	);
	const facts: D771LoweringAdmissionFactV1[] = [];
	admissionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		if (facts.length >= 128) throw new TypeError("D771 lowering fact bound exhausted");
		const fact = message[1] as D771LoweringAdmissionFactV1;
		if (
			facts.some(
				(candidate) =>
					candidate.graphEvidenceDigest === fact.graphEvidenceDigest &&
					candidate.requestDigest === fact.requestDigest,
			)
		)
			throw new TypeError("D771 lowering request was replayed");
		facts.push(fact);
	});
	const authority = Object.freeze({
		revision: "graphrefly.b112.d771.lowering-evidence-authority.v1" as const,
	});
	authorities.set(authority, { proposalNode, facts });
	return authority;
}

export function admitD771CriterionLowering(
	authority: D771LoweringEvidenceAuthorityV1,
	proposalValue: D771CriterionLoweringProposalV1,
	graphEvidence: D771CanonicalGraphEvidenceV1,
): D771LoweringAdmissionFactV1 {
	const state = authorityState(authority);
	const proposal = consumeD771CriterionLoweringProposal(proposalValue);
	if (proposal.graphDirectiveDigest === null || proposal.contextAdmissionDigest === null)
		throw new TypeError("D771 lowering proposal lacks Graph route directive provenance");
	const matches = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.request.requestDigest === proposal.requestDigest &&
			fact.request.logicalRequestDigest === proposal.logicalRequestDigest &&
			fact.request.attemptOrdinal === proposal.attemptOrdinal &&
			(fact.request.completionContext?.contextDigest ?? fact.request.logicalRequestDigest) ===
				proposal.contextDigest &&
			fact.result.effectKind === "provider-request"
				? [{ run, fact }]
				: [],
		),
	);
	if (matches.length !== 1)
		throw new TypeError("D771 lowering proposal lacks one exact admitted Graph result");
	const match = matches[0]!;
	const admissions = graphEvidence.ledger.effectAdmissions.filter(
		(admission) => admission.decisionDigest === match.fact.admissionDigest,
	);
	const reconciliations = graphEvidence.ledger.effectReconciliations.filter(
		(reconciliation) => reconciliation.admissionDigest === match.fact.admissionDigest,
	);
	if (admissions.length !== 1 || reconciliations.length !== 1)
		throw new TypeError("D771 lowering proposal lacks exact admission and reconciliation");
	const armFacts = graphEvidence.ledger.facts.filter(
		(fact) => fact.issuedRequestDigest === match.run.issuedRequestDigest,
	);
	if (armFacts.length !== 1)
		throw new TypeError("D771 lowering proposal lacks exact arm provenance");
	const expectedExposure = deriveD771ModelExposure(armFacts[0]!.arm, match.fact.request);
	if (
		proposal.conversationDigest !== expectedExposure.conversationDigest ||
		proposal.modelVisibleMessagesDigest !== expectedExposure.modelVisibleMessagesDigest ||
		proposal.exposureEvidenceDigest !== expectedExposure.evidenceDigest
	)
		throw new TypeError("D771 lowering proposal model exposure drifted");
	const originalAttempt = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.request.logicalRequestDigest === proposal.logicalRequestDigest &&
			fact.request.attemptOrdinal === 1
				? [fact]
				: [],
		),
	);
	if (originalAttempt.length !== 1)
		throw new TypeError("D771 lowering proposal original admission drifted");
	const expectedContextAdmissionDigest =
		proposal.attemptOrdinal === 1
			? match.fact.admissionDigest
			: originalAttempt[0]!.admissionDigest;
	if (proposal.contextAdmissionDigest !== expectedContextAdmissionDigest)
		throw new TypeError("D771 lowering proposal context admission drifted");
	const expectedRequiredTool =
		match.fact.request.completionContext?.reason === "public-semantic-validation-failed"
			? "replace_exact"
			: null;
	if (proposal.requiredToolName !== expectedRequiredTool)
		throw new TypeError("D771 lowering proposal tool disposition drifted");
	const material = strictSnapshot({
		schemaVersion: D771_LOWERING_FACT_SCHEMA,
		runSequence: match.run.runSequence,
		effectSequence: admissions[0]!.effectSequence,
		requestDigest: proposal.requestDigest,
		logicalRequestDigest: proposal.logicalRequestDigest,
		attemptOrdinal: proposal.attemptOrdinal,
		contextDigest: proposal.contextDigest,
		contextAdmissionDigest: proposal.contextAdmissionDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		graphDirectiveDigest: proposal.graphDirectiveDigest,
		loweredBodyDigest: proposal.loweredBodyDigest,
		requiredToolName: proposal.requiredToolName,
		conversationDigest: proposal.conversationDigest,
		modelVisibleMessagesDigest: proposal.modelVisibleMessagesDigest,
		exposureEvidenceDigest: proposal.exposureEvidenceDigest,
		admissionDigest: match.fact.admissionDigest,
		resultDigest: match.fact.resultDigest,
		reconciliationDigest: reconciliations[0]!.reconciliationDigest,
		proposalDigest: proposal.proposalDigest,
	});
	const candidate = strictSnapshot({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	});
	const before = state.facts.length;
	state.proposalNode.down([["DATA", candidate]]);
	const admitted = state.facts[before];
	if (admitted === undefined || state.facts.length !== before + 1)
		throw new TypeError("D771 Graph omitted lowering admission");
	return admitted;
}

export function snapshotD771LoweringGraphEvidence(
	authority: D771LoweringEvidenceAuthorityV1,
): D771LoweringGraphEvidenceV1 {
	const state = authorityState(authority);
	const material = strictSnapshot({
		schemaVersion: D771_LOWERING_EVIDENCE_SCHEMA,
		facts: state.facts,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function validateD771LoweringGraphEvidence(
	value: unknown,
	graphsValue: readonly D771CanonicalGraphEvidenceV1[],
): D771LoweringGraphEvidenceV1 {
	const candidate = record(value, "d771.loweringEvidence");
	exactKeys(candidate, ["evidenceDigest", "facts", "schemaVersion"], "d771.loweringEvidence");
	literal(candidate.schemaVersion, D771_LOWERING_EVIDENCE_SCHEMA, "d771.loweringEvidence.schema");
	const rawFacts = array(candidate.facts, "d771.loweringEvidence.facts");
	if (rawFacts.length < 1 || rawFacts.length > 128)
		throw new TypeError("D771 lowering evidence coverage drifted");
	const facts = Object.freeze(
		rawFacts.map((fact, index) => validateFact(fact, `d771.loweringEvidence.facts[${index}]`)),
	);
	if (
		new Set(facts.map((fact) => `${fact.graphEvidenceDigest}:${fact.requestDigest}`)).size !==
		facts.length
	)
		throw new TypeError("D771 lowering evidence request replayed");
	const rawGraphs = array(graphsValue, "d771.loweringEvidence.graphs");
	if (rawGraphs.length !== 2) throw new TypeError("D771 lowering Graph coverage drifted");
	const graphs = rawGraphs as unknown as readonly D771CanonicalGraphEvidenceV1[];
	const expected = graphs.flatMap((graphEvidence) =>
		graphEvidence.effectRuns.flatMap((run) =>
			run.facts.flatMap((graphFact) =>
				graphFact.kind === "graph-effect-result-admitted" &&
				graphFact.request.effectKind === "provider-request"
					? [`${graphEvidence.evidenceDigest}:${graphFact.request.requestDigest}`]
					: [],
			),
		),
	);
	if (
		expected.length !== facts.length ||
		expected.some(
			(key, index) => `${facts[index]?.graphEvidenceDigest}:${facts[index]?.requestDigest}` !== key,
		)
	)
		throw new TypeError("D771 lowering evidence does not preserve exact Graph provider order");
	for (const [index, fact] of facts.entries()) {
		const matches = graphs.flatMap((graphEvidence) =>
			graphEvidence.evidenceDigest === fact.graphEvidenceDigest
				? graphEvidence.effectRuns.flatMap((run) =>
						run.facts.flatMap((graphFact) =>
							graphFact.kind === "graph-effect-result-admitted" &&
							graphFact.request.requestDigest === fact.requestDigest &&
							graphFact.admissionDigest === fact.admissionDigest &&
							graphFact.resultDigest === fact.resultDigest
								? [{ graphEvidence, run, graphFact }]
								: [],
						),
					)
				: [],
		);
		if (matches.length !== 1) throw new TypeError(`D771 lowering fact ${index} is not Graph-bound`);
		const match = matches[0]!;
		const armFacts = match.graphEvidence.ledger.facts.filter(
			(value) => value.issuedRequestDigest === match.run.issuedRequestDigest,
		);
		if (armFacts.length !== 1)
			throw new TypeError(`D771 lowering fact ${index} arm provenance drifted`);
		const expectedExposure = deriveD771ModelExposure(armFacts[0]!.arm, match.graphFact.request);
		const expectedOriginal = match.graphEvidence.effectRuns.flatMap((run) =>
			run.facts.flatMap((value) =>
				value.kind === "graph-effect-result-admitted" &&
				value.request.effectKind === "provider-request" &&
				value.request.logicalRequestDigest === fact.logicalRequestDigest &&
				value.request.attemptOrdinal === 1
					? [value]
					: [],
			),
		);
		const expectedContextAdmissionDigest =
			fact.attemptOrdinal === 1
				? match.graphFact.admissionDigest
				: expectedOriginal.length === 1
					? expectedOriginal[0]!.admissionDigest
					: null;
		const expectedRequiredTool =
			match.graphFact.request.completionContext?.reason === "public-semantic-validation-failed"
				? "replace_exact"
				: null;
		const matchedAdmissions = match.graphEvidence.ledger.effectAdmissions.filter(
			(admission) => admission.decisionDigest === fact.admissionDigest,
		);
		if (
			fact.runSequence !== match.run.runSequence ||
			matchedAdmissions.length !== 1 ||
			fact.effectSequence !== matchedAdmissions[0]!.effectSequence ||
			fact.logicalRequestDigest !== match.graphFact.request.logicalRequestDigest ||
			fact.attemptOrdinal !== match.graphFact.request.attemptOrdinal ||
			fact.contextDigest !==
				(match.graphFact.request.completionContext?.contextDigest ??
					match.graphFact.request.logicalRequestDigest) ||
			fact.contextAdmissionDigest !== expectedContextAdmissionDigest ||
			fact.requiredToolName !== expectedRequiredTool ||
			fact.conversationDigest !== expectedExposure.conversationDigest ||
			fact.modelVisibleMessagesDigest !== expectedExposure.modelVisibleMessagesDigest ||
			fact.exposureEvidenceDigest !== expectedExposure.evidenceDigest
		)
			throw new TypeError(`D771 lowering fact ${index} Graph coordinates drifted`);
		const reconciliations = graphs
			.filter((graphEvidence) => graphEvidence.evidenceDigest === fact.graphEvidenceDigest)
			.flatMap((graphEvidence) =>
				graphEvidence.ledger.effectReconciliations.filter(
					(reconciliation) => reconciliation.admissionDigest === fact.admissionDigest,
				),
			);
		if (
			reconciliations.length !== 1 ||
			reconciliations[0]?.reconciliationDigest !== fact.reconciliationDigest
		)
			throw new TypeError(`D771 lowering fact ${index} reconciliation drifted`);
	}
	const groups = new Map<string, D771LoweringAdmissionFactV1[]>();
	for (const fact of facts)
		groups.set(`${fact.graphEvidenceDigest}:${fact.logicalRequestDigest}`, [
			...(groups.get(`${fact.graphEvidenceDigest}:${fact.logicalRequestDigest}`) ?? []),
			fact,
		]);
	const retried = [...groups.values()].filter((group) => group.length === 2);
	if (
		retried.length !== 2 ||
		[...retried.map((group) => group[0]?.requiredToolName)]
			.sort((left, right) => String(left).localeCompare(String(right)))
			.join(",") !== ",replace_exact" ||
		retried.some(
			(group) =>
				group[0]?.attemptOrdinal !== 1 ||
				group[1]?.attemptOrdinal !== 2 ||
				group[0]?.contextDigest !== group[1]?.contextDigest ||
				group[0]?.contextAdmissionDigest !== group[0]?.admissionDigest ||
				group[1]?.contextAdmissionDigest !== group[0]?.admissionDigest ||
				group[0]?.loweredBodyDigest !== group[1]?.loweredBodyDigest,
		) ||
		[...groups.values()].some((group) => group.length > 2)
	)
		throw new TypeError("D771 lowering retry identity drifted");
	const material = strictSnapshot({ schemaVersion: D771_LOWERING_EVIDENCE_SCHEMA, facts });
	literal(
		candidate.evidenceDigest,
		empiricalStrictJsonDigest(material),
		"d771.loweringEvidence.digest",
	);
	return Object.freeze({ ...material, evidenceDigest: candidate.evidenceDigest as string });
}
