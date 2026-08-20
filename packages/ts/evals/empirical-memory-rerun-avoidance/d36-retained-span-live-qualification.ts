import { chmod, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
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
import { createD35RetainedSpanRealProviderExecutor } from "./d35-retained-span-real-provider-composition.js";
import {
	admitD36D35Baseline,
	createD36InjectedBaselineForTest,
	type D36D35BaselineAdmissionV1,
	type D36LiveBundleV1,
	persistD36LiveBundle,
	runD36InjectedMeasurementForTest,
	validateD36LiveBundle,
} from "./d36-retained-span-live.js";
import {
	acquireD36DispatchClaimAtRootForTest,
	consumeD36DispatchClaim,
	readD36CurrentKeyAdmission,
} from "./d36-retained-span-live-claim.js";
import {
	D36_D35_ARTIFACT_DIGEST,
	D36_D35_BUNDLE_DIGEST,
	D36_D35_EVIDENCE_DIGEST,
	D36_D35_GENERATION_DIGEST,
	D36_D35_IMPLEMENTATION_MANIFEST_DIGEST,
	D36_D35_QUALIFICATION_DIGEST,
	D36_DECISION_REF,
	D36_QUALIFICATION_GENERATION_REF,
} from "./d36-retained-span-live-coordinates.js";
import { D36_IMPLEMENTATION_MANIFEST_DIGEST } from "./d36-retained-span-live-implementation-manifest.js";
import {
	admitD36ZeroByok,
	composeD36Preclaim,
	type D36CredentialV1,
	readD36OfficialPricing,
} from "./d36-retained-span-live-preflight.js";

export const D36_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d36.retained-span-live-qualification.v1" as const;
export const D36_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d36.retained-span-live-qualification-bundle.v1" as const;
export const D36_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d36.retained-span-live-qualification-generation.v1" as const;

export interface D36QualificationBundleV1 {
	readonly schemaVersion: typeof D36_QUALIFICATION_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d35-artifact" | "injected-test";
	readonly mainBundle: D36LiveBundleV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D36_QUALIFICATION_SCHEMA;
		readonly decisionRef: typeof D36_DECISION_REF;
		readonly d35ArtifactDigest: typeof D36_D35_ARTIFACT_DIGEST;
		readonly d35BundleDigest: typeof D36_D35_BUNDLE_DIGEST;
		readonly d35QualificationDigest: typeof D36_D35_QUALIFICATION_DIGEST;
		readonly d35GenerationDigest: typeof D36_D35_GENERATION_DIGEST;
		readonly d35EvidenceDigest: typeof D36_D35_EVIDENCE_DIGEST;
		readonly d35ImplementationManifestDigest: typeof D36_D35_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly implementationManifestDigest: typeof D36_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly mainBundleDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly graphAdmissionBeforeEveryEffect: true;
		readonly exactNamedNewTextOnlyWire: true;
		readonly retryIdentityPassed: true;
		readonly providerTransportCalls: number;
		readonly retainedSpanTransportCalls: number;
		readonly retryWaitCount: 1;
		readonly maxActiveEffects: 1;
		readonly maxActiveTransport: 1;
		readonly providerNetworkCalls: 0;
		readonly freshGateClaimCurrentKeyOrderPassed: true;
		readonly duplicateClaimRejected: true;
		readonly partialFailurePersistencePassed: true;
		readonly workspaceResidueCount: 0;
		readonly liveGateEvaluated: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualified: true;
		readonly qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		readonly schemaVersion: typeof D36_QUALIFICATION_GENERATION_SCHEMA;
		readonly generationRef: typeof D36_QUALIFICATION_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly mainBundleDigest: string;
		readonly implementationManifestDigest: typeof D36_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const constructed = new WeakSet<object>();

export function admitD36QualificationBaseline(bytes: Uint8Array) {
	return admitD36D35Baseline(bytes);
}

export function createD36QualificationInjectedBaselineForTest() {
	return createD36InjectedBaselineForTest();
}

function officialPricingResponse() {
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

async function makeTestPreclaim(credential: D36CredentialV1, nowMs: number) {
	const pricing = await readD36OfficialPricing({
		fetch: async () => officialPricingResponse(),
		nowMs: () => nowMs,
		signal: new AbortController().signal,
	});
	const zeroByok = admitD36ZeroByok({
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
	return composeD36Preclaim({
		pricingObservation: pricing,
		zeroByokObservation: zeroByok,
		credential,
		nowMs,
	});
}

async function issueTestAuthority(input: {
	readonly privateRoot: string;
	readonly credential: D36CredentialV1;
	readonly nowMs: number;
}) {
	const coordinate = empiricalStrictJsonDigest({
		decisionRef: D36_DECISION_REF,
		implementationManifestDigest: D36_IMPLEMENTATION_MANIFEST_DIGEST,
	});
	const claim = await acquireD36DispatchClaimAtRootForTest(input.privateRoot, {
		preclaim: await makeTestPreclaim(input.credential, input.nowMs),
		nowMs: input.nowMs,
		implementationManifestDigest: D36_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: coordinate,
		qualificationDigest: coordinate,
	});
	let duplicateRejected = false;
	try {
		await acquireD36DispatchClaimAtRootForTest(input.privateRoot, {
			preclaim: await makeTestPreclaim(input.credential, input.nowMs),
			nowMs: input.nowMs,
			implementationManifestDigest: D36_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest: coordinate,
			qualificationDigest: coordinate,
		});
	} catch (error) {
		duplicateRejected = (error as NodeJS.ErrnoException).code === "EEXIST";
	}
	if (!duplicateRejected) throw new TypeError("D36 duplicate dispatch claim was admitted");
	const currentKeyAdmission = await readD36CurrentKeyAdmission({
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
	return consumeD36DispatchClaim({ claim, currentKeyAdmission, allowInjectedTestScope: true });
}

async function qualifyPartialFailure(input: {
	readonly testRoot: string;
	readonly credential: D36CredentialV1;
}): Promise<void> {
	const claimRoot = join(input.testRoot, "partial-claim");
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const executionAuthority = await issueTestAuthority({
		privateRoot: await realpath(claimRoot),
		credential: input.credential,
		nowMs: Date.parse("2026-08-20T12:01:00.000Z"),
	});
	const partial = await runD36InjectedMeasurementForTest({
		executionAuthority,
		baseline: createD36InjectedBaselineForTest(),
		implementationManifestDigest: D36_IMPLEMENTATION_MANIFEST_DIGEST,
		executorFactory: () =>
			Object.freeze({
				async executeNext() {
					throw new TypeError("injected executor failure");
				},
				async dispose() {},
			}),
	});
	if (
		partial.disposition !== "partial-failure" ||
		partial.graphEvidence !== null ||
		partial.generation !== null ||
		partial.partialGraphEvidence?.failureCode !== "executor-boundary-failed" ||
		partial.gate.evaluated !== false ||
		partial.efficacyClaim !== "none"
	)
		throw new TypeError("D36 injected partial failure semantics drifted");
	const persistenceRoot = join(input.testRoot, "partial-persistence");
	await mkdir(persistenceRoot, { mode: 0o700 });
	await chmod(persistenceRoot, 0o700);
	await persistD36LiveBundle({ privateRoot: await realpath(persistenceRoot), bundle: partial });
	try {
		await persistD36LiveBundle({ privateRoot: await realpath(persistenceRoot), bundle: partial });
		throw new TypeError("D36 partial persistence replay was admitted");
	} catch (error) {
		if (!(error instanceof TypeError) || !error.message.includes("forged or replayed")) throw error;
	}
}

function providerResponse(toolName: string, args: unknown, callCount = 1) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: Array.from({ length: callCount }, (_, index) => ({
							id: `d36-${toolName}-${index}`,
							type: "function",
							function: { name: toolName, arguments: JSON.stringify(args) },
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

function providerBatch(calls: readonly Readonly<{ name: string; args: unknown }>[]) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: calls.map((call, index) => ({
							id: `d36-${call.name}-${index}`,
							type: "function",
							function: { name: call.name, arguments: JSON.stringify(call.args) },
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

function providerAttemptCount(bundle: D36LiveBundleV1): number {
	return (
		bundle.graphEvidence?.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
			(fact) => fact.request.effectKind === "provider-request",
		).length ?? 0
	);
}

function retryWaitCount(bundle: D36LiveBundleV1): number {
	return (
		bundle.graphEvidence?.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
			(fact) => fact.result.effectKind === "retry-wait",
		).length ?? 0
	);
}

async function runMain(input: {
	readonly baseline: D36D35BaselineAdmissionV1;
	readonly baselineBasis: D36QualificationBundleV1["baselineBasis"];
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly privateRoot: string;
}) {
	const credential = Object.freeze({
		bearerToken: "d36-injected-no-network-credential",
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
	const executionAuthority = await issueTestAuthority({
		privateRoot: input.privateRoot,
		credential,
		nowMs: Date.parse("2026-08-20T12:00:00.000Z"),
	});
	let activeTransport = 0;
	let maxActiveTransport = 0;
	let transportCalls = 0;
	let retainedCalls = 0;
	let retryInjected = false;
	let executorError: string | null = null;
	const retainedBodies: Uint8Array[] = [];
	const toolNames: string[] = [];
	const bundle = await runD36InjectedMeasurementForTest({
		executionAuthority,
		baseline: input.baseline,
		implementationManifestDigest: D36_IMPLEMENTATION_MANIFEST_DIGEST,
		allowConsumedBaselineForQualification: input.baselineBasis === "consumed-d35-artifact",
		executorFactory: (authority) => {
			const executor = createD35RetainedSpanRealProviderExecutor({
				authority,
				repositoryRoot: input.repositoryRoot,
				materializationRoot: input.materializationRoot,
				credential,
				fetchImpl: async (_url, init) => {
					activeTransport += 1;
					maxActiveTransport = Math.max(maxActiveTransport, activeTransport);
					transportCalls += 1;
					try {
						const bytes =
							typeof init?.body === "string"
								? Buffer.from(init.body, "utf8")
								: Buffer.from(init?.body as Uint8Array);
						const body = record(JSON.parse(bytes.toString("utf8")), "D36 injected body");
						const messages = Array.isArray(body.messages) ? body.messages : [];
						const hasReadResult = messages.some((value) => {
							const message = record(value, "D36 injected message");
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
										record(choice, "D36 injected tool choice").function,
										"D36 injected tool choice function",
									).name;
						toolNames.push(String(toolName));
						if (toolName === "read_file")
							return choice === "required"
								? providerResponse("read_file", { path: CURRENT_GRAPH_LIVE_WRITABLE_FILE })
								: providerBatch(
										CURRENT_GRAPH_LIVE_READABLE_FILES.map((path) => ({
											name: "read_file",
											args: { path },
										})),
									);
						if (toolName === "replace_exact")
							return providerResponse("replace_exact", {
								path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
								oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
								newText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
							});
						if (toolName !== "propose_replacement_text")
							throw new TypeError("D36 injected named tool drifted");
						retainedCalls += 1;
						retainedBodies.push(new Uint8Array(bytes));
						if (!retryInjected) {
							retryInjected = true;
							return new Response(JSON.stringify({ error: { message: "bounded injected 429" } }), {
								status: 429,
								headers: { "content-type": "application/json", "retry-after": "0" },
							});
						}
						return providerResponse("propose_replacement_text", {
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
			});
			return Object.freeze({
				async executeNext() {
					try {
						return await executor.executeNext();
					} catch (error) {
						executorError = error instanceof Error ? error.message : "non-error";
						throw error;
					}
				},
				dispose: executor.dispose,
			});
		},
	});
	if (
		retainedBodies.length < 2 ||
		!Buffer.from(retainedBodies[0]!).equals(Buffer.from(retainedBodies[1]!))
	)
		throw new TypeError(
			`D36 retained retry wire identity drifted: ${JSON.stringify({ retainedBodies: retainedBodies.length, transportCalls, retainedCalls, toolNames, disposition: bundle.disposition, partial: bundle.partialGraphEvidence?.failureCode ?? null, executorError })}`,
		);
	for (const bytes of retainedBodies) {
		const serialized = Buffer.from(bytes).toString("utf8");
		if (
			serialized.includes("oldText") ||
			serialized.includes(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK) ||
			!serialized.includes("propose_replacement_text") ||
			!serialized.includes("newText")
		)
			throw new TypeError("D36 retained wire privacy drifted");
	}
	return Object.freeze({ bundle, transportCalls, retainedCalls, maxActiveTransport });
}

export async function runD36InjectedNoNetworkQualification(input: {
	readonly baseline: D36D35BaselineAdmissionV1;
	readonly baselineBasis: D36QualificationBundleV1["baselineBasis"];
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
}): Promise<D36QualificationBundleV1> {
	const testRoot = await mkdtemp(join(tmpdir(), "graphrefly-d36-qualification-"));
	await chmod(testRoot, 0o700);
	const claimRoot = join(testRoot, "claim");
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	try {
		const main = await runMain({ ...input, privateRoot: await realpath(claimRoot) });
		await qualifyPartialFailure({
			testRoot,
			credential: Object.freeze({
				bearerToken: "d36-injected-no-network-credential",
				credentialBindingRef: "openrouter.local-eval-2" as const,
				credentialBindingRevision: "2026-08-14.v1" as const,
			}),
		});
		const validatedMain = validateD36LiveBundle(main.bundle);
		const runs =
			validatedMain.graphEvidence?.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence
				.runs ?? [];
		const waits = retryWaitCount(validatedMain);
		const attempts = providerAttemptCount(validatedMain);
		let workspaceResidueCount: number;
		try {
			workspaceResidueCount = (await readdir(input.materializationRoot)).length;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			workspaceResidueCount = 0;
		}
		if (
			validatedMain.disposition !== "success" ||
			validatedMain.executionClass !== "injected-no-network" ||
			validatedMain.gate.evaluated !== false ||
			validatedMain.efficacyClaim !== "none" ||
			runs.length !== 6 ||
			runs.some(
				(run) =>
					run.status !== "completed" ||
					!run.publicSemanticValidationPassed ||
					!run.hiddenVerifierPassed ||
					run.cleanupStatus !== "completed",
			) ||
			attempts !== main.transportCalls ||
			waits !== 1 ||
			main.maxActiveTransport !== 1 ||
			workspaceResidueCount !== 0
		)
			throw new TypeError("D36 injected live lifecycle drifted");
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D36_QUALIFICATION_SCHEMA,
			decisionRef: D36_DECISION_REF,
			d35ArtifactDigest: D36_D35_ARTIFACT_DIGEST,
			d35BundleDigest: D36_D35_BUNDLE_DIGEST,
			d35QualificationDigest: D36_D35_QUALIFICATION_DIGEST,
			d35GenerationDigest: D36_D35_GENERATION_DIGEST,
			d35EvidenceDigest: D36_D35_EVIDENCE_DIGEST,
			d35ImplementationManifestDigest: D36_D35_IMPLEMENTATION_MANIFEST_DIGEST,
			implementationManifestDigest: D36_IMPLEMENTATION_MANIFEST_DIGEST,
			mainBundleDigest: validatedMain.bundleDigest,
			exactSixArmsCompleted: true as const,
			graphAdmissionBeforeEveryEffect: true as const,
			exactNamedNewTextOnlyWire: true as const,
			retryIdentityPassed: true as const,
			providerTransportCalls: main.transportCalls,
			retainedSpanTransportCalls: main.retainedCalls,
			retryWaitCount: 1 as const,
			maxActiveEffects: 1 as const,
			maxActiveTransport: 1 as const,
			providerNetworkCalls: 0 as const,
			freshGateClaimCurrentKeyOrderPassed: true as const,
			duplicateClaimRejected: true as const,
			partialFailurePersistencePassed: true as const,
			workspaceResidueCount,
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
			schemaVersion: D36_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D36_QUALIFICATION_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			mainBundleDigest: validatedMain.bundleDigest,
			implementationManifestDigest: D36_IMPLEMENTATION_MANIFEST_DIGEST,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const material = strictSnapshot({
			schemaVersion: D36_QUALIFICATION_BUNDLE_SCHEMA,
			baselineBasis: input.baselineBasis,
			mainBundle: validatedMain,
			qualification,
			generation,
		});
		const bundle = Object.freeze({
			...material,
			bundleDigest: empiricalStrictJsonDigest(material),
		}) as D36QualificationBundleV1;
		constructed.add(bundle);
		return bundle;
	} finally {
		await rm(testRoot, { recursive: true, force: true });
	}
}

export function validateD36QualificationBundle(value: unknown): D36QualificationBundleV1 {
	const candidate = record(value, "D36 qualification bundle");
	exactKeys(
		candidate,
		["baselineBasis", "bundleDigest", "generation", "mainBundle", "qualification", "schemaVersion"],
		"D36 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D36_QUALIFICATION_BUNDLE_SCHEMA ||
		(candidate.baselineBasis !== "consumed-d35-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D36 qualification bundle coordinates drifted");
	const mainBundle = validateD36LiveBundle(candidate.mainBundle);
	const qualification = record(candidate.qualification, "D36 qualification");
	const generation = record(candidate.generation, "D36 qualification generation");
	if (
		qualification.schemaVersion !== D36_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D36_DECISION_REF ||
		qualification.d35ArtifactDigest !== D36_D35_ARTIFACT_DIGEST ||
		qualification.d35BundleDigest !== D36_D35_BUNDLE_DIGEST ||
		qualification.d35QualificationDigest !== D36_D35_QUALIFICATION_DIGEST ||
		qualification.d35GenerationDigest !== D36_D35_GENERATION_DIGEST ||
		qualification.d35EvidenceDigest !== D36_D35_EVIDENCE_DIGEST ||
		qualification.d35ImplementationManifestDigest !== D36_D35_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.implementationManifestDigest !== D36_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.mainBundleDigest !== mainBundle.bundleDigest ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.graphAdmissionBeforeEveryEffect !== true ||
		qualification.exactNamedNewTextOnlyWire !== true ||
		qualification.retryIdentityPassed !== true ||
		qualification.retryWaitCount !== 1 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.maxActiveTransport !== 1 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.freshGateClaimCurrentKeyOrderPassed !== true ||
		qualification.duplicateClaimRejected !== true ||
		qualification.partialFailurePersistencePassed !== true ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.liveGateEvaluated !== false ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		qualification.qualified !== true ||
		mainBundle.gate.evaluated !== false ||
		mainBundle.efficacyClaim !== "none" ||
		generation.schemaVersion !== D36_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D36_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.mainBundleDigest !== mainBundle.bundleDigest ||
		generation.implementationManifestDigest !== D36_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D36 qualification semantics drifted");
	const qualificationBase = { ...qualification };
	delete qualificationBase.qualificationDigest;
	if (qualification.qualificationDigest !== empiricalStrictJsonDigest(qualificationBase))
		throw new TypeError("D36 qualification digest drifted");
	const generationBase = { ...generation };
	delete generationBase.generationDigest;
	if (generation.generationDigest !== empiricalStrictJsonDigest(generationBase))
		throw new TypeError("D36 qualification generation digest drifted");
	const material = strictSnapshot({
		schemaVersion: D36_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis: candidate.baselineBasis,
		mainBundle,
		qualification: strictSnapshot(qualification),
		generation: strictSnapshot(generation),
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D36 qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D36QualificationBundleV1;
}

export async function persistD36Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D36QualificationBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D36 qualification bundle was not constructed in this process");
	constructed.delete(input.bundle as object);
	const bundle = validateD36QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d35-artifact")
		throw new TypeError("D36 production qualification requires consumed D35 artifact bytes");
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D36_QUALIFICATION_GENERATION_REF,
		artifacts: {
			"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
			"qualification.v1.json": strictJsonCodec.encode(
				bundle.qualification as unknown as StrictJsonValue,
			),
			"generation.v1.json": strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue),
		},
		commitBytes: strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly-ts.d36.retained-span-live-qualification-commit.v1",
				generationRef: D36_QUALIFICATION_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				qualificationDigest: bundle.qualification.qualificationDigest,
				generationDigest: bundle.generation.generationDigest,
			}) as unknown as StrictJsonValue,
		),
	});
}
