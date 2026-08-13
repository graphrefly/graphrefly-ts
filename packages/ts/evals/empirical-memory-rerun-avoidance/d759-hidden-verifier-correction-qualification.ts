import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD759GraphHiddenVerifierCorrectionPolicy,
	type D720ToolRef,
	type D722AdmittedEffectFactV1,
	D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
	D759_HIDDEN_VERIFIER_CORRECTION_POLICY_REVISION,
} from "./d722-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	runD722GraphNativeEvalCore,
} from "./d722-graph-native-eval.js";
import { deriveD756GraphToolDirective } from "./d756-graph-named-tool-continuation.js";
import {
	D759_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD759Implementation,
} from "./d759-implementation-manifest.js";

export const D759_DECISION_REF = "decision.D759" as const;
export const D759_DECISION_REVISION = "2026-08-12.v1" as const;
export const D759_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d759.hidden-verifier-correction-qualification.v1" as const;
export const D759_GENERATION_SCHEMA =
	"graphrefly.b112.d759.hidden-verifier-correction-generation.v1" as const;
export const D759_BUNDLE_SCHEMA =
	"graphrefly.b112.d759.hidden-verifier-correction-bundle.v1" as const;
export const D759_GENERATION_REF = "d759-hidden-verifier-correction-no-network-v2" as const;
export const D759_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d759.hidden-verifier-correction-persistence.v1" as const;

