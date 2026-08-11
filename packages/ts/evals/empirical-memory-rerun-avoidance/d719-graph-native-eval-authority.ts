import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import type { AgentRequestIssued } from "../../src/orchestration/agent-runtime.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type D716Arm,
	type D716GraphNativeSixArmCoordinatorV1,
	type D716RequestInput,
	isConstructedD716GraphNativeSixArmCoordinator,
	isD716ActiveGraphNativeArmRequest,
	isD716GraphNativeArmCompletionAccepted,
} from "./d716-graph-native-live-coordinator.js";

export const D719_GRAPH_NATIVE_EVAL_AUTHORITY_REVISION =
	"graphrefly.b112.d719.eval-evidence-authority.v1" as const;
export const D719_GRAPH_NATIVE_BUDGET_EVIDENCE_SCHEMA =
	"graphrefly.b112.d719.graph-native-budget-evidence.v1" as const;

export const D719_BUDGET_DECISION_REASONS = Object.freeze({
	pendingReservation: "pending-reservation",
	requestLimit: "request-limit",
	stepLimit: "step-limit",
	canonicalRequestBytes: "canonical-request-bytes",
	inputTokenReservation: "input-token-reservation",
	outputTokenReservation: "output-token-reservation",
	costReservation: "cost-reservation",
	elapsedBudget: "elapsed-budget",
} as const);

export type D719BudgetDecisionReason =
	(typeof D719_BUDGET_DECISION_REASONS)[keyof typeof D719_BUDGET_DECISION_REASONS];

export interface D719BudgetStateFactV1 {
	readonly requests: number;
	readonly currentRunRequestCount: number;
	readonly requestAlreadySeen: boolean;
	readonly pendingReservation: boolean;
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly reservedCostMicrousd: number;
	readonly latencyMs: number;
}

export interface D719BudgetLimitsFactV1 {
	readonly maxRequests: number;
	readonly maxStepsPerRun: number;
	readonly maxCanonicalRequestBytes: number;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly maxCostMicrousd: number;
	readonly maxLatencyMs: number;
	readonly enforceElapsedAdmission: boolean;
}

export interface D719TransportAdmissionFactV1 {
	readonly kind: "transport-admission" | "retry-admission";
	readonly sequence: number;
	readonly arm: D716Arm;
	readonly issuedArmRequestDigest: string;
	readonly requestRef: string;
	readonly wireRequestBytes: number;
	readonly maxOutputTokens: number;
	readonly reservedInputTokens: number;
	readonly reservedCostMicrousd: number;
	readonly prospectiveInputTokens: number;
	readonly prospectiveOutputTokens: number;
	readonly prospectiveCostMicrousd: number;
	readonly state: D719BudgetStateFactV1;
	readonly limits: D719BudgetLimitsFactV1;
}

export interface D719OutcomeReconciliationFactV1 {
	readonly kind: "outcome-reconciliation";
	readonly sequence: number;
	readonly arm: D716Arm;
	readonly issuedArmRequestDigest: string;
	readonly requestRef: string;
	readonly state: D719BudgetStateFactV1;
	readonly limits: D719BudgetLimitsFactV1;
}

export interface D719ElapsedCheckFactV1 {
	readonly kind: "elapsed-check";
	readonly sequence: number;
	readonly arm: D716Arm;
	readonly issuedArmRequestDigest: string;
	readonly requestRef: "block";
	readonly measuredElapsedMs: number;
	readonly deadlineSignalAborted: boolean;
	readonly state: D719BudgetStateFactV1;
	readonly limits: D719BudgetLimitsFactV1;
}

export interface D719RetryWaitFactV1 {
	readonly kind: "retry-wait";
	readonly sequence: number;
	readonly arm: D716Arm;
	readonly issuedArmRequestDigest: string;
	readonly requestRef: string;
	readonly waitedMs: number;
	readonly state: D719BudgetStateFactV1;
	readonly limits: D719BudgetLimitsFactV1;
}

export type D719BudgetFactV1 =
	| D719TransportAdmissionFactV1
	| D719OutcomeReconciliationFactV1
	| D719ElapsedCheckFactV1
	| D719RetryWaitFactV1;
