import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	CURRENT_GRAPH_LIVE_QUANTIZATION,
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "./d8-current-openrouter-adapter.js";
import {
	D41_INSPECTION_MAX_OUTPUT_TOKENS as D42_INSPECTION_MAX_OUTPUT_TOKENS,
	D41_MUTATION_MAX_OUTPUT_TOKENS as D42_MUTATION_MAX_OUTPUT_TOKENS,
} from "./d41-phase-specific-inference-authority.js";
import { createD41PhaseSpecificRealProviderExecutor } from "./d41-phase-specific-real-provider-composition.js";
import {
	createD42InjectedBaselineForTest,
	type D42D41BaselineAdmissionV1,
	type D42LiveBundleV1,
	persistD42LiveBundle,
	runD42InjectedMeasurementForTest,
	validateD42LiveBundle,
} from "./d42-phase-specific-inference-live.js";
import {
	acquireD42DispatchClaimAtRootForTest,
	consumeD42DispatchClaim,
	readD42CurrentKeyAdmission,
} from "./d42-phase-specific-inference-live-claim.js";
import {
	D42_D41_ARTIFACT_DIGEST,
	D42_D41_BUNDLE_DIGEST,
	D42_D41_GENERATION_DIGEST,
	D42_D41_IMPLEMENTATION_MANIFEST_DIGEST,
	D42_D41_MAIN_EVIDENCE_DIGEST,
	D42_D41_QUALIFICATION_DIGEST,
	D42_DECISION_REF,
	D42_QUALIFICATION_GENERATION_REF,
} from "./d42-phase-specific-inference-live-coordinates.js";
import { D42_IMPLEMENTATION_MANIFEST_DIGEST } from "./d42-phase-specific-inference-live-implementation-manifest.js";
import {
	admitD42ZeroByok,
	composeD42Preclaim,
	type D42CredentialV1,
	readD42OfficialPricing,
} from "./d42-phase-specific-inference-live-preflight.js";

export const D42_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d42.phase-specific-inference-live-qualification.v1" as const;
export const D42_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d42.phase-specific-inference-live-qualification-bundle.v1" as const;
export const D42_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d42.phase-specific-inference-live-qualification-generation.v1" as const;