export interface D759HiddenVerifierCorrectionBundleV1 {
	readonly schemaVersion: typeof D759_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly terminalFailureGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly wrongToolGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

const constructedBundles = new WeakSet<object>();
const sha = (value: unknown): string => empiricalStrictJsonDigest(value);
const LIMITS = Object.freeze({
	maxRequests: 96,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
});
const CEILINGS = Object.freeze({
	routeDigest: sha({ d759: "injected-no-network-route" }),
	providerMaxCostMicrousd: 50_000,
	providerMaxElapsedMs: 60_000,
	localEffectMaxElapsedMs: 60_000,
});

type CaseOptions = Readonly<{
	retryCorrectionOnce?: boolean;
	failSecondVerifier?: boolean;
	wrongCorrectionTool?: boolean;
}>;

function toolForPhase(phase: string): D720ToolRef {
	if (phase === "inspection") return "read-file";
	if (phase === "exact-mutation") return "replace-exact";
	if (phase === "workspace-diff") return "workspace-diff";
	if (phase === "focused-validation") return "focused-validation";
	throw new TypeError("D759 scripted phase is invalid");
}

async function runCase(
	label: string,
	options: CaseOptions,
): Promise<{
	readonly graph: D722CanonicalGraphEvidenceV1;
	readonly providerCalls: number;
	readonly retryWaits: number;
	readonly maxActive: number;
	readonly workspaceResidueCount: number;
}> {
	const workspaces = new Map<number, string>();
	const verifierAttempts = new Map<number, number>();
	const retriedLogicalRequests = new Set<string>();
	let providerCalls = 0;
	let retryWaits = 0;
	let retryInjected = false;
	let active = 0;
	let maxActive = 0;
	const executor = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		if (active !== 1) throw new TypeError("D759 observed parallel effects");
		try {
			if (effectRequest.effectKind === "materialization") {
				const workspace = sha({ label, run: effectRequest.runSequence, workspace: 0 });
				workspaces.set(effectRequest.runSequence, workspace);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: workspace,
						evidenceDigest: sha({ label, materialized: effectRequest.runSequence }),
					},
				};
			}
			if (effectRequest.effectKind === "provider-request") {
				providerCalls += 1;
				const workspace = workspaces.get(effectRequest.runSequence);
				if (workspace === undefined) throw new TypeError("D759 provider workspace is missing");
				if (
					options.retryCorrectionOnce === true &&
					!retryInjected &&
					effectRequest.completionContext?.reason === "hidden-verifier-failed" &&
					effectRequest.attemptOrdinal === 1
				) {
					retryInjected = true;
					retriedLogicalRequests.add(effectRequest.logicalRequestDigest);
					return {
						actualCostMicrousd: 1,
						actualElapsedMs: 1,
						result: {
							effectKind: "provider-request" as const,
							status: "retryable-failure" as const,
							toolIntents: Object.freeze([]),
							failureDiscriminator: "d710-untyped-http-429" as const,
							retryAfterMs: null,
							workspaceStateDigest: workspace,
							evidenceDigest: sha({ label, retry: effectRequest.logicalRequestDigest }),
						},
					};
				}
				if (effectRequest.completionContext?.requiredDisposition === "structured-final") {
					return {
						actualCostMicrousd: 1,
						actualElapsedMs: 1,
						result: {
							effectKind: "provider-request" as const,
							status: "structured-final" as const,
							toolIntents: Object.freeze([]),
							failureDiscriminator: "none" as const,
							retryAfterMs: null,
							workspaceStateDigest: workspace,
							evidenceDigest: sha({ label, final: effectRequest.requestDigest }),
						},
					};
				}
				const contextTool =
					effectRequest.completionContext === undefined
						? "read-file"
						: options.wrongCorrectionTool === true &&
								effectRequest.completionContext.reason === "hidden-verifier-failed"
							? "search-repository"
							: toolForPhase(effectRequest.completionContext.nextRequiredPhase);
				return {
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					result: {
						effectKind: "provider-request" as const,
						status: "tool-intents" as const,
						toolIntents: Object.freeze([
							Object.freeze({
								toolRef: contextTool,
								intentDigest: sha({ label, request: effectRequest.requestDigest, contextTool }),
							}),
						]),
						failureDiscriminator: "none" as const,
						retryAfterMs: null,
						workspaceStateDigest: workspace,
						evidenceDigest: sha({ label, tools: effectRequest.requestDigest }),
					},
				};
			}
			if (effectRequest.effectKind === "retry-wait") {
				retryWaits += 1;
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
					result: {
						effectKind: "retry-wait" as const,
						status: "completed" as const,
						evidenceDigest: sha({ label, waited: effectRequest.logicalRequestDigest }),
					},
				};
			}
			if (effectRequest.effectKind === "tool-action") {
				const intent = effectRequest.toolIntent;
				const before = workspaces.get(effectRequest.runSequence);
				if (intent === null || before === undefined)
					throw new TypeError("D759 tool workspace is missing");
				const after =
					intent.toolRef === "replace-exact"
						? sha({ before, mutation: intent.intentDigest })
						: before;
				workspaces.set(effectRequest.runSequence, after);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "tool-action" as const,
						toolRef: intent.toolRef,
						intentDigest: intent.intentDigest,
						status: "succeeded" as const,
						nonEmptyDiff: intent.toolRef === "workspace-diff",
						workspaceStateBeforeDigest: before,
						workspaceStateAfterDigest: after,
						evidenceDigest: sha({ label, tool: intent.intentDigest }),
					},
				};
			}
			if (effectRequest.effectKind === "hidden-verifier") {
				const attempts = (verifierAttempts.get(effectRequest.runSequence) ?? 0) + 1;
				verifierAttempts.set(effectRequest.runSequence, attempts);
				const status =
					attempts === 1 ||
					(options.failSecondVerifier === true && effectRequest.runSequence === 0 && attempts === 2)
						? ("failed" as const)
						: ("passed" as const);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "hidden-verifier" as const,
						status,
						workspaceStateDigest: workspaces.get(effectRequest.runSequence)!,
						evidenceDigest: sha({ label, verifier: effectRequest.runSequence, attempts, status }),
					},
				};
			}
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: sha({ label, cleanup: effectRequest.runSequence }),
				},
			};
		} finally {
			active -= 1;
		}
	});
	const policy = createD759GraphHiddenVerifierCorrectionPolicy();
	const run = await runD722GraphNativeEvalCore({
		sourceDigest: sha({ d759: label }),
		budgetLimits: LIMITS,
		effectCeilings: CEILINGS,
		executor,
		armLocalTerminalPolicy: createD726ArmLocalTerminalProviderPolicy(),
		objectivePhaseRecoveryPolicy: policy,
		signal: AbortSignal.timeout(30_000),
	});
	const graph = deriveD722CanonicalGraphEvidence(
		run.ledger,
		run.effectRuns,
		createD726ArmLocalTerminalProviderPolicy(),
		policy,
	);
	if (options.retryCorrectionOnce === true && retriedLogicalRequests.size !== 1)
		throw new TypeError("D759 correction retry was not exercised exactly once");
	return Object.freeze({
		graph,
		providerCalls,
		retryWaits,
		maxActive,
		workspaceResidueCount: workspaces.size,
	});
}

