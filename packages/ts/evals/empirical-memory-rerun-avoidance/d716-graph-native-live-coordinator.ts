import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import type { AgentRequestIssued, EffectRunResult } from "../../src/orchestration/agent-runtime.js";
import { sanitizeAgentRequestIssued } from "../../src/orchestration/agent-runtime-request-ledger.js";
import { workItemExecutionRecipe } from "../../src/solutions/work-item/execution.js";
import type {
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "../../src/solutions/work-item/scheduling.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import type { B112MatchedBlockReflectionV2 } from "./matched-block-memory.js";

export const D716_GRAPH_NATIVE_COORDINATOR_REVISION =
	"graphrefly.b112.d716.graph-native-matched-coordinator.v1" as const;
export const D716_GRAPH_NATIVE_COORDINATION_SCHEMA =
	"graphrefly.b112.d716.graph-native-matched-coordination-evidence.v1" as const;
export const D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST =
	"sha256:56d5ec277761d635b9036a2dd0a2c84db6bcd8731d3f148f020744b17297b644" as const;
export const D716_GRAPH_NATIVE_ARM_ORDER = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export type D716Arm = (typeof D716_GRAPH_NATIVE_ARM_ORDER)[number];
export type D716Phase =
	| "none"
	| "inspection"
	| "exact-mutation"
	| "workspace-diff"
	| "focused-validation-attempted"
	| "focused-validation-passed"
	| "hidden-verifier-attempted"
	| "hidden-verifier-passed";
export type D716StoppedReason =
	| "budget-exhausted"
	| "warm-preparation-failed"
	| "workspace-cleanup-failed"
	| "cancelled"
	| null;

export interface D716RequestInput {
	readonly authority: "D716";
	readonly arm: D716Arm;
	readonly sequence: number;
	readonly sourceDigest: string;
}

interface D716ArmDefinition {
	readonly arm: D716Arm;
	readonly sequence: number;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly sourceDigest: string;
}

interface D716ArmDirective extends D716ArmDefinition {
	readonly kind: "arm-issued";
}

export interface D716ArmCompletionFact {
	readonly arm: D716Arm;
	readonly sequence: number;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly issuedRequestDigest: string;
	readonly traceComplete: boolean;
	readonly inspectionObserved: boolean;
	readonly contentChangingMutationObserved: boolean;
	readonly nonEmptyDiffAfterLatestMutation: boolean;
	readonly focusedValidationAttempted: boolean;
	readonly focusedValidationPassed: boolean;
	readonly hiddenVerifierAttempted: boolean;
	readonly hiddenVerifierPassed: boolean;
	readonly requests: number;
	readonly costMicrousd: number;
	readonly elapsedMs: number;
	readonly stoppedReason: D716StoppedReason;
}

interface D716ArmCompletionAccepted {
	readonly kind: "completion-accepted";
	readonly fact: D716ArmCompletionFact;
}

interface D716CompletionRejected {
	readonly kind: "completion-rejected";
	readonly issueCode:
		| "completion-without-active-arm"
		| "completion-provenance-mismatch"
		| "duplicate-arm-completion";
	readonly factDigest: string;
}

type D716SchedulerEvent = D716ArmDirective | D716ArmCompletionAccepted | D716CompletionRejected;

export interface D716ArmProgressProjection {
	readonly arm: D716Arm;
	readonly sequence: number;
	readonly phase: D716Phase;
	readonly evaluable: boolean;
	readonly fullTaskCompleted: boolean;
	readonly requests: number;
	readonly costMicrousd: number;
	readonly elapsedMs: number;
	readonly stoppedReason: D716StoppedReason;
	readonly provenanceDigest: string;
}

export interface D716GraphNativeCoordinationEvidenceV1 {
	readonly schemaVersion: typeof D716_GRAPH_NATIVE_COORDINATION_SCHEMA;
	readonly coordinatorRevision: typeof D716_GRAPH_NATIVE_COORDINATOR_REVISION;
	readonly qualificationDigest: typeof D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST;
	readonly infrastructureEvidenceDigest: string;
	readonly armOrder: readonly D716Arm[];
	readonly issuedArms: readonly D716Arm[];
	readonly completedArms: readonly D716Arm[];
	readonly progress: readonly D716ArmProgressProjection[];
	readonly issueCodes: readonly string[];
	readonly maxActiveArms: 1;
	readonly warmArmsIndependentOfCold: boolean;
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

export interface D716GraphNativeSixArmCoordinatorV1 {
	readonly revision: typeof D716_GRAPH_NATIVE_COORDINATOR_REVISION;
}

interface D716SchedulerState {
	readonly definitions: Map<D716Arm, D716ArmDefinition>;
	readonly completed: Set<D716Arm>;
	active: D716ArmDirective | null;
}

interface D716CoordinatorState {
	readonly warmReflection: B112MatchedBlockReflectionV2;
	readonly infrastructureEvidenceDigest: string;
	readonly completionNode: ReturnType<typeof createCompletionNode>;
	readonly resultNode: ReturnType<typeof createResultNode>;
	readonly requests: AgentRequestIssued<D716RequestInput>[];
	readonly issued: D716Arm[];
	readonly completed: D716Arm[];
	readonly progress: D716ArmProgressProjection[];
	readonly issues: string[];
	readonly schedulerIssued: D716Arm[];
	readonly requestByArm: Map<D716Arm, AgentRequestIssued<D716RequestInput>>;
	readonly owner: ReturnType<typeof graph>;
	activeTaken: D716Arm | null;
	activeTakenRequest: AgentRequestIssued<D716RequestInput> | null;
}

const constructedCoordinators = new WeakMap<object, D716CoordinatorState>();

function createCompletionNode(owner: ReturnType<typeof graph>) {
	return owner.node<D716ArmCompletionFact>([], null, { name: "d716/armCompletions" });
}

function createResultNode(owner: ReturnType<typeof graph>) {
	return owner.node<EffectRunResult>([], null, { name: "d716/effectRunResults" });
}

function phaseFor(fact: D716ArmCompletionFact): D716Phase {
	if (
		(fact.hiddenVerifierPassed && !fact.hiddenVerifierAttempted) ||
		(fact.hiddenVerifierAttempted && !fact.focusedValidationPassed) ||
		(fact.focusedValidationPassed && !fact.focusedValidationAttempted) ||
		(fact.focusedValidationAttempted && !fact.nonEmptyDiffAfterLatestMutation) ||
		(fact.nonEmptyDiffAfterLatestMutation && !fact.contentChangingMutationObserved) ||
		(fact.contentChangingMutationObserved && !fact.inspectionObserved)
	) {
		return "none";
	}
	if (fact.hiddenVerifierPassed) return "hidden-verifier-passed";
	if (fact.hiddenVerifierAttempted) return "hidden-verifier-attempted";
	if (fact.focusedValidationPassed) return "focused-validation-passed";
	if (fact.focusedValidationAttempted) return "focused-validation-attempted";
	if (fact.nonEmptyDiffAfterLatestMutation) return "workspace-diff";
	if (fact.contentChangingMutationObserved) return "exact-mutation";
	if (fact.inspectionObserved) return "inspection";
	return "none";
}

function validateCompletionFact(value: unknown): D716ArmCompletionFact {
	const candidate = record(value, "d716.completion");
	exactKeys(
		candidate,
		[
			"arm",
			"contentChangingMutationObserved",
			"costMicrousd",
			"elapsedMs",
			"executionInputRevision",
			"focusedValidationAttempted",
			"focusedValidationPassed",
			"hiddenVerifierAttempted",
			"hiddenVerifierPassed",
			"inspectionObserved",
			"issuedRequestDigest",
			"nonEmptyDiffAfterLatestMutation",
			"requests",
			"sequence",
			"stoppedReason",
			"traceComplete",
			"workItemId",
		],
		"d716.completion",
	);
	strictSnapshot(candidate);
	if (!D716_GRAPH_NATIVE_ARM_ORDER.includes(candidate.arm as D716Arm)) {
		throw new TypeError("D716 completion arm is not frozen");
	}
	for (const key of [
		"traceComplete",
		"inspectionObserved",
		"contentChangingMutationObserved",
		"nonEmptyDiffAfterLatestMutation",
		"focusedValidationAttempted",
		"focusedValidationPassed",
		"hiddenVerifierAttempted",
		"hiddenVerifierPassed",
	] as const) {
		if (typeof candidate[key] !== "boolean") throw new TypeError(`D716 ${key} is invalid`);
	}
	for (const key of [
		"sequence",
		"executionInputRevision",
		"requests",
		"costMicrousd",
		"elapsedMs",
	] as const) {
		if (!Number.isSafeInteger(candidate[key]) || (candidate[key] as number) < 0) {
			throw new TypeError(`D716 ${key} is invalid`);
		}
	}
	if (typeof candidate.workItemId !== "string" || candidate.workItemId.length > 128) {
		throw new TypeError("D716 workItemId is invalid");
	}
	if (candidate.workItemId.length === 0) throw new TypeError("D716 workItemId is empty");
	digest(candidate.issuedRequestDigest, "d716.issuedRequestDigest");
	if (
		candidate.stoppedReason !== null &&
		![
			"budget-exhausted",
			"warm-preparation-failed",
			"workspace-cleanup-failed",
			"cancelled",
		].includes(candidate.stoppedReason as string)
	) {
		throw new TypeError("D716 stoppedReason is invalid");
	}
	return strictSnapshot(candidate) as unknown as D716ArmCompletionFact;
}

function workItemFor(definition: D716ArmDefinition): WorkItemProjection<D716RequestInput> {
	return Object.freeze({
		workItemId: definition.workItemId,
		summary: "D716 Graph-native matched arm",
		authoringRevision: 1,
		executionInputRevision: definition.executionInputRevision,
		lastEventId: `event:${definition.workItemId}:${definition.executionInputRevision}`,
		revisionSourceRefs: Object.freeze([
			{ kind: "d716-graph-native-admission", id: definition.sourceDigest },
		]),
	});
}

function proposalFor(definition: D716ArmDefinition): WorkItemEffectPlanProposed<D716RequestInput> {
	const value = Object.freeze({
		authority: "D716" as const,
		arm: definition.arm,
		sequence: definition.sequence,
		sourceDigest: definition.sourceDigest,
	});
	return Object.freeze({
		kind: "work-item-effect-plan-proposed",
		planId: `plan:D716:${definition.arm}`,
		workItemId: definition.workItemId,
		executionInputRevision: definition.executionInputRevision,
		joinPolicy: "all-required",
		sourceRefs: Object.freeze([
			{ kind: "d716-graph-native-admission", id: definition.sourceDigest },
		]),
		members: Object.freeze([
			Object.freeze({
				memberId: `member:${definition.arm}`,
				effectKind: "graph-native-agent-turn",
				required: true,
				goal: Object.freeze({
					kind: "graph-native-agent-turn",
					input: Object.freeze({
						inputId: `input:D716:${definition.arm}`,
						inputKind: "graph-native-agent-turn",
						dataMode: "inline" as const,
						value,
					}),
				}),
				limits: Object.freeze({ maxSteps: 1, maxRequests: 1 }),
				sourceRefs: Object.freeze([
					{ kind: "d716-graph-native-admission", id: definition.sourceDigest },
				]),
			}),
		]),
	});
}

function validateWarmReflection(value: unknown): B112MatchedBlockReflectionV2 {
	const candidate = record(value, "d716.warmReflection");
	exactKeys(
		candidate,
		["branches", "candidateRecordDigests", "evidenceDigest", "issueCodes"],
		"d716.warmReflection",
	);
	const snapshot = strictSnapshot(candidate) as unknown as B112MatchedBlockReflectionV2;
	digest(snapshot.evidenceDigest, "d716.warmReflection.evidenceDigest");
	if (snapshot.candidateRecordDigests.length > 32 || snapshot.issueCodes.length > 32) {
		throw new TypeError("D716 warm reflection exceeds the frozen evidence bounds");
	}
	for (const value of snapshot.candidateRecordDigests) {
		digest(value, "d716.warmReflection.candidateRecordDigest");
	}
	for (const issueCode of snapshot.issueCodes) {
		if (typeof issueCode !== "string" || issueCode.length === 0 || issueCode.length > 128) {
			throw new TypeError("D716 warm reflection issue code is invalid");
		}
	}
	if (snapshot.branches.length !== 5) throw new TypeError("D716 requires five warm branches");
	for (const [index, expected] of D716_GRAPH_NATIVE_ARM_ORDER.slice(1).entries()) {
		const branch = snapshot.branches[index];
		if (branch?.branchKind !== expected) throw new TypeError("D716 warm branch order drifted");
		if (branch.actorMemoryContext !== null && branch.actorMemoryContext.text.length > 4_096) {
			throw new TypeError("D716 warm memory exceeds the frozen bound");
		}
	}
	return snapshot;
}

export function createD716GraphNativeSixArmCoordinator(inputValue: {
	readonly qualificationDigest: typeof D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST;
	readonly infrastructureEvidenceDigest: string;
	readonly warmReflection: B112MatchedBlockReflectionV2;
}): D716GraphNativeSixArmCoordinatorV1 {
	const input = record(inputValue, "d716.coordinator");
	exactKeys(
		input,
		["infrastructureEvidenceDigest", "qualificationDigest", "warmReflection"],
		"d716.coordinator",
	);
	if (input.qualificationDigest !== D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST) {
		throw new TypeError("D716 coordinator requires the exact D714/D715 qualification");
	}
	const infrastructureEvidenceDigest = digest(
		input.infrastructureEvidenceDigest,
		"d716.infrastructureEvidenceDigest",
	);
	const warmReflection = validateWarmReflection(input.warmReflection);
	const owner = graph({ name: "d716/graph-native-matched-live-harness" });
	const definitions = owner.node<D716ArmDefinition>([], null, { name: "d716/armDefinitions" });
	const completionNode = createCompletionNode(owner);
	const resultNode = createResultNode(owner);
	const scheduler = owner.node<D716SchedulerEvent>(
		[definitions, completionNode],
		(ctx) => {
			const state =
				ctx.state.get<D716SchedulerState>() ??
				({
					definitions: new Map(),
					completed: new Set(),
					active: null,
				} satisfies D716SchedulerState);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const definition = raw as D716ArmDefinition;
				state.definitions.set(definition.arm, definition);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const fact = raw as D716ArmCompletionFact;
				if (state.active === null) {
					ctx.down([
						[
							"DATA",
							Object.freeze({
								kind: "completion-rejected" as const,
								issueCode: "completion-without-active-arm" as const,
								factDigest: empiricalStrictJsonDigest(fact),
							}),
						],
					]);
					continue;
				}
				if (state.completed.has(fact.arm)) {
					ctx.down([
						[
							"DATA",
							Object.freeze({
								kind: "completion-rejected" as const,
								issueCode: "duplicate-arm-completion" as const,
								factDigest: empiricalStrictJsonDigest(fact),
							}),
						],
					]);
					continue;
				}
				if (
					fact.arm !== state.active.arm ||
					fact.sequence !== state.active.sequence ||
					fact.workItemId !== state.active.workItemId ||
					fact.executionInputRevision !== state.active.executionInputRevision
				) {
					ctx.down([
						[
							"DATA",
							Object.freeze({
								kind: "completion-rejected" as const,
								issueCode: "completion-provenance-mismatch" as const,
								factDigest: empiricalStrictJsonDigest(fact),
							}),
						],
					]);
					continue;
				}
				state.completed.add(fact.arm);
				state.active = null;
				ctx.down([["DATA", Object.freeze({ kind: "completion-accepted" as const, fact })]]);
			}
			if (
				state.active === null &&
				state.definitions.size === D716_GRAPH_NATIVE_ARM_ORDER.length &&
				state.completed.size < D716_GRAPH_NATIVE_ARM_ORDER.length
			) {
				const nextArm = D716_GRAPH_NATIVE_ARM_ORDER[state.completed.size];
				const definition = nextArm === undefined ? undefined : state.definitions.get(nextArm);
				if (definition !== undefined) {
					state.active = Object.freeze({ kind: "arm-issued" as const, ...definition });
					ctx.down([["DATA", state.active]]);
				}
			}
			ctx.state.set(state);
		},
		{
			name: "d716/serialScheduler",
			factory: "d716GraphNativeSerialArmScheduler",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const workItems = owner.node<WorkItemProjection<D716RequestInput>>(
		[scheduler],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as D716SchedulerEvent;
				if (event.kind === "arm-issued") ctx.down([["DATA", workItemFor(event)]]);
			}
		},
		{ name: "d716/workItems", factory: "d716ScheduledArmWorkItems" },
	);
	const proposals = owner.node<WorkItemEffectPlanProposed<D716RequestInput>>(
		[scheduler],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as D716SchedulerEvent;
				if (event.kind === "arm-issued") ctx.down([["DATA", proposalFor(event)]]);
			}
		},
		{ name: "d716/effectPlanProposals", factory: "d716ScheduledArmEffectPlans" },
	);
	const progressNode = owner.node<D716ArmProgressProjection>(
		[scheduler],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as D716SchedulerEvent;
				if (event.kind !== "completion-accepted") continue;
				const phase = phaseFor(event.fact);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							arm: event.fact.arm,
							sequence: event.fact.sequence,
							phase,
							evaluable: event.fact.traceComplete && phase !== "none",
							fullTaskCompleted: event.fact.hiddenVerifierPassed,
							requests: event.fact.requests,
							costMicrousd: event.fact.costMicrousd,
							elapsedMs: event.fact.elapsedMs,
							stoppedReason: event.fact.stoppedReason,
							provenanceDigest: empiricalStrictJsonDigest(event.fact),
						}),
					],
				]);
			}
		},
		{ name: "d716/progress", factory: "d716OrderedPhaseProjection" },
	);
	const recipe = workItemExecutionRecipe(owner, {
		name: "d716/workItemExecution",
		workItems,
		effectPlanProposals: proposals,
		effectRunResults: resultNode,
		policy: { allowedEffectKinds: ["graph-native-agent-turn"] },
		now: () => 0,
	});
	const requests: AgentRequestIssued<D716RequestInput>[] = [];
	const issued: D716Arm[] = [];
	const completed: D716Arm[] = [];
	const progress: D716ArmProgressProjection[] = [];
	const issues: string[] = [];
	const schedulerIssued: D716Arm[] = [];
	const requestByArm = new Map<D716Arm, AgentRequestIssued<D716RequestInput>>();
	recipe.requests.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const request = sanitizeAgentRequestIssued(
			message[1] as AgentRequestIssued<D716RequestInput>,
		) as AgentRequestIssued<D716RequestInput>;
		const arm = request.input?.value?.arm;
		if (arm === undefined) throw new TypeError("D716 issued request omitted its arm");
		requests.push(request);
		issued.push(arm);
		requestByArm.set(arm, request);
	});
	progressNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const projection = message[1] as D716ArmProgressProjection;
		progress.push(projection);
		completed.push(projection.arm);
	});
	scheduler.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const event = message[1] as D716SchedulerEvent;
		if (event.kind === "arm-issued") schedulerIssued.push(event.arm);
		if (event.kind === "completion-rejected") issues.push(event.issueCode);
	});
	definitions.down(
		D716_GRAPH_NATIVE_ARM_ORDER.map((arm, index) => [
			"DATA",
			Object.freeze({
				arm,
				sequence: index,
				workItemId: `d716-arm-${arm}`,
				executionInputRevision: index + 1,
				sourceDigest: infrastructureEvidenceDigest,
			}),
		]),
	);
	const capability = Object.freeze({ revision: D716_GRAPH_NATIVE_COORDINATOR_REVISION });
	constructedCoordinators.set(capability, {
		warmReflection,
		infrastructureEvidenceDigest,
		completionNode,
		resultNode,
		requests,
		issued,
		completed,
		progress,
		issues,
		schedulerIssued,
		requestByArm,
		owner,
		activeTaken: null,
		activeTakenRequest: null,
	});
	return capability;
}

