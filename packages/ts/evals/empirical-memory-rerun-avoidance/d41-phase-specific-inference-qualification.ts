import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "./d8-current-openrouter-adapter.js";
import { D21_TASK_PROFILE } from "./d21-current-efficacy-recovery-authority.js";
import { validateD40LiveBundle } from "./d40-phase-specific-inference-live.js";
import { D40_REPAIRED_LIVE_LIMITS } from "./d40-phase-specific-inference-live-coordinates.js";
import {
	admitD41EffectResult,
	createD41InferenceAuthority,
	D41_DECISION_REF,
	D41_INSPECTION_MAX_OUTPUT_TOKENS,
	D41_MUTATION_MAX_OUTPUT_TOKENS,
	type D41InferenceEvidenceV1,
	snapshotD41InferenceEvidence,
	takeD41AdmittedEffect,
	validateD41InferenceEvidence,
} from "./d41-phase-specific-inference-authority.js";
import { D41_IMPLEMENTATION_MANIFEST_DIGEST } from "./d41-phase-specific-inference-implementation-manifest.js";
import { createD41PhaseSpecificRealProviderExecutor } from "./d41-phase-specific-real-provider-composition.js";

export const D41_D40_ARTIFACT_DIGEST =
	"sha256:8ed287955dcee90df57d61fbafffcccdbaa51178f0612cded4d7bb91b27a0f98" as const;
export const D41_D40_BUNDLE_DIGEST =
	"sha256:3526690f4ed7533a433b3ede016a3346d74ecd0aab3e86dda20e5c3e1a2b70f5" as const;
export const D41_D40_GRAPH_EVIDENCE_DIGEST =
	"sha256:ab32ee447eb74a9792bfe2156da390a388129fe4044b0ef0a6a4369b7fd8cc07" as const;
export const D41_D40_GATE_DIGEST =
	"sha256:a54fdcb8acad9f7dfc4fbfc2061e383eee05664519e095993cff275d8ad4a1d2" as const;
export const D41_D40_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:6203b88ed03715e346639ef17425decaee9a599a03f994994a5983d6de83d656" as const;
export const D41_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d41.phase-specific-inference-qualification.v1" as const;
export const D41_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d41.phase-specific-inference-qualification-bundle.v1" as const;
export const D41_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d41.phase-specific-inference-qualification-generation.v1" as const;
export const D41_QUALIFICATION_GENERATION_REF =
	"current-graph-native-phase-specific-inference-no-network-2026-08-20-d41-v1" as const;
export interface D41D40BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d41.d40-baseline-admission.v1";
}