export interface D42QualificationBundleV1 {
	readonly schemaVersion: typeof D42_QUALIFICATION_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d41-artifact" | "injected-test";
	readonly mainBundle: D42LiveBundleV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D42_QUALIFICATION_SCHEMA;
		readonly decisionRef: typeof D42_DECISION_REF;
		readonly d41ArtifactDigest: typeof D42_D41_ARTIFACT_DIGEST;
		readonly d41BundleDigest: typeof D42_D41_BUNDLE_DIGEST;
		readonly d41MainEvidenceDigest: typeof D42_D41_MAIN_EVIDENCE_DIGEST;
		readonly d41GenerationDigest: typeof D42_D41_GENERATION_DIGEST;
		readonly d41QualificationDigest: typeof D42_D41_QUALIFICATION_DIGEST;
		readonly d41ImplementationManifestDigest: typeof D42_D41_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly implementationManifestDigest: typeof D42_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly mainBundleDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly zeroRetainedSpanFacts: true;
		readonly inspectionFactCount: 6;
		readonly mutationFactCount: number;
		readonly exactPhaseCeilings: true;
		readonly exactRetryWireIdentity: true;
		readonly retryWaitCount: 1;
		readonly providerAttemptCount: number;
		readonly graphAdmissionBeforeEveryEffect: true;
		readonly conservativeRetryAccounting: true;
		readonly maxActiveTransport: 1;
		readonly providerNetworkCalls: 0;
		readonly duplicateClaimRejected: true;
		readonly partialFailurePersistencePassed: true;
		readonly liveGateEvaluated: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualified: true;
		readonly qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		readonly schemaVersion: typeof D42_QUALIFICATION_GENERATION_SCHEMA;
		readonly generationRef: typeof D42_QUALIFICATION_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly mainBundleDigest: string;
		readonly implementationManifestDigest: typeof D42_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const constructed = new WeakSet<object>();

function officialPricingResponse(): Response {
	const response = new Response(
		JSON.stringify({
			data: {
				id: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
				endpoints: [
					{
						provider_name: CURRENT_GRAPH_LIVE_PROVIDER_NAME,
						tag: CURRENT_GRAPH_LIVE_PROVIDER_TAG,
						quantization: CURRENT_GRAPH_LIVE_QUANTIZATION,
						model: CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
						supported_parameters: ["max_tokens", "reasoning", "tool_choice", "tools"],
						pricing: {
							prompt: "0.00000008",
							completion: "0.00000018",
							input_cache_read: "0.000000016",
						},
					},
				],
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
	Object.defineProperty(response, "url", {
		value: "https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints",
	});
	return response;
}

async function makeTestPreclaim(credential: D42CredentialV1, nowMs: number) {
	const pricing = await readD42OfficialPricing({
		fetch: async () => officialPricingResponse(),
		nowMs: () => nowMs,
		signal: new AbortController().signal,
	});
	const zeroByok = admitD42ZeroByok({
		bytes: Buffer.from(
			JSON.stringify({
				schemaVersion: "graphrefly-ts.d20.zero-byok-observation.v1",
				decisionRef: "graphrefly-ts:D20",
				workspaceName: "GraphReFly",
				workspaceSlug: "graph-re-fly",
				keyName: "Local Eval 2",
				keyVisiblePrefix: credential.bearerToken.slice(0, 12),
				keyVisibleSuffix: credential.bearerToken.slice(-3),
				byokCredentialCount: 0,
				allowedModels: [CURRENT_GRAPH_LIVE_REQUEST_MODEL],
				allowedProviders: [CURRENT_GRAPH_LIVE_PROVIDER_NAME],
				observedAt: new Date(nowMs).toISOString(),
				source: "openrouter-browser-settings",
			}),
		),
		credential,
		nowMs,
	});
	return composeD42Preclaim({
		pricingObservation: pricing,
		zeroByokObservation: zeroByok,
		credential,
		nowMs,
	});
}

async function issueTestAuthority(input: {
	readonly privateRoot: string;
	readonly credential: D42CredentialV1;
	readonly nowMs: number;
}) {
	const qualificationCoordinate = empiricalStrictJsonDigest({
		decisionRef: D42_DECISION_REF,
		implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
	});
	const claim = await acquireD42DispatchClaimAtRootForTest(input.privateRoot, {
		preclaim: await makeTestPreclaim(input.credential, input.nowMs),
		nowMs: input.nowMs,
		implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: qualificationCoordinate,
		qualificationDigest: qualificationCoordinate,
	});
	let duplicateRejected = false;
	try {
		await acquireD42DispatchClaimAtRootForTest(input.privateRoot, {
			preclaim: await makeTestPreclaim(input.credential, input.nowMs),
			nowMs: input.nowMs,
			implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest: qualificationCoordinate,
			qualificationDigest: qualificationCoordinate,
		});
	} catch (error) {
		duplicateRejected = (error as NodeJS.ErrnoException).code === "EEXIST";
	}
	if (!duplicateRejected) throw new TypeError("D42 duplicate test claim was admitted");
	const currentKeyAdmission = await readD42CurrentKeyAdmission({
		claim,
		credential: input.credential,
		fetch: async () =>
			new Response(
				JSON.stringify({
					data: {
						limit: 32,
						limit_remaining: 31,
						usage: 1,
						limit_reset: null,
						is_management_key: false,
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		signal: new AbortController().signal,
	});
	return consumeD42DispatchClaim({ claim, currentKeyAdmission, allowInjectedTestScope: true });
}

function providerResponse(toolName: string, args: unknown): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: `d42-${toolName}`,
								type: "function",
								function: { name: toolName, arguments: JSON.stringify(args) },
							},
						],
					},
				},
			],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function batchReadResponse(): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
							id: `d42-read-${index}`,
							type: "function",
							function: { name: "read_file", arguments: JSON.stringify({ path }) },
						})),
					},
				},
			],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function deriveMain(bundleValue: unknown) {
	const bundle = validateD42LiveBundle(bundleValue);
	if (
		bundle.disposition !== "success" ||
		bundle.executionClass !== "injected-no-network" ||
		bundle.graphEvidence === null ||
		bundle.gate.evaluated !== false ||
		bundle.efficacyClaim !== "none"
	)
		throw new TypeError("D42 qualification main disposition drifted");
	const evidence = bundle.graphEvidence;
	const retained = evidence.retainedSpanEvidence;
	const workflow = retained.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence;
	if (
		retained.facts.length !== 0 ||
		workflow.runStatus !== "complete" ||
		workflow.runs.length !== 6 ||
		workflow.runs.some(
			(run) =>
				run.status !== "completed" ||
				run.cleanupStatus !== "completed" ||
				run.publicSemanticValidationPassed !== true ||
				run.hiddenVerifierPassed !== true,
		)
	)
		throw new TypeError("D42 qualification six-arm lifecycle drifted");
	const inspection = evidence.facts.filter((fact) => fact.phase === "inspection");
	const mutation = evidence.facts.filter((fact) => fact.phase === "mutation");
	if (
		inspection.length !== 6 ||
		mutation.length < 7 ||
		evidence.facts.some(
			(fact) =>
				fact.maxOutputTokens !==
				(fact.phase === "inspection"
					? D42_INSPECTION_MAX_OUTPUT_TOKENS
					: D42_MUTATION_MAX_OUTPUT_TOKENS),
		)
	)
		throw new TypeError("D42 qualification inference ceilings drifted");
	const providerFacts = retained.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	);
	if (providerFacts.length !== evidence.facts.length)
		throw new TypeError("D42 inference/provider fact reverse coverage drifted");
	for (const fact of evidence.facts) {
		const provider = providerFacts.find(
			(candidate) =>
				candidate.request.requestDigest === fact.requestDigest &&
				candidate.admission.decisionDigest === fact.admissionDigest,
		);
		if (provider === undefined || provider.factDigest !== fact.providerFactDigest)
			throw new TypeError("D42 inference/provider fact binding drifted");
	}
	const waits = retained.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
		(fact) => fact.request.effectKind === "retry-wait",
	);
	if (waits.length !== 1) throw new TypeError("D42 retry wait count drifted");
	const retryGroups = new Map<string, typeof evidence.facts>();
	for (const fact of evidence.facts) {
		const prior = retryGroups.get(fact.logicalRequestDigest) ?? [];
		retryGroups.set(fact.logicalRequestDigest, Object.freeze([...prior, fact]));
	}
	const retried = [...retryGroups.values()].filter((facts) => facts.length > 1);
	if (
		retried.length !== 1 ||
		retried[0]!.length !== 2 ||
		retried[0]![0]!.loweredBodyDigest !== retried[0]![1]!.loweredBodyDigest ||
		retried[0]![0]!.maxOutputTokens !== D42_MUTATION_MAX_OUTPUT_TOKENS
	)
		throw new TypeError("D42 retry wire identity drifted");
	const retryProvider = providerFacts.find(
		(fact) => fact.request.requestDigest === retried[0]![0]!.requestDigest,
	);
	if (
		retryProvider === undefined ||
		retryProvider.result.effectKind !== "provider-request" ||
		retryProvider.result.usage.costBasis !== "conservative-reservation" ||
		retryProvider.reconciliation.actualCostMicrousd !==
			retryProvider.request.reservation.maxCostMicrousd
	)
		throw new TypeError("D42 retry conservative accounting drifted");
	return Object.freeze({
		bundle,
		inspectionFactCount: inspection.length,
		mutationFactCount: mutation.length,
		providerAttemptCount: providerFacts.length,
	});
}