function coordinatorState(value: unknown): D716CoordinatorState {
	if (typeof value !== "object" || value === null) {
		throw new TypeError("D716 coordinator must be a constructed object");
	}
	const state = constructedCoordinators.get(value);
	if (state === undefined) throw new TypeError("D716 coordinator is not constructed by GraphReFly");
	return state;
}

export function isConstructedD716GraphNativeSixArmCoordinator(
	value: unknown,
): value is D716GraphNativeSixArmCoordinatorV1 {
	return typeof value === "object" && value !== null && constructedCoordinators.has(value);
}

export function takeNextD716GraphNativeArmRequest(
	coordinator: D716GraphNativeSixArmCoordinatorV1,
): AgentRequestIssued<D716RequestInput> {
	const state = coordinatorState(coordinator);
	if (state.activeTaken !== null) {
		throw new TypeError("D716 active arm must complete before another request is taken");
	}
	if (state.requests.length !== 1) {
		throw new TypeError(
			`D716 graph did not expose exactly one next serial request (observed ${state.requests.length}; scheduler issued ${state.schedulerIssued.join(",") || "none"})`,
		);
	}
	const request = state.requests.shift();
	const arm = request?.input?.value?.arm;
	if (request === undefined || arm === undefined)
		throw new TypeError("D716 next request is invalid");
	state.activeTaken = arm;
	const taken = strictSnapshot(request) as AgentRequestIssued<D716RequestInput>;
	state.activeTakenRequest = taken;
	return taken;
}