export type D719BudgetFactInputV1 = D719BudgetFactV1 extends infer Fact
	? Fact extends { readonly sequence: number }
		? Omit<Fact, "arm" | "issuedArmRequestDigest" | "sequence">
		: never
	: never;

export interface D719BudgetDecisionProjectionV1 {
	readonly kind: D719BudgetFactV1["kind"];
	readonly sequence: number;
	readonly arm: D716Arm;
	readonly issuedArmRequestDigest: string;
	readonly requestRef: string;
	readonly admitted: boolean;
	readonly exhausted: boolean;
	readonly reasons: readonly D719BudgetDecisionReason[];
	readonly factDigest: string;
	readonly decisionDigest: string;
}

export interface D719GraphNativeBudgetEvidenceV1 {
	readonly schemaVersion: typeof D719_GRAPH_NATIVE_BUDGET_EVIDENCE_SCHEMA;
	readonly authorityRevision: typeof D719_GRAPH_NATIVE_EVAL_AUTHORITY_REVISION;
	readonly sourceCoordinatorRevision: "graphrefly.b112.d716.graph-native-matched-coordinator.v1";
	readonly facts: readonly D719BudgetFactV1[];
	readonly factDigests: readonly string[];
	readonly decisions: readonly D719BudgetDecisionProjectionV1[];
	readonly exhausted: boolean;
	readonly topologyDigest: string;
	readonly topology: readonly {
		readonly id: string;
		readonly factory: string;
		readonly deps: readonly string[];
	}[];
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D719GraphNativeEvalAuthorityV1 {
	readonly revision: typeof D719_GRAPH_NATIVE_EVAL_AUTHORITY_REVISION;
}

interface D719AuthorityState {
	readonly coordinator: D716GraphNativeSixArmCoordinatorV1;
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createBudgetFactNode>;
	readonly facts: D719BudgetFactV1[];
	readonly decisions: D719BudgetDecisionProjectionV1[];
	nextSequence: number;
	active: { readonly arm: D716Arm; readonly issuedArmRequestDigest: string } | null;
	limitsBytes: Uint8Array | null;
	lastState: D719BudgetStateFactV1 | null;
	pendingTransport: {
		readonly requestRef: string;
		readonly state: D719BudgetStateFactV1;
	} | null;
}

const constructedAuthorities = new WeakMap<object, D719AuthorityState>();

function createBudgetFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D719BudgetFactV1>([], null, { name: "d719/budgetFacts" });
}

function boundedText(value: unknown, label: string, max = 256): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
}

function validateState(value: unknown): D719BudgetStateFactV1 {
	const candidate = record(value, "d719.budget.state");
	exactKeys(
		candidate,
		[
			"currentRunRequestCount",
			"latencyMs",
			"pendingReservation",
			"requestAlreadySeen",
			"requests",
			"reservedCostMicrousd",
			"reservedInputTokens",
			"reservedOutputTokens",
		],
		"d719.budget.state",
	);
	for (const key of [
		"requests",
		"currentRunRequestCount",
		"reservedInputTokens",
		"reservedOutputTokens",
		"reservedCostMicrousd",
		"latencyMs",
	] as const) {
		safeInteger(candidate[key], `d719.budget.state.${key}`, { min: 0 });
	}
	for (const key of ["requestAlreadySeen", "pendingReservation"] as const) {
		if (typeof candidate[key] !== "boolean") {
			throw new TypeError(`d719.budget.state.${key} is invalid`);
		}
	}
	return strictSnapshot(candidate) as unknown as D719BudgetStateFactV1;
}

function validateLimits(value: unknown): D719BudgetLimitsFactV1 {
	const candidate = record(value, "d719.budget.limits");
	exactKeys(
		candidate,
		[
			"enforceElapsedAdmission",
			"maxCanonicalRequestBytes",
			"maxCostMicrousd",
			"maxInputTokens",
			"maxLatencyMs",
			"maxOutputTokens",
			"maxRequests",
			"maxStepsPerRun",
		],
		"d719.budget.limits",
	);
	for (const key of [
		"maxRequests",
		"maxStepsPerRun",
		"maxCanonicalRequestBytes",
		"maxInputTokens",
		"maxOutputTokens",
		"maxCostMicrousd",
		"maxLatencyMs",
	] as const) {
		safeInteger(candidate[key], `d719.budget.limits.${key}`, { min: 1 });
	}
	if (typeof candidate.enforceElapsedAdmission !== "boolean") {
		throw new TypeError("d719.budget.limits.enforceElapsedAdmission is invalid");
	}
	return strictSnapshot(candidate) as unknown as D719BudgetLimitsFactV1;
}