export interface D41QualificationBundleV1 {
	readonly schemaVersion: typeof D41_QUALIFICATION_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d40-artifact" | "injected-test";
	readonly mainEvidence: D41InferenceEvidenceV1;
	readonly schemaRejectionEvidence: D41InferenceEvidenceV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D41_QUALIFICATION_SCHEMA;
		readonly decisionRef: typeof D41_DECISION_REF;
		readonly d40ArtifactDigest: typeof D41_D40_ARTIFACT_DIGEST;
		readonly d40BundleDigest: typeof D41_D40_BUNDLE_DIGEST;
		readonly d40GraphEvidenceDigest: typeof D41_D40_GRAPH_EVIDENCE_DIGEST;
		readonly d40GateDigest: typeof D41_D40_GATE_DIGEST;
		readonly d40ImplementationManifestDigest: typeof D41_D40_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly implementationManifestDigest: typeof D41_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly mainEvidenceDigest: string;
		readonly schemaRejectionEvidenceDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly inspectionMaxOutputTokens: 65_536;
		readonly mutationMaxOutputTokens: 8_192;
		readonly lengthRecoveryObserved: true;
		readonly validToolCallObserved: true;
		readonly malformedSchemaRejected: true;
		readonly exactRetryWireIdentity: true;
		readonly exactUsageReconciliation: true;
		readonly maxActiveTransport: 1;
		readonly mainProviderAttemptCount: number;
		readonly schemaProviderAttemptCount: number;
		readonly providerNetworkCalls: 0;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualified: true;
		readonly qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		readonly schemaVersion: typeof D41_QUALIFICATION_GENERATION_SCHEMA;
		readonly generationRef: typeof D41_QUALIFICATION_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly mainEvidenceDigest: string;
		readonly schemaRejectionEvidenceDigest: string;
		readonly implementationManifestDigest: typeof D41_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

interface ScenarioResult {
	readonly evidence: D41InferenceEvidenceV1;
	readonly maxActiveTransport: number;
	readonly transportCalls: number;
}

const baselines = new WeakMap<object, D41QualificationBundleV1["baselineBasis"]>();
const constructed = new WeakSet<object>();

function makeBaseline(basis: D41QualificationBundleV1["baselineBasis"]): D41D40BaselineAdmissionV1 {
	const baseline = Object.freeze({
		revision: "graphrefly-ts.d41.d40-baseline-admission.v1" as const,
	});
	baselines.set(baseline, basis);
	return baseline;
}

export function admitD41D40Baseline(bytesValue: Uint8Array): D41D40BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D41 D40 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D41_D40_ARTIFACT_DIGEST)
		throw new TypeError("D41 D40 immutable artifact drifted");
	const bundle = validateD40LiveBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.disposition !== "success" ||
		bundle.bundleDigest !== D41_D40_BUNDLE_DIGEST ||
		bundle.graphEvidence?.evidenceDigest !== D41_D40_GRAPH_EVIDENCE_DIGEST ||
		bundle.gate.gateDigest !== D41_D40_GATE_DIGEST ||
		bundle.implementationManifestDigest !== D41_D40_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.gate.passed !== false ||
		bundle.efficacyClaim !== "none" ||
		bundle.terminalReceipt.providerAttempts !== 12 ||
		bundle.terminalReceipt.confirmedCostMicrousd !== 35_119
	)
		throw new TypeError("D41 D40 immutable coordinates drifted");
	return makeBaseline("consumed-d40-artifact");
}

export function createD41InjectedBaselineForTest(): D41D40BaselineAdmissionV1 {
	return makeBaseline("injected-test");
}

function consumeBaseline(
	baseline: D41D40BaselineAdmissionV1,
	expected: D41QualificationBundleV1["baselineBasis"],
): void {
	const actual = baselines.get(baseline as object);
	baselines.delete(baseline as object);
	if (actual !== expected) throw new TypeError("D41 baseline is forged, replayed, or wrong-basis");
}

