import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	sameBytes,
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
	D22_FIXED_ADMISSION_BLOCK,
	D22_INITIAL_ADMISSION_BLOCK,
	D22_WRONG_ADMISSION_BLOCK,
} from "./d22-current-efficacy-real-provider-qualification.js";
import { createD26PhaseSpecificRealProviderExecutor } from "./d26-phase-specific-real-provider-composition.js";
import {
	admitD27D31Baseline,
	createD27InjectedBaselineForTest,
	type D27D31BaselineAdmissionV1,
	type D27LiveBundleV1,
	runD27InjectedMeasurementForTest,
	validateD27LiveBundle,
} from "./d27-phase-specific-live.js";
import {
	acquireD27DispatchClaimAtRootForTest,
	consumeD27DispatchClaim,
	readD27CurrentKeyAdmission,
} from "./d27-phase-specific-live-claim.js";
import {
	D27_D31_ARTIFACT_DIGEST,
	D27_D31_BUNDLE_DIGEST,
	D27_D31_GENERATION_DIGEST,
	D27_D31_GRAPH_EVIDENCE_DIGEST,
	D27_D31_IMPLEMENTATION_MANIFEST_DIGEST,
	D27_D31_QUALIFICATION_ARTIFACT_DIGEST,
	D27_D31_QUALIFICATION_DIGEST,
	D27_DECISION_REF,
	D27_QUALIFICATION_GENERATION_REF,
} from "./d27-phase-specific-live-coordinates.js";
import { D27_IMPLEMENTATION_MANIFEST_DIGEST } from "./d27-phase-specific-live-implementation-manifest.js";
import {
	admitD27ZeroByok,
	composeD27Preclaim,
	type D27CredentialV1,
	readD27OfficialPricing,
} from "./d27-phase-specific-live-preflight.js";

export const D27_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d32.phase-specific-live-qualification.v1" as const;
export const D27_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d32.phase-specific-live-qualification-bundle.v1" as const;
export const D27_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d32.phase-specific-live-qualification-generation.v1" as const;

const D32_FORMAT_INVALID_ADMISSION_BLOCK = D22_WRONG_ADMISSION_BLOCK.replaceAll("\t", "  ");
if (D32_FORMAT_INVALID_ADMISSION_BLOCK === D22_WRONG_ADMISSION_BLOCK)
	throw new TypeError("D32 focused-validation fixture drifted");