function validateBudgetFact(value: unknown, expectedSequence: number): D719BudgetFactV1 {
	const candidate = record(value, "d719.budget.fact");
	if (
		candidate.kind !== "transport-admission" &&
		candidate.kind !== "retry-admission" &&
		candidate.kind !== "outcome-reconciliation" &&
		candidate.kind !== "elapsed-check" &&
		candidate.kind !== "retry-wait"
	) {
		throw new TypeError("D719 budget fact kind is invalid");
	}
	const admissionKeys =
		candidate.kind === "transport-admission" || candidate.kind === "retry-admission"
			? [
					"maxOutputTokens",
					"prospectiveCostMicrousd",
					"prospectiveInputTokens",
					"prospectiveOutputTokens",
					"reservedCostMicrousd",
					"reservedInputTokens",
					"wireRequestBytes",
				]
			: [];
	const elapsedKeys =
		candidate.kind === "elapsed-check" ? ["deadlineSignalAborted", "measuredElapsedMs"] : [];
	const retryWaitKeys = candidate.kind === "retry-wait" ? ["waitedMs"] : [];
	exactKeys(
		candidate,
		[
			"arm",
			"issuedArmRequestDigest",
			"kind",
			"limits",
			"requestRef",
			"sequence",
			"state",
			...admissionKeys,
			...elapsedKeys,
			...retryWaitKeys,
		],
		"d719.budget.fact",
	);
	if (
		safeInteger(candidate.sequence, "d719.budget.fact.sequence", { min: 0 }) !== expectedSequence
	) {
		throw new TypeError("D719 budget fact sequence is not canonical");
	}
	boundedText(candidate.requestRef, "d719.budget.fact.requestRef");
	if (
		!Array.of<D716Arm>(
			"cold",
			"relevant-applied",
			"proposal-only",
			"admission-rejected",
			"irrelevant-applied",
			"wrong-scope-applied",
		).includes(candidate.arm as D716Arm)
	) {
		throw new TypeError("D719 budget fact arm is invalid");
	}
	digest(candidate.issuedArmRequestDigest, "d719.budget.fact.issuedArmRequestDigest");
	const state = validateState(candidate.state);
	const limits = validateLimits(candidate.limits);
	if (candidate.kind === "transport-admission" || candidate.kind === "retry-admission") {
		const measurements = {} as Record<
			| "wireRequestBytes"
			| "maxOutputTokens"
			| "reservedInputTokens"
			| "reservedCostMicrousd"
			| "prospectiveInputTokens"
			| "prospectiveOutputTokens"
			| "prospectiveCostMicrousd",
			number
		>;
		for (const key of [
			"wireRequestBytes",
			"maxOutputTokens",
			"reservedInputTokens",
			"reservedCostMicrousd",
			"prospectiveInputTokens",
			"prospectiveOutputTokens",
			"prospectiveCostMicrousd",
		] as const) {
			measurements[key] = safeInteger(candidate[key], `d719.budget.fact.${key}`, { min: 0 });
		}
		if (measurements.wireRequestBytes === 0 || measurements.maxOutputTokens === 0) {
			throw new TypeError("D719 admission request measurements must be positive");
		}
		if (
			measurements.prospectiveInputTokens !==
				state.reservedInputTokens + measurements.reservedInputTokens ||
			measurements.prospectiveOutputTokens !==
				state.reservedOutputTokens + measurements.maxOutputTokens ||
			measurements.prospectiveCostMicrousd !==
				state.reservedCostMicrousd + measurements.reservedCostMicrousd
		) {
			throw new TypeError("D719 admission prospective measurements do not reconcile");
		}
		return strictSnapshot({
			...candidate,
			...measurements,
			state,
			limits,
		}) as D719TransportAdmissionFactV1;
	}
	if (candidate.kind === "elapsed-check") {
		if (candidate.requestRef !== "block")
			throw new TypeError("D719 elapsed fact requestRef drifted");
		safeInteger(candidate.measuredElapsedMs, "d719.budget.fact.measuredElapsedMs", { min: 0 });
		if (typeof candidate.deadlineSignalAborted !== "boolean") {
			throw new TypeError("D719 elapsed deadline signal fact is invalid");
		}
	}
	if (candidate.kind === "retry-wait") {
		safeInteger(candidate.waitedMs, "d719.budget.fact.waitedMs", { min: 1 });
	}
	return strictSnapshot({ ...candidate, state, limits }) as D719BudgetFactV1;
}