function batchReadResponse(): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
							id: `d41-read-${index}`,
							type: "function",
							function: { name: "read_file", arguments: JSON.stringify({ path }) },
						})),
					},
				},
			],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 200,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function replacementResponse(): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "d41-replace",
								type: "function",
								function: {
									name: "replace_exact",
									arguments: JSON.stringify({
										path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
										oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
										newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
									}),
								},
							},
						],
					},
				},
			],
			usage: {
				prompt_tokens: 63_000,
				completion_tokens: 1_200,
				prompt_tokens_details: { cached_tokens: 512 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function lengthResponse(): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: "length",
					message: { role: "assistant", content: "bounded truncated mutation", tool_calls: [] },
				},
			],
			usage: {
				prompt_tokens: 63_000,
				completion_tokens: D41_MUTATION_MAX_OUTPUT_TOKENS,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function malformedToolResponse(): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								type: "function",
								function: { name: "replace_exact", arguments: '{"path":' },
							},
						],
					},
				},
			],
			usage: {
				prompt_tokens: 63_000,
				completion_tokens: D41_MUTATION_MAX_OUTPUT_TOKENS,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

async function runScenario(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly scenario: "main" | "schema";
}): Promise<ScenarioResult> {
	const authority = createD41InferenceAuthority({
		limits: D40_REPAIRED_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	let activeTransport = 0;
	let maxActiveTransport = 0;
	let transportCalls = 0;
	let lengthInjected = false;
	let retryInjected = false;
	let malformedInjected = false;
	const executor = createD41PhaseSpecificRealProviderExecutor({
		repositoryRoot: input.repositoryRoot,
		materializationRoot: input.materializationRoot,
		credential: Object.freeze({
			bearerToken: "d41-injected-no-network-credential",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		}),
		fetchImpl: async (_url, init) => {
			activeTransport += 1;
			maxActiveTransport = Math.max(maxActiveTransport, activeTransport);
			transportCalls += 1;
			try {
				const bytes = Buffer.from(init?.body as Uint8Array);
				const body = record(JSON.parse(bytes.toString("utf8")), "D41 injected body");
				const maxTokens = safeInteger(body.max_tokens, "D41 injected max_tokens");
				const messages = array(body.messages, "D41 injected messages");
				const hasReadResult = messages.some((value) => {
					const message = record(value, "D41 injected message");
					return (
						message.role === "tool" &&
						typeof message.content === "string" &&
						message.content.includes("managed-cloud-postgresql")
					);
				});
				const choice = body.tool_choice;
				const toolName =
					choice === "required"
						? hasReadResult
							? "replace_exact"
							: "read_file"
						: record(record(choice, "D41 tool choice").function, "D41 tool function").name;
				if (toolName === "read_file") {
					if (maxTokens !== D41_INSPECTION_MAX_OUTPUT_TOKENS)
						throw new TypeError("D41 inspection ceiling drifted on wire");
					return batchReadResponse();
				}
				if (toolName !== "replace_exact" || maxTokens !== D41_MUTATION_MAX_OUTPUT_TOKENS)
					throw new TypeError("D41 mutation directive drifted on wire");
				if (input.scenario === "schema" && !malformedInjected) {
					malformedInjected = true;
					return malformedToolResponse();
				}
				if (input.scenario === "main" && !lengthInjected) {
					lengthInjected = true;
					return lengthResponse();
				}
				if (input.scenario === "main" && !retryInjected) {
					retryInjected = true;
					return new Response(JSON.stringify({ error: { message: "bounded injected 429" } }), {
						status: 429,
						headers: { "content-type": "application/json", "retry-after": "0" },
					});
				}
				return replacementResponse();
			} finally {
				activeTransport -= 1;
			}
		},
		now: (() => {
			let value = 0;
			return () => ++value;
		})(),
		sleep: async () => undefined,
	});
	try {
		for (let guard = 0; guard < D40_REPAIRED_LIVE_LIMITS.maxEffectFacts; guard += 1) {
			const admitted = takeD41AdmittedEffect(authority);
			if (admitted === null)
				return Object.freeze({
					evidence: validateD41InferenceEvidence(snapshotD41InferenceEvidence(authority)),
					maxActiveTransport,
					transportCalls,
				});
			const executed = await executor.execute(admitted);
			admitD41EffectResult(authority, executed.admitted, executed.result, executed.wireReceipt);
		}
		throw new TypeError("D41 scenario exhausted the effect bound");
	} finally {
		await executor.dispose();
	}
}

function workflow(evidence: D41InferenceEvidenceV1) {
	return evidence.retainedSpanEvidence.phaseEvidence.workflowEvidence.providerEvidence
		.workflowEvidence;
}

function providerFacts(evidence: D41InferenceEvidenceV1) {
	return evidence.retainedSpanEvidence.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	);
}

function assertExactAccounting(evidence: D41InferenceEvidenceV1): void {
	for (const fact of providerFacts(evidence)) {
		if (
			fact.result.effectKind !== "provider-request" ||
			fact.reconciliation.actualCostMicrousd !== fact.result.usage.actualCostMicrousd ||
			fact.reconciliation.actualElapsedMs !== fact.result.usage.actualElapsedMs
		)
			throw new TypeError("D41 provider usage reconciliation drifted");
	}
}

function deriveQualification(
	mainEvidenceValue: unknown,
	schemaEvidenceValue: unknown,
): Readonly<{
	main: D41InferenceEvidenceV1;
	schema: D41InferenceEvidenceV1;
	mainProviderAttempts: number;
	schemaProviderAttempts: number;
}> {
	const main = validateD41InferenceEvidence(mainEvidenceValue);
	const schema = validateD41InferenceEvidence(schemaEvidenceValue);
	const mainWorkflow = workflow(main);
	const schemaWorkflow = workflow(schema);
	if (
		mainWorkflow.runStatus !== "complete" ||
		mainWorkflow.runs.length !== 6 ||
		mainWorkflow.runs.some(
			(run) =>
				run.status !== "completed" ||
				run.cleanupStatus !== "completed" ||
				run.publicSemanticValidationPassed !== true ||
				run.hiddenVerifierPassed !== true,
		)
	)
		throw new TypeError("D41 main six-arm lifecycle drifted");
	if (
		schemaWorkflow.runStatus !== "complete" ||
		schemaWorkflow.runs.length !== 6 ||
		schemaWorkflow.runs.some((run) => run.cleanupStatus !== "completed") ||
		schemaWorkflow.runs[0]?.status !== "incomplete" ||
		schemaWorkflow.runs.slice(1).some((run) => run.status !== "completed")
	)
		throw new TypeError("D41 schema-rejection lifecycle drifted");
	for (const evidence of [main, schema]) {
		if (
			evidence.facts.filter((fact) => fact.phase === "inspection").length !== 6 ||
			evidence.facts.some(
				(fact) =>
					fact.maxOutputTokens !==
					(fact.phase === "inspection"
						? D41_INSPECTION_MAX_OUTPUT_TOKENS
						: D41_MUTATION_MAX_OUTPUT_TOKENS),
			)
		)
			throw new TypeError("D41 phase ceiling coverage drifted");
		assertExactAccounting(evidence);
	}
	const mainProviders = providerFacts(main);
	const schemaProviders = providerFacts(schema);
	const length = mainProviders.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.result.failureCode === "premature-structured-final" &&
			fact.result.usage.outputTokens === D41_MUTATION_MAX_OUTPUT_TOKENS &&
			fact.result.usage.costBasis === "reported",
	);
	if (length.length !== 1) throw new TypeError("D41 bounded length recovery evidence drifted");
	const malformed = schemaProviders.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.result.failureCode === "provider-failed" &&
			fact.result.usage.outputTokens === D41_MUTATION_MAX_OUTPUT_TOKENS &&
			fact.result.usage.costBasis === "reported",
	);
	if (malformed.length !== 1)
		throw new TypeError("D41 malformed schema rejection evidence drifted");
	const successCalls = mainProviders.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "completed" &&
			fact.result.toolCalls.some((tool) => tool.toolRef === "replace-exact"),
	);
	if (successCalls.length !== 6) throw new TypeError("D41 valid tool-call coverage drifted");
	const groups = new Map<string, typeof main.facts>();
	for (const fact of main.facts) {
		const prior = groups.get(fact.logicalRequestDigest) ?? [];
		groups.set(fact.logicalRequestDigest, Object.freeze([...prior, fact]));
	}
	const retried = [...groups.values()].filter((facts) => facts.length > 1);
	if (
		retried.length !== 1 ||
		retried[0]?.length !== 2 ||
		retried[0][0]?.loweredBodyDigest !== retried[0][1]?.loweredBodyDigest ||
		retried[0][0]?.maxOutputTokens !== D41_MUTATION_MAX_OUTPUT_TOKENS
	)
		throw new TypeError("D41 retry wire identity drifted");
	const retryProvider = mainProviders.find(
		(fact) => fact.request.requestDigest === retried[0]?.[0]?.requestDigest,
	);
	if (
		retryProvider === undefined ||
		retryProvider.result.effectKind !== "provider-request" ||
		retryProvider.result.failureCode !== "retryable-transient" ||
		retryProvider.result.usage.costBasis !== "conservative-reservation" ||
		retryProvider.reconciliation.actualCostMicrousd !==
			retryProvider.request.reservation.maxCostMicrousd
	)
		throw new TypeError("D41 retry accounting drifted");
	return Object.freeze({
		main,
		schema,
		mainProviderAttempts: mainProviders.length,
		schemaProviderAttempts: schemaProviders.length,
	});
}