export function isD716ActiveGraphNativeArmRequest(
	coordinator: D716GraphNativeSixArmCoordinatorV1,
	request: AgentRequestIssued<D716RequestInput>,
): boolean {
	const state = coordinatorState(coordinator);
	return state.activeTakenRequest === request;
}

export function isD716GraphNativeArmCompletionAccepted(
	coordinator: D716GraphNativeSixArmCoordinatorV1,
	arm: D716Arm,
	issuedRequestDigest: string,
): boolean {
	const state = coordinatorState(coordinator);
	const issued = state.requestByArm.get(arm);
	return (
		state.activeTaken === null &&
		state.completed.includes(arm) &&
		issued !== undefined &&
		empiricalStrictJsonDigest(issued) === issuedRequestDigest
	);
}

export function d716IndependentWarmReflection(
	coordinator: D716GraphNativeSixArmCoordinatorV1,
): B112MatchedBlockReflectionV2 {
	return coordinatorState(coordinator).warmReflection;
}

export function recordD716GraphNativeArmCompletion(
	coordinator: D716GraphNativeSixArmCoordinatorV1,
	value: unknown,
): D716ArmProgressProjection {
	const state = coordinatorState(coordinator);
	const fact = validateCompletionFact(value);
	if (state.activeTaken !== fact.arm) {
		throw new TypeError("D716 completion does not match the taken active arm");
	}
	const request = state.requestByArm.get(fact.arm);
	if (request === undefined || empiricalStrictJsonDigest(request) !== fact.issuedRequestDigest) {
		throw new TypeError("D716 completion does not bind the exact issued request");
	}
	const beforeProgress = state.progress.length;
	const beforeIssues = state.issues.length;
	state.completionNode.down([["DATA", fact]]);
	if (state.issues.length !== beforeIssues) {
		throw new TypeError(`D716 graph rejected completion: ${state.issues.at(-1)}`);
	}
	const projection = state.progress[beforeProgress];
	if (projection === undefined) throw new TypeError("D716 graph omitted completion projection");
	state.activeTaken = null;
	state.activeTakenRequest = null;
	state.resultNode.down([
		[
			"DATA",
			Object.freeze({
				kind: "effect-run-result",
				resultId: `result:D716:${fact.arm}`,
				status: "completed",
				effectRunId: request.effectRunId,
				operationId: request.operationId,
				output: Object.freeze({
					kind: "d716-arm-completion",
					value: Object.freeze({
						arm: fact.arm,
						phase: projection.phase,
						provenanceDigest: projection.provenanceDigest,
					}),
				}),
				sourceRefs: Object.freeze([{ kind: "d716-completion", id: projection.provenanceDigest }]),
			}) satisfies EffectRunResult,
		],
	]);
	return projection;
}