function reasonsFor(fact: D719BudgetFactV1): readonly D719BudgetDecisionReason[] {
	const reasons: D719BudgetDecisionReason[] = [];
	if (fact.kind === "transport-admission" || fact.kind === "retry-admission") {
		if (fact.state.pendingReservation)
			reasons.push(D719_BUDGET_DECISION_REASONS.pendingReservation);
		if (fact.state.requests >= fact.limits.maxRequests) {
			reasons.push(D719_BUDGET_DECISION_REASONS.requestLimit);
		}
		if (
			!fact.state.requestAlreadySeen &&
			fact.state.currentRunRequestCount >= fact.limits.maxStepsPerRun
		) {
			reasons.push(D719_BUDGET_DECISION_REASONS.stepLimit);
		}
		if (fact.wireRequestBytes > fact.limits.maxCanonicalRequestBytes) {
			reasons.push(D719_BUDGET_DECISION_REASONS.canonicalRequestBytes);
		}
		if (fact.prospectiveInputTokens > fact.limits.maxInputTokens) {
			reasons.push(D719_BUDGET_DECISION_REASONS.inputTokenReservation);
		}
		if (fact.prospectiveOutputTokens > fact.limits.maxOutputTokens) {
			reasons.push(D719_BUDGET_DECISION_REASONS.outputTokenReservation);
		}
		if (fact.prospectiveCostMicrousd > fact.limits.maxCostMicrousd) {
			reasons.push(D719_BUDGET_DECISION_REASONS.costReservation);
		}
		if (fact.limits.enforceElapsedAdmission && fact.state.latencyMs >= fact.limits.maxLatencyMs) {
			reasons.push(D719_BUDGET_DECISION_REASONS.elapsedBudget);
		}
	} else if (fact.kind === "outcome-reconciliation") {
		if (fact.state.latencyMs > fact.limits.maxLatencyMs) {
			reasons.push(D719_BUDGET_DECISION_REASONS.elapsedBudget);
		}
		if (fact.state.reservedInputTokens > fact.limits.maxInputTokens) {
			reasons.push(D719_BUDGET_DECISION_REASONS.inputTokenReservation);
		}
		if (fact.state.reservedOutputTokens > fact.limits.maxOutputTokens) {
			reasons.push(D719_BUDGET_DECISION_REASONS.outputTokenReservation);
		}
		if (fact.state.reservedCostMicrousd > fact.limits.maxCostMicrousd) {
			reasons.push(D719_BUDGET_DECISION_REASONS.costReservation);
		}
	} else if (
		fact.kind === "elapsed-check" &&
		fact.limits.enforceElapsedAdmission &&
		(fact.deadlineSignalAborted || fact.measuredElapsedMs >= fact.limits.maxLatencyMs)
	) {
		reasons.push(D719_BUDGET_DECISION_REASONS.elapsedBudget);
	} else if (fact.kind === "retry-wait" && fact.state.latencyMs > fact.limits.maxLatencyMs) {
		reasons.push(D719_BUDGET_DECISION_REASONS.elapsedBudget);
	}
	return Object.freeze(reasons);
}

function decisionFor(fact: D719BudgetFactV1): D719BudgetDecisionProjectionV1 {
	const reasons = reasonsFor(fact);
	const material = strictSnapshot({
		kind: fact.kind,
		sequence: fact.sequence,
		arm: fact.arm,
		issuedArmRequestDigest: fact.issuedArmRequestDigest,
		requestRef: fact.requestRef,
		admitted:
			(fact.kind === "transport-admission" || fact.kind === "retry-admission") &&
			reasons.length === 0,
		exhausted: reasons.length > 0,
		reasons,
		factDigest: empiricalStrictJsonDigest(fact),
	});
	return Object.freeze({ ...material, decisionDigest: empiricalStrictJsonDigest(material) });
}