async function qualifyPartialFailure(input: {
	readonly testRoot: string;
	readonly credential: D42CredentialV1;
}): Promise<void> {
	const claimRoot = join(input.testRoot, "partial-claim");
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const executionAuthority = await issueTestAuthority({
		privateRoot: await realpath(claimRoot),
		credential: input.credential,
		nowMs: Date.parse("2026-08-20T12:01:00.000Z"),
	});
	const partial = await runD42InjectedMeasurementForTest({
		executionAuthority,
		baseline: createD42InjectedBaselineForTest(),
		implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
		executorFactory: () =>
			Object.freeze({
				async execute() {
					throw new TypeError("injected D42 executor failure");
				},
				async dispose() {},
			}),
	});
	const validated = validateD42LiveBundle(partial);
	if (
		validated.disposition !== "partial-failure" ||
		validated.graphEvidence !== null ||
		validated.generation !== null ||
		validated.partialGraphEvidence?.failureCode !== "executor-boundary-failed" ||
		validated.partialGraphEvidence.activeRequestDigest === null ||
		validated.partialGraphEvidence.activeAdmissionDigest === null ||
		validated.efficacyClaim !== "none"
	)
		throw new TypeError("D42 partial failure evidence drifted");
	const persistenceRoot = join(input.testRoot, "partial-persistence");
	await mkdir(persistenceRoot, { mode: 0o700 });
	await chmod(persistenceRoot, 0o700);
	await persistD42LiveBundle({ privateRoot: await realpath(persistenceRoot), bundle: partial });
	let replayRejected = false;
	try {
		await persistD42LiveBundle({ privateRoot: await realpath(persistenceRoot), bundle: partial });
	} catch (error) {
		replayRejected = error instanceof TypeError && error.message.includes("forged or replayed");
	}
	if (!replayRejected) throw new TypeError("D42 partial persistence replay was admitted");
}