function correctionProof(graph: D722CanonicalGraphEvidenceV1): Readonly<Record<string, unknown>> {
	const correctionContexts = graph.completionContexts.filter(
		(context) => context.reason === "hidden-verifier-failed",
	);
	const correctionAttempts: readonly D722AdmittedEffectFactV1[] = graph.effectRuns.flatMap((run) =>
		run.facts.filter(
			(fact): fact is D722AdmittedEffectFactV1 =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.completionContext?.reason === "hidden-verifier-failed" &&
				fact.result.effectKind === "provider-request",
		),
	);
	const directives = correctionAttempts.map((fact) => deriveD756GraphToolDirective(fact.request));
	const retryGroups = new Map<string, typeof correctionAttempts>();
	for (const fact of correctionAttempts) {
		const key = `${fact.request.runSequence}:${fact.request.logicalRequestDigest}`;
		retryGroups.set(key, Object.freeze([...(retryGroups.get(key) ?? []), fact]));
	}
	const retried = [...retryGroups.values()].filter((facts) => facts.length > 1);
	const retryIdentity =
		retried.length === 1 &&
		retried[0]?.length === 2 &&
		new Set(retried[0].map((fact) => fact.request.logicalRequestDigest)).size === 1 &&
		new Set(retried[0].map((fact) => fact.request.completionContext?.contextDigest)).size === 1 &&
		retried[0][0]?.request.attemptOrdinal === 1 &&
		retried[0][1]?.request.attemptOrdinal === 2;
	return strictSnapshot({
		correctionContextCount: correctionContexts.length,
		correctionAttemptCount: correctionAttempts.length,
		namedMutationDirectiveCount: directives.filter(
			(directive) => directive?.requiredToolRef === "replace-exact",
		).length,
		retryIdentity,
	});
}