export function createD719GraphNativeEvalAuthority(inputValue: {
	readonly coordinator: D716GraphNativeSixArmCoordinatorV1;
}): D719GraphNativeEvalAuthorityV1 {
	const input = record(inputValue, "d719.authority");
	exactKeys(input, ["coordinator"], "d719.authority");
	if (!isConstructedD716GraphNativeSixArmCoordinator(input.coordinator)) {
		throw new TypeError("D719 authority requires the constructed D716 coordinator");
	}
	const coordinator = input.coordinator;
	const owner = graph({ name: "d719/graph-native-eval-authority" });
	const factNode = createBudgetFactNode(owner);
	const decisionNode = owner.node<D719BudgetDecisionProjectionV1>(
		[factNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", decisionFor(raw as D719BudgetFactV1)]]);
			}
		},
		{ name: "d719/budgetDecisions", factory: "d719CanonicalBudgetDecisionProjection" },
	);
	const facts: D719BudgetFactV1[] = [];
	const decisions: D719BudgetDecisionProjectionV1[] = [];
	factNode.subscribe((message) => {
		if (message[0] === "DATA") facts.push(message[1] as D719BudgetFactV1);
	});
	decisionNode.subscribe((message) => {
		if (message[0] === "DATA") decisions.push(message[1] as D719BudgetDecisionProjectionV1);
	});
	const capability = Object.freeze({ revision: D719_GRAPH_NATIVE_EVAL_AUTHORITY_REVISION });
	constructedAuthorities.set(capability, {
		coordinator,
		owner,
		factNode,
		facts,
		decisions,
		nextSequence: 0,
		active: null,
		limitsBytes: null,
		lastState: null,
		pendingTransport: null,
	});
	return capability;
}

function authorityState(value: unknown): D719AuthorityState {
	if (typeof value !== "object" || value === null) {
		throw new TypeError("D719 authority must be a constructed object");
	}
	const state = constructedAuthorities.get(value);
	if (state === undefined) throw new TypeError("D719 authority is not constructed by GraphReFly");
	return state;
}

export function isConstructedD719GraphNativeEvalAuthorityForCoordinator(
	value: unknown,
	coordinator: D716GraphNativeSixArmCoordinatorV1,
): value is D719GraphNativeEvalAuthorityV1 {
	return (
		typeof value === "object" &&
		value !== null &&
		constructedAuthorities.get(value)?.coordinator === coordinator
	);
}

export function beginD719GraphNativeBudgetArm(
	authority: D719GraphNativeEvalAuthorityV1,
	request: AgentRequestIssued<D716RequestInput>,
): void {
	const state = authorityState(authority);
	if (state.active !== null) throw new TypeError("D719 budget authority already has an active arm");
	if (state.pendingTransport !== null) {
		throw new TypeError("D719 cannot begin an arm with an unmatched transport admission");
	}
	if (!isD716ActiveGraphNativeArmRequest(state.coordinator, request)) {
		throw new TypeError("D719 budget authority requires the exact active D716 arm request");
	}
	const arm = request.input?.value?.arm;
	if (arm === undefined) throw new TypeError("D719 active request omitted its arm");
	state.active = Object.freeze({
		arm,
		issuedArmRequestDigest: empiricalStrictJsonDigest(request),
	});
}

function sameGlobalBudgetState(left: D719BudgetStateFactV1, right: D719BudgetStateFactV1): boolean {
	return (
		left.requests === right.requests &&
		left.reservedInputTokens === right.reservedInputTokens &&
		left.reservedOutputTokens === right.reservedOutputTokens &&
		left.reservedCostMicrousd === right.reservedCostMicrousd &&
		left.latencyMs === right.latencyMs &&
		left.pendingReservation === right.pendingReservation
	);
}