function qualificationMaterial(input: {
	readonly main: D41InferenceEvidenceV1;
	readonly schema: D41InferenceEvidenceV1;
}) {
	const derived = deriveQualification(input.main, input.schema);
	return strictSnapshot({
		schemaVersion: D41_QUALIFICATION_SCHEMA,
		decisionRef: D41_DECISION_REF,
		d40ArtifactDigest: D41_D40_ARTIFACT_DIGEST,
		d40BundleDigest: D41_D40_BUNDLE_DIGEST,
		d40GraphEvidenceDigest: D41_D40_GRAPH_EVIDENCE_DIGEST,
		d40GateDigest: D41_D40_GATE_DIGEST,
		d40ImplementationManifestDigest: D41_D40_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D41_IMPLEMENTATION_MANIFEST_DIGEST,
		mainEvidenceDigest: input.main.evidenceDigest,
		schemaRejectionEvidenceDigest: input.schema.evidenceDigest,
		exactSixArmsCompleted: true as const,
		inspectionMaxOutputTokens: D41_INSPECTION_MAX_OUTPUT_TOKENS,
		mutationMaxOutputTokens: D41_MUTATION_MAX_OUTPUT_TOKENS,
		lengthRecoveryObserved: true as const,
		validToolCallObserved: true as const,
		malformedSchemaRejected: true as const,
		exactRetryWireIdentity: true as const,
		exactUsageReconciliation: true as const,
		maxActiveTransport: 1 as const,
		mainProviderAttemptCount: derived.mainProviderAttempts,
		schemaProviderAttemptCount: derived.schemaProviderAttempts,
		providerNetworkCalls: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
}

export async function runD41InjectedNoNetworkQualification(input: {
	readonly baseline: D41D40BaselineAdmissionV1;
	readonly baselineBasis: D41QualificationBundleV1["baselineBasis"];
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
}): Promise<D41QualificationBundleV1> {
	consumeBaseline(input.baseline, input.baselineBasis);
	const mainRoot = join(input.materializationRoot, "main");
	const schemaRoot = join(input.materializationRoot, "schema");
	await mkdir(mainRoot, { recursive: true, mode: 0o700 });
	await mkdir(schemaRoot, { mode: 0o700 });
	const main = await runScenario({
		repositoryRoot: input.repositoryRoot,
		materializationRoot: mainRoot,
		scenario: "main",
	});
	const schema = await runScenario({
		repositoryRoot: input.repositoryRoot,
		materializationRoot: schemaRoot,
		scenario: "schema",
	});
	if (
		main.maxActiveTransport !== 1 ||
		schema.maxActiveTransport !== 1 ||
		main.transportCalls !== providerFacts(main.evidence).length ||
		schema.transportCalls !== providerFacts(schema.evidence).length
	)
		throw new TypeError("D41 no-network transport coverage drifted");
	const derived = deriveQualification(main.evidence, schema.evidence);
	const qualificationBody = qualificationMaterial({ main: derived.main, schema: derived.schema });
	const qualification = Object.freeze({
		...qualificationBody,
		qualificationDigest: empiricalStrictJsonDigest(qualificationBody),
	});
	const generationBody = strictSnapshot({
		schemaVersion: D41_QUALIFICATION_GENERATION_SCHEMA,
		generationRef: D41_QUALIFICATION_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		mainEvidenceDigest: derived.main.evidenceDigest,
		schemaRejectionEvidenceDigest: derived.schema.evidenceDigest,
		implementationManifestDigest: D41_IMPLEMENTATION_MANIFEST_DIGEST,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationBody,
		generationDigest: empiricalStrictJsonDigest(generationBody),
	});
	const body = strictSnapshot({
		schemaVersion: D41_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis: input.baselineBasis,
		mainEvidence: derived.main,
		schemaRejectionEvidence: derived.schema,
		qualification,
		generation,
	});
	const bundle = Object.freeze({
		...body,
		bundleDigest: empiricalStrictJsonDigest(body),
	}) as D41QualificationBundleV1;
	constructed.add(bundle);
	return bundle;
}

function validateQualification(
	value: unknown,
	main: D41InferenceEvidenceV1,
	schema: D41InferenceEvidenceV1,
) {
	const candidate = record(value, "D41 qualification");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"d40ArtifactDigest",
			"d40BundleDigest",
			"d40GateDigest",
			"d40GraphEvidenceDigest",
			"d40ImplementationManifestDigest",
			"decisionRef",
			"efficacyClaim",
			"exactRetryWireIdentity",
			"exactSixArmsCompleted",
			"exactUsageReconciliation",
			"implementationManifestDigest",
			"inspectionMaxOutputTokens",
			"lengthRecoveryObserved",
			"mainEvidenceDigest",
			"mainProviderAttemptCount",
			"malformedSchemaRejected",
			"maxActiveTransport",
			"mutationMaxOutputTokens",
			"providerNetworkCalls",
			"qualificationDigest",
			"qualified",
			"schemaRejectionEvidenceDigest",
			"schemaProviderAttemptCount",
			"schemaVersion",
			"validToolCallObserved",
		],
		"D41 qualification",
	);
	const body = qualificationMaterial({ main, schema });
	const supplied = record(candidate, "D41 qualification");
	const { qualificationDigest, ...withoutDigest } = supplied;
	if (
		qualificationDigest !== empiricalStrictJsonDigest(body) ||
		empiricalStrictJsonDigest(strictSnapshot(withoutDigest)) !== empiricalStrictJsonDigest(body)
	)
		throw new TypeError("D41 qualification drifted");
	return Object.freeze({
		...body,
		qualificationDigest,
	}) as D41QualificationBundleV1["qualification"];
}

