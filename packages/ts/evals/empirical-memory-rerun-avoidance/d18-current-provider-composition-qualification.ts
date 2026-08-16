import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import type { D17EffectResultInputV1 } from "./d17-current-efficacy-authority.js";
import {
	D17_QUALIFICATION_BUNDLE_SCHEMA,
	validateD17QualificationBundle,
} from "./d17-current-pre-live-qualification.js";
import { createD18OneEffectAdapter } from "./d18-current-injected-provider-adapter.js";
import {
	admitD18EffectResult,
	createD18Authority,
	D18_DECISION_REF,
	D18_INSPECTION_PATHS,
	D18_LIMITS,
	D18_ROUTE,
	D18_WRITABLE_PATH,
	type D18EvidenceV1,
	type D18ProviderAttemptRequestV1,
	type D18ProviderResultInputV1,
	type D18RetryPolicy,
	snapshotD18Evidence,
	takeD18Effect,
	validateD18Evidence,
} from "./d18-current-provider-composition-authority.js";
import { D18_IMPLEMENTATION_MANIFEST_DIGEST } from "./d18-current-provider-composition-implementation-manifest.js";

export const D18_D17_BASELINE_ARTIFACT_DIGEST =
	"sha256:2bfdef6295e4de0680da6b17da2c7606d0e221365cb54457d3e28a5ac672886a" as const;
export const D18_D17_BASELINE_BUNDLE_DIGEST =
	"sha256:1ab40395856d8b7b759183237bd5264884522b9cdca1bff9347bf79acd0906ed" as const;
export const D18_D17_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:a1cb4da3401159bf6015f7ea8e4a100f1c4a2e7a3519bb4c9e2b3ce0987cf811" as const;
export const D18_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d18.current-provider-composition-qualification.v1" as const;
export const D18_BUNDLE_SCHEMA =
	"graphrefly-ts.d18.current-provider-composition-qualification-bundle.v1" as const;
export const D18_GENERATION_SCHEMA =
	"graphrefly-ts.d18.current-provider-composition-generation.v1" as const;
export const D18_GENERATION_REF =
	"current-graph-native-provider-composition-no-network-2026-08-16-d18-v1" as const;
export const D18_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-provider-composition-injected-test-2026-08-16-d18-v1" as const;

export interface D18D17BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d18.d17-baseline-admission.v1";
}