function validateD719BudgetTransitionBeforeDecision(
	state: D719AuthorityState,
	fact: D719BudgetFactV1,
): void {
	const limitsBytes = strictJsonCodec.encode(fact.limits);
	if (state.limitsBytes === null) {
		state.limitsBytes = limitsBytes;
	} else if (!sameBytes(state.limitsBytes, limitsBytes)) {
		throw new TypeError("D719 budget limits drifted after initial admission");
	}
	if (fact.kind === "outcome-reconciliation") {
		const pending = state.pendingTransport;
		if (pending === null || pending.requestRef !== fact.requestRef) {
			throw new TypeError("D719 outcome does not bind one admitted transport request");
		}
		if (
			fact.state.requests !== pending.state.requests + 1 ||
			fact.state.latencyMs < pending.state.latencyMs ||
			fact.state.pendingReservation
		) {
			throw new TypeError("D719 outcome budget measurements do not reconcile the admission");
		}
		return;
	}
	if (fact.kind === "retry-wait") {
		if (state.pendingTransport !== null || state.lastState === null) {
			throw new TypeError("D719 retry wait does not bind a reconciled attempt");
		}
		if (
			fact.state.requests !== state.lastState.requests ||
			fact.state.reservedInputTokens !== state.lastState.reservedInputTokens ||
			fact.state.reservedOutputTokens !== state.lastState.reservedOutputTokens ||
			fact.state.reservedCostMicrousd !== state.lastState.reservedCostMicrousd ||
			fact.state.latencyMs !== state.lastState.latencyMs + fact.waitedMs ||
			fact.state.pendingReservation
		) {
			throw new TypeError("D719 retry wait measurements do not reconcile the prior attempt");
		}
		return;
	}
	if (state.pendingTransport !== null) {
		throw new TypeError(
			"D719 budget authority requires outcome reconciliation before another fact",
		);
	}
	if (state.lastState !== null && !sameGlobalBudgetState(state.lastState, fact.state)) {
		throw new TypeError(
			`D719 caller budget measurements reset or drifted between facts (${JSON.stringify(
				state.lastState,
			)} -> ${JSON.stringify(fact.state)})`,
		);
	}
}

function recordD719BudgetTransitionAfterDecision(
	state: D719AuthorityState,
	fact: D719BudgetFactV1,
	decision: D719BudgetDecisionProjectionV1,
): void {
	if (fact.kind === "transport-admission" && decision.admitted) {
		state.pendingTransport = Object.freeze({ requestRef: fact.requestRef, state: fact.state });
	} else if (fact.kind === "outcome-reconciliation") {
		state.pendingTransport = null;
	}
	state.lastState = fact.state;
}

export function endD719GraphNativeBudgetArm(
	authority: D719GraphNativeEvalAuthorityV1,
	arm: D716Arm,
): void {
	const state = authorityState(authority);
	if (state.active?.arm !== arm) {
		throw new TypeError("D719 completed budget arm does not match its active Graph arm");
	}
	if (
		!isD716GraphNativeArmCompletionAccepted(
			state.coordinator,
			arm,
			state.active.issuedArmRequestDigest,
		)
	) {
		throw new TypeError("D719 cannot end an arm before D716 admits its completion");
	}
	state.active = null;
}

export function d719GraphNativeBudgetStoppedReasonForArm(
	authority: D719GraphNativeEvalAuthorityV1,
	arm: D716Arm,
): "budget-exhausted" | null {
	const state = authorityState(authority);
	return state.decisions.some((decision) => decision.arm === arm && decision.exhausted)
		? "budget-exhausted"
		: null;
}

export function decideD719GraphNativeBudget(
	authority: D719GraphNativeEvalAuthorityV1,
	value: D719BudgetFactInputV1,
): D719BudgetDecisionProjectionV1 {
	const state = authorityState(authority);
	if (state.active === null) {
		throw new TypeError("D719 budget facts require an active Graph-issued arm");
	}
	if (state.nextSequence >= 2_048) {
		throw new TypeError("D719 budget fact bound exhausted");
	}
	const raw = record(value, "d719.budget.input");
	if (
		Object.hasOwn(raw, "sequence") ||
		Object.hasOwn(raw, "arm") ||
		Object.hasOwn(raw, "issuedArmRequestDigest")
	) {
		throw new TypeError("D719 budget provenance coordinates are Graph-owned");
	}
	const fact = validateBudgetFact(
		{ ...raw, ...state.active, sequence: state.nextSequence },
		state.nextSequence,
	);
	validateD719BudgetTransitionBeforeDecision(state, fact);
	const before = state.decisions.length;
	state.factNode.down([["DATA", fact]]);
	const decision = state.decisions[before];
	if (decision === undefined) throw new TypeError("D719 Graph omitted the budget decision");
	recordD719BudgetTransitionAfterDecision(state, fact, decision);
	state.nextSequence += 1;
	return strictSnapshot(decision) as D719BudgetDecisionProjectionV1;
}

