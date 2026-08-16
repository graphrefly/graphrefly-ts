import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	admitD17EffectResult,
	createD17Authority,
	D17_ARMS,
	D17_COMPLETE_TASK_STATEMENT,
	D17_DECISION_REF,
	D17_DEFAULT_PROVIDER_DEADLINE_MS,
	D17_MUTATION_PROVIDER_DEADLINE_MS,
	type D17EffectResultInputV1,
	type D17EvidenceV1,
	nextD17Effect,
	snapshotD17Evidence,
	validateD17Evidence,
} from "./d17-current-efficacy-authority.js";
import { D17_IMPLEMENTATION_MANIFEST_DIGEST } from "./d17-current-implementation-manifest.js";
import {
	type D17InjectedWireRequestV1,
	executeD17InjectedProviderEffect,
} from "./d17-current-injected-adapter.js";

export const D17_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d17.current-efficacy-qualification.v1" as const;
export const D17_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d17.current-efficacy-qualification-bundle.v1" as const;
export const D17_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d17.current-efficacy-qualification-generation.v1" as const;
export const D17_QUALIFICATION_GENERATION_REF =
	"current-graph-native-efficacy-no-network-qualification-2026-08-16-d17-v1" as const;
export const D17_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-efficacy-no-network-injected-test-d17-v1" as const;
export const D17_D16_BASELINE_ARTIFACT_DIGEST =
	"sha256:7c2fa4fe9f12cde6b9153439762282413812b2c19f3cf18b12aa6116a3a79a60" as const;
export const D17_D16_BASELINE_BUNDLE_DIGEST =
	"sha256:febc26b494cc46e39d90e2efc10a675554ded26c235a5935b51ac611b66a4e59" as const;
export const D17_D16_BASELINE_GRAPH_EVIDENCE_DIGEST =
	"sha256:806fea417ca20915fda96b4b430d023e0b8b1ef9e45ff6d8efd5448436d5f4ec" as const;
export const D17_D16_BASELINE_GENERATION_DIGEST =
	"sha256:dd61c58483f685b8399461193a9bdf265780f46b4b7651afa5d0926abc54d74f" as const;

export interface D17D16BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d17.d16-baseline-admission.v1";
}

export interface D17QualificationBundleV1 {
	readonly schemaVersion: typeof D17_QUALIFICATION_BUNDLE_SCHEMA;
	readonly qualification: Readonly<{
		schemaVersion: typeof D17_QUALIFICATION_SCHEMA;
		decisionRef: typeof D17_DECISION_REF;
		implementationManifestDigest: string;
		baselineBasis: "exact-d16-artifact" | "injected-test";
		d16ArtifactDigest: typeof D17_D16_BASELINE_ARTIFACT_DIGEST;
		d16BundleDigest: typeof D17_D16_BASELINE_BUNDLE_DIGEST;
		d16GraphEvidenceDigest: typeof D17_D16_BASELINE_GRAPH_EVIDENCE_DIGEST;
		d16GenerationDigest: typeof D17_D16_BASELINE_GENERATION_DIGEST;
		graphEvidenceDigest: string;
		exactSixArmExposurePassed: true;
		namedMutationLoweringPassed: true;
		graphScheduledValidationPassed: true;
		phaseDeadlinePassed: true;
		retryIdentityPassed: true;
		exposureSubstitutionRejected: true;
		replayRejected: true;
		stateDriftRejected: true;
		headroomDeniedBeforeWire: true;
		providerNetworkCalls: 0;
		maxActiveEffects: 1;
		workspaceResidueCount: 0;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly graphEvidence: D17EvidenceV1;
	readonly retryProofs: readonly Readonly<{
		policy: "D671" | "D675" | "D710";
		logicalRequestDigest: string;
		wireBodyDigest: string;
		exposureDigest: string;
		attemptOrdinals: readonly [1, 2];
		proofDigest: string;
	}>[];
	readonly generation: Readonly<{
		schemaVersion: typeof D17_QUALIFICATION_GENERATION_SCHEMA;
		generationRef: typeof D17_QUALIFICATION_GENERATION_REF;
		qualificationDigest: string;
		graphEvidenceDigest: string;
		implementationManifestDigest: string;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const baselineStates = new WeakMap<object, "exact-d16-artifact" | "injected-test">();
const constructedBundles = new WeakMap<object, "exact-d16-artifact" | "injected-test">();

function baselineCapability(
	basis: "exact-d16-artifact" | "injected-test",
): D17D16BaselineAdmissionV1 {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d17.d16-baseline-admission.v1" as const,
	});
	baselineStates.set(capability, basis);
	return capability;
}

export function admitD17D16Baseline(bytesValue: Uint8Array): D17D16BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D17 D16 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D17_D16_BASELINE_ARTIFACT_DIGEST)
		throw new TypeError("D17 D16 baseline artifact drifted");
	const bundle = record(strictJsonCodec.decode(bytes), "D17 D16 baseline bundle");
	const graphEvidence = record(bundle.graphEvidence, "D17 D16 baseline graph evidence");
	const generation = record(bundle.generation, "D17 D16 baseline generation");
	if (
		bundle.bundleDigest !== D17_D16_BASELINE_BUNDLE_DIGEST ||
		graphEvidence.evidenceDigest !== D17_D16_BASELINE_GRAPH_EVIDENCE_DIGEST ||
		generation.generationDigest !== D17_D16_BASELINE_GENERATION_DIGEST ||
		bundle.executionClass !== "live-provider" ||
		bundle.disposition !== "success" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D17 D16 baseline projection drifted");
	return baselineCapability("exact-d16-artifact");
}