export async function runD759InjectedNoNetworkQualification(): Promise<D759HiddenVerifierCorrectionBundleV1> {
	if ((await measureD759Implementation()) !== D759_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D759 implementation manifest validation failed");
	const main = await runCase("main", { retryCorrectionOnce: true });
	const terminalFailure = await runCase("terminal-failure", { failSecondVerifier: true });
	const wrongTool = await runCase("wrong-tool", { wrongCorrectionTool: true });
	const proof = correctionProof(main.graph);
	const terminalCorrectionContexts = terminalFailure.graph.completionContexts.filter(
		(context) => context.reason === "hidden-verifier-failed",
	);
	const terminalRunZeroVerifierStatuses = terminalFailure.graph.effectRuns[0]?.facts.flatMap(
		(fact) =>
			fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "hidden-verifier"
				? [fact.result.status]
				: [],
	);
	const wrongToolExecuted = wrongTool.graph.effectRuns.some((run) =>
		run.facts.some(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "tool-action" &&
				fact.result.toolRef === "search-repository",
		),
	);
	if (
		main.graph.runStatus !== "complete" ||
		main.graph.ledger.completedArms.length !== 6 ||
		main.graph.effectRuns.length !== 6 ||
		main.graph.completionContexts.length !== 48 ||
		main.providerCalls !== 55 ||
		main.retryWaits !== 1 ||
		main.maxActive !== 1 ||
		main.workspaceResidueCount !== 0 ||
		proof.correctionContextCount !== 6 ||
		proof.correctionAttemptCount !== 7 ||
		proof.namedMutationDirectiveCount !== 7 ||
		proof.retryIdentity !== true ||
		!main.graph.effectRuns.every(
			(run) =>
				run.facts
					.flatMap((fact) =>
						fact.kind === "graph-effect-result-admitted" &&
						fact.result.effectKind === "hidden-verifier"
							? [fact.result.status]
							: [],
					)
					.join(",") === "failed,passed",
		) ||
		terminalFailure.graph.ledger.completedArms.length !== 6 ||
		terminalCorrectionContexts.length !== terminalFailure.graph.effectRuns.length ||
		terminalRunZeroVerifierStatuses?.join(",") !== "failed,failed" ||
		new Set(terminalCorrectionContexts.map((context) => context.runSequence)).size !==
			terminalCorrectionContexts.length ||
		wrongTool.graph.ledger.completedArms.length !== 6 ||
		wrongToolExecuted ||
		wrongTool.workspaceResidueCount !== 0
	)
		throw new TypeError("D759 no-network qualification coverage failed");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D759_QUALIFICATION_SCHEMA,
		decisionRef: D759_DECISION_REF,
		decisionRevision: D759_DECISION_REVISION,
		policyRevision: D759_HIDDEN_VERIFIER_CORRECTION_POLICY_REVISION,
		contextSchema: D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
		implementationManifestDigest: D759_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: main.graph.evidenceDigest,
		terminalFailureGraphEvidenceDigest: terminalFailure.graph.evidenceDigest,
		wrongToolGraphEvidenceDigest: wrongTool.graph.evidenceDigest,
		providerRequestCount: main.providerCalls,
		retryWaitCount: main.retryWaits,
		maxActiveArms: main.graph.ledger.maxActiveArms,
		maxActiveEffects: main.maxActive,
		workspaceResidueCount: main.workspaceResidueCount,
		correctionProof: proof,
		secondVerifierFailureDisposition: "arm-local-terminal" as const,
		wrongToolDisposition: "zero-tool-side-effect" as const,
		providerNetworkCalls: 0,
		materialFree: true,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: sha(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D759_GENERATION_SCHEMA,
		generationRef: D759_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		implementationManifestDigest: D759_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: main.graph.evidenceDigest,
		providerNetworkCalls: 0,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: sha(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D759_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence: main.graph,
		terminalFailureGraphEvidence: terminalFailure.graph,
		wrongToolGraphEvidence: wrongTool.graph,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: sha(material) });
	constructedBundles.add(bundle);
	return bundle as unknown as D759HiddenVerifierCorrectionBundleV1;
}

export function validateD759QualificationBundle(
	value: unknown,
): D759HiddenVerifierCorrectionBundleV1 {
	const candidate = record(value, "d759.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"executionClass",
			"generation",
			"graphEvidence",
			"qualification",
			"schemaVersion",
			"terminalFailureGraphEvidence",
			"wrongToolGraphEvidence",
		],
		"d759.bundle",
	);
	literal(candidate.schemaVersion, D759_BUNDLE_SCHEMA, "d759.bundle.schema");
	literal(candidate.executionClass, "simulated-contract", "d759.bundle.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d759.bundle.causal");
	literal(candidate.efficacyClaim, "none", "d759.bundle.efficacy");
	const policy = createD759GraphHiddenVerifierCorrectionPolicy();
	const replay = (raw: unknown, path: string): D722CanonicalGraphEvidenceV1 => {
		const graph = record(raw, path);
		const runs = array(graph.effectRuns, `${path}.effectRuns`);
		if (runs.length > 12) throw new TypeError("D759 Graph run bound exceeded");
		const derived = deriveD722CanonicalGraphEvidence(
			graph.ledger,
			runs as D722CanonicalGraphEvidenceV1["effectRuns"],
			createD726ArmLocalTerminalProviderPolicy(),
			policy,
		);
		literal(sha(graph), sha(derived), `${path}.canonicalReplay`);
		return derived;
	};
	const graphEvidence = replay(candidate.graphEvidence, "d759.graphEvidence");
	const terminalFailureGraphEvidence = replay(
		candidate.terminalFailureGraphEvidence,
		"d759.terminalFailureGraphEvidence",
	);
	const wrongToolGraphEvidence = replay(
		candidate.wrongToolGraphEvidence,
		"d759.wrongToolGraphEvidence",
	);
	const qualification = record(candidate.qualification, "d759.qualification");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"contextSchema",
			"correctionProof",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"materialFree",
			"maxActiveArms",
			"maxActiveEffects",
			"policyRevision",
			"providerNetworkCalls",
			"providerRequestCount",
			"qualificationDigest",
			"retryWaitCount",
			"schemaVersion",
			"secondVerifierFailureDisposition",
			"terminalFailureGraphEvidenceDigest",
			"workspaceResidueCount",
			"wrongToolDisposition",
			"wrongToolGraphEvidenceDigest",
		],
		"d759.qualification",
	);
	literal(qualification.schemaVersion, D759_QUALIFICATION_SCHEMA, "d759.qualification.schema");
	literal(qualification.decisionRef, D759_DECISION_REF, "d759.qualification.decisionRef");
	literal(qualification.decisionRevision, D759_DECISION_REVISION, "d759.qualification.revision");
	literal(
		qualification.policyRevision,
		D759_HIDDEN_VERIFIER_CORRECTION_POLICY_REVISION,
		"d759.qualification.policy",
	);
	literal(
		qualification.contextSchema,
		D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
		"d759.qualification.contextSchema",
	);
	literal(
		qualification.implementationManifestDigest,
		D759_IMPLEMENTATION_MANIFEST_DIGEST,
		"d759.qualification.implementation",
	);
	literal(qualification.graphEvidenceDigest, graphEvidence.evidenceDigest, "d759.graphDigest");
	literal(
		qualification.terminalFailureGraphEvidenceDigest,
		terminalFailureGraphEvidence.evidenceDigest,
		"d759.terminalGraphDigest",
	);
	literal(
		qualification.wrongToolGraphEvidenceDigest,
		wrongToolGraphEvidence.evidenceDigest,
		"d759.wrongToolGraphDigest",
	);
	literal(qualification.providerRequestCount, 55, "d759.providerRequests");
	literal(qualification.retryWaitCount, 1, "d759.retryWaits");
	literal(qualification.maxActiveArms, 1, "d759.maxActiveArms");
	literal(qualification.maxActiveEffects, 1, "d759.maxActiveEffects");
	literal(qualification.workspaceResidueCount, 0, "d759.workspaceResidue");
	literal(qualification.providerNetworkCalls, 0, "d759.networkCalls");
	literal(qualification.materialFree, true, "d759.materialFree");
	literal(
		qualification.secondVerifierFailureDisposition,
		"arm-local-terminal",
		"d759.secondFailure",
	);
	literal(qualification.wrongToolDisposition, "zero-tool-side-effect", "d759.wrongTool");
	literal(qualification.causalAttribution, "undetermined", "d759.qualification.causal");
	literal(qualification.efficacyClaim, "none", "d759.qualification.efficacy");
	const proof = record(qualification.correctionProof, "d759.correctionProof");
	exactKeys(
		proof,
		[
			"correctionAttemptCount",
			"correctionContextCount",
			"namedMutationDirectiveCount",
			"retryIdentity",
		],
		"d759.correctionProof",
	);
	literal(proof.correctionContextCount, 6, "d759.proof.contexts");
	literal(proof.correctionAttemptCount, 7, "d759.proof.attempts");
	literal(proof.namedMutationDirectiveCount, 7, "d759.proof.namedMutation");
	literal(proof.retryIdentity, true, "d759.proof.retryIdentity");
	const qualificationDigest = digest(
		qualification.qualificationDigest,
		"d759.qualification.digest",
	);
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
	literal(
		qualification.qualificationDigest,
		sha(qualificationMaterial),
		"d759.qualification.digestBinding",
	);
	const generation = record(candidate.generation, "d759.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"providerNetworkCalls",
			"qualificationDigest",
			"schemaVersion",
		],
		"d759.generation",
	);
	literal(generation.schemaVersion, D759_GENERATION_SCHEMA, "d759.generation.schema");
	literal(generation.generationRef, D759_GENERATION_REF, "d759.generation.ref");
	literal(generation.qualificationDigest, qualificationDigest, "d759.generation.qualification");
	literal(
		generation.implementationManifestDigest,
		D759_IMPLEMENTATION_MANIFEST_DIGEST,
		"d759.generation.implementation",
	);
	literal(generation.graphEvidenceDigest, graphEvidence.evidenceDigest, "d759.generation.graph");
	literal(generation.providerNetworkCalls, 0, "d759.generation.network");
	literal(generation.causalAttribution, "undetermined", "d759.generation.causal");
	literal(generation.efficacyClaim, "none", "d759.generation.efficacy");
	digest(generation.generationDigest, "d759.generation.digest");
	const { generationDigest: _generationDigest, ...generationMaterial } = generation;
	literal(generation.generationDigest, sha(generationMaterial), "d759.generation.digestBinding");
	digest(candidate.bundleDigest, "d759.bundle.digest");
	const { bundleDigest: _bundleDigest, ...material } = candidate;
	literal(candidate.bundleDigest, sha(material), "d759.bundle.digestBinding");
	return Object.freeze({
		...strictSnapshot(material),
		bundleDigest: candidate.bundleDigest as string,
	}) as unknown as D759HiddenVerifierCorrectionBundleV1;
}