export function snapshotD719GraphNativeBudgetEvidence(
	authority: D719GraphNativeEvalAuthorityV1,
): D719GraphNativeBudgetEvidenceV1 {
	const state = authorityState(authority);
	const topology = state.owner.topology();
	const topologyMaterial = strictSnapshot({
		nodes: topology.nodes.map((node) => ({
			id: node.id,
			factory: node.factory,
			deps: Object.freeze([...node.deps]),
		})),
		edges: topology.edges,
	});
	const material = strictSnapshot({
		schemaVersion: D719_GRAPH_NATIVE_BUDGET_EVIDENCE_SCHEMA,
		authorityRevision: D719_GRAPH_NATIVE_EVAL_AUTHORITY_REVISION,
		sourceCoordinatorRevision: "graphrefly.b112.d716.graph-native-matched-coordinator.v1" as const,
		facts: state.facts,
		factDigests: state.facts.map((fact) => empiricalStrictJsonDigest(fact)),
		decisions: state.decisions,
		exhausted: state.decisions.some((decision) => decision.exhausted),
		topologyDigest: empiricalStrictJsonDigest(topologyMaterial.nodes),
		topology: topologyMaterial.nodes,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function validateD719GraphNativeBudgetEvidence(
	value: unknown,
): D719GraphNativeBudgetEvidenceV1 {
	const candidate = record(value, "d719.budgetEvidence");
	exactKeys(
		candidate,
		[
			"authorityRevision",
			"causalAttribution",
			"decisions",
			"efficacyClaim",
			"evidenceDigest",
			"exhausted",
			"facts",
			"factDigests",
			"schemaVersion",
			"sourceCoordinatorRevision",
			"topology",
			"topologyDigest",
		],
		"d719.budgetEvidence",
	);
	const snapshot = strictSnapshot(candidate) as unknown as D719GraphNativeBudgetEvidenceV1;
	if (
		snapshot.schemaVersion !== D719_GRAPH_NATIVE_BUDGET_EVIDENCE_SCHEMA ||
		snapshot.authorityRevision !== D719_GRAPH_NATIVE_EVAL_AUTHORITY_REVISION ||
		snapshot.sourceCoordinatorRevision !==
			"graphrefly.b112.d716.graph-native-matched-coordinator.v1" ||
		snapshot.causalAttribution !== "undetermined" ||
		snapshot.efficacyClaim !== "none" ||
		typeof snapshot.exhausted !== "boolean"
	) {
		throw new TypeError("D719 budget evidence coordinates drifted");
	}
	if (
		snapshot.decisions.length > 2_048 ||
		snapshot.facts.length !== snapshot.decisions.length ||
		snapshot.factDigests.length !== snapshot.decisions.length
	) {
		throw new TypeError("D719 budget evidence exceeds its bound");
	}
	for (const [index, value] of snapshot.factDigests.entries()) {
		digest(value, "d719.budgetEvidence.factDigest");
		const fact = validateBudgetFact(snapshot.facts[index], index);
		if (value !== empiricalStrictJsonDigest(fact)) {
			throw new TypeError("D719 admitted budget fact digest mismatch");
		}
		const decision = record(snapshot.decisions[index], "d719.budgetEvidence.decision");
		exactKeys(
			decision,
			[
				"admitted",
				"arm",
				"decisionDigest",
				"exhausted",
				"factDigest",
				"issuedArmRequestDigest",
				"kind",
				"reasons",
				"requestRef",
				"sequence",
			],
			"d719.budgetEvidence.decision",
		);
		if (
			decision.kind !== "transport-admission" &&
			decision.kind !== "retry-admission" &&
			decision.kind !== "outcome-reconciliation" &&
			decision.kind !== "elapsed-check" &&
			decision.kind !== "retry-wait"
		) {
			throw new TypeError("D719 budget decision kind is invalid");
		}
		if (
			!Array.of<D716Arm>(
				"cold",
				"relevant-applied",
				"proposal-only",
				"admission-rejected",
				"irrelevant-applied",
				"wrong-scope-applied",
			).includes(decision.arm as D716Arm)
		) {
			throw new TypeError("D719 budget decision arm is invalid");
		}
		if (
			safeInteger(decision.sequence, "d719.budgetEvidence.decision.sequence", { min: 0 }) !== index
		) {
			throw new TypeError("D719 budget decision sequence drifted");
		}
		boundedText(decision.requestRef, "d719.budgetEvidence.decision.requestRef");
		if (typeof decision.admitted !== "boolean" || typeof decision.exhausted !== "boolean") {
			throw new TypeError("D719 budget decision disposition is invalid");
		}
		if (!Array.isArray(decision.reasons) || decision.reasons.length > 8) {
			throw new TypeError("D719 budget decision reasons exceed their bound");
		}
		const reasons = decision.reasons as unknown[];
		for (const reason of reasons) {
			if (
				!Object.values(D719_BUDGET_DECISION_REASONS).includes(reason as D719BudgetDecisionReason)
			) {
				throw new TypeError("D719 budget decision reason is invalid");
			}
		}
		if (new Set(reasons).size !== reasons.length || decision.exhausted !== reasons.length > 0) {
			throw new TypeError("D719 budget decision reasons are not canonical");
		}
		if (decision.kind === "transport-admission" || decision.kind === "retry-admission") {
			if (decision.admitted !== (reasons.length === 0)) {
				throw new TypeError("D719 transport admission decision is inconsistent");
			}
		} else if (decision.admitted) {
			throw new TypeError("D719 non-admission decision cannot admit transport");
		}
		digest(decision.factDigest, "d719.budgetEvidence.decision.factDigest");
		digest(decision.issuedArmRequestDigest, "d719.budgetEvidence.decision.issuedArmRequestDigest");
		digest(decision.decisionDigest, "d719.budgetEvidence.decision.decisionDigest");
		if (decision.factDigest !== value) {
			throw new TypeError("D719 budget decision does not bind its admitted fact");
		}
		const expectedDecision = decisionFor(fact);
		if (!sameBytes(strictJsonCodec.encode(expectedDecision), strictJsonCodec.encode(decision))) {
			throw new TypeError("D719 budget decision is not the canonical Graph projection");
		}
		const { decisionDigest, ...decisionMaterial } = decision;
		if (decisionDigest !== empiricalStrictJsonDigest(decisionMaterial)) {
			throw new TypeError("D719 budget decision digest mismatch");
		}
	}
	if (snapshot.exhausted !== snapshot.decisions.some((decision) => decision.exhausted)) {
		throw new TypeError("D719 budget exhausted projection drifted");
	}
	if (snapshot.topology.length > 8) throw new TypeError("D719 topology exceeds its bound");
	for (const nodeValue of snapshot.topology) {
		const node = record(nodeValue, "d719.budgetEvidence.topologyNode");
		exactKeys(node, ["deps", "factory", "id"], "d719.budgetEvidence.topologyNode");
		boundedText(node.id, "d719.budgetEvidence.topologyNode.id", 512);
		boundedText(node.factory, "d719.budgetEvidence.topologyNode.factory", 256);
		if (!Array.isArray(node.deps) || node.deps.length > 8) {
			throw new TypeError("D719 topology dependency list exceeds its bound");
		}
		for (const dep of node.deps) boundedText(dep, "d719.budgetEvidence.topologyNode.dep", 512);
	}
	digest(snapshot.topologyDigest, "d719.budgetEvidence.topologyDigest");
	if (snapshot.topologyDigest !== empiricalStrictJsonDigest(snapshot.topology)) {
		throw new TypeError("D719 topology digest mismatch");
	}
	digest(snapshot.evidenceDigest, "d719.budgetEvidence.evidenceDigest");
	const { evidenceDigest: _evidenceDigest, ...material } = snapshot;
	if (snapshot.evidenceDigest !== empiricalStrictJsonDigest(material)) {
		throw new TypeError("D719 budget evidence digest mismatch");
	}
	return snapshot;
}