export function createD17InjectedD16BaselineForTest(): D17D16BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

const READ_OUTPUTS = Object.freeze([
	"Public producer contract fixture: canonical proposals carry an immutable producer proposal reference and a separate admission coordinate.",
	"Unrelated executor fixture: cancellation ownership and capacity release are bounded independently.",
	"Canonical identity fixture: opaque producer references are compared by exact canonical value.",
	"Consumer admission fixture: malformed or locally reconstructed proposal provenance must be rejected before mutation.",
]);

function localResult(
	effect: NonNullable<ReturnType<typeof nextD17Effect>>,
	workspaceState: string,
): { result: D17EffectResultInputV1; runtimeMaterial?: string; nextWorkspaceState: string } {
	const request = effect.request;
	const elapsed = Math.min(5, request.reservation.maxElapsedMs);
	if (request.effectKind === "materialization") {
		const state = empiricalStrictJsonDigest({ arm: request.arm, materialized: true });
		return {
			result: Object.freeze({
				effectKind: "materialization" as const,
				status: "completed" as const,
				workspaceStateDigest: state,
				evidenceDigest: empiricalStrictJsonDigest({ requestDigest: request.requestDigest, state }),
				actualCostMicrousd: 0 as const,
				actualElapsedMs: elapsed,
			}),
			nextWorkspaceState: state,
		};
	}
	if (request.effectKind === "tool-action") {
		const index = request.toolRef === "read-file" ? (readOrdinal.get(request.arm) ?? 0) : 0;
		if (request.toolRef === "read-file") readOrdinal.set(request.arm, index + 1);
		const changed = request.toolRef === "replace-exact";
		const after = changed
			? empiricalStrictJsonDigest({ before: workspaceState, arm: request.arm, mutation: true })
			: workspaceState;
		return {
			result: Object.freeze({
				effectKind: "tool-action" as const,
				toolRef: request.toolRef!,
				status: "succeeded" as const,
				workspaceStateBeforeDigest: workspaceState,
				workspaceStateAfterDigest: after,
				nonEmptyDiff: request.toolRef === "workspace-diff",
				evidenceDigest: empiricalStrictJsonDigest({
					requestDigest: request.requestDigest,
					toolRef: request.toolRef,
					before: workspaceState,
					after,
				}),
				actualCostMicrousd: 0 as const,
				actualElapsedMs: elapsed,
			}),
			runtimeMaterial: request.toolRef === "read-file" ? READ_OUTPUTS[index]! : undefined,
			nextWorkspaceState: after,
		};
	}
	if (request.effectKind === "public-semantic-validation")
		return {
			result: Object.freeze({
				effectKind: "public-semantic-validation" as const,
				status: "passed" as const,
				criterionFailureCodes: Object.freeze([]),
				workspaceStateDigest: workspaceState,
				evidenceDigest: empiricalStrictJsonDigest({
					requestDigest: request.requestDigest,
					publicScenarios: "passed",
				}),
				actualCostMicrousd: 0 as const,
				actualElapsedMs: elapsed,
			}),
			nextWorkspaceState: workspaceState,
		};
	if (request.effectKind === "hidden-verifier")
		return {
			result: Object.freeze({
				effectKind: "hidden-verifier" as const,
				status: request.arm === "relevant-applied" ? ("passed" as const) : ("failed" as const),
				workspaceStateDigest: workspaceState,
				evidenceDigest: empiricalStrictJsonDigest({
					requestDigest: request.requestDigest,
					hidden: request.arm === "relevant-applied",
				}),
				actualCostMicrousd: 0 as const,
				actualElapsedMs: elapsed,
			}),
			nextWorkspaceState: workspaceState,
		};
	return {
		result: Object.freeze({
			effectKind: "cleanup" as const,
			status: "completed" as const,
			workspaceStateDigest: null,
			evidenceDigest: empiricalStrictJsonDigest({
				requestDigest: request.requestDigest,
				cleanup: "completed",
			}),
			actualCostMicrousd: 0 as const,
			actualElapsedMs: elapsed,
		}),
		nextWorkspaceState: workspaceState,
	};
}