export interface D18QualificationBundleV1 {
	readonly schemaVersion: typeof D18_BUNDLE_SCHEMA;
	readonly baseline: Readonly<{
		artifactDigest: typeof D18_D17_BASELINE_ARTIFACT_DIGEST;
		bundleDigest: typeof D18_D17_BASELINE_BUNDLE_DIGEST;
		implementationManifestDigest: typeof D18_D17_IMPLEMENTATION_MANIFEST_DIGEST;
		basis: "exact-private-artifact" | "injected-test";
	}>;
	readonly implementationManifestDigest: string;
	readonly graphEvidence: D18EvidenceV1;
	readonly retryEvidence: Readonly<{
		D671: D18EvidenceV1;
		D675: D18EvidenceV1;
	}>;
	readonly qualification: Readonly<{
		schemaVersion: typeof D18_QUALIFICATION_SCHEMA;
		decisionRef: typeof D18_DECISION_REF;
		providerNetworkCalls: 0;
		armOrder: readonly string[];
		providerAttempts: number;
		retryWaits: 1;
		retryPoliciesPassed: readonly ["D671", "D675", "D710"];
		sameBodyRetryPassed: true;
		headroomDeniedBeforeTransport: true;
		terminalProviderFailureContinued: true;
		maxActiveEffects: 1;
		workspaceResidueCount: 0;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		schemaVersion: typeof D18_GENERATION_SCHEMA;
		generationRef: typeof D18_GENERATION_REF | typeof D18_INJECTED_TEST_GENERATION_REF;
		graphEvidenceDigest: string;
		qualificationDigest: string;
		implementationManifestDigest: string;
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const exactBaselines = new WeakSet<object>();
const injectedBaselines = new WeakSet<object>();
const constructedBundles = new WeakSet<object>();

function baselineReceipt(basis: "exact-private-artifact" | "injected-test") {
	const receipt = Object.freeze({
		revision: "graphrefly-ts.d18.d17-baseline-admission.v1" as const,
	});
	(basis === "exact-private-artifact" ? exactBaselines : injectedBaselines).add(receipt);
	return receipt;
}

export function admitD18D17Baseline(bytesValue: Uint8Array): D18D17BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D18 D17 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D18_D17_BASELINE_ARTIFACT_DIGEST)
		throw new TypeError("D18 D17 baseline artifact digest drifted");
	const decoded = strictJsonCodec.decode(bytes);
	const bundle = validateD17QualificationBundle(decoded);
	if (
		bundle.schemaVersion !== D17_QUALIFICATION_BUNDLE_SCHEMA ||
		bundle.bundleDigest !== D18_D17_BASELINE_BUNDLE_DIGEST ||
		bundle.qualification.implementationManifestDigest !== D18_D17_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D18 D17 baseline canonical coordinates drifted");
	return baselineReceipt("exact-private-artifact");
}

export function createD18InjectedD17BaselineForTest(): D18D17BaselineAdmissionV1 {
	return baselineReceipt("injected-test");
}

function retryCause(policy: D18RetryPolicy) {
	if (policy === "D671") return "typed-rate-limit-or-503" as const;
	if (policy === "D675") return "request-phase-und-err-socket" as const;
	return "untyped-http-429" as const;
}

function retryFailureFamily(policy: D18RetryPolicy) {
	return policy === "D675" ? ("transport" as const) : ("http" as const);
}

function digestOf(kind: string, value: unknown) {
	return empiricalStrictJsonDigest({ kind, value });
}

function assertInjectedWire(value: unknown, phase: "inspection" | "mutation"): void {
	const body = record(value, "D18 injected wire body");
	exactKeys(
		body,
		["max_tokens", "messages", "model", "provider", "reasoning", "tool_choice", "tools"],
		"D18 injected wire body",
	);
	if (body.model !== D18_ROUTE.model || body.max_tokens !== D18_ROUTE.maxOutputTokens)
		throw new TypeError("D18 injected wire model coordinates drifted");
	const messages = array(body.messages, "D18 injected wire messages");
	if (messages.length !== 1 || record(messages[0], "D18 injected wire message").role !== "user")
		throw new TypeError("D18 injected wire model-visible envelope drifted");
	const tools = array(body.tools, "D18 injected wire tools");
	if (tools.length !== 1) throw new TypeError("D18 injected wire tool cardinality drifted");
	const tool = record(tools[0], "D18 injected wire tool");
	const fn = record(tool.function, "D18 injected wire tool.function");
	if (fn.name !== (phase === "inspection" ? "read_file" : "replace_exact"))
		throw new TypeError("D18 injected wire phase tool drifted");
	const provider = record(body.provider, "D18 injected wire provider");
	if (
		JSON.stringify(provider.order) !== JSON.stringify([D18_ROUTE.providerTag]) ||
		JSON.stringify(provider.only) !== JSON.stringify([D18_ROUTE.providerTag]) ||
		provider.allow_fallbacks !== false ||
		provider.require_parameters !== true
	)
		throw new TypeError("D18 injected wire provider route drifted");
	if (Object.hasOwn(body, "parallel_tool_calls"))
		throw new TypeError("D18 injected wire used an unqualified parallel_tool_calls parameter");
}

async function runInjectedSixArms(policy: D18RetryPolicy) {
	const authority = createD18Authority();
	let providerCalls = 0;
	let retryInjected = false;
	let workspaceCounter = 0;
	const adapter = createD18OneEffectAdapter({
		provider: async (effect, material): Promise<D18ProviderResultInputV1> => {
			providerCalls += 1;
			assertInjectedWire(material.body, effect.request.phase);
			if (
				!retryInjected &&
				effect.request.arm === "cold" &&
				effect.request.phase === "inspection" &&
				effect.request.attemptOrdinal === 1
			) {
				retryInjected = true;
				return Object.freeze({
					effectKind: "provider-attempt",
					status: "failed",
					wireBodyDigest: effect.request.wireBodyDigest,
					failureFamily: retryFailureFamily(policy),
					retryProposal: Object.freeze({
						policy,
						cause: retryCause(policy),
						delayMs: policy === "D710" ? 60_000 : 7_000,
					}),
					costBasis: "conservative-reservation",
					actualCostMicrousd: D18_LIMITS.providerMaxCostMicrousd,
					actualElapsedMs: 5,
					evidenceDigest: digestOf("injected-provider-retry", {
						policy,
						requestDigest: effect.request.requestDigest,
					}),
				});
			}
			const bodyDigest = empiricalStrictJsonDigest(material.body);
			if (bodyDigest !== effect.request.wireBodyDigest)
				throw new TypeError("D18 injected adapter body identity drifted");
			const toolIntents =
				effect.request.phase === "inspection"
					? D18_INSPECTION_PATHS.map((path) =>
							Object.freeze({ toolRef: "read-file" as const, path }),
						)
					: [
							Object.freeze({
								toolRef: "replace-exact" as const,
								path: D18_WRITABLE_PATH,
								oldText: "assertBoundedAuthorityId(admissionId);",
								newText: "assertBoundedAuthorityId(admissionProposalId);",
							}),
						];
			return Object.freeze({
				effectKind: "provider-attempt",
				status: "completed",
				wireBodyDigest: effect.request.wireBodyDigest,
				toolIntents: Object.freeze(toolIntents),
				inputTokens: 1_000,
				outputTokens: 100,
				cacheReadTokens: 0,
				actualCostMicrousd: 100,
				actualElapsedMs: 2,
				evidenceDigest: digestOf("injected-provider-success", {
					arm: effect.request.arm,
					phase: effect.request.phase,
					attemptOrdinal: effect.request.attemptOrdinal,
				}),
			});
		},
		local: async (effect, material) => {
			const request = effect.workflowEffect.request;
			const workspace = request.workspaceStateDigest ?? digestOf("workspace", workspaceCounter);
			let result: D17EffectResultInputV1;
			let runtimeMaterial: unknown;
			if (request.effectKind === "materialization") {
				workspaceCounter += 1;
				result = Object.freeze({
					effectKind: "materialization",
					status: "completed",
					workspaceStateDigest: digestOf("workspace", workspaceCounter),
					evidenceDigest: digestOf("materialization", request.arm),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			} else if (request.effectKind === "tool-action") {
				if (request.toolRef === "read-file") {
					if (material.toolArguments?.toolRef !== "read-file")
						throw new TypeError("D18 injected read arguments missing");
					runtimeMaterial = `export const admitted_${request.sequence} = true;`;
				}
				const after =
					request.toolRef === "replace-exact"
						? digestOf("mutated-workspace", { arm: request.arm, sequence: request.sequence })
						: workspace;
				result = Object.freeze({
					effectKind: "tool-action",
					toolRef: request.toolRef!,
					status: "succeeded",
					workspaceStateBeforeDigest: workspace,
					workspaceStateAfterDigest: after,
					nonEmptyDiff: request.toolRef === "workspace-diff",
					evidenceDigest: digestOf("local-tool", { arm: request.arm, tool: request.toolRef }),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			} else if (request.effectKind === "public-semantic-validation") {
				result = Object.freeze({
					effectKind: "public-semantic-validation",
					status: "passed",
					criterionFailureCodes: Object.freeze([]),
					workspaceStateDigest: workspace,
					evidenceDigest: digestOf("public-semantic", request.arm),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			} else if (request.effectKind === "hidden-verifier") {
				result = Object.freeze({
					effectKind: "hidden-verifier",
					status: request.arm === "relevant-applied" ? "passed" : "failed",
					workspaceStateDigest: workspace,
					evidenceDigest: digestOf("hidden-verifier", request.arm),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			} else {
				result = Object.freeze({
					effectKind: "cleanup",
					status: "completed",
					workspaceStateDigest: null,
					evidenceDigest: digestOf("cleanup", request.arm),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			}
			return Object.freeze({
				result,
				...(runtimeMaterial === undefined ? {} : { runtimeMaterial }),
			});
		},
		retryWait: async (effect) =>
			Object.freeze({
				actualElapsedMs: effect.request.delayMs,
				evidenceDigest: digestOf("retry-wait", {
					policy: effect.request.retryPolicy,
					delayMs: effect.request.delayMs,
				}),
			}),
	});
	for (let guard = 0; guard < 256; guard += 1) {
		const effect = takeD18Effect(authority);
		if (effect === null) {
			const evidence = snapshotD18Evidence(authority);
			return Object.freeze({ evidence, providerCalls, maxActive: adapter.maxActiveEffects() });
		}
		const executed = await adapter.execute(authority, effect);
		admitD18EffectResult(authority, effect, executed.result, executed.runtimeMaterial);
	}
	throw new TypeError("D18 injected six-arm loop exceeded its bound");
}

async function proveHeadroomDeniedBeforeTransport(): Promise<boolean> {
	const authority = createD18Authority({
		limits: Object.freeze({ ...D18_LIMITS, maxProviderAttempts: 0 }),
	});
	const materialization = takeD18Effect(authority);
	if (materialization?.kind !== "workflow-local") return false;
	const result: D17EffectResultInputV1 = Object.freeze({
		effectKind: "materialization",
		status: "completed",
		workspaceStateDigest: digestOf("headroom-workspace", 1),
		evidenceDigest: digestOf("headroom-materialization", 1),
		actualCostMicrousd: 0,
		actualElapsedMs: 1,
	});
	admitD18EffectResult(authority, materialization, result);
	const cleanup = takeD18Effect(authority);
	return (
		cleanup?.kind === "workflow-local" && cleanup.workflowEffect.request.effectKind === "cleanup"
	);
}

async function proveTerminalFailureContinues(): Promise<boolean> {
	const authority = createD18Authority();
	let failed = false;
	for (let guard = 0; guard < 8; guard += 1) {
		const effect = takeD18Effect(authority);
		if (effect === null) return false;
		if (effect.kind === "workflow-local") {
			const request = effect.workflowEffect.request;
			if (request.arm === "relevant-applied" && request.effectKind === "materialization")
				return failed;
			const result: D17EffectResultInputV1 =
				request.effectKind === "materialization"
					? Object.freeze({
							effectKind: "materialization",
							status: "completed",
							workspaceStateDigest: digestOf("terminal-workspace", request.arm),
							evidenceDigest: digestOf("terminal-materialization", request.arm),
							actualCostMicrousd: 0,
							actualElapsedMs: 1,
						})
					: Object.freeze({
							effectKind: "cleanup",
							status: "completed",
							workspaceStateDigest: null,
							evidenceDigest: digestOf("terminal-cleanup", request.arm),
							actualCostMicrousd: 0,
							actualElapsedMs: 1,
						});
			admitD18EffectResult(authority, effect, result);
		} else if (effect.kind === "provider-attempt") {
			failed = true;
			admitD18EffectResult(
				authority,
				effect,
				Object.freeze({
					effectKind: "provider-attempt",
					status: "failed",
					wireBodyDigest: effect.request.wireBodyDigest,
					failureFamily: "http",
					retryProposal: null,
					costBasis: "conservative-reservation",
					actualCostMicrousd: effect.request.reservation.maxCostMicrousd,
					actualElapsedMs: 1,
					evidenceDigest: digestOf("terminal-http", effect.request.requestDigest),
				}),
			);
		} else return false;
	}
	return false;
}

function retryProof(evidence: D18EvidenceV1, policy: D18RetryPolicy) {
	const wait = evidence.providerFacts.find(
		(fact) =>
			fact.request.schemaVersion === "graphrefly-ts.d18.retry-wait-request.v1" &&
			fact.request.retryPolicy === policy,
	);
	if (wait === undefined) throw new TypeError(`D18 ${policy} retry wait is missing`);
	const attempts = evidence.providerFacts.filter(
		(fact) =>
			fact.request.schemaVersion === "graphrefly-ts.d18.provider-attempt-request.v1" &&
			fact.request.workflowRequestDigest === wait.request.workflowRequestDigest,
	) as readonly (D18EvidenceV1["providerFacts"][number] & {
		request: D18ProviderAttemptRequestV1;
	})[];
	if (attempts.length !== 2) throw new TypeError(`D18 ${policy} retry attempt count drifted`);
	return strictSnapshot({
		policy,
		workflowRequestDigest: wait.request.workflowRequestDigest,
		wireBodyDigest: attempts[0]?.request.wireBodyDigest,
		attemptOrdinals: attempts.map((fact) => fact.request.attemptOrdinal),
		waitFactDigest: wait.factDigest,
	});
}

export async function runD18InjectedNoNetworkQualification(input: {
	readonly baseline: D18D17BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
	readonly generationRef?: typeof D18_GENERATION_REF | typeof D18_INJECTED_TEST_GENERATION_REF;
}): Promise<D18QualificationBundleV1> {
	const basis = exactBaselines.has(input.baseline)
		? "exact-private-artifact"
		: injectedBaselines.has(input.baseline)
			? "injected-test"
			: null;
	if (basis === null) throw new TypeError("D18 D17 baseline admission is forged");
	const runs: Partial<Record<D18RetryPolicy, Awaited<ReturnType<typeof runInjectedSixArms>>>> = {};
	for (const policy of ["D671", "D675", "D710"] as const)
		runs[policy] = await runInjectedSixArms(policy);
	const d671 = runs.D671!;
	const d675 = runs.D675!;
	const d710 = runs.D710!;
	const retryProofs = [
		retryProof(d671.evidence, "D671"),
		retryProof(d675.evidence, "D675"),
		retryProof(d710.evidence, "D710"),
	];
	if (new Set(retryProofs.map((proof) => proof.policy)).size !== 3)
		throw new TypeError("D18 retry policy coverage drifted");
	if (d710.maxActive !== 1 || d710.evidence.workflowEvidence.runs.length !== 6)
		throw new TypeError("D18 six-arm serial qualification drifted");
	if (
		!D18_ARMS_FOR_QUALIFICATION.every(
			(arm, index) => d710.evidence.workflowEvidence.runs[index]?.arm === arm,
		)
	)
		throw new TypeError("D18 arm order drifted");
	const headroomDeniedBeforeTransport = await proveHeadroomDeniedBeforeTransport();
	const terminalProviderFailureContinued = await proveTerminalFailureContinues();
	if (!headroomDeniedBeforeTransport || !terminalProviderFailureContinued)
		throw new TypeError("D18 negative qualification gate failed");
	const qualificationBase = strictSnapshot({
		schemaVersion: D18_QUALIFICATION_SCHEMA,
		decisionRef: D18_DECISION_REF,
		providerNetworkCalls: 0 as const,
		armOrder: D18_ARMS_FOR_QUALIFICATION,
		providerAttempts: d710.evidence.budget.providerAttempts,
		retryWaits: 1 as const,
		retryPoliciesPassed: ["D671", "D675", "D710"] as const,
		sameBodyRetryPassed: true as const,
		headroomDeniedBeforeTransport: true as const,
		terminalProviderFailureContinued: true as const,
		maxActiveEffects: 1 as const,
		workspaceResidueCount: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationBase,
		qualificationDigest: empiricalStrictJsonDigest({
			...qualificationBase,
			graphEvidenceDigest: d710.evidence.evidenceDigest,
			retryProofs,
			implementationManifestDigest: input.implementationManifestDigest,
		}),
	});
	const generationBase = strictSnapshot({
		schemaVersion: D18_GENERATION_SCHEMA,
		generationRef: input.generationRef ?? D18_GENERATION_REF,
		graphEvidenceDigest: d710.evidence.evidenceDigest,
		qualificationDigest: qualification.qualificationDigest,
		implementationManifestDigest: input.implementationManifestDigest,
	});
	const generation = Object.freeze({
		...generationBase,
		generationDigest: empiricalStrictJsonDigest(generationBase),
	});
	const base = strictSnapshot({
		schemaVersion: D18_BUNDLE_SCHEMA,
		baseline: Object.freeze({
			artifactDigest: D18_D17_BASELINE_ARTIFACT_DIGEST,
			bundleDigest: D18_D17_BASELINE_BUNDLE_DIGEST,
			implementationManifestDigest: D18_D17_IMPLEMENTATION_MANIFEST_DIGEST,
			basis,
		}),
		implementationManifestDigest: input.implementationManifestDigest,
		graphEvidence: d710.evidence,
		retryEvidence: Object.freeze({ D671: d671.evidence, D675: d675.evidence }),
		qualification,
		generation,
	});
	const bundle = Object.freeze({ ...base, bundleDigest: empiricalStrictJsonDigest(base) });
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD18QualificationBundle(value: unknown): D18QualificationBundleV1 {
	const candidate = record(value, "D18 bundle");
	exactKeys(
		candidate,
		[
			"baseline",
			"bundleDigest",
			"generation",
			"graphEvidence",
			"implementationManifestDigest",
			"qualification",
			"retryEvidence",
			"schemaVersion",
		],
		"D18 bundle",
	);
	if (candidate.schemaVersion !== D18_BUNDLE_SCHEMA)
		throw new TypeError("D18 bundle schema drifted");
	const baselineValue = record(candidate.baseline, "D18 baseline");
	exactKeys(
		baselineValue,
		["artifactDigest", "basis", "bundleDigest", "implementationManifestDigest"],
		"D18 baseline",
	);
	if (
		baselineValue.artifactDigest !== D18_D17_BASELINE_ARTIFACT_DIGEST ||
		baselineValue.bundleDigest !== D18_D17_BASELINE_BUNDLE_DIGEST ||
		baselineValue.implementationManifestDigest !== D18_D17_IMPLEMENTATION_MANIFEST_DIGEST ||
		(baselineValue.basis !== "exact-private-artifact" && baselineValue.basis !== "injected-test")
	)
		throw new TypeError("D18 baseline coordinates drifted");
	const baseline = strictSnapshot(baselineValue) as D18QualificationBundleV1["baseline"];
	const graphEvidence = validateD18Evidence(candidate.graphEvidence);
	const retryEvidenceValue = record(candidate.retryEvidence, "D18 retryEvidence");
	exactKeys(retryEvidenceValue, ["D671", "D675"], "D18 retryEvidence");
	const retryEvidence = Object.freeze({
		D671: validateD18Evidence(retryEvidenceValue.D671),
		D675: validateD18Evidence(retryEvidenceValue.D675),
	});
	const proofs = [
		retryProof(retryEvidence.D671, "D671"),
		retryProof(retryEvidence.D675, "D675"),
		retryProof(graphEvidence, "D710"),
	];
	const qualification = record(candidate.qualification, "D18 qualification");
	exactKeys(
		qualification,
		[
			"armOrder",
			"causalAttribution",
			"decisionRef",
			"efficacyClaim",
			"headroomDeniedBeforeTransport",
			"liveGateEvaluated",
			"maxActiveEffects",
			"providerAttempts",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryPoliciesPassed",
			"retryWaits",
			"sameBodyRetryPassed",
			"schemaVersion",
			"terminalProviderFailureContinued",
			"workspaceResidueCount",
		],
		"D18 qualification",
	);
	const expectedQualificationBase = strictSnapshot({
		schemaVersion: D18_QUALIFICATION_SCHEMA,
		decisionRef: D18_DECISION_REF,
		providerNetworkCalls: 0 as const,
		armOrder: D18_ARMS_FOR_QUALIFICATION,
		providerAttempts: graphEvidence.budget.providerAttempts,
		retryWaits: 1 as const,
		retryPoliciesPassed: ["D671", "D675", "D710"] as const,
		sameBodyRetryPassed: true as const,
		headroomDeniedBeforeTransport: true as const,
		terminalProviderFailureContinued: true as const,
		maxActiveEffects: 1 as const,
		workspaceResidueCount: 0,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	if (
		JSON.stringify({ ...qualification, qualificationDigest: undefined }) !==
		JSON.stringify({ ...expectedQualificationBase, qualificationDigest: undefined })
	)
		throw new TypeError("D18 qualification projection drifted");
	const implementationManifestDigest = candidate.implementationManifestDigest as string;
	if (!/^sha256:[0-9a-f]{64}$/u.test(implementationManifestDigest))
		throw new TypeError("D18 implementation manifest digest is invalid");
	if (
		baseline.basis === "exact-private-artifact" &&
		implementationManifestDigest !== D18_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D18 production implementation manifest drifted");
	const expectedQualificationDigest = empiricalStrictJsonDigest({
		...expectedQualificationBase,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		retryProofs: proofs,
		implementationManifestDigest,
	});
	if (qualification.qualificationDigest !== expectedQualificationDigest)
		throw new TypeError("D18 qualification digest drifted");
	const generation = record(candidate.generation, "D18 generation");
	exactKeys(
		generation,
		[
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"D18 generation",
	);
	const generationBase = strictSnapshot({
		schemaVersion: generation.schemaVersion,
		generationRef: generation.generationRef,
		graphEvidenceDigest: generation.graphEvidenceDigest,
		qualificationDigest: generation.qualificationDigest,
		implementationManifestDigest: generation.implementationManifestDigest,
	});
	if (
		generation.schemaVersion !== D18_GENERATION_SCHEMA ||
		(generation.generationRef !== D18_GENERATION_REF &&
			generation.generationRef !== D18_INJECTED_TEST_GENERATION_REF) ||
		(baseline.basis === "exact-private-artifact") !==
			(generation.generationRef === D18_GENERATION_REF) ||
		generation.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.implementationManifestDigest !== implementationManifestDigest ||
		generation.generationDigest !== empiricalStrictJsonDigest(generationBase)
	)
		throw new TypeError("D18 generation drifted");
	const base = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		baseline,
		implementationManifestDigest,
		graphEvidence,
		retryEvidence,
		qualification,
		generation,
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(base))
		throw new TypeError("D18 bundle digest drifted");
	return Object.freeze({
		...base,
		bundleDigest: candidate.bundleDigest,
	}) as D18QualificationBundleV1;
}

export async function persistD18Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D18QualificationBundleV1;
}) {
	if (!constructedBundles.delete(input.bundle))
		throw new TypeError("D18 qualification bundle is forged or replayed");
	const bundle = validateD18QualificationBundle(input.bundle);
	if (
		bundle.baseline.basis !== "exact-private-artifact" ||
		bundle.generation.generationRef !== D18_GENERATION_REF
	)
		throw new TypeError("D18 production persistence requires exact D17 baseline bytes");
	const artifacts = Object.freeze({
		"bundle.v1.json": strictJsonCodec.encode(bundle),
		"qualification.v1.json": strictJsonCodec.encode(bundle.qualification),
		"generation.v1.json": strictJsonCodec.encode(bundle.generation),
	});
	const commit = strictSnapshot({
		schemaVersion: "graphrefly-ts.d18.current-provider-composition-commit.v1",
		generationRef: bundle.generation.generationRef,
		bundleDigest: bundle.bundleDigest,
		artifactDigests: Object.fromEntries(
			Object.entries(artifacts).map(([name, bytes]) => [name, empiricalSha256(bytes)]),
		),
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: bundle.generation.generationRef,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit),
	});
}

export async function persistD18InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D18QualificationBundleV1;
}) {
	if (!constructedBundles.delete(input.bundle))
		throw new TypeError("D18 injected qualification bundle is forged or replayed");
	const bundle = validateD18QualificationBundle(input.bundle);
	if (
		bundle.baseline.basis !== "injected-test" ||
		bundle.generation.generationRef !== D18_INJECTED_TEST_GENERATION_REF
	)
		throw new TypeError("D18 injected persistence requires the test-only generation");
	const artifacts = Object.freeze({
		"bundle.v1.json": strictJsonCodec.encode(bundle),
		"qualification.v1.json": strictJsonCodec.encode(bundle.qualification),
		"generation.v1.json": strictJsonCodec.encode(bundle.generation),
	});
	const commit = strictSnapshot({
		schemaVersion: "graphrefly-ts.d18.current-provider-composition-injected-commit.v1",
		generationRef: bundle.generation.generationRef,
		bundleDigest: bundle.bundleDigest,
		artifactDigests: Object.fromEntries(
			Object.entries(artifacts).map(([name, bytes]) => [name, empiricalSha256(bytes)]),
		),
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: bundle.generation.generationRef,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit),
	});
}

export const D18_ARMS_FOR_QUALIFICATION = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export function D18ConstructedBundleForTest(value: D18QualificationBundleV1): boolean {
	return constructedBundles.has(value);
}