export async function runD42InjectedNoNetworkQualification(input: {
	readonly baseline: D42D41BaselineAdmissionV1;
	readonly baselineBasis: D42QualificationBundleV1["baselineBasis"];
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
}): Promise<D42QualificationBundleV1> {
	const testRoot = await mkdtemp(join(tmpdir(), "graphrefly-d42-qualification-"));
	await chmod(testRoot, 0o700);
	const claimRoot = join(testRoot, "claim");
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const credential = Object.freeze({
		bearerToken: "d42-injected-no-network-credential",
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
	try {
		const executionAuthority = await issueTestAuthority({
			privateRoot: await realpath(claimRoot),
			credential,
			nowMs: Date.parse("2026-08-20T12:00:00.000Z"),
		});
		let activeTransport = 0;
		let maxActiveTransport = 0;
		let retryInjected = false;
		const main = await runD42InjectedMeasurementForTest({
			executionAuthority,
			baseline: input.baseline,
			implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
			allowConsumedBaselineForQualification: input.baselineBasis === "consumed-d41-artifact",
			executorFactory: () =>
				createD41PhaseSpecificRealProviderExecutor({
					repositoryRoot: input.repositoryRoot,
					materializationRoot: input.materializationRoot,
					credential,
					fetchImpl: async (_url, init) => {
						activeTransport += 1;
						maxActiveTransport = Math.max(maxActiveTransport, activeTransport);
						try {
							const bytes = Buffer.from(init?.body as Uint8Array);
							const body = record(JSON.parse(bytes.toString("utf8")), "D42 injected body");
							const messages = array(body.messages, "D42 injected messages");
							const hasReadResult = messages.some((value) => {
								const message = record(value, "D42 injected message");
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
									: record(
											record(choice, "D42 injected tool choice").function,
											"D42 injected tool function",
										).name;
							if (toolName === "read_file") return batchReadResponse();
							if (toolName !== "replace_exact")
								throw new TypeError("D42 injected tool choice drifted");
							if (!retryInjected) {
								retryInjected = true;
								return new Response(
									JSON.stringify({ error: { message: "bounded injected 429" } }),
									{
										status: 429,
										headers: { "content-type": "application/json", "retry-after": "0" },
									},
								);
							}
							return providerResponse("replace_exact", {
								path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
								oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
								newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
							});
						} finally {
							activeTransport -= 1;
						}
					},
					now: (() => {
						let value = 0;
						return () => ++value;
					})(),
					sleep: async () => undefined,
				}),
		});
		const derived = deriveMain(main);
		if (maxActiveTransport !== 1)
			throw new TypeError("D42 qualification observed non-serial transport");
		await qualifyPartialFailure({ testRoot, credential });
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D42_QUALIFICATION_SCHEMA,
			decisionRef: D42_DECISION_REF,
			d41ArtifactDigest: D42_D41_ARTIFACT_DIGEST,
			d41BundleDigest: D42_D41_BUNDLE_DIGEST,
			d41MainEvidenceDigest: D42_D41_MAIN_EVIDENCE_DIGEST,
			d41GenerationDigest: D42_D41_GENERATION_DIGEST,
			d41QualificationDigest: D42_D41_QUALIFICATION_DIGEST,
			d41ImplementationManifestDigest: D42_D41_IMPLEMENTATION_MANIFEST_DIGEST,
			implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
			mainBundleDigest: derived.bundle.bundleDigest,
			exactSixArmsCompleted: true as const,
			zeroRetainedSpanFacts: true as const,
			inspectionFactCount: 6 as const,
			mutationFactCount: derived.mutationFactCount,
			exactPhaseCeilings: true as const,
			exactRetryWireIdentity: true as const,
			retryWaitCount: 1 as const,
			providerAttemptCount: derived.providerAttemptCount,
			graphAdmissionBeforeEveryEffect: true as const,
			conservativeRetryAccounting: true as const,
			maxActiveTransport: 1 as const,
			providerNetworkCalls: 0 as const,
			duplicateClaimRejected: true as const,
			partialFailurePersistencePassed: true as const,
			liveGateEvaluated: false as const,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
			qualified: true as const,
		});
		const qualification = Object.freeze({
			...qualificationMaterial,
			qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
		});
		const generationMaterial = strictSnapshot({
			schemaVersion: D42_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D42_QUALIFICATION_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			mainBundleDigest: derived.bundle.bundleDigest,
			implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const material = strictSnapshot({
			schemaVersion: D42_QUALIFICATION_BUNDLE_SCHEMA,
			baselineBasis: input.baselineBasis,
			mainBundle: derived.bundle,
			qualification,
			generation,
		});
		const bundle = Object.freeze({
			...material,
			bundleDigest: empiricalStrictJsonDigest(material),
		}) as D42QualificationBundleV1;
		constructed.add(bundle);
		return bundle;
	} finally {
		await rm(testRoot, { recursive: true, force: true });
	}
}

function validateQualification(value: unknown, main: D42LiveBundleV1) {
	const candidate = record(value, "D42 qualification");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"conservativeRetryAccounting",
			"d41ArtifactDigest",
			"d41BundleDigest",
			"d41ImplementationManifestDigest",
			"d41MainEvidenceDigest",
			"d41GenerationDigest",
			"d41QualificationDigest",
			"decisionRef",
			"duplicateClaimRejected",
			"efficacyClaim",
			"exactPhaseCeilings",
			"exactRetryWireIdentity",
			"exactSixArmsCompleted",
			"graphAdmissionBeforeEveryEffect",
			"implementationManifestDigest",
			"inspectionFactCount",
			"liveGateEvaluated",
			"mainBundleDigest",
			"maxActiveTransport",
			"mutationFactCount",
			"partialFailurePersistencePassed",
			"providerAttemptCount",
			"providerNetworkCalls",
			"qualificationDigest",
			"qualified",
			"retryWaitCount",
			"schemaVersion",
			"zeroRetainedSpanFacts",
		],
		"D42 qualification",
	);
	const derived = deriveMain(main);
	const material = strictSnapshot({
		schemaVersion: D42_QUALIFICATION_SCHEMA,
		decisionRef: D42_DECISION_REF,
		d41ArtifactDigest: D42_D41_ARTIFACT_DIGEST,
		d41BundleDigest: D42_D41_BUNDLE_DIGEST,
		d41MainEvidenceDigest: D42_D41_MAIN_EVIDENCE_DIGEST,
		d41GenerationDigest: D42_D41_GENERATION_DIGEST,
		d41QualificationDigest: D42_D41_QUALIFICATION_DIGEST,
		d41ImplementationManifestDigest: D42_D41_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
		mainBundleDigest: main.bundleDigest,
		exactSixArmsCompleted: true as const,
		zeroRetainedSpanFacts: true as const,
		inspectionFactCount: 6 as const,
		mutationFactCount: derived.mutationFactCount,
		exactPhaseCeilings: true as const,
		exactRetryWireIdentity: true as const,
		retryWaitCount: 1 as const,
		providerAttemptCount: derived.providerAttemptCount,
		graphAdmissionBeforeEveryEffect: true as const,
		conservativeRetryAccounting: true as const,
		maxActiveTransport: 1 as const,
		providerNetworkCalls: 0 as const,
		duplicateClaimRejected: true as const,
		partialFailurePersistencePassed: true as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	if (
		candidate.qualificationDigest !== empiricalStrictJsonDigest(material) ||
		empiricalStrictJsonDigest(
			strictSnapshot(
				Object.fromEntries(
					Object.entries(candidate).filter(([key]) => key !== "qualificationDigest"),
				),
			),
		) !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D42 qualification drifted");
	return Object.freeze({ ...material, qualificationDigest: candidate.qualificationDigest });
}

export function validateD42QualificationBundle(value: unknown): D42QualificationBundleV1 {
	const candidate = record(value, "D42 qualification bundle");
	exactKeys(
		candidate,
		["baselineBasis", "bundleDigest", "generation", "mainBundle", "qualification", "schemaVersion"],
		"D42 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D42_QUALIFICATION_BUNDLE_SCHEMA ||
		(candidate.baselineBasis !== "consumed-d41-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D42 qualification bundle coordinates drifted");
	const mainBundle = validateD42LiveBundle(candidate.mainBundle);
	const qualification = validateQualification(candidate.qualification, mainBundle);
	const generation = record(candidate.generation, "D42 qualification generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"mainBundleDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"D42 qualification generation",
	);
	const generationMaterial = strictSnapshot({
		schemaVersion: D42_QUALIFICATION_GENERATION_SCHEMA,
		generationRef: D42_QUALIFICATION_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		mainBundleDigest: mainBundle.bundleDigest,
		implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	if (
		generation.generationDigest !== empiricalStrictJsonDigest(generationMaterial) ||
		empiricalStrictJsonDigest(
			strictSnapshot(
				Object.fromEntries(
					Object.entries(generation).filter(([key]) => key !== "generationDigest"),
				),
			),
		) !== empiricalStrictJsonDigest(generationMaterial)
	)
		throw new TypeError("D42 qualification generation drifted");
	const material = strictSnapshot({
		schemaVersion: D42_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis: candidate.baselineBasis,
		mainBundle,
		qualification,
		generation: Object.freeze({
			...generationMaterial,
			generationDigest: generation.generationDigest,
		}),
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D42 qualification bundle digest drifted");
	return Object.freeze({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as D42QualificationBundleV1;
}

export async function persistD42Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D42QualificationBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D42 qualification bundle is forged or replayed");
	constructed.delete(input.bundle as object);
	const bundle = validateD42QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d41-artifact")
		throw new TypeError("D42 production qualification requires consumed D41 bytes");
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d42.phase-specific-inference-live-qualification-commit.v1",
		generationRef: D42_QUALIFICATION_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D42_QUALIFICATION_GENERATION_REF,
		artifacts: Object.freeze({
			"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
			"qualification.v1.json": strictJsonCodec.encode(
				bundle.qualification as unknown as StrictJsonValue,
			),
			"generation.v1.json": strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue),
		}),
		commitBytes: strictJsonCodec.encode({
			...commitMaterial,
			commitDigest: empiricalStrictJsonDigest(commitMaterial),
		}),
	});
}

export function qualificationArtifactDigest(bytes: Uint8Array): string {
	return empiricalSha256(bytes);
}

export function qualificationDigest(value: unknown): string {
	return digest(
		record(validateD42QualificationBundle(value).qualification, "D42 qualification")
			.qualificationDigest,
		"D42 qualification digest",
	);
}

export function qualificationProviderAttemptCount(value: unknown): number {
	return safeInteger(
		record(validateD42QualificationBundle(value).qualification, "D42 qualification")
			.providerAttemptCount,
		"D42 qualification provider attempt count",
	);
}