export function validateD41QualificationBundle(value: unknown): D41QualificationBundleV1 {
	const candidate = record(value, "D41 qualification bundle");
	exactKeys(
		candidate,
		[
			"baselineBasis",
			"bundleDigest",
			"generation",
			"mainEvidence",
			"qualification",
			"schemaRejectionEvidence",
			"schemaVersion",
		],
		"D41 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D41_QUALIFICATION_BUNDLE_SCHEMA ||
		(candidate.baselineBasis !== "consumed-d40-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D41 qualification bundle coordinates drifted");
	const mainEvidence = validateD41InferenceEvidence(candidate.mainEvidence);
	const schemaRejectionEvidence = validateD41InferenceEvidence(candidate.schemaRejectionEvidence);
	const qualification = validateQualification(
		candidate.qualification,
		mainEvidence,
		schemaRejectionEvidence,
	);
	const generation = record(candidate.generation, "D41 qualification generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"mainEvidenceDigest",
			"qualificationDigest",
			"schemaRejectionEvidenceDigest",
			"schemaVersion",
		],
		"D41 qualification generation",
	);
	const generationBody = strictSnapshot({
		schemaVersion: D41_QUALIFICATION_GENERATION_SCHEMA,
		generationRef: D41_QUALIFICATION_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		mainEvidenceDigest: mainEvidence.evidenceDigest,
		schemaRejectionEvidenceDigest: schemaRejectionEvidence.evidenceDigest,
		implementationManifestDigest: D41_IMPLEMENTATION_MANIFEST_DIGEST,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const suppliedGeneration = record(generation, "D41 qualification generation");
	const { generationDigest, ...withoutGenerationDigest } = suppliedGeneration;
	if (
		generationDigest !== empiricalStrictJsonDigest(generationBody) ||
		empiricalStrictJsonDigest(strictSnapshot(withoutGenerationDigest)) !==
			empiricalStrictJsonDigest(generationBody)
	)
		throw new TypeError("D41 qualification generation drifted");
	const acceptedGeneration = Object.freeze({ ...generationBody, generationDigest });
	const body = strictSnapshot({
		schemaVersion: D41_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis: candidate.baselineBasis,
		mainEvidence,
		schemaRejectionEvidence,
		qualification,
		generation: acceptedGeneration,
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(body))
		throw new TypeError("D41 qualification bundle digest drifted");
	return Object.freeze({
		...body,
		bundleDigest: candidate.bundleDigest,
	}) as D41QualificationBundleV1;
}

export async function persistD41Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D41QualificationBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D41 qualification bundle is forged or replayed");
	constructed.delete(input.bundle as object);
	const bundle = validateD41QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d40-artifact")
		throw new TypeError("D41 production qualification requires consumed D40 bytes");
	const commitBody = strictSnapshot({
		schemaVersion: "graphrefly-ts.d41.phase-specific-inference-qualification-commit.v1",
		generationRef: D41_QUALIFICATION_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D41_QUALIFICATION_GENERATION_REF,
		artifacts: Object.freeze({
			"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
			"qualification.v1.json": strictJsonCodec.encode(
				bundle.qualification as unknown as StrictJsonValue,
			),
			"generation.v1.json": strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue),
		}),
		commitBytes: strictJsonCodec.encode({
			...commitBody,
			commitDigest: empiricalStrictJsonDigest(commitBody),
		}),
	});
}

export async function runD41QualificationInTemporaryRoot(input: {
	readonly baseline: D41D40BaselineAdmissionV1;
	readonly baselineBasis: D41QualificationBundleV1["baselineBasis"];
	readonly repositoryRoot: string;
}) {
	const root = await mkdtemp(join(tmpdir(), "graphrefly-d41-qualification-"));
	await chmod(root, 0o700);
	try {
		return await runD41InjectedNoNetworkQualification({
			...input,
			materializationRoot: root,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