export function isConstructedD759QualificationBundle(
	value: unknown,
): value is D759HiddenVerifierCorrectionBundleV1 {
	return typeof value === "object" && value !== null && constructedBundles.has(value);
}

export interface D759PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d759.persistence-fault.v1";
}

type PersistenceStage = "after-write" | "after-rename";
type Identity = Readonly<{ dev: number; ino: number }>;
const persistenceFaults = new WeakMap<object, { stage: PersistenceStage; consumed: boolean }>();

export function createD759PersistenceFaultForTest(stage: PersistenceStage): D759PersistenceFaultV1 {
	if (stage !== "after-write" && stage !== "after-rename")
		throw new TypeError("D759 persistence fault stage is invalid");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d759.persistence-fault.v1" as const,
	});
	persistenceFaults.set(capability, { stage, consumed: false });
	return capability;
}

async function assertD759Directory(path: string, identity: Identity): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D759 persistence directory identity drifted");
}

async function writeD759File(path: string, bytes: Uint8Array): Promise<Identity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D759 persistence file identity drifted");
		return Object.freeze({ dev: stat.dev, ino: stat.ino });
	} finally {
		await handle.close();
	}
}

async function assertD759File(path: string, identity: Identity, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("D759 persistence file readback drifted");
	} finally {
		await handle.close();
	}
}

