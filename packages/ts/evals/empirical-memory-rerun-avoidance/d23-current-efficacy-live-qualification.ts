import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
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
} from "./d8-current-live-coordinates.js";
import {
	admitD23D22Baseline,
	assertD23NoWorkspaceResidue,
	createD23InjectedBaselineForTest,
	createD23RealProviderExecutor,
	D23_FIXTURE_BLOCKS,
	type D23D22BaselineAdmissionV1,
	type D23LiveBundleV1,
	persistD23LiveBundle,
	persistD23PreexecutionFailure,
	runD23InjectedMeasurementForTest,
	validateD23LiveBundle,
} from "./d23-current-efficacy-live.js";
import {
	acquireD23DispatchClaimAtRootForTest,
	consumeD23DispatchClaim,
	readD23CurrentKeyAdmission,
} from "./d23-current-efficacy-live-claim.js";
import {
	D23_COORDINATES_DIGEST,
	D23_DECISION_REF,
	D23_DISPATCH_CLAIM_REF,
	D23_QUALIFICATION_GENERATION_REF,
} from "./d23-current-efficacy-live-coordinates.js";
import { D23_IMPLEMENTATION_MANIFEST_DIGEST } from "./d23-current-efficacy-live-implementation-manifest.js";
import {
	admitD23ZeroByok,
	composeD23Preclaim,
	type D23CredentialV1,
	readD23OfficialPricing,
} from "./d23-current-efficacy-live-preflight.js";

export const D23_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d23.live-no-network-qualification.v1" as const;
export const D23_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d23.live-no-network-bundle.v1" as const;
export const D23_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d23.live-no-network-generation.v1" as const;
export const D23_QUALIFICATION_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d23.live-no-network-persistence.v1" as const;

export interface D23QualificationBundleV1 {
	readonly schemaVersion: typeof D23_QUALIFICATION_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d22-artifact" | "injected-test";
	readonly mainBundle: D23LiveBundleV1;
	readonly partialBundle: D23LiveBundleV1;
	readonly qualification: Readonly<Record<string, StrictJsonValue>>;
	readonly generation: Readonly<Record<string, StrictJsonValue>>;
	readonly bundleDigest: string;
}

const baselineBasis = new WeakMap<object, D23QualificationBundleV1["baselineBasis"]>();
const constructed = new WeakSet<object>();
const constructedLiveBundles = new WeakMap<
	object,
	Readonly<{ mainBundle: D23LiveBundleV1; partialBundle: D23LiveBundleV1 }>
>();

export function admitD23QualificationBaseline(bytes: Uint8Array): D23D22BaselineAdmissionV1 {
	const capability = admitD23D22Baseline(bytes);
	baselineBasis.set(capability, "consumed-d22-artifact");
	return capability;
}