export function snapshotD716GraphNativeCoordination(
	coordinator: D716GraphNativeSixArmCoordinatorV1,
): D716GraphNativeCoordinationEvidenceV1 {
	const state = coordinatorState(coordinator);
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
		schemaVersion: D716_GRAPH_NATIVE_COORDINATION_SCHEMA,
		coordinatorRevision: D716_GRAPH_NATIVE_COORDINATOR_REVISION,
		qualificationDigest: D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST,
		infrastructureEvidenceDigest: state.infrastructureEvidenceDigest,
		armOrder: D716_GRAPH_NATIVE_ARM_ORDER,
		issuedArms: state.issued,
		completedArms: state.completed,
		progress: state.progress,
		issueCodes: Object.freeze([...new Set(state.issues)].sort()),
		maxActiveArms: 1 as const,
		warmArmsIndependentOfCold:
			state.issued.length === 6 &&
			state.issued.slice(1).every((arm, index) => arm === D716_GRAPH_NATIVE_ARM_ORDER[index + 1]),
		topologyDigest: empiricalStrictJsonDigest(topologyMaterial),
		topology: topologyMaterial.nodes,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	});
}

export function validateD716GraphNativeCoordinationEvidence(
	value: unknown,
): D716GraphNativeCoordinationEvidenceV1 {
	const candidate = record(value, "d716.coordinationEvidence");
	exactKeys(
		candidate,
		[
			"armOrder",
			"causalAttribution",
			"completedArms",
			"coordinatorRevision",
			"efficacyClaim",
			"evidenceDigest",
			"infrastructureEvidenceDigest",
			"issueCodes",
			"issuedArms",
			"maxActiveArms",
			"progress",
			"qualificationDigest",
			"schemaVersion",
			"topology",
			"topologyDigest",
			"warmArmsIndependentOfCold",
		],
		"d716.coordinationEvidence",
	);
	const snapshot = strictSnapshot(candidate) as unknown as D716GraphNativeCoordinationEvidenceV1;
	if (
		snapshot.schemaVersion !== D716_GRAPH_NATIVE_COORDINATION_SCHEMA ||
		snapshot.coordinatorRevision !== D716_GRAPH_NATIVE_COORDINATOR_REVISION ||
		snapshot.qualificationDigest !== D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST ||
		snapshot.causalAttribution !== "undetermined" ||
		snapshot.efficacyClaim !== "none" ||
		snapshot.maxActiveArms !== 1 ||
		typeof snapshot.warmArmsIndependentOfCold !== "boolean"
	) {
		throw new TypeError("D716 coordination evidence coordinates drifted");
	}
	digest(snapshot.infrastructureEvidenceDigest, "d716.infrastructureEvidenceDigest");
	digest(snapshot.topologyDigest, "d716.topologyDigest");
	digest(snapshot.evidenceDigest, "d716.evidenceDigest");
	for (const [label, arms] of [
		["armOrder", snapshot.armOrder],
		["issuedArms", snapshot.issuedArms],
		["completedArms", snapshot.completedArms],
	] as const) {
		if (arms.length > D716_GRAPH_NATIVE_ARM_ORDER.length) {
			throw new TypeError(`D716 ${label} exceeds the six-arm bound`);
		}
		for (const arm of arms) {
			if (!D716_GRAPH_NATIVE_ARM_ORDER.includes(arm)) {
				throw new TypeError(`D716 ${label} contains an unknown arm`);
			}
		}
	}
	if (snapshot.armOrder.join("|") !== D716_GRAPH_NATIVE_ARM_ORDER.join("|")) {
		throw new TypeError("D716 frozen arm order drifted");
	}
	if (snapshot.progress.length > D716_GRAPH_NATIVE_ARM_ORDER.length) {
		throw new TypeError("D716 progress exceeds the six-arm bound");
	}
	for (const item of snapshot.progress) {
		const fact = record(item, "d716.progress");
		exactKeys(
			fact,
			[
				"arm",
				"costMicrousd",
				"elapsedMs",
				"evaluable",
				"fullTaskCompleted",
				"phase",
				"provenanceDigest",
				"requests",
				"sequence",
				"stoppedReason",
			],
			"d716.progress",
		);
		if (!D716_GRAPH_NATIVE_ARM_ORDER.includes(fact.arm as D716Arm)) {
			throw new TypeError("D716 progress arm is invalid");
		}
		for (const scalar of ["sequence", "requests", "costMicrousd", "elapsedMs"] as const) {
			if (!Number.isSafeInteger(fact[scalar]) || (fact[scalar] as number) < 0) {
				throw new TypeError(`D716 progress ${scalar} is invalid`);
			}
		}
		if (typeof fact.evaluable !== "boolean" || typeof fact.fullTaskCompleted !== "boolean") {
			throw new TypeError("D716 progress boolean is invalid");
		}
		if (
			![
				"none",
				"inspection",
				"exact-mutation",
				"workspace-diff",
				"focused-validation-attempted",
				"focused-validation-passed",
				"hidden-verifier-attempted",
				"hidden-verifier-passed",
			].includes(fact.phase as string) ||
			(fact.stoppedReason !== null &&
				![
					"budget-exhausted",
					"warm-preparation-failed",
					"workspace-cleanup-failed",
					"cancelled",
				].includes(fact.stoppedReason as string))
		) {
			throw new TypeError("D716 progress phase or stop reason is invalid");
		}
		digest(fact.provenanceDigest, "d716.progress.provenanceDigest");
	}
	if (snapshot.issueCodes.length > 32) throw new TypeError("D716 issue list exceeds its bound");
	for (const issueCode of snapshot.issueCodes) {
		if (typeof issueCode !== "string" || issueCode.length === 0 || issueCode.length > 128) {
			throw new TypeError("D716 issue code is invalid");
		}
	}
	if (snapshot.topology.length === 0 || snapshot.topology.length > 64) {
		throw new TypeError("D716 topology exceeds its bound");
	}
	for (const node of snapshot.topology) {
		const item = record(node, "d716.topologyNode");
		exactKeys(item, ["deps", "factory", "id"], "d716.topologyNode");
		if (
			typeof item.id !== "string" ||
			item.id.length === 0 ||
			item.id.length > 256 ||
			typeof item.factory !== "string" ||
			item.factory.length === 0 ||
			item.factory.length > 128 ||
			!Array.isArray(item.deps) ||
			item.deps.length > 16
		) {
			throw new TypeError("D716 topology node is invalid");
		}
	}
	const { evidenceDigest: _evidenceDigest, ...material } = snapshot;
	if (empiricalStrictJsonDigest(material) !== snapshot.evidenceDigest) {
		throw new TypeError("D716 coordination evidence digest mismatch");
	}
	return snapshot;
}
