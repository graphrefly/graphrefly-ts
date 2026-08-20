import { chmod, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import { CURRENT_GRAPH_ARMS } from "./d5-graph-native-eval-authority.js";
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
import type { D34AdmittedEffectV1 } from "./d34-retained-span-mutation-authority.js";
import {
	admitD38D37Baseline,
	createD38InjectedBaselineForTest,
	type D38D37BaselineAdmissionV1,
	type D38LiveBundleV1,
	persistD38LiveBundle,
	runD38InjectedMeasurementForTest,
	validateD38LiveBundle,
} from "./d38-premature-final-live.js";
import {
	acquireD38DispatchClaimAtRootForTest,
	consumeD38DispatchClaim,
	readD38CurrentKeyAdmission,
} from "./d38-premature-final-live-claim.js";
import {
	D38_D37_ARTIFACT_DIGEST,
	D38_D37_BUNDLE_DIGEST,
	D38_D37_EVIDENCE_DIGEST,
	D38_D37_GENERATION_DIGEST,
	D38_D37_IMPLEMENTATION_MANIFEST_DIGEST,
	D38_D37_QUALIFICATION_DIGEST,
	D38_DECISION_REF,
	D38_QUALIFICATION_GENERATION_REF,
} from "./d38-premature-final-live-coordinates.js";
import { D38_IMPLEMENTATION_MANIFEST_DIGEST } from "./d38-premature-final-live-implementation-manifest.js";
import {
	admitD38ZeroByok,
	composeD38Preclaim,
	type D38CredentialV1,
	readD38OfficialPricing,
} from "./d38-premature-final-live-preflight.js";
import { createD38PrematureFinalRealProviderExecutor } from "./d38-premature-final-real-provider-composition.js";

export const D38_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d38.premature-final-live-qualification.v2" as const;
export const D38_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d38.premature-final-live-qualification-bundle.v2" as const;
export const D38_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d38.premature-final-live-qualification-generation.v2" as const;

export interface D38QualificationBundleV1 {
	readonly schemaVersion: typeof D38_QUALIFICATION_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d37-artifact" | "injected-test";
	readonly mainBundle: D38LiveBundleV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D38_QUALIFICATION_SCHEMA;
		readonly decisionRef: typeof D38_DECISION_REF;
		readonly d37ArtifactDigest: typeof D38_D37_ARTIFACT_DIGEST;
		readonly d37BundleDigest: typeof D38_D37_BUNDLE_DIGEST;
		readonly d37QualificationDigest: typeof D38_D37_QUALIFICATION_DIGEST;
		readonly d37GenerationDigest: typeof D38_D37_GENERATION_DIGEST;
		readonly d37EvidenceDigest: typeof D38_D37_EVIDENCE_DIGEST;
		readonly d37ImplementationManifestDigest: typeof D38_D37_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly implementationManifestDigest: typeof D38_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly mainBundleDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly graphAdmissionBeforeEveryEffect: true;
		readonly exactNamedNewTextOnlyWire: true;
		readonly prematureFinalRecoveryCount: 6;
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
		readonly schemaVersion: typeof D38_QUALIFICATION_GENERATION_SCHEMA;
		readonly generationRef: typeof D38_QUALIFICATION_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly mainBundleDigest: string;
		readonly implementationManifestDigest: typeof D38_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const constructed = new WeakSet<object>();

export function admitD38QualificationBaseline(bytes: Uint8Array) {
	return admitD38D37Baseline(bytes);
}

export function createD38QualificationInjectedBaselineForTest() {
	return createD38InjectedBaselineForTest();
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

async function makeTestPreclaim(credential: D38CredentialV1, nowMs: number) {
	const pricing = await readD38OfficialPricing({
		fetch: async () => officialPricingResponse(),
		nowMs: () => nowMs,
		signal: new AbortController().signal,
	});
	const zeroByok = admitD38ZeroByok({
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
	return composeD38Preclaim({
		pricingObservation: pricing,
		zeroByokObservation: zeroByok,
		credential,
		nowMs,
	});
}

async function issueTestAuthority(input: {
	readonly privateRoot: string;
	readonly credential: D38CredentialV1;
	readonly nowMs: number;
}) {
	const coordinate = empiricalStrictJsonDigest({
		decisionRef: D38_DECISION_REF,
		implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
	});
	const claim = await acquireD38DispatchClaimAtRootForTest(input.privateRoot, {
		preclaim: await makeTestPreclaim(input.credential, input.nowMs),
		nowMs: input.nowMs,
		implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: coordinate,
		qualificationDigest: coordinate,
	});
	let duplicateRejected = false;
	try {
		await acquireD38DispatchClaimAtRootForTest(input.privateRoot, {
			preclaim: await makeTestPreclaim(input.credential, input.nowMs),
			nowMs: input.nowMs,
			implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest: coordinate,
			qualificationDigest: coordinate,
		});
	} catch (error) {
		duplicateRejected = (error as NodeJS.ErrnoException).code === "EEXIST";
	}
	if (!duplicateRejected) throw new TypeError("D38 duplicate dispatch claim was admitted");
	const currentKeyAdmission = await readD38CurrentKeyAdmission({
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
	return consumeD38DispatchClaim({ claim, currentKeyAdmission, allowInjectedTestScope: true });
}

async function qualifyPartialFailure(input: {
	readonly testRoot: string;
	readonly credential: D38CredentialV1;
}): Promise<void> {
	const claimRoot = join(input.testRoot, "partial-claim");
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const executionAuthority = await issueTestAuthority({
		privateRoot: await realpath(claimRoot),
		credential: input.credential,
		nowMs: Date.parse("2026-08-20T12:01:00.000Z"),
	});
	const partial = await runD38InjectedMeasurementForTest({
		executionAuthority,
		baseline: createD38InjectedBaselineForTest(),
		implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
		executorFactory: () =>
			Object.freeze({
				async execute() {
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
		throw new TypeError("D38 injected partial failure semantics drifted");
	const persistenceRoot = join(input.testRoot, "partial-persistence");
	await mkdir(persistenceRoot, { mode: 0o700 });
	await chmod(persistenceRoot, 0o700);
	await persistD38LiveBundle({ privateRoot: await realpath(persistenceRoot), bundle: partial });
	try {
		await persistD38LiveBundle({ privateRoot: await realpath(persistenceRoot), bundle: partial });
		throw new TypeError("D38 partial persistence replay was admitted");
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
							id: `d38-${toolName}-${index}`,
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
							id: `d38-${call.name}-${index}`,
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

function providerAttemptCount(bundle: D38LiveBundleV1): number {
	return (
		bundle.graphEvidence?.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
			(fact) => fact.request.effectKind === "provider-request",
		).length ?? 0
	);
}

function retryWaitCount(bundle: D38LiveBundleV1): number {
	return (
		bundle.graphEvidence?.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
			(fact) => fact.result.effectKind === "retry-wait",
		).length ?? 0
	);
}

function assertGraphAuthoredPrematureFinalRecovery(bundle: D38LiveBundleV1): 6 {
	const evidence = bundle.graphEvidence;
	if (evidence === null) throw new TypeError("D38 recovery evidence is incomplete");
	const providerEvidence = evidence.phaseEvidence.workflowEvidence.providerEvidence;
	const workflow = providerEvidence.workflowEvidence;
	const findings = workflow.findings.filter(
		(finding) => finding.code === "premature-structured-final",
	);
	const corrections = workflow.facts.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.request.correctionDirective?.reason === "premature-structured-final" &&
			fact.request.correctionDirective.stage === "phase-retry",
	);
	const failures = providerEvidence.facts.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.result.failureCode === "premature-structured-final",
	);
	if (
		findings.length !== CURRENT_GRAPH_ARMS.length ||
		corrections.length !== CURRENT_GRAPH_ARMS.length ||
		failures.length !== CURRENT_GRAPH_ARMS.length ||
		findings.some(
			(finding, index) =>
				finding.arm !== CURRENT_GRAPH_ARMS[index] || finding.runSequence !== index,
		) ||
		corrections.some(
			(fact, index) =>
				fact.arm !== CURRENT_GRAPH_ARMS[index] ||
				fact.runSequence !== index ||
				fact.result.status !== "completed" ||
				fact.request.correctionDirective?.requiredFirstToolRef !== "replace-exact",
		) ||
		failures.some(
			(fact, index) =>
				fact.request.runSequence !== index ||
				fact.result.effectKind !== "provider-request" ||
				fact.result.status !== "failed" ||
				fact.result.usage.costBasis !== "reported" ||
				fact.result.usage.requests !== 1 ||
				fact.result.usage.inputTokens !== 100 ||
				fact.result.usage.outputTokens !== 20 ||
				fact.result.usage.cacheReadTokens !== 0 ||
				fact.reconciliation.actualCostMicrousd !== fact.result.usage.actualCostMicrousd ||
				fact.reconciliation.actualElapsedMs !== fact.result.usage.actualElapsedMs,
		)
	)
		throw new TypeError(
			`D38 canonical premature-final recovery evidence drifted: ${JSON.stringify({
				findings: findings.map((finding) => ({
					arm: finding.arm,
					runSequence: finding.runSequence,
				})),
				corrections: corrections.map((fact) => ({
					arm: fact.arm,
					runSequence: fact.runSequence,
					requiredFirstToolRef: fact.request.correctionDirective?.requiredFirstToolRef,
				})),
				failures: failures.map((fact) => ({
					runSequence: fact.request.runSequence,
					status: fact.result.status,
					usage: fact.result.effectKind === "provider-request" ? fact.result.usage : null,
				})),
			})}`,
		);
	return 6;
}

async function runMain(input: {
	readonly baseline: D38D37BaselineAdmissionV1;
	readonly baselineBasis: D38QualificationBundleV1["baselineBasis"];
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly privateRoot: string;
	readonly disposeFails?: boolean;
}) {
	const credential = Object.freeze({
		bearerToken: "d38-injected-no-network-credential",
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
	let prematureFinalRecoveryCount = 0;
	let prematureFinalInjectedForCurrentArm = false;
	let retryInjected = false;
	let executorError: string | null = null;
	const retainedBodies: Uint8Array[] = [];
	const toolNames: string[] = [];
	const bundle = await runD38InjectedMeasurementForTest({
		executionAuthority,
		baseline: input.baseline,
		implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
		allowConsumedBaselineForQualification: input.baselineBasis === "consumed-d37-artifact",
		executorFactory: (authority) => {
			const executor = createD38PrematureFinalRealProviderExecutor({
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
						const body = record(JSON.parse(bytes.toString("utf8")), "D38 injected body");
						const messages = Array.isArray(body.messages) ? body.messages : [];
						const hasReadResult = messages.some((value) => {
							const message = record(value, "D38 injected message");
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
										record(choice, "D38 injected tool choice").function,
										"D38 injected tool choice function",
									).name;
						toolNames.push(String(toolName));
						if (toolName === "read_file") {
							prematureFinalInjectedForCurrentArm = false;
							return choice === "required"
								? providerResponse("read_file", { path: CURRENT_GRAPH_LIVE_WRITABLE_FILE })
								: providerBatch(
										CURRENT_GRAPH_LIVE_READABLE_FILES.map((path) => ({
											name: "read_file",
											args: { path },
										})),
									);
						}
						if (toolName === "replace_exact" && !prematureFinalInjectedForCurrentArm) {
							prematureFinalInjectedForCurrentArm = true;
							prematureFinalRecoveryCount += 1;
							return new Response(
								JSON.stringify({
									choices: [
										{
											message: {
												role: "assistant",
												content: "The task appears complete.",
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
						if (toolName === "replace_exact")
							return providerResponse("replace_exact", {
								path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
								oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
								newText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
							});
						if (toolName !== "propose_replacement_text")
							throw new TypeError("D38 injected named tool drifted");
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
				async execute(admitted: D34AdmittedEffectV1) {
					try {
						return await executor.execute(admitted);
					} catch (error) {
						executorError = error instanceof Error ? error.message : "non-error";
						throw error;
					}
				},
				async dispose() {
					await executor.dispose();
					if (input.disposeFails === true)
						throw new TypeError("injected post-snapshot disposal failure");
				},
			});
		},
	});
	if (
		retainedBodies.length < 2 ||
		!Buffer.from(retainedBodies[0]!).equals(Buffer.from(retainedBodies[1]!))
	)
		throw new TypeError(
			`D38 retained retry wire identity drifted: ${JSON.stringify({ retainedBodies: retainedBodies.length, transportCalls, retainedCalls, toolNames, disposition: bundle.disposition, partial: bundle.partialGraphEvidence?.failureCode ?? null, executorError })}`,
		);
	for (const bytes of retainedBodies) {
		const serialized = Buffer.from(bytes).toString("utf8");
		if (
			serialized.includes("oldText") ||
			serialized.includes(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK) ||
			!serialized.includes("propose_replacement_text") ||
			!serialized.includes("newText")
		)
			throw new TypeError("D38 retained wire privacy drifted");
	}
	return Object.freeze({
		bundle,
		transportCalls,
		retainedCalls,
		prematureFinalRecoveryCount,
		maxActiveTransport,
	});
}

export async function runD38InjectedNoNetworkQualification(input: {
	readonly baseline: D38D37BaselineAdmissionV1;
	readonly baselineBasis: D38QualificationBundleV1["baselineBasis"];
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
}): Promise<D38QualificationBundleV1> {
	const testRoot = await mkdtemp(join(tmpdir(), "graphrefly-d38-qualification-"));
	await chmod(testRoot, 0o700);
	const claimRoot = join(testRoot, "claim");
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	try {
		const main = await runMain({ ...input, privateRoot: await realpath(claimRoot) });
		const disposalClaimRoot = join(testRoot, "disposal-claim");
		await mkdir(disposalClaimRoot, { mode: 0o700 });
		await chmod(disposalClaimRoot, 0o700);
		const disposalFailure = await runMain({
			baseline: createD38InjectedBaselineForTest(),
			baselineBasis: "injected-test",
			repositoryRoot: input.repositoryRoot,
			materializationRoot: `${input.materializationRoot}-dispose-failure`,
			privateRoot: await realpath(disposalClaimRoot),
			disposeFails: true,
		});
		const validatedDisposalFailure = validateD38LiveBundle(disposalFailure.bundle);
		if (
			validatedDisposalFailure.disposition !== "partial-failure" ||
			validatedDisposalFailure.graphEvidence !== null ||
			validatedDisposalFailure.generation !== null ||
			validatedDisposalFailure.partialGraphEvidence?.failureCode !== "executor-disposal-failed" ||
			validatedDisposalFailure.partialGraphEvidence.completedGraphEvidence === null ||
			validatedDisposalFailure.efficacyClaim !== "none"
		)
			throw new TypeError("D38 post-snapshot disposal failure evidence drifted");
		const disposalPersistenceRoot = join(testRoot, "disposal-persistence");
		await mkdir(disposalPersistenceRoot, { mode: 0o700 });
		await chmod(disposalPersistenceRoot, 0o700);
		await persistD38LiveBundle({
			privateRoot: await realpath(disposalPersistenceRoot),
			bundle: disposalFailure.bundle,
		});
		await qualifyPartialFailure({
			testRoot,
			credential: Object.freeze({
				bearerToken: "d38-injected-no-network-credential",
				credentialBindingRef: "openrouter.local-eval-2" as const,
				credentialBindingRevision: "2026-08-14.v1" as const,
			}),
		});
		const validatedMain = validateD38LiveBundle(main.bundle);
		const runs =
			validatedMain.graphEvidence?.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence
				.runs ?? [];
		const waits = retryWaitCount(validatedMain);
		const attempts = providerAttemptCount(validatedMain);
		const graphRecoveryCount = assertGraphAuthoredPrematureFinalRecovery(validatedMain);
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
			main.prematureFinalRecoveryCount !== graphRecoveryCount ||
			workspaceResidueCount !== 0
		)
			throw new TypeError("D38 injected live lifecycle drifted");
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D38_QUALIFICATION_SCHEMA,
			decisionRef: D38_DECISION_REF,
			d37ArtifactDigest: D38_D37_ARTIFACT_DIGEST,
			d37BundleDigest: D38_D37_BUNDLE_DIGEST,
			d37QualificationDigest: D38_D37_QUALIFICATION_DIGEST,
			d37GenerationDigest: D38_D37_GENERATION_DIGEST,
			d37EvidenceDigest: D38_D37_EVIDENCE_DIGEST,
			d37ImplementationManifestDigest: D38_D37_IMPLEMENTATION_MANIFEST_DIGEST,
			implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
			mainBundleDigest: validatedMain.bundleDigest,
			exactSixArmsCompleted: true as const,
			graphAdmissionBeforeEveryEffect: true as const,
			exactNamedNewTextOnlyWire: true as const,
			prematureFinalRecoveryCount: graphRecoveryCount,
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
			schemaVersion: D38_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D38_QUALIFICATION_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			mainBundleDigest: validatedMain.bundleDigest,
			implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const material = strictSnapshot({
			schemaVersion: D38_QUALIFICATION_BUNDLE_SCHEMA,
			baselineBasis: input.baselineBasis,
			mainBundle: validatedMain,
			qualification,
			generation,
		});
		const bundle = Object.freeze({
			...material,
			bundleDigest: empiricalStrictJsonDigest(material),
		}) as D38QualificationBundleV1;
		constructed.add(bundle);
		return bundle;
	} finally {
		await rm(testRoot, { recursive: true, force: true });
	}
}

export function validateD38QualificationBundle(value: unknown): D38QualificationBundleV1 {
	const candidate = record(value, "D38 qualification bundle");
	exactKeys(
		candidate,
		["baselineBasis", "bundleDigest", "generation", "mainBundle", "qualification", "schemaVersion"],
		"D38 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D38_QUALIFICATION_BUNDLE_SCHEMA ||
		(candidate.baselineBasis !== "consumed-d37-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D38 qualification bundle coordinates drifted");
	const mainBundle = validateD38LiveBundle(candidate.mainBundle);
	const qualification = record(candidate.qualification, "D38 qualification");
	const generation = record(candidate.generation, "D38 qualification generation");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"d37ArtifactDigest",
			"d37BundleDigest",
			"d37EvidenceDigest",
			"d37GenerationDigest",
			"d37ImplementationManifestDigest",
			"d37QualificationDigest",
			"decisionRef",
			"duplicateClaimRejected",
			"efficacyClaim",
			"exactNamedNewTextOnlyWire",
			"exactSixArmsCompleted",
			"freshGateClaimCurrentKeyOrderPassed",
			"graphAdmissionBeforeEveryEffect",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"mainBundleDigest",
			"maxActiveEffects",
			"maxActiveTransport",
			"partialFailurePersistencePassed",
			"prematureFinalRecoveryCount",
			"providerNetworkCalls",
			"providerTransportCalls",
			"qualificationDigest",
			"qualified",
			"retainedSpanTransportCalls",
			"retryIdentityPassed",
			"retryWaitCount",
			"schemaVersion",
			"workspaceResidueCount",
		],
		"D38 qualification",
	);
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
		"D38 qualification generation",
	);
	const graphRecoveryCount = assertGraphAuthoredPrematureFinalRecovery(mainBundle);
	if (
		qualification.schemaVersion !== D38_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D38_DECISION_REF ||
		qualification.d37ArtifactDigest !== D38_D37_ARTIFACT_DIGEST ||
		qualification.d37BundleDigest !== D38_D37_BUNDLE_DIGEST ||
		qualification.d37QualificationDigest !== D38_D37_QUALIFICATION_DIGEST ||
		qualification.d37GenerationDigest !== D38_D37_GENERATION_DIGEST ||
		qualification.d37EvidenceDigest !== D38_D37_EVIDENCE_DIGEST ||
		qualification.d37ImplementationManifestDigest !== D38_D37_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.implementationManifestDigest !== D38_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.mainBundleDigest !== mainBundle.bundleDigest ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.graphAdmissionBeforeEveryEffect !== true ||
		qualification.exactNamedNewTextOnlyWire !== true ||
		qualification.prematureFinalRecoveryCount !== graphRecoveryCount ||
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
		generation.schemaVersion !== D38_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D38_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.mainBundleDigest !== mainBundle.bundleDigest ||
		generation.implementationManifestDigest !== D38_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D38 qualification semantics drifted");
	const qualificationBase = { ...qualification };
	delete qualificationBase.qualificationDigest;
	if (qualification.qualificationDigest !== empiricalStrictJsonDigest(qualificationBase))
		throw new TypeError("D38 qualification digest drifted");
	const generationBase = { ...generation };
	delete generationBase.generationDigest;
	if (generation.generationDigest !== empiricalStrictJsonDigest(generationBase))
		throw new TypeError("D38 qualification generation digest drifted");
	const material = strictSnapshot({
		schemaVersion: D38_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis: candidate.baselineBasis,
		mainBundle,
		qualification: strictSnapshot(qualification),
		generation: strictSnapshot(generation),
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D38 qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D38QualificationBundleV1;
}

export async function persistD38Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D38QualificationBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D38 qualification bundle was not constructed in this process");
	constructed.delete(input.bundle as object);
	const bundle = validateD38QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d37-artifact")
		throw new TypeError("D38 production qualification requires consumed D37 artifact bytes");
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D38_QUALIFICATION_GENERATION_REF,
		artifacts: {
			"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
			"qualification.v1.json": strictJsonCodec.encode(
				bundle.qualification as unknown as StrictJsonValue,
			),
			"generation.v1.json": strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue),
		},
		commitBytes: strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly-ts.d38.premature-final-live-qualification-commit.v1",
				generationRef: D38_QUALIFICATION_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				qualificationDigest: bundle.qualification.qualificationDigest,
				generationDigest: bundle.generation.generationDigest,
			}) as unknown as StrictJsonValue,
		),
	});
}