export function createD23QualificationInjectedBaselineForTest(): D23D22BaselineAdmissionV1 {
	const capability = createD23InjectedBaselineForTest();
	baselineBasis.set(capability, "injected-test");
	return capability;
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

function providerResponse(calls: readonly unknown[]) {
	return new Response(
		JSON.stringify({
			choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function functionCall(id: string, name: string, args: unknown) {
	return Object.freeze({
		id,
		type: "function",
		function: { name, arguments: JSON.stringify(args) },
	});
}

function injectedProvider(calls: Uint8Array[]) {
	let providerCalls = 0;
	const retryPolicyByArm = new Map<string, "D671" | "D675" | "D710">([
		["cold", "D710"],
		["relevant-applied", "D671"],
		["proposal-only", "D675"],
	]);
	const retryInjected = new Set<string>();
	const pendingRetryBody = new Map<string, Uint8Array>();
	return Object.freeze({
		fetchImpl: (async (_url, init) => {
			providerCalls += 1;
			const bodyBytes = new Uint8Array(init?.body as Uint8Array);
			calls.push(bodyBytes.slice());
			const body = JSON.parse(Buffer.from(bodyBytes).toString("utf8")) as {
				readonly messages: readonly { readonly role?: string; readonly content?: string }[];
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
			if (arm === undefined) throw new TypeError("D23 injected request arm is missing");
			const pending = pendingRetryBody.get(arm);
			if (pending !== undefined) {
				if (!sameBytes(pending, bodyBytes)) throw new TypeError("D23 retry body drifted");
				pendingRetryBody.delete(arm);
			} else if (!retryInjected.has(arm)) {
				const policy = retryPolicyByArm.get(arm);
				if (policy !== undefined) {
					retryInjected.add(arm);
					pendingRetryBody.set(arm, bodyBytes.slice());
					if (policy === "D675")
						throw new TypeError("D23 injected socket reset", {
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
			}
			const hasToolResult = body.messages.some((message) => message.role === "tool");
			const correction = body.messages.some(
				(message) =>
					message.role === "system" && message.content?.includes("correction=semantic-correction"),
			);
			if (!hasToolResult)
				return providerResponse(
					CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) =>
						functionCall(`read-${providerCalls}-${index}`, "read_file", { path }),
					),
				);
			return providerResponse([
				functionCall(`replace-${providerCalls}`, "replace_exact", {
					path: D23_FIXTURE_BLOCKS.writableFile,
					oldText: correction ? D23_FIXTURE_BLOCKS.wrong : D23_FIXTURE_BLOCKS.initial,
					newText: correction ? D23_FIXTURE_BLOCKS.fixed : D23_FIXTURE_BLOCKS.wrong,
				}),
				functionCall(`diff-${providerCalls}`, "workspace_diff", {}),
				functionCall(`focused-${providerCalls}`, "focused_validation", {}),
			]);
		}) as typeof fetch,
		providerCalls: () => providerCalls,
	});
}

async function makeTestPreclaim(input: {
	readonly credential: D23CredentialV1;
	readonly nowMs: number;
}) {
	const pricing = await readD23OfficialPricing({
		fetch: async () => officialPricingResponse(),
		nowMs: () => input.nowMs,
		signal: new AbortController().signal,
	});
	const zeroByokBytes = Buffer.from(
		JSON.stringify({
			schemaVersion: "graphrefly-ts.d20.zero-byok-observation.v1",
			decisionRef: "graphrefly-ts:D20",
			workspaceName: "GraphReFly",
			workspaceSlug: "graph-re-fly",
			keyName: "Local Eval 2",
			keyVisiblePrefix: input.credential.bearerToken.slice(0, 12),
			keyVisibleSuffix: input.credential.bearerToken.slice(-3),
			byokCredentialCount: 0,
			allowedModels: [CURRENT_GRAPH_LIVE_REQUEST_MODEL],
			allowedProviders: [CURRENT_GRAPH_LIVE_PROVIDER_NAME],
			observedAt: new Date(input.nowMs).toISOString(),
			source: "openrouter-browser-settings",
		}),
	);
	const zeroByok = admitD23ZeroByok({
		bytes: zeroByokBytes,
		credential: input.credential,
		nowMs: input.nowMs,
	});
	return composeD23Preclaim({
		pricingObservation: pricing,
		zeroByokObservation: zeroByok,
		credential: input.credential,
		nowMs: input.nowMs,
	});
}

async function issueTestClaim(input: {
	readonly privateRoot: string;
	readonly credential: D23CredentialV1;
	readonly nowMs: number;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
}) {
	return acquireD23DispatchClaimAtRootForTest(input.privateRoot, {
		preclaim: await makeTestPreclaim(input),
		nowMs: input.nowMs,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
	});
}

async function issueTestAuthority(input: Parameters<typeof issueTestClaim>[0]) {
	const claim = await issueTestClaim(input);
	const currentKey = await readD23CurrentKeyAdmission({
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
	return consumeD23DispatchClaim({
		claim,
		currentKeyAdmission: currentKey,
		allowInjectedTestScope: true,
	});
}

export async function runD23InjectedNoNetworkQualification(inputValue: {
	readonly repositoryRoot: string;
	readonly baseline: D23D22BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D23QualificationBundleV1> {
	const input = record(inputValue, "D23 qualification input");
	exactKeys(
		input,
		["baseline", "implementationManifestDigest", "repositoryRoot"],
		"D23 qualification input",
	);
	const basis =
		input.baseline !== null && typeof input.baseline === "object"
			? baselineBasis.get(input.baseline)
			: undefined;
	if (basis === undefined) throw new TypeError("D23 qualification baseline is forged or replayed");
	baselineBasis.delete(input.baseline as object);
	if (input.implementationManifestDigest !== D23_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D23 qualification implementation manifest drifted");
	const repositoryRoot = await realpath(resolve(String(input.repositoryRoot)));
	const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d23-")));
	await chmod(temporaryRoot, 0o700);
	const credential = Object.freeze({
		bearerToken: "sk-or-v1-test-current-graph-efficacy-d23",
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
	const qualificationCoordinate = empiricalStrictJsonDigest({
		decisionRef: D23_DECISION_REF,
		implementationManifestDigest: input.implementationManifestDigest,
	});
	try {
		const stalePrivate = join(temporaryRoot, "stale-preclaim-private");
		await mkdir(stalePrivate, { mode: 0o700 });
		const stalePreclaim = await makeTestPreclaim({ credential, nowMs: 1_786_924_800_000 });
		await acquireD23DispatchClaimAtRootForTest(await realpath(stalePrivate), {
			preclaim: stalePreclaim,
			nowMs: 1_786_924_921_000,
			implementationManifestDigest: String(input.implementationManifestDigest),
			qualificationArtifactDigest: qualificationCoordinate,
			qualificationDigest: qualificationCoordinate,
		}).then(
			() => {
				throw new TypeError("D23 stale preclaim unexpectedly acquired a claim");
			},
			(error: unknown) => {
				if (!(error instanceof TypeError) || !/stale|expired/iu.test(error.message)) throw error;
			},
		);
		await lstat(join(stalePrivate, `.${D23_DISPATCH_CLAIM_REF}`)).then(
			() => {
				throw new TypeError("D23 stale preclaim left a durable claim");
			},
			(error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			},
		);

		const currentKeyFailurePrivate = join(temporaryRoot, "current-key-failure-private");
		await mkdir(currentKeyFailurePrivate, { mode: 0o700 });
		const currentKeyFailureClaim = await issueTestClaim({
			privateRoot: await realpath(currentKeyFailurePrivate),
			credential,
			nowMs: 1_786_924_800_000,
			implementationManifestDigest: String(input.implementationManifestDigest),
			qualificationArtifactDigest: qualificationCoordinate,
			qualificationDigest: qualificationCoordinate,
		});
		await readD23CurrentKeyAdmission({
			claim: currentKeyFailureClaim,
			credential,
			fetch: async () =>
				new Response(
					JSON.stringify({
						data: {
							limit: 32,
							limit_remaining: 5,
							usage: 27,
							limit_reset: null,
							is_management_key: false,
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			signal: new AbortController().signal,
		}).then(
			() => {
				throw new TypeError("D23 insufficient current-key admission unexpectedly passed");
			},
			(error: unknown) => {
				if (!(error instanceof TypeError)) throw error;
			},
		);
		const currentKeyFailureReceipt = await persistD23PreexecutionFailure({
			privateRoot: await realpath(currentKeyFailurePrivate),
			claim: currentKeyFailureClaim,
			implementationManifestDigest: String(input.implementationManifestDigest),
			failurePhase: "current-key-admission",
			allowInjectedTestScope: true,
		});
		if (currentKeyFailureReceipt.disposition !== "partial-failure")
			throw new TypeError("D23 current-key failure persistence drifted");

		const mainPrivate = join(temporaryRoot, "main-private");
		await mkdir(mainPrivate, { mode: 0o700 });
		const mainAuthority = await issueTestAuthority({
			privateRoot: await realpath(mainPrivate),
			credential,
			nowMs: 1_786_924_800_000,
			implementationManifestDigest: String(input.implementationManifestDigest),
			qualificationArtifactDigest: qualificationCoordinate,
			qualificationDigest: qualificationCoordinate,
		});
		const calls: Uint8Array[] = [];
		const transport = injectedProvider(calls);
		const observedDeadlines: number[] = [];
		const materializationRoot = join(temporaryRoot, "main-workspaces");
		const mainBundle = await runD23InjectedMeasurementForTest({
			executionAuthority: mainAuthority,
			baseline: input.baseline as D23D22BaselineAdmissionV1,
			implementationManifestDigest: String(input.implementationManifestDigest),
			allowConsumedBaselineForQualification: true,
			executor: createD23RealProviderExecutor({
				repositoryRoot,
				materializationRoot,
				credential,
				fetchImpl: transport.fetchImpl,
				now: (() => {
					let clock = 0;
					return () => ++clock;
				})(),
				sleep: async () => undefined,
				observeDeadlineForTest: (deadline) => observedDeadlines.push(deadline),
			}),
		});
		await assertD23NoWorkspaceResidue(materializationRoot);
		const workflow = mainBundle.graphEvidence?.providerEvidence.workflowEvidence;
		if (
			mainBundle.disposition !== "success" ||
			workflow?.runStatus !== "complete" ||
			workflow.runs.length !== 6 ||
			workflow.runs.some(
				(run) =>
					!run.semanticRecoveryUsed ||
					!run.publicSemanticValidationPassed ||
					!run.hiddenVerifierPassed ||
					run.cleanupStatus !== "completed",
			) ||
			mainBundle.gate.evaluated !== false ||
			mainBundle.efficacyClaim !== "none" ||
			!observedDeadlines.includes(120_000) ||
			!observedDeadlines.includes(240_000) ||
			transport.providerCalls() !== 21
		)
			throw new TypeError("D23 main no-network measurement drifted");

		const partialPrivate = join(temporaryRoot, "partial-private");
		await mkdir(partialPrivate, { mode: 0o700 });
		const partialAuthority = await issueTestAuthority({
			privateRoot: await realpath(partialPrivate),
			credential,
			nowMs: 1_786_924_800_000,
			implementationManifestDigest: String(input.implementationManifestDigest),
			qualificationArtifactDigest: qualificationCoordinate,
			qualificationDigest: qualificationCoordinate,
		});
		const partialBundle = await runD23InjectedMeasurementForTest({
			executionAuthority: partialAuthority,
			baseline: createD23InjectedBaselineForTest(),
			implementationManifestDigest: String(input.implementationManifestDigest),
			executor: Object.freeze({
				execute: async () => {
					throw new TypeError("D23 injected executor failure");
				},
				dispose: async () => undefined,
			}),
		});
		if (
			partialBundle.disposition !== "partial-failure" ||
			partialBundle.partialGraphEvidence === null ||
			partialBundle.generation !== null ||
			partialBundle.efficacyClaim !== "none"
		)
			throw new TypeError("D23 partial no-network measurement drifted");

		const qualificationMaterial = strictSnapshot({
			schemaVersion: D23_QUALIFICATION_SCHEMA,
			decisionRef: D23_DECISION_REF,
			coordinatesDigest: D23_COORDINATES_DIGEST,
			implementationManifestDigest: String(input.implementationManifestDigest),
			d22ArtifactDigest: digest(
				"sha256:e0a23dd452df02368fb28d388792f09a6abbd088b4f44cfce2d98b60562023be",
				"D23 D22 artifact",
			),
			mainBundleDigest: mainBundle.bundleDigest,
			partialBundleDigest: partialBundle.bundleDigest,
			exactSixArmsCompleted: true as const,
			coldIndependentWarmAdmissionPassed: true as const,
			semanticRecoveryCount: 6 as const,
			retryIdentityPassed: true as const,
			retryDelayCoverageMs: Object.freeze([1_000, 7_000, 60_000] as const),
			phaseAwareDeadlinePassed: true as const,
			ordinaryProviderDeadlineMs: 120_000 as const,
			semanticCorrectionProviderDeadlineMs: 240_000 as const,
			preclaimClaimCurrentKeyOrderingPassed: true as const,
			partialFailurePersistenceShapePassed: true as const,
			providerAttempts: 21,
			maxActiveEffects: 1 as const,
			providerNetworkCalls: 0 as const,
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
			schemaVersion: D23_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D23_QUALIFICATION_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			mainBundleDigest: mainBundle.bundleDigest,
			partialBundleDigest: partialBundle.bundleDigest,
			implementationManifestDigest: String(input.implementationManifestDigest),
			liveGateEvaluated: false as const,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const material = strictSnapshot({
			schemaVersion: D23_QUALIFICATION_BUNDLE_SCHEMA,
			baselineBasis: basis,
			mainBundle,
			partialBundle,
			qualification,
			generation,
		});
		const bundle = Object.freeze({
			...material,
			bundleDigest: empiricalStrictJsonDigest(material),
		}) as D23QualificationBundleV1;
		constructed.add(bundle);
		constructedLiveBundles.set(bundle, Object.freeze({ mainBundle, partialBundle }));
		return bundle;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export function validateD23QualificationBundle(value: unknown): D23QualificationBundleV1 {
	const candidate = record(value, "D23 qualification bundle");
	exactKeys(
		candidate,
		[
			"baselineBasis",
			"bundleDigest",
			"generation",
			"mainBundle",
			"partialBundle",
			"qualification",
			"schemaVersion",
		],
		"D23 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D23_QUALIFICATION_BUNDLE_SCHEMA ||
		(candidate.baselineBasis !== "consumed-d22-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D23 qualification bundle coordinates drifted");
	const mainBundle = validateD23LiveBundle(candidate.mainBundle);
	const partialBundle = validateD23LiveBundle(candidate.partialBundle);
	if (
		mainBundle.executionClass !== "injected-no-network" ||
		mainBundle.disposition !== "success" ||
		partialBundle.executionClass !== "injected-no-network" ||
		partialBundle.disposition !== "partial-failure" ||
		partialBundle.generation !== null
	)
		throw new TypeError("D23 qualification evidence classes drifted");
	const qualification = record(candidate.qualification, "D23 qualification");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"coldIndependentWarmAdmissionPassed",
			"coordinatesDigest",
			"d22ArtifactDigest",
			"decisionRef",
			"efficacyClaim",
			"exactSixArmsCompleted",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"mainBundleDigest",
			"maxActiveEffects",
			"ordinaryProviderDeadlineMs",
			"partialBundleDigest",
			"partialFailurePersistenceShapePassed",
			"phaseAwareDeadlinePassed",
			"preclaimClaimCurrentKeyOrderingPassed",
			"providerAttempts",
			"providerNetworkCalls",
			"qualificationDigest",
			"qualified",
			"retryDelayCoverageMs",
			"retryIdentityPassed",
			"schemaVersion",
			"semanticCorrectionProviderDeadlineMs",
			"semanticRecoveryCount",
			"workspaceResidueCount",
		],
		"D23 qualification",
	);
	const workflow = mainBundle.graphEvidence?.providerEvidence.workflowEvidence;
	const providerEvidence = mainBundle.graphEvidence?.providerEvidence;
	const retryDelays = Object.freeze(
		(providerEvidence?.facts ?? [])
			.filter((fact) => fact.request.effectKind === "retry-wait")
			.map((fact) => fact.request.retryDelayMs)
			.sort((left, right) => left - right),
	);
	const exactSixArms =
		workflow?.runStatus === "complete" &&
		workflow.runs.length === 6 &&
		workflow.runs.every(
			(run, index) =>
				[
					"cold",
					"relevant-applied",
					"proposal-only",
					"admission-rejected",
					"irrelevant-applied",
					"wrong-scope-applied",
				][index] === run.arm,
		);
	const semanticRecoveryCount =
		workflow?.runs.filter(
			(run) =>
				run.semanticRecoveryUsed &&
				run.publicSemanticValidationPassed &&
				run.hiddenVerifierAttempted &&
				run.cleanupStatus === "completed",
		).length ?? 0;
	if (
		qualification.schemaVersion !== D23_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D23_DECISION_REF ||
		qualification.coordinatesDigest !== D23_COORDINATES_DIGEST ||
		qualification.implementationManifestDigest !== D23_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.mainBundleDigest !== mainBundle.bundleDigest ||
		qualification.partialBundleDigest !== partialBundle.bundleDigest ||
		qualification.exactSixArmsCompleted !== exactSixArms ||
		qualification.coldIndependentWarmAdmissionPassed !== true ||
		qualification.semanticRecoveryCount !== semanticRecoveryCount ||
		semanticRecoveryCount !== 6 ||
		qualification.retryIdentityPassed !== true ||
		empiricalStrictJsonDigest(qualification.retryDelayCoverageMs) !==
			empiricalStrictJsonDigest(retryDelays) ||
		empiricalStrictJsonDigest(retryDelays) !== empiricalStrictJsonDigest([1_000, 7_000, 60_000]) ||
		qualification.phaseAwareDeadlinePassed !== true ||
		qualification.ordinaryProviderDeadlineMs !== 120_000 ||
		qualification.semanticCorrectionProviderDeadlineMs !== 240_000 ||
		qualification.preclaimClaimCurrentKeyOrderingPassed !== true ||
		qualification.partialFailurePersistenceShapePassed !== true ||
		qualification.providerAttempts !== providerEvidence?.budget.providerAttempts ||
		qualification.providerAttempts !== 21 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.liveGateEvaluated !== false ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		qualification.qualified !== true
	)
		throw new TypeError("D23 qualification claims drifted");
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D23 qualification digest drifted");
	const generation = record(candidate.generation, "D23 qualification generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"mainBundleDigest",
			"partialBundleDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"D23 qualification generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	if (
		generation.schemaVersion !== D23_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D23_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.mainBundleDigest !== mainBundle.bundleDigest ||
		generation.partialBundleDigest !== partialBundle.bundleDigest ||
		generation.implementationManifestDigest !== D23_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.liveGateEvaluated !== false ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none" ||
		generationDigest !== empiricalStrictJsonDigest(generationMaterial)
	)
		throw new TypeError("D23 qualification generation drifted");
	const { bundleDigest, ...material } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D23 qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D23QualificationBundleV1;
}

export async function persistD23Qualification(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D23QualificationBundleV1;
}) {
	const input = record(inputValue, "D23 qualification persistence input");
	exactKeys(input, ["bundle", "privateRoot"], "D23 qualification persistence input");
	if (
		input.bundle === null ||
		typeof input.bundle !== "object" ||
		!constructed.delete(input.bundle)
	)
		throw new TypeError("D23 qualification persistence requires a constructed bundle");
	const bundle = validateD23QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d22-artifact")
		throw new TypeError("D23 production qualification requires consumed D22 evidence");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const artifacts = {
		"bundle.v1.json": bundleBytes,
		"qualification.v1.json": strictJsonCodec.encode(bundle.qualification as StrictJsonValue),
		"generation.v1.json": strictJsonCodec.encode(bundle.generation as StrictJsonValue),
	};
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d23.live-no-network-commit.v1",
		generationRef: D23_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: digest(
			bundle.qualification.qualificationDigest,
			"D23 qualification digest",
		),
		generationDigest: digest(bundle.generation.generationDigest, "D23 generation digest"),
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	const receipt = await persistCurrentGraphPrivateGeneration({
		privateRoot: String(input.privateRoot),
		generationRef: D23_QUALIFICATION_GENERATION_REF,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D23_QUALIFICATION_PERSISTENCE_SCHEMA,
		generationRef: D23_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		persistenceReceiptDigest: receipt.receiptDigest,
		receiptDigest: empiricalStrictJsonDigest({
			bundleArtifactDigest: empiricalSha256(bundleBytes),
			bundleDigest: bundle.bundleDigest,
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
			persistenceReceiptDigest: receipt.receiptDigest,
		}),
	});
}

export async function persistD23InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D23QualificationBundleV1;
}) {
	if (!constructed.has(input.bundle)) throw new TypeError("D23 test bundle is not constructed");
	const liveBundles = constructedLiveBundles.get(input.bundle);
	if (liveBundles === undefined) throw new TypeError("D23 test live bundles are unavailable");
	const bundle = validateD23QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "injected-test") throw new TypeError("D23 test basis drifted");
	constructed.delete(input.bundle);
	constructedLiveBundles.delete(input.bundle);
	const successRoot = join(input.privateRoot, "live-success");
	const partialRoot = join(input.privateRoot, "live-partial");
	await mkdir(successRoot, { mode: 0o700 });
	await mkdir(partialRoot, { mode: 0o700 });
	const successReceipt = await persistD23LiveBundle({
		privateRoot: successRoot,
		bundle: liveBundles.mainBundle,
	});
	const partialReceipt = await persistD23LiveBundle({
		privateRoot: partialRoot,
		bundle: liveBundles.partialBundle,
	});
	return Object.freeze({
		bundleDigest: bundle.bundleDigest,
		successPersistenceDigest: successReceipt.persistenceDigest,
		partialPersistenceDigest: partialReceipt.persistenceDigest,
	});
}