export interface D27QualificationBundleV1 {
	readonly schemaVersion: typeof D27_QUALIFICATION_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d31-artifact" | "injected-test";
	readonly mainBundle: D27LiveBundleV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D27_QUALIFICATION_SCHEMA;
		readonly decisionRef: typeof D27_DECISION_REF;
		readonly d31ArtifactDigest: typeof D27_D31_ARTIFACT_DIGEST;
		readonly d31BundleDigest: typeof D27_D31_BUNDLE_DIGEST;
		readonly d31GraphEvidenceDigest: typeof D27_D31_GRAPH_EVIDENCE_DIGEST;
		readonly d31QualificationArtifactDigest: typeof D27_D31_QUALIFICATION_ARTIFACT_DIGEST;
		readonly d31QualificationDigest: typeof D27_D31_QUALIFICATION_DIGEST;
		readonly d31GenerationDigest: typeof D27_D31_GENERATION_DIGEST;
		readonly d31ImplementationManifestDigest: typeof D27_D31_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly implementationManifestDigest: typeof D27_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly mainBundleDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly graphAdmissionBeforeEveryEffect: true;
		readonly exactNamedWirePassed: true;
		readonly retryIdentityPassed: true;
		readonly exactReplacementCauseCoverage: readonly [
			"exact-replacement-unchanged",
			"exact-replacement-old-text-not-found",
			"exact-replacement-old-text-not-unique",
		];
		readonly validationRecoveryPassed: true;
		readonly retryDelayCoverageMs: readonly [1_000, 7_000, 60_000];
		readonly providerTransportCalls: number;
		readonly providerNetworkCalls: 0;
		readonly maxActiveEffects: 1;
		readonly workspaceResidueCount: 0;
		readonly liveGateEvaluated: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualified: true;
		readonly qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		readonly schemaVersion: typeof D27_QUALIFICATION_GENERATION_SCHEMA;
		readonly generationRef: typeof D27_QUALIFICATION_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly mainBundleDigest: string;
		readonly implementationManifestDigest: typeof D27_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const constructed = new WeakSet<object>();

export function admitD27QualificationBaseline(bytes: Uint8Array) {
	return admitD27D31Baseline(bytes);
}

export function createD27QualificationInjectedBaselineForTest() {
	return createD27InjectedBaselineForTest();
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

async function makeTestPreclaim(credential: D27CredentialV1, nowMs: number) {
	const pricing = await readD27OfficialPricing({
		fetch: async () => officialPricingResponse(),
		nowMs: () => nowMs,
		signal: new AbortController().signal,
	});
	const zeroByok = admitD27ZeroByok({
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
	return composeD27Preclaim({
		pricingObservation: pricing,
		zeroByokObservation: zeroByok,
		credential,
		nowMs,
	});
}

async function issueTestAuthority(input: {
	readonly privateRoot: string;
	readonly credential: D27CredentialV1;
	readonly nowMs: number;
}) {
	const coordinate = empiricalStrictJsonDigest({
		decisionRef: D27_DECISION_REF,
		implementationManifestDigest: D27_IMPLEMENTATION_MANIFEST_DIGEST,
	});
	const claim = await acquireD27DispatchClaimAtRootForTest(input.privateRoot, {
		preclaim: await makeTestPreclaim(input.credential, input.nowMs),
		nowMs: input.nowMs,
		implementationManifestDigest: D27_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: coordinate,
		qualificationDigest: coordinate,
	});
	const currentKeyAdmission = await readD27CurrentKeyAdmission({
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
	return consumeD27DispatchClaim({ claim, currentKeyAdmission, allowInjectedTestScope: true });
}

function toolCall(id: string, name: string, args: unknown) {
	return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function providerResponse(calls: readonly unknown[]) {
	return new Response(
		JSON.stringify({
			choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }],
			usage: {
				prompt_tokens: 120,
				completion_tokens: 80,
				prompt_tokens_details: { cached_tokens: 20 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function injectedTransport() {
	let active = 0;
	let maxActive = 0;
	let calls = 0;
	const retryPolicy = new Map<string, "D671" | "D675" | "D710">([
		["cold", "D710"],
		["relevant-applied", "D671"],
		["proposal-only", "D675"],
		["admission-rejected", "D710"],
	]);
	const retried = new Set<string>();
	const replacementFailureInjected = new Set<string>();
	const validationFailureInjected = new Set<string>();
	const pending = new Map<string, Uint8Array>();
	const retryDelays = new Set<number>();
	const fetchImpl: typeof fetch = async (_url, init) => {
		if (!(init?.signal instanceof AbortSignal) || init.signal.aborted)
			throw new TypeError("D28 injected transport lacked its Graph-admitted deadline signal");
		active += 1;
		maxActive = Math.max(maxActive, active);
		try {
			calls += 1;
			const bytes = new Uint8Array(init?.body as Uint8Array);
			const body = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
				messages: Array<{ content?: string }>;
				tool_choice: { function: { name: string } };
				tools: unknown[];
			};
			const arm = [
				"cold",
				"relevant-applied",
				"proposal-only",
				"admission-rejected",
				"irrelevant-applied",
				"wrong-scope-applied",
			].find((candidate) =>
				body.messages.some((message) =>
					message.content?.includes(`Frozen evaluation arm: ${candidate}.`),
				),
			);
			if (arm === undefined) throw new TypeError("D27 injected arm is missing");
			if (
				body.tools.length !== 1 ||
				!["read_file", "replace_exact"].includes(body.tool_choice.function.name)
			)
				throw new TypeError("D27 injected named wire drifted");
			const prior = pending.get(arm);
			if (prior !== undefined) {
				if (!sameBytes(prior, bytes)) throw new TypeError("D27 injected retry wire drifted");
				pending.delete(arm);
				if (arm === "admission-rejected")
					return new Response(JSON.stringify({ error: { message: "bounded-terminal-retry" } }), {
						status: 429,
						headers: { "content-type": "application/json" },
					});
			} else if (!retried.has(arm) && retryPolicy.has(arm)) {
				retried.add(arm);
				pending.set(arm, bytes.slice());
				const policy = retryPolicy.get(arm)!;
				if (policy === "D675")
					throw new TypeError("D27 injected socket reset", {
						cause: Object.freeze({ code: "UND_ERR_SOCKET" }),
					});
				return new Response(
					JSON.stringify(
						policy === "D710"
							? { error: { message: "bounded" } }
							: { error: { message: "bounded", type: "rate_limit", code: "rate_limit" } },
					),
					{
						status: policy === "D710" ? 429 : 503,
						headers: { "content-type": "application/json" },
					},
				);
			}
			if (body.tool_choice.function.name === "read_file")
				return providerResponse(
					CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) =>
						toolCall(`read-${calls}-${index}`, "read_file", { path }),
					),
				);
			const currentCorrection = body.messages.at(-1)?.content ?? "";
			const semanticCorrection = currentCorrection.includes("correctionStage=semantic-correction");
			const replacementCorrection = currentCorrection.includes("correctionStage=fresh-mutation")
				? currentCorrection
				: undefined;
			const validationCorrection =
				currentCorrection.includes("correctionReason=focused-validation-failed") &&
				currentCorrection.includes("correctionStage=validation-mutation") &&
				currentCorrection.includes("requiredDisposition=repair-focused-validation-failure");
			if (
				["cold", "relevant-applied", "wrong-scope-applied"].includes(arm) &&
				!replacementFailureInjected.has(arm)
			) {
				replacementFailureInjected.add(arm);
				return providerResponse([
					toolCall(`replace-rejected-${calls}`, "replace_exact", {
						path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
						oldText:
							arm === "relevant-applied"
								? D22_INITIAL_ADMISSION_BLOCK
								: arm === "cold"
									? "\t\t"
									: "__d32_missing_exact_source__",
						newText:
							arm === "relevant-applied"
								? D22_INITIAL_ADMISSION_BLOCK
								: "__d32_fresh_replacement__",
					}),
				]);
			}
			if (replacementFailureInjected.has(arm) && !semanticCorrection) {
				const expected =
					arm === "relevant-applied"
						? "correctionReason=exact-replacement-unchanged; correctionStage=fresh-mutation; requiredDisposition=fresh-byte-different-exact-replacement"
						: arm === "cold"
							? "correctionReason=exact-replacement-old-text-not-unique; correctionStage=fresh-mutation; requiredDisposition=fresh-unique-span-exact-replacement"
							: "correctionReason=exact-replacement-old-text-not-found; correctionStage=fresh-mutation; requiredDisposition=fresh-current-source-exact-replacement";
				if (replacementCorrection?.includes(expected) !== true)
					throw new TypeError("D32 injected fresh mutation omitted its exact Graph cause");
			}
			if (arm === "proposal-only" && !validationFailureInjected.has(arm)) {
				validationFailureInjected.add(arm);
				return providerResponse([
					toolCall(`replace-format-invalid-${calls}`, "replace_exact", {
						path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
						oldText: D22_INITIAL_ADMISSION_BLOCK,
						newText: D32_FORMAT_INVALID_ADMISSION_BLOCK,
					}),
				]);
			}
			if (arm === "proposal-only" && validationFailureInjected.has(arm) && !validationCorrection)
				throw new TypeError("D32 injected validation mutation omitted Graph correction context");
			return providerResponse([
				toolCall(`replace-${calls}`, "replace_exact", {
					path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
					oldText: semanticCorrection
						? D22_WRONG_ADMISSION_BLOCK
						: validationCorrection
							? D32_FORMAT_INVALID_ADMISSION_BLOCK
							: D22_INITIAL_ADMISSION_BLOCK,
					newText: semanticCorrection ? D22_FIXED_ADMISSION_BLOCK : D22_WRONG_ADMISSION_BLOCK,
				}),
			]);
		} finally {
			active -= 1;
		}
	};
	return Object.freeze({ fetchImpl, calls: () => calls, maxActive: () => maxActive, retryDelays });
}

function deriveD32MainProjection(mainBundle: D27LiveBundleV1) {
	const graphEvidence = mainBundle.graphEvidence;
	if (mainBundle.disposition !== "success" || graphEvidence === null)
		throw new TypeError("D32 qualification requires complete canonical Graph evidence");
	const providerEvidence = graphEvidence.workflowEvidence.providerEvidence;
	const workflow = providerEvidence.workflowEvidence;
	if (
		workflow.runStatus !== "complete" ||
		workflow.runs.length !== 6 ||
		workflow.runs.some((run) => run.cleanupStatus !== "completed")
	)
		throw new TypeError("D32 qualification six-arm lifecycle drifted");
	const proposalRun = workflow.runs.find((run) => run.arm === "proposal-only");
	if (proposalRun?.validationRecoveryUsed !== true || proposalRun.semanticRecoveryUsed !== true)
		throw new TypeError("D32 qualification recovery lifecycle drifted");
	const exactReplacementCauseCoverage = Object.freeze(
		[
			...new Set(
				workflow.facts
					.filter(
						(fact) =>
							fact.result.effectKind === "tool-action" &&
							fact.result.toolRef === "replace-exact" &&
							fact.result.status === "failed",
					)
					.map((fact) => (fact.result.effectKind === "tool-action" ? fact.result.causeCode : null)),
			),
		].sort(),
	);
	const expectedReplacementCauses = Object.freeze([
		"exact-replacement-old-text-not-found",
		"exact-replacement-old-text-not-unique",
		"exact-replacement-unchanged",
	]);
	if (
		!sameBytes(
			Buffer.from(exactReplacementCauseCoverage.join(",")),
			Buffer.from(expectedReplacementCauses.join(",")),
		)
	)
		throw new TypeError("D32 qualification exact replacement cause coverage drifted");
	const proposalCorrectionRequests = workflow.facts
		.filter(
			(fact) =>
				fact.arm === "proposal-only" &&
				fact.result.effectKind === "provider-request" &&
				fact.request.correctionDirective?.reason === "focused-validation-failed",
		)
		.map((fact) => fact.request.correctionDirective?.stage);
	if (
		proposalCorrectionRequests.length !== 2 ||
		proposalCorrectionRequests[0] !== "validation-reinspect" ||
		proposalCorrectionRequests[1] !== "validation-mutation"
	)
		throw new TypeError("D32 qualification validation correction ordering drifted");
	const proposalFocusedValidationFacts = workflow.facts.filter(
		(fact) =>
			fact.arm === "proposal-only" &&
			fact.result.effectKind === "tool-action" &&
			fact.result.toolRef === "focused-validation",
	);
	if (
		proposalFocusedValidationFacts.length !== 2 ||
		proposalFocusedValidationFacts[0]?.result.effectKind !== "tool-action" ||
		proposalFocusedValidationFacts[0].result.status !== "failed" ||
		proposalFocusedValidationFacts[0].result.causeCode !== "focused-validation-failed" ||
		proposalFocusedValidationFacts[1]?.result.effectKind !== "tool-action" ||
		proposalFocusedValidationFacts[1].result.status !== "succeeded"
	)
		throw new TypeError(
			`D32 qualification focused validation lifecycle drifted: ${JSON.stringify(
				proposalFocusedValidationFacts.map((fact) => ({
					status: fact.result.effectKind === "tool-action" ? fact.result.status : null,
					causeCode: fact.result.effectKind === "tool-action" ? fact.result.causeCode : null,
					correctionStage: fact.request.correctionDirective?.stage ?? null,
				})),
			)}`,
		);
	const providerTransportCalls = providerEvidence.facts.filter(
		(fact) => fact.result.effectKind === "provider-request",
	).length;
	const retryDelayCoverageMs = Object.freeze(
		[
			...new Set(
				providerEvidence.facts
					.filter((fact) => fact.result.effectKind === "retry-wait")
					.map((fact) => fact.request.retryDelayMs),
			),
		].sort((left, right) => left - right),
	);
	if (
		retryDelayCoverageMs.length !== 3 ||
		retryDelayCoverageMs[0] !== 1_000 ||
		retryDelayCoverageMs[1] !== 7_000 ||
		retryDelayCoverageMs[2] !== 60_000
	)
		throw new TypeError(
			`D32 qualification retry coverage drifted: ${JSON.stringify(retryDelayCoverageMs)}`,
		);
	if (mainBundle.gate.evaluated !== false || mainBundle.efficacyClaim !== "none")
		throw new TypeError("D32 qualification claim boundary drifted");
	return Object.freeze({ providerTransportCalls });
}

export async function runD27InjectedNoNetworkQualification(inputValue: {
	readonly repositoryRoot: string;
	readonly baseline: D27D31BaselineAdmissionV1;
	readonly baselineBasis: "consumed-d31-artifact" | "injected-test";
}): Promise<D27QualificationBundleV1> {
	const input = record(inputValue, "D27 qualification input");
	exactKeys(input, ["baseline", "baselineBasis", "repositoryRoot"], "D27 qualification input");
	const repositoryRoot = await realpath(resolve(String(input.repositoryRoot)));
	const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d32-")));
	await chmod(temporaryRoot, 0o700);
	const credential = Object.freeze({
		bearerToken: "sk-or-v1-test-current-graph-d27-key",
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
	try {
		const privateRoot = join(temporaryRoot, "private");
		await mkdir(privateRoot, { mode: 0o700 });
		const executionAuthority = await issueTestAuthority({
			privateRoot: await realpath(privateRoot),
			credential,
			nowMs: 1_786_953_600_000,
		});
		const transport = injectedTransport();
		const materializationRoot = join(temporaryRoot, "workspaces");
		let executorFailureMessage: string | null = null;
		const mainBundle = await runD27InjectedMeasurementForTest({
			executionAuthority,
			baseline: input.baseline as D27D31BaselineAdmissionV1,
			implementationManifestDigest: D27_IMPLEMENTATION_MANIFEST_DIGEST,
			allowConsumedBaselineForQualification: input.baselineBasis === "consumed-d31-artifact",
			executorFactory: (authority) => {
				const executor = createD26PhaseSpecificRealProviderExecutor({
					authority,
					repositoryRoot,
					materializationRoot,
					credential,
					fetchImpl: transport.fetchImpl,
					now: (() => {
						let clock = 0;
						return () => ++clock;
					})(),
					sleep: async (milliseconds) => {
						if ([1_000, 7_000, 60_000].includes(milliseconds))
							transport.retryDelays.add(milliseconds);
					},
				});
				return Object.freeze({
					async executeNext() {
						try {
							return await executor.executeNext();
						} catch (error) {
							executorFailureMessage = error instanceof Error ? error.message : "unknown";
							throw error;
						}
					},
					dispose: () => executor.dispose(),
				});
			},
		});
		await lstat(materializationRoot).then(
			() => {
				throw new TypeError("D27 qualification left workspace residue");
			},
			(error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			},
		);
		const validatedMain = validateD27LiveBundle(mainBundle);
		const derived = deriveD32MainProjection(validatedMain);
		if (
			transport.maxActive() !== 1 ||
			transport.calls() !== derived.providerTransportCalls ||
			!sameBytes(
				Buffer.from([...transport.retryDelays].sort((a, b) => a - b).join(",")),
				Buffer.from("1000,7000,60000"),
			)
		)
			throw new TypeError(
				`D27 injected qualification projection drifted: ${JSON.stringify({
					disposition: validatedMain.disposition,
					failureCode: validatedMain.partialGraphEvidence?.failureCode ?? null,
					gateEvaluated: validatedMain.gate.evaluated,
					efficacyClaim: validatedMain.efficacyClaim,
					maxActiveEffects: transport.maxActive(),
					transportCalls: transport.calls(),
					retryDelays: [...transport.retryDelays].sort((left, right) => left - right),
					executorFailureMessage,
				})}`,
			);
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D27_QUALIFICATION_SCHEMA,
			decisionRef: D27_DECISION_REF,
			d31ArtifactDigest: D27_D31_ARTIFACT_DIGEST,
			d31BundleDigest: D27_D31_BUNDLE_DIGEST,
			d31GraphEvidenceDigest: D27_D31_GRAPH_EVIDENCE_DIGEST,
			d31QualificationArtifactDigest: D27_D31_QUALIFICATION_ARTIFACT_DIGEST,
			d31QualificationDigest: D27_D31_QUALIFICATION_DIGEST,
			d31GenerationDigest: D27_D31_GENERATION_DIGEST,
			d31ImplementationManifestDigest: D27_D31_IMPLEMENTATION_MANIFEST_DIGEST,
			implementationManifestDigest: D27_IMPLEMENTATION_MANIFEST_DIGEST,
			mainBundleDigest: validatedMain.bundleDigest,
			exactSixArmsCompleted: true as const,
			graphAdmissionBeforeEveryEffect: true as const,
			exactNamedWirePassed: true as const,
			retryIdentityPassed: true as const,
			exactReplacementCauseCoverage: [
				"exact-replacement-unchanged",
				"exact-replacement-old-text-not-found",
				"exact-replacement-old-text-not-unique",
			] as const,
			validationRecoveryPassed: true as const,
			retryDelayCoverageMs: [1_000, 7_000, 60_000] as const,
			providerTransportCalls: transport.calls(),
			providerNetworkCalls: 0 as const,
			maxActiveEffects: 1 as const,
			workspaceResidueCount: 0 as const,
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
			schemaVersion: D27_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D27_QUALIFICATION_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			mainBundleDigest: validatedMain.bundleDigest,
			implementationManifestDigest: D27_IMPLEMENTATION_MANIFEST_DIGEST,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const bundleMaterial = strictSnapshot({
			schemaVersion: D27_QUALIFICATION_BUNDLE_SCHEMA,
			baselineBasis: input.baselineBasis,
			mainBundle: validatedMain,
			qualification,
			generation,
		});
		const bundle = Object.freeze({
			...bundleMaterial,
			bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
		}) as D27QualificationBundleV1;
		constructed.add(bundle);
		return bundle;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export function validateD27QualificationBundle(value: unknown): D27QualificationBundleV1 {
	const candidate = record(value, "D27 qualification bundle");
	exactKeys(
		candidate,
		["baselineBasis", "bundleDigest", "generation", "mainBundle", "qualification", "schemaVersion"],
		"D27 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D27_QUALIFICATION_BUNDLE_SCHEMA ||
		!["consumed-d31-artifact", "injected-test"].includes(String(candidate.baselineBasis))
	)
		throw new TypeError("D27 qualification bundle coordinates drifted");
	const mainBundle = validateD27LiveBundle(candidate.mainBundle);
	const derived = deriveD32MainProjection(mainBundle);
	const qualification = record(candidate.qualification, "D27 qualification");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"d31ArtifactDigest",
			"d31BundleDigest",
			"d31GenerationDigest",
			"d31GraphEvidenceDigest",
			"d31ImplementationManifestDigest",
			"d31QualificationArtifactDigest",
			"d31QualificationDigest",
			"decisionRef",
			"efficacyClaim",
			"exactNamedWirePassed",
			"exactReplacementCauseCoverage",
			"exactSixArmsCompleted",
			"graphAdmissionBeforeEveryEffect",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"mainBundleDigest",
			"maxActiveEffects",
			"providerNetworkCalls",
			"providerTransportCalls",
			"qualificationDigest",
			"qualified",
			"retryDelayCoverageMs",
			"retryIdentityPassed",
			"schemaVersion",
			"validationRecoveryPassed",
			"workspaceResidueCount",
		],
		"D27 qualification",
	);
	const retryDelayCoverageMs = array(
		qualification.retryDelayCoverageMs,
		"D27 qualification retry delay coverage",
	);
	if (
		qualification.schemaVersion !== D27_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D27_DECISION_REF ||
		qualification.d31ArtifactDigest !== D27_D31_ARTIFACT_DIGEST ||
		qualification.d31BundleDigest !== D27_D31_BUNDLE_DIGEST ||
		qualification.d31GraphEvidenceDigest !== D27_D31_GRAPH_EVIDENCE_DIGEST ||
		qualification.d31QualificationArtifactDigest !== D27_D31_QUALIFICATION_ARTIFACT_DIGEST ||
		qualification.d31QualificationDigest !== D27_D31_QUALIFICATION_DIGEST ||
		qualification.d31GenerationDigest !== D27_D31_GENERATION_DIGEST ||
		qualification.d31ImplementationManifestDigest !== D27_D31_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.implementationManifestDigest !== D27_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.mainBundleDigest !== mainBundle.bundleDigest ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.graphAdmissionBeforeEveryEffect !== true ||
		qualification.exactNamedWirePassed !== true ||
		qualification.retryIdentityPassed !== true ||
		safeInteger(
			qualification.providerTransportCalls,
			"D27 qualification provider transport calls",
			{ min: 1, max: 96 },
		) !== derived.providerTransportCalls ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.validationRecoveryPassed !== true ||
		!sameBytes(
			Buffer.from(
				array(
					qualification.exactReplacementCauseCoverage,
					"D27 qualification exact replacement cause coverage",
				).join(","),
			),
			Buffer.from(
				[
					"exact-replacement-unchanged",
					"exact-replacement-old-text-not-found",
					"exact-replacement-old-text-not-unique",
				].join(","),
			),
		) ||
		retryDelayCoverageMs.length !== 3 ||
		retryDelayCoverageMs[0] !== 1_000 ||
		retryDelayCoverageMs[1] !== 7_000 ||
		retryDelayCoverageMs[2] !== 60_000 ||
		qualification.liveGateEvaluated !== false ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		qualification.qualified !== true
	)
		throw new TypeError("D27 qualification projection drifted");
	const qualificationMaterial = strictSnapshot(
		Object.fromEntries(
			Object.entries(qualification).filter(([key]) => key !== "qualificationDigest"),
		),
	);
	if (qualification.qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D27 qualification digest drifted");
	const generation = record(candidate.generation, "D27 qualification generation");
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
		"D27 qualification generation",
	);
	if (
		generation.schemaVersion !== D27_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D27_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.mainBundleDigest !== mainBundle.bundleDigest ||
		generation.implementationManifestDigest !== D27_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D27 qualification generation drifted");
	const generationMaterial = strictSnapshot(
		Object.fromEntries(Object.entries(generation).filter(([key]) => key !== "generationDigest")),
	);
	if (generation.generationDigest !== empiricalStrictJsonDigest(generationMaterial))
		throw new TypeError("D27 qualification generation digest drifted");
	const material = strictSnapshot(
		Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "bundleDigest")),
	);
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D27 qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D27QualificationBundleV1;
}

export async function persistD27Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D27QualificationBundleV1;
}) {
	if (!constructed.delete(input.bundle as object))
		throw new TypeError("D27 qualification is forged or replayed");
	const bundle = validateD27QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d31-artifact")
		throw new TypeError("D32 production qualification requires consumed D31 artifact bytes");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d32.phase-specific-live-qualification-commit.v1",
		generationRef: D27_QUALIFICATION_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D27_QUALIFICATION_GENERATION_REF,
		artifacts: Object.freeze({ "bundle.v1.json": bundleBytes }),
		commitBytes: strictJsonCodec.encode({
			...commitMaterial,
			commitDigest: empiricalStrictJsonDigest(commitMaterial),
		}),
	});
}