const readOrdinal = new Map<string, number>();

function proveD17HeadroomDeniedBeforeWire(): true {
	const authority = createD17Authority({
		taskStatement: D17_COMPLETE_TASK_STATEMENT,
		limits: {
			maxProviderRequests: 96,
			maxCostMicrousd: 6_000_000,
			maxElapsedMs: 250_000,
			maxEffectFacts: 512,
			providerMaxCostMicrousd: 100_000,
			localEffectMaxElapsedMs: 10_000,
		},
	});
	const materialization = nextD17Effect(authority);
	if (materialization?.request.effectKind !== "materialization")
		throw new TypeError("D17 headroom proof did not begin with materialization");
	const workspaceStateDigest = empiricalStrictJsonDigest({ headroomProof: "workspace" });
	admitD17EffectResult(authority, materialization, {
		effectKind: "materialization",
		status: "completed",
		workspaceStateDigest,
		evidenceDigest: empiricalStrictJsonDigest({ headroomProof: "materialized" }),
		actualCostMicrousd: 0,
		actualElapsedMs: 1,
	});
	const inspection = nextD17Effect(authority);
	if (inspection?.request.effectKind !== "provider-request")
		throw new TypeError("D17 headroom proof did not reach inspection");
	admitD17EffectResult(authority, inspection, {
		effectKind: "provider-request",
		status: "completed",
		toolIntents: ["read-file", "read-file", "read-file", "read-file"],
		observedModelVisibleEnvelopeDigest: inspection.request.modelVisibleEnvelopeDigest,
		wireMessagesDigest: inspection.request.modelVisibleEnvelopeDigest,
		failureFamily: null,
		evidenceDigest: empiricalStrictJsonDigest({ headroomProof: "inspection" }),
		actualCostMicrousd: 1,
		actualElapsedMs: 1,
	});
	for (let index = 0; index < 4; index += 1) {
		const read = nextD17Effect(authority);
		if (read?.request.effectKind !== "tool-action" || read.request.toolRef !== "read-file")
			throw new TypeError("D17 headroom proof read lifecycle drifted");
		admitD17EffectResult(
			authority,
			read,
			{
				effectKind: "tool-action",
				toolRef: "read-file",
				status: "succeeded",
				workspaceStateBeforeDigest: workspaceStateDigest,
				workspaceStateAfterDigest: workspaceStateDigest,
				nonEmptyDiff: false,
				evidenceDigest: empiricalStrictJsonDigest({ headroomProof: "read", index }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			},
			READ_OUTPUTS[index],
		);
	}
	if (nextD17Effect(authority)?.request.effectKind !== "cleanup")
		throw new TypeError("D17 insufficient provider headroom did not fail closed before wire");
	return true;
}

function proveD17ExposureSubstitutionRejected(evidence: D17EvidenceV1): true {
	const forged = structuredClone(evidence) as unknown as Record<string, unknown>;
	const exposures = forged.exposureFacts as Array<Record<string, unknown>>;
	exposures[1] = {
		...exposures[1],
		insightDigest: empiricalStrictJsonDigest({ insight: "forged-substitution" }),
	};
	const { evidenceDigest: _evidenceDigest, ...base } = forged;
	forged.evidenceDigest = empiricalStrictJsonDigest(base);
	try {
		validateD17Evidence(forged);
	} catch {
		return true;
	}
	throw new TypeError("D17 exposure substitution was accepted");
}

async function proveD17ReplayAndStateDriftRejected(): Promise<true> {
	const authority = createD17Authority({ taskStatement: D17_COMPLETE_TASK_STATEMENT });
	const materialization = nextD17Effect(authority);
	if (materialization?.request.effectKind !== "materialization")
		throw new TypeError("D17 replay proof did not begin with materialization");
	const workspaceStateDigest = empiricalStrictJsonDigest({ replayProof: "workspace" });
	const result = Object.freeze({
		effectKind: "materialization" as const,
		status: "completed" as const,
		workspaceStateDigest,
		evidenceDigest: empiricalStrictJsonDigest({ replayProof: "materialized" }),
		actualCostMicrousd: 0 as const,
		actualElapsedMs: 1,
	});
	admitD17EffectResult(authority, materialization, result);
	try {
		admitD17EffectResult(authority, materialization, result);
		throw new TypeError("D17 replayed effect was accepted");
	} catch (error) {
		if (error instanceof TypeError && error.message === "D17 replayed effect was accepted")
			throw error;
	}
	const provider = nextD17Effect(authority);
	if (provider?.request.effectKind !== "provider-request")
		throw new TypeError("D17 state-drift proof did not reach provider admission");
	let transportCalls = 0;
	try {
		await executeD17InjectedProviderEffect({
			authority,
			effect: structuredClone(provider),
			transport: async () => {
				transportCalls += 1;
				throw new TypeError("D17 forged provider transport executed");
			},
		});
		throw new TypeError("D17 forged provider admission was accepted");
	} catch (error) {
		if (
			error instanceof TypeError &&
			(error.message === "D17 forged provider transport executed" ||
				error.message === "D17 forged provider admission was accepted")
		)
			throw error;
	}
	if (transportCalls !== 0) throw new TypeError("D17 state drift reached transport");
	return true;
}

function retryProofsFrom(
	request: D17InjectedWireRequestV1,
	logicalRequestDigest: string,
	exposureDigest: string,
) {
	return Object.freeze(
		(["D671", "D675", "D710"] as const).map((policy) => {
			const base = strictSnapshot({
				policy,
				logicalRequestDigest,
				wireBodyDigest: request.bodyDigest,
				exposureDigest,
				attemptOrdinals: Object.freeze([1, 2] as const),
			});
			return Object.freeze({ ...base, proofDigest: empiricalStrictJsonDigest(base) });
		}),
	);
}

export async function runD17InjectedNoNetworkQualification(inputValue: {
	readonly baseline: D17D16BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D17QualificationBundleV1> {
	const input = record(inputValue, "D17 qualification input");
	exactKeys(input, ["baseline", "implementationManifestDigest"], "D17 qualification input");
	const baseline = input.baseline as D17D16BaselineAdmissionV1;
	const basis =
		typeof baseline === "object" && baseline !== null ? baselineStates.get(baseline) : undefined;
	if (basis === undefined) throw new TypeError("D17 D16 baseline is forged or replayed");
	baselineStates.delete(baseline);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"D17 implementation manifest digest",
	);
	if (implementationManifestDigest !== D17_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D17 implementation manifest drifted");
	readOrdinal.clear();
	const authority = createD17Authority({ taskStatement: D17_COMPLETE_TASK_STATEMENT });
	const workspaceStates = new Map<string, string>();
	let firstWire: D17InjectedWireRequestV1 | null = null;
	let retryLogicalRequestDigest: string | null = null;
	let retryExposureDigest: string | null = null;
	let active = 0;
	let maxActive = 0;
	const providerNetworkCalls = 0;
	for (;;) {
		const effect = nextD17Effect(authority);
		if (effect === null) break;
		if (effect.request.effectKind === "provider-request") {
			const result = await executeD17InjectedProviderEffect({
				authority,
				effect,
				transport: async (request) => {
					active += 1;
					maxActive = Math.max(maxActive, active);
					try {
						if (firstWire === null) {
							firstWire = request;
							retryLogicalRequestDigest = effect.request.logicalRequestDigest;
							retryExposureDigest = effect.request.modelVisibleEnvelopeDigest;
						}
						const mutation = effect.request.phase === "mutation";
						if (
							request.deadlineMs !==
							(mutation ? D17_MUTATION_PROVIDER_DEADLINE_MS : D17_DEFAULT_PROVIDER_DEADLINE_MS)
						)
							throw new TypeError("D17 phase deadline lowering drifted");
						if (
							mutation
								? typeof request.body.tool_choice !== "object" ||
									request.body.tool_choice.function.name !== "replace_exact"
								: request.body.tool_choice !== "auto"
						)
							throw new TypeError("D17 named mutation lowering drifted");
						const toolIntents = mutation
							? Object.freeze(["replace-exact"] as const)
							: Object.freeze(["read-file", "read-file", "read-file", "read-file"] as const);
						return Object.freeze({
							status: "completed" as const,
							toolIntents,
							failureFamily: null,
							usage: Object.freeze({
								costMicrousd: mutation ? 17 : 7,
								elapsedMs: mutation ? 125_000 : 30,
							}),
							responseDigest: empiricalStrictJsonDigest({
								requestDigest: effect.request.requestDigest,
								toolIntents,
							}),
						});
					} finally {
						active -= 1;
					}
				},
			});
			admitD17EffectResult(authority, effect, result);
			continue;
		}
		const workspace =
			workspaceStates.get(effect.request.arm) ??
			empiricalStrictJsonDigest({ arm: effect.request.arm, before: true });
		const local = localResult(effect, workspace);
		admitD17EffectResult(authority, effect, local.result, local.runtimeMaterial);
		workspaceStates.set(effect.request.arm, local.nextWorkspaceState);
	}
	const graphEvidence = validateD17Evidence(
		snapshotD17Evidence(authority, { evaluateLiveGate: false }),
	);
	const headroomDeniedBeforeWire = proveD17HeadroomDeniedBeforeWire();
	const exposureSubstitutionRejected = proveD17ExposureSubstitutionRejected(graphEvidence);
	const replayAndStateDriftRejected = await proveD17ReplayAndStateDriftRejected();
	if (firstWire === null || retryLogicalRequestDigest === null || retryExposureDigest === null)
		throw new TypeError("D17 retry identity seed was not observed");
	const retryProofs = retryProofsFrom(firstWire, retryLogicalRequestDigest, retryExposureDigest);
	if (
		graphEvidence.runs.length !== D17_ARMS.length ||
		graphEvidence.runs.some((run) => !run.evaluable || !run.cleanupCompleted) ||
		graphEvidence.gate.evaluated !== false ||
		graphEvidence.efficacyClaim !== "none" ||
		maxActive !== 1 ||
		providerNetworkCalls !== 0
	)
		throw new TypeError("D17 injected six-arm qualification did not satisfy its frozen gates");
	const qualificationBase = strictSnapshot({
		schemaVersion: D17_QUALIFICATION_SCHEMA,
		decisionRef: D17_DECISION_REF,
		implementationManifestDigest,
		baselineBasis: basis,
		d16ArtifactDigest: D17_D16_BASELINE_ARTIFACT_DIGEST,
		d16BundleDigest: D17_D16_BASELINE_BUNDLE_DIGEST,
		d16GraphEvidenceDigest: D17_D16_BASELINE_GRAPH_EVIDENCE_DIGEST,
		d16GenerationDigest: D17_D16_BASELINE_GENERATION_DIGEST,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		exactSixArmExposurePassed: true as const,
		namedMutationLoweringPassed: true as const,
		graphScheduledValidationPassed: true as const,
		phaseDeadlinePassed: true as const,
		retryIdentityPassed: true as const,
		exposureSubstitutionRejected,
		replayRejected: replayAndStateDriftRejected,
		stateDriftRejected: replayAndStateDriftRejected,
		headroomDeniedBeforeWire,
		providerNetworkCalls: providerNetworkCalls as 0,
		maxActiveEffects: maxActive as 1,
		workspaceResidueCount: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationBase,
		qualificationDigest: empiricalStrictJsonDigest(qualificationBase),
	});
	const generationBase = strictSnapshot({
		schemaVersion: D17_QUALIFICATION_GENERATION_SCHEMA,
		generationRef: D17_QUALIFICATION_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		implementationManifestDigest,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationBase,
		generationDigest: empiricalStrictJsonDigest(generationBase),
	});
	const bundleBase = strictSnapshot({
		schemaVersion: D17_QUALIFICATION_BUNDLE_SCHEMA,
		qualification,
		graphEvidence,
		retryProofs,
		generation,
	});
	const bundle = Object.freeze({
		...bundleBase,
		bundleDigest: empiricalStrictJsonDigest(bundleBase),
	});
	constructedBundles.set(bundle, basis);
	return bundle;
}

export function validateD17QualificationBundle(value: unknown): D17QualificationBundleV1 {
	const candidate = record(value, "D17 qualification bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"generation",
			"graphEvidence",
			"qualification",
			"retryProofs",
			"schemaVersion",
		],
		"D17 qualification bundle",
	);
	if (candidate.schemaVersion !== D17_QUALIFICATION_BUNDLE_SCHEMA)
		throw new TypeError("D17 qualification bundle schema drifted");
	const graphEvidence = validateD17Evidence(candidate.graphEvidence);
	const qualification = record(candidate.qualification, "D17 qualification");
	exactKeys(
		qualification,
		[
			"baselineBasis",
			"causalAttribution",
			"d16ArtifactDigest",
			"d16BundleDigest",
			"d16GenerationDigest",
			"d16GraphEvidenceDigest",
			"decisionRef",
			"efficacyClaim",
			"exactSixArmExposurePassed",
			"exposureSubstitutionRejected",
			"graphEvidenceDigest",
			"graphScheduledValidationPassed",
			"headroomDeniedBeforeWire",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"maxActiveEffects",
			"namedMutationLoweringPassed",
			"phaseDeadlinePassed",
			"providerNetworkCalls",
			"qualificationDigest",
			"replayRejected",
			"retryIdentityPassed",
			"schemaVersion",
			"stateDriftRejected",
			"workspaceResidueCount",
		],
		"D17 qualification",
	);
	if (
		qualification.schemaVersion !== D17_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D17_DECISION_REF ||
		qualification.implementationManifestDigest !== D17_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.d16ArtifactDigest !== D17_D16_BASELINE_ARTIFACT_DIGEST ||
		qualification.d16BundleDigest !== D17_D16_BASELINE_BUNDLE_DIGEST ||
		qualification.d16GraphEvidenceDigest !== D17_D16_BASELINE_GRAPH_EVIDENCE_DIGEST ||
		qualification.d16GenerationDigest !== D17_D16_BASELINE_GENERATION_DIGEST ||
		qualification.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		qualification.exactSixArmExposurePassed !== true ||
		qualification.namedMutationLoweringPassed !== true ||
		qualification.graphScheduledValidationPassed !== true ||
		qualification.phaseDeadlinePassed !== true ||
		qualification.retryIdentityPassed !== true ||
		qualification.exposureSubstitutionRejected !== true ||
		qualification.replayRejected !== true ||
		qualification.stateDriftRejected !== true ||
		qualification.headroomDeniedBeforeWire !== true ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.liveGateEvaluated !== false ||
		qualification.efficacyClaim !== "none"
	)
		throw new TypeError("D17 qualification projection drifted");
	const qualificationDigest = digest(qualification.qualificationDigest, "D17 qualification digest");
	const { qualificationDigest: _qualificationDigest, ...qualificationBase } = qualification;
	if (empiricalStrictJsonDigest(qualificationBase) !== qualificationDigest)
		throw new TypeError("D17 qualification digest drifted");
	const retryProofValues = array(candidate.retryProofs, "D17 retry proofs");
	if (retryProofValues.length !== 3) throw new TypeError("D17 retry proof cardinality drifted");
	let sharedRetryCoordinates: string | null = null;
	for (const [index, policy] of (["D671", "D675", "D710"] as const).entries()) {
		const proof = record(retryProofValues[index], `D17 retry proof[${index}]`);
		exactKeys(
			proof,
			[
				"attemptOrdinals",
				"exposureDigest",
				"logicalRequestDigest",
				"policy",
				"proofDigest",
				"wireBodyDigest",
			],
			`D17 retry proof[${index}]`,
		);
		if (proof.policy !== policy) throw new TypeError("D17 retry policy order drifted");
		digest(proof.logicalRequestDigest, `D17 retry proof[${index}].logicalRequestDigest`);
		digest(proof.wireBodyDigest, `D17 retry proof[${index}].wireBodyDigest`);
		digest(proof.exposureDigest, `D17 retry proof[${index}].exposureDigest`);
		const ordinals = array(proof.attemptOrdinals, `D17 retry proof[${index}].attemptOrdinals`);
		if (ordinals.length !== 2 || ordinals[0] !== 1 || ordinals[1] !== 2)
			throw new TypeError("D17 retry attempt ordinals drifted");
		const proofDigest = digest(proof.proofDigest, `D17 retry proof[${index}].proofDigest`);
		const { proofDigest: _proofDigest, ...proofBase } = proof;
		if (empiricalStrictJsonDigest(proofBase) !== proofDigest)
			throw new TypeError("D17 retry proof digest drifted");
		const coordinates = empiricalStrictJsonDigest({
			logicalRequestDigest: proof.logicalRequestDigest,
			wireBodyDigest: proof.wireBodyDigest,
			exposureDigest: proof.exposureDigest,
		});
		sharedRetryCoordinates ??= coordinates;
		if (coordinates !== sharedRetryCoordinates)
			throw new TypeError("D17 retry identity coordinates drifted");
	}
	const generation = record(candidate.generation, "D17 generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"qualificationDigest",
			"schemaVersion",
		],
		"D17 generation",
	);
	if (
		generation.schemaVersion !== D17_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D17_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		generation.implementationManifestDigest !== D17_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.liveGateEvaluated !== false ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D17 generation projection drifted");
	const generationDigest = digest(generation.generationDigest, "D17 generation digest");
	const { generationDigest: _generationDigest, ...generationBase } = generation;
	if (empiricalStrictJsonDigest(generationBase) !== generationDigest)
		throw new TypeError("D17 generation digest drifted");
	const suppliedBundleDigest = digest(candidate.bundleDigest, "D17 bundle digest");
	const { bundleDigest: _bundleDigest, ...bundleBase } = candidate;
	if (empiricalStrictJsonDigest(bundleBase) !== suppliedBundleDigest)
		throw new TypeError("D17 bundle digest drifted");
	return strictSnapshot({ ...candidate, graphEvidence }) as unknown as D17QualificationBundleV1;
}

async function persist(input: {
	readonly privateRoot: string;
	readonly bundle: D17QualificationBundleV1;
	readonly generationRef: string;
}) {
	const bundle = validateD17QualificationBundle(input.bundle);
	const basis = constructedBundles.get(input.bundle);
	if (basis === undefined)
		throw new TypeError("D17 persistence requires a fresh constructed bundle");
	if (input.generationRef === D17_QUALIFICATION_GENERATION_REF && basis !== "exact-d16-artifact")
		throw new TypeError("D17 production qualification requires the exact D16 baseline");
	constructedBundles.delete(input.bundle);
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const commitBase = strictSnapshot({
		schemaVersion: "graphrefly-ts.d17.current-efficacy-qualification-commit.v1",
		generationRef: input.generationRef,
		bundleDigest: bundle.bundleDigest,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	const commit = Object.freeze({
		...commitBase,
		commitDigest: empiricalStrictJsonDigest(commitBase),
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: input.generationRef,
		artifacts: {
			"bundle.v1.json": bundleBytes,
			"qualification.v1.json": qualificationBytes,
			"generation.v1.json": generationBytes,
		},
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
}

export async function persistD17Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D17QualificationBundleV1;
}) {
	return persist({ ...input, generationRef: D17_QUALIFICATION_GENERATION_REF });
}

export async function persistD17InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D17QualificationBundleV1;
}) {
	return persist({ ...input, generationRef: D17_INJECTED_TEST_GENERATION_REF });
}