function d759Artifact(name: string, bytes: Uint8Array): readonly [string, Uint8Array] {
	return Object.freeze([name, bytes] as const);
}

export async function persistD759QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D759HiddenVerifierCorrectionBundleV1;
	readonly fault?: D759PersistenceFaultV1;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(inputValue, "d759.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d759.persist",
	);
	if (!constructedBundles.delete(input.bundle as object))
		throw new TypeError("D759 persistence requires a same-process constructed bundle");
	const bundle = validateD759QualificationBundle(input.bundle);
	let fault: PersistenceStage | null = null;
	if (Object.hasOwn(input, "fault")) {
		const state =
			typeof input.fault === "object" && input.fault !== null
				? persistenceFaults.get(input.fault)
				: undefined;
		if (state === undefined || state.consumed)
			throw new TypeError("D759 persistence fault is invalid or consumed");
		state.consumed = true;
		fault = state.stage;
	}
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D759 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D759 private root is not canonical");
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let operationError: unknown = null;
	let finalIdentity: Identity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactBytes: readonly (readonly [string, Uint8Array])[] = [];
	try {
		const parentStat = await parentHandle.stat();
		const parentIdentity = Object.freeze({ dev: parentStat.dev, ino: parentStat.ino });
		await assertD759Directory(privateRoot, parentIdentity);
		const finalRoot = join(privateRoot, D759_GENERATION_REF);
		await mkdir(finalRoot, { mode: 0o700 });
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const finalStat = await finalHandle.stat();
		finalIdentity = Object.freeze({ dev: finalStat.dev, ino: finalStat.ino });
		await assertD759Directory(finalRoot, finalIdentity);
		artifactBytes = Object.freeze([
			d759Artifact("graph-evidence.v1.json", strictJsonCodec.encode(bundle.graphEvidence)),
			d759Artifact(
				"terminal-failure-graph-evidence.v1.json",
				strictJsonCodec.encode(bundle.terminalFailureGraphEvidence),
			),
			d759Artifact(
				"wrong-tool-graph-evidence.v1.json",
				strictJsonCodec.encode(bundle.wrongToolGraphEvidence),
			),
			d759Artifact("qualification.v1.json", strictJsonCodec.encode(bundle.qualification)),
			d759Artifact("generation.v1.json", strictJsonCodec.encode(bundle.generation)),
			d759Artifact("bundle.v1.json", strictJsonCodec.encode(bundle)),
		]);
		const staging = join(finalRoot, `.d759-staging-${randomUUID()}`);
		await mkdir(staging, { mode: 0o700 });
		const stagingStat = await lstat(staging);
		const stagingIdentity = Object.freeze({ dev: stagingStat.dev, ino: stagingStat.ino });
		await assertD759Directory(staging, stagingIdentity);
		const fileIdentities = new Map<string, Identity>();
		for (const [name, bytes] of artifactBytes)
			fileIdentities.set(name, await writeD759File(join(staging, name), bytes));
		const stagingHandle = await open(
			staging,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of artifactBytes)
			await assertD759File(join(staging, name), fileIdentities.get(name)!, bytes);
		if (fault === "after-write") throw new TypeError("D759 injected after-write failure");
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(staging, artifactsRoot);
		artifactsHandle = await open(
			artifactsRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStat = await artifactsHandle.stat();
		const artifactsIdentity = Object.freeze({ dev: artifactsStat.dev, ino: artifactsStat.ino });
		if (
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D759 artifact rename identity drifted");
		if (fault === "after-rename") throw new TypeError("D759 injected after-rename failure");
		const commitBytes = strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly.b112.d759.atomic-commit.v1",
				generationRef: D759_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				artifactsDirectory: "artifacts",
			}),
		);
		const commitIdentity = await writeD759File(join(finalRoot, "commit.v1.json"), commitBytes);
		await finalHandle.sync();
		await parentHandle.sync();
		for (const [name, bytes] of artifactBytes)
			await assertD759File(join(artifactsRoot, name), fileIdentities.get(name)!, bytes);
		await assertD759File(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		await assertD759Directory(privateRoot, parentIdentity);
		await assertD759Directory(finalRoot, finalIdentity);
		await assertD759Directory(artifactsRoot, artifactsIdentity);
		const [finalStable, artifactsStable] = await Promise.all([
			finalHandle.stat(),
			artifactsHandle.stat(),
		]);
		if (
			finalStable.dev !== finalIdentity.dev ||
			finalStable.ino !== finalIdentity.ino ||
			artifactsStable.dev !== artifactsIdentity.dev ||
			artifactsStable.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D759 stable persistence handle drifted");
		await assertD759Directory(privateRoot, parentIdentity);
		await assertD759Directory(finalRoot, finalIdentity);
		await assertD759Directory(artifactsRoot, artifactsIdentity);
	} catch (error) {
		operationError = error;
	}
	const closes = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closes
		.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
		.map((entry) => entry.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D759 persistence handle cleanup failed",
		);
	const finalRoot = join(privateRoot, D759_GENERATION_REF);
	let cleanupError: unknown = null;
	if (operationError !== null && finalIdentity !== null) {
		const current = await lstat(finalRoot).catch(() => null);
		if (current?.dev === finalIdentity.dev && current.ino === finalIdentity.ino) {
			try {
				const tombstone = join(privateRoot, `.d759-tombstone-${randomUUID()}`);
				await rename(finalRoot, tombstone);
				const moved = await lstat(tombstone);
				if (moved.dev !== finalIdentity.dev || moved.ino !== finalIdentity.ino)
					throw new TypeError("D759 cleanup tombstone ownership drifted");
				await rm(tombstone, { recursive: true, force: true });
				await parentHandle.sync();
			} catch (error) {
				cleanupError = error;
			}
		} else cleanupError = new TypeError("D759 persistence cleanup ownership drifted");
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1) throw new AggregateError(errors, "D759 persistence cleanup failed");
		throw operationError;
	}
	const receiptMaterial = strictSnapshot({
		schemaVersion: D759_PERSISTENCE_SCHEMA,
		generationRef: D759_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		artifactDigests: artifactBytes.map(([name, bytes]) => ({
			name,
			sha256: empiricalSha256(bytes),
		})),
	});
	return Object.freeze({ ...receiptMaterial, persistenceDigest: sha(receiptMaterial) });
}
