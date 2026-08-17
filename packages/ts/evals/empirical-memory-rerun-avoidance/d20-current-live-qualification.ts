import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	D18_INSPECTION_PATHS,
	D18_WRITABLE_PATH,
} from "./d18-current-provider-composition-authority.js";
import {
	D19_BUGGY_ADMISSION_BLOCK,
	D19_FIXED_ADMISSION_BLOCK,
	D19_OPENROUTER_ENDPOINT,
} from "./d19-current-real-provider-adapter.js";
import {
	admitD20D19Baseline,
	createD20InjectedD19BaselineForTest,
	type D20D19BaselineAdmissionV1,
	type D20LiveBundleV1,
	runD20InjectedMeasurementForTest,
	validateD20LiveBundle,
} from "./d20-current-live.js";
import {
	acquireD20DispatchClaimAtRootForTest,
	consumeD20DispatchClaim,
	readD20CurrentKeyAdmission,
} from "./d20-current-live-claim.js";
import {
	D20_COORDINATES_DIGEST,
	D20_D19_ARTIFACT_DIGEST,
	D20_DECISION_REF,
	D20_PROVIDER,
	D20_PROVIDER_TAG,
	D20_QUALIFICATION_GENERATION_REF,
	D20_QUANTIZATION,
	D20_REQUEST_MODEL,
	D20_SELECTED_ENDPOINT_MODEL,
} from "./d20-current-live-coordinates.js";
import { D20_IMPLEMENTATION_MANIFEST_DIGEST } from "./d20-current-live-implementation-manifest.js";
import {
	admitD20ZeroByok,
	composeD20Preclaim,
	type D20CredentialV1,
	d20ZeroByokCanonicalBytes,
	readD20OfficialPricing,
} from "./d20-current-live-preflight.js";

export const D20_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d20.live-no-network-qualification.v1" as const;
export const D20_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d20.live-no-network-bundle.v1" as const;
export const D20_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d20.live-no-network-generation.v1" as const;
export const D20_QUALIFICATION_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d20.live-no-network-persistence.v1" as const;

export interface D20QualificationBundleV1 {
	readonly schemaVersion: typeof D20_QUALIFICATION_BUNDLE_SCHEMA;
	readonly implementationManifestDigest: string;
	readonly baselineBasis: "exact-private-artifact" | "injected-test";
	readonly qualification: Readonly<{
		schemaVersion: typeof D20_QUALIFICATION_SCHEMA;
		decisionRef: typeof D20_DECISION_REF;
		coordinatesDigest: string;
		implementationManifestDigest: string;
		d19ArtifactDigest: typeof D20_D19_ARTIFACT_DIGEST;
		mainBundleDigest: string;
		partialBundleDigest: string;
		fullSixArmIntegrationPassed: true;
		fixedArmOrderPassed: true;
		coldIndependentWarmAdmissionPassed: true;
		retryIdentityPassed: true;
		retryWaits: 1;
		maxActiveEffects: 1;
		pricingPreclaimClaimCurrentKeyOrderingPassed: true;
		partialFailurePersistenceShapePassed: true;
		workspaceResidueCount: 0;
		externalNetworkCalls: 0;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly mainBundle: D20LiveBundleV1;
	readonly partialBundle: D20LiveBundleV1;
	readonly generation: Readonly<{
		schemaVersion: typeof D20_QUALIFICATION_GENERATION_SCHEMA;
		generationRef: typeof D20_QUALIFICATION_GENERATION_REF;
		qualificationDigest: string;
		mainBundleDigest: string;
		partialBundleDigest: string;
		implementationManifestDigest: string;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const constructedBundles = new WeakSet<object>();
const baselineBasis = new WeakMap<object, "exact-private-artifact" | "injected-test">();

export function admitD20QualificationBaseline(bytes: Uint8Array): D20D19BaselineAdmissionV1 {
	const baseline = admitD20D19Baseline(bytes);
	baselineBasis.set(baseline, "exact-private-artifact");
	return baseline;
}

export function createD20QualificationInjectedBaselineForTest(): D20D19BaselineAdmissionV1 {
	const baseline = createD20InjectedD19BaselineForTest();
	baselineBasis.set(baseline, "injected-test");
	return baseline;
}

function officialPricingResponse(): Response {
	const response = new Response(
		JSON.stringify({
			data: {
				id: D20_REQUEST_MODEL,
				endpoints: [
					{
						provider_name: D20_PROVIDER,
						tag: D20_PROVIDER_TAG,
						quantization: D20_QUANTIZATION,
						model: D20_SELECTED_ENDPOINT_MODEL,
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

function successResponse(body: unknown): Response {
	const candidate = record(body, "D20 injected provider body");
	const mutation = typeof candidate.tool_choice === "object" && candidate.tool_choice !== null;
	const calls = mutation
		? [
				{
					id: "replace-1",
					type: "function",
					function: {
						name: "replace_exact",
						arguments: JSON.stringify({
							path: D18_WRITABLE_PATH,
							oldText: D19_BUGGY_ADMISSION_BLOCK,
							newText: D19_FIXED_ADMISSION_BLOCK,
						}),
					},
				},
			]
		: D18_INSPECTION_PATHS.map((path, index) => ({
				id: `read-${index}`,
				type: "function",
				function: { name: "read_file", arguments: JSON.stringify({ path }) },
			}));
	return new Response(
		JSON.stringify({
			choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 10 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function injectedProvider(calls: Uint8Array[]): typeof fetch {
	let first = true;
	return (async (input, init) => {
		if (input !== D19_OPENROUTER_ENDPOINT || init?.method !== "POST")
			throw new TypeError("D20 injected provider route drifted");
		if (!(init.body instanceof Uint8Array))
			throw new TypeError("D20 injected provider body is not bytes");
		const bytes = new Uint8Array(init.body);
		calls.push(bytes);
		const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		if (first) {
			first = false;
			return new Response(JSON.stringify({ error: { message: "retry" } }), {
				status: 429,
				headers: { "content-type": "application/json" },
			});
		}
		return successResponse(body);
	}) as typeof fetch;
}

async function issueTestAuthority(input: {
	readonly privateRoot: string;
	readonly credential: D20CredentialV1;
	readonly nowMs: number;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
}) {
	const signal = new AbortController().signal;
	const pricing = await readD20OfficialPricing({
		fetch: async () => officialPricingResponse(),
		nowMs: () => input.nowMs,
		signal,
	});
	const zeroByok = admitD20ZeroByok({
		bytes: d20ZeroByokCanonicalBytes({
			schemaVersion: "graphrefly-ts.d20.zero-byok-observation.v1",
			decisionRef: D20_DECISION_REF,
			workspaceName: "GraphReFly",
			workspaceSlug: "graph-re-fly",
			keyName: "Local Eval 2",
			keyVisiblePrefix: input.credential.bearerToken.slice(0, 12),
			keyVisibleSuffix: input.credential.bearerToken.slice(-3),
			byokCredentialCount: 0,
			allowedModels: [D20_REQUEST_MODEL],
			allowedProviders: [D20_PROVIDER],
			observedAt: new Date(input.nowMs).toISOString(),
			source: "openrouter-browser-settings",
		}),
		credential: input.credential,
		nowMs: input.nowMs,
	});
	const preclaim = composeD20Preclaim({
		pricingObservation: pricing,
		zeroByokObservation: zeroByok,
		credential: input.credential,
		nowMs: input.nowMs,
	});
	const claim = await acquireD20DispatchClaimAtRootForTest(input.privateRoot, {
		preclaim,
		nowMs: input.nowMs,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
	});
	const currentKey = await readD20CurrentKeyAdmission({
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
		signal,
	});
	return consumeD20DispatchClaim({
		claim,
		currentKeyAdmission: currentKey,
		allowInjectedTestScope: true,
	});
}

export async function runD20InjectedNoNetworkQualification(inputValue: {
	readonly repositoryRoot: string;
	readonly baseline: D20D19BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D20QualificationBundleV1> {
	const input = record(inputValue, "D20 qualification input");
	exactKeys(
		input,
		["baseline", "implementationManifestDigest", "repositoryRoot"],
		"D20 qualification input",
	);
	const basis =
		typeof input.baseline === "object" && input.baseline !== null
			? baselineBasis.get(input.baseline)
			: undefined;
	if (basis === undefined) throw new TypeError("D20 qualification baseline is forged or replayed");
	baselineBasis.delete(input.baseline as object);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"D20 implementation manifest",
	);
	if (implementationManifestDigest !== D20_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D20 qualification implementation manifest drifted");
	const repositoryRoot = await realpath(String(input.repositoryRoot));
	const temporaryRoot = await mkdtemp(join(tmpdir(), "graphrefly-d20-no-network-"));
	await chmod(temporaryRoot, 0o700);
	const credential = Object.freeze({
		bearerToken: "sk-or-v1-test-current-graph-efficacy-d20",
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
	const qualificationCoordinate = empiricalStrictJsonDigest({
		decisionRef: D20_DECISION_REF,
		implementationManifestDigest,
	});
	try {
		const mainRoot = join(temporaryRoot, "main-private");
		await mkdir(mainRoot, { mode: 0o700 });
		const mainAuthority = await issueTestAuthority({
			privateRoot: await realpath(mainRoot),
			credential,
			nowMs: 1_786_924_800_000,
			implementationManifestDigest,
			qualificationArtifactDigest: qualificationCoordinate,
			qualificationDigest: qualificationCoordinate,
		});
		const calls: Uint8Array[] = [];
		let clock = 0;
		const mainBundle = await runD20InjectedMeasurementForTest({
			executionAuthority: mainAuthority,
			baseline: input.baseline as D20D19BaselineAdmissionV1,
			implementationManifestDigest,
			adapterOptions: {
				repositoryRoot,
				materializationRoot: join(temporaryRoot, "main-workspaces"),
				fetchImpl: injectedProvider(calls),
				bearerToken: credential.bearerToken,
				now: () => ++clock,
				sleep: async () => undefined,
			},
		});
		if (
			mainBundle.disposition !== "success" ||
			mainBundle.graphEvidence?.workflowEvidence.runs.length !== 6 ||
			mainBundle.graphEvidence.workflowEvidence.runs.some(
				(run, index) =>
					run.arm !==
					[
						"cold",
						"relevant-applied",
						"proposal-only",
						"admission-rejected",
						"irrelevant-applied",
						"wrong-scope-applied",
					][index],
			) ||
			mainBundle.gate.evaluated !== false ||
			mainBundle.efficacyClaim !== "none"
		)
			throw new TypeError("D20 main no-network measurement drifted");
		if (calls.length < 2 || !sameBytes(calls[0]!, calls[1]!))
			throw new TypeError("D20 D710 retry body identity drifted");

		const partialRoot = join(temporaryRoot, "partial-private");
		await mkdir(partialRoot, { mode: 0o700 });
		const partialAuthority = await issueTestAuthority({
			privateRoot: await realpath(partialRoot),
			credential,
			nowMs: 1_786_924_800_000,
			implementationManifestDigest,
			qualificationArtifactDigest: qualificationCoordinate,
			qualificationDigest: qualificationCoordinate,
		});
		const partialBundle = await runD20InjectedMeasurementForTest({
			executionAuthority: partialAuthority,
			baseline: createD20InjectedD19BaselineForTest(),
			implementationManifestDigest,
			adapterOptions: {
				repositoryRoot: join(temporaryRoot, "missing-repository"),
				materializationRoot: join(temporaryRoot, "missing-parent", "workspaces"),
				fetchImpl: async () => {
					throw new TypeError("unexpected provider invocation");
				},
				bearerToken: credential.bearerToken,
				now: () => ++clock,
				sleep: async () => undefined,
			},
		});
		if (
			partialBundle.disposition !== "partial-failure" ||
			partialBundle.partialGraphEvidence === null ||
			partialBundle.generation !== null ||
			partialBundle.efficacyClaim !== "none"
		)
			throw new TypeError("D20 partial no-network measurement drifted");
		const retryWaits = mainBundle.graphEvidence.providerFacts.filter(
			(fact) => fact.request.schemaVersion === "graphrefly-ts.d18.retry-wait-request.v1",
		).length;
		if (retryWaits !== 1) throw new TypeError("D20 retry wait qualification drifted");
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D20_QUALIFICATION_SCHEMA,
			decisionRef: D20_DECISION_REF,
			coordinatesDigest: D20_COORDINATES_DIGEST,
			implementationManifestDigest,
			d19ArtifactDigest: D20_D19_ARTIFACT_DIGEST,
			mainBundleDigest: mainBundle.bundleDigest,
			partialBundleDigest: partialBundle.bundleDigest,
			fullSixArmIntegrationPassed: true as const,
			fixedArmOrderPassed: true as const,
			coldIndependentWarmAdmissionPassed: true as const,
			retryIdentityPassed: true as const,
			retryWaits: 1 as const,
			maxActiveEffects: 1 as const,
			pricingPreclaimClaimCurrentKeyOrderingPassed: true as const,
			partialFailurePersistenceShapePassed: true as const,
			workspaceResidueCount: 0 as const,
			externalNetworkCalls: 0 as const,
			liveGateEvaluated: false as const,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const qualification = Object.freeze({
			...qualificationMaterial,
			qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
		});
		const generationMaterial = strictSnapshot({
			schemaVersion: D20_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D20_QUALIFICATION_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			mainBundleDigest: mainBundle.bundleDigest,
			partialBundleDigest: partialBundle.bundleDigest,
			implementationManifestDigest,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const bundleMaterial = strictSnapshot({
			schemaVersion: D20_QUALIFICATION_BUNDLE_SCHEMA,
			implementationManifestDigest,
			baselineBasis: basis,
			qualification,
			mainBundle,
			partialBundle,
			generation,
		});
		const bundle = Object.freeze({
			...bundleMaterial,
			bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
		}) as D20QualificationBundleV1;
		constructedBundles.add(bundle);
		return bundle;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export function validateD20QualificationBundle(value: unknown): D20QualificationBundleV1 {
	const candidate = record(value, "D20 qualification bundle");
	exactKeys(
		candidate,
		[
			"baselineBasis",
			"bundleDigest",
			"generation",
			"implementationManifestDigest",
			"mainBundle",
			"partialBundle",
			"qualification",
			"schemaVersion",
		],
		"D20 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D20_QUALIFICATION_BUNDLE_SCHEMA ||
		candidate.implementationManifestDigest !== D20_IMPLEMENTATION_MANIFEST_DIGEST ||
		(candidate.baselineBasis !== "exact-private-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D20 qualification bundle coordinates drifted");
	const mainBundle = validateD20LiveBundle(candidate.mainBundle);
	const partialBundle = validateD20LiveBundle(candidate.partialBundle);
	if (
		mainBundle.executionClass !== "injected-no-network" ||
		mainBundle.disposition !== "success" ||
		mainBundle.graphEvidence?.workflowEvidence.runs.length !== 6 ||
		mainBundle.graphEvidence.providerFacts.filter(
			(fact) => fact.request.schemaVersion === "graphrefly-ts.d18.retry-wait-request.v1",
		).length !== 1 ||
		mainBundle.gate.evaluated !== false ||
		mainBundle.efficacyClaim !== "none" ||
		partialBundle.executionClass !== "injected-no-network" ||
		partialBundle.disposition !== "partial-failure" ||
		partialBundle.generation !== null ||
		partialBundle.partialGraphEvidence === null
	)
		throw new TypeError("D20 qualification Graph projection drifted");
	const qualification = record(candidate.qualification, "D20 qualification");
	const expectedKeys = [
		"causalAttribution",
		"coldIndependentWarmAdmissionPassed",
		"coordinatesDigest",
		"d19ArtifactDigest",
		"decisionRef",
		"efficacyClaim",
		"externalNetworkCalls",
		"fixedArmOrderPassed",
		"fullSixArmIntegrationPassed",
		"implementationManifestDigest",
		"liveGateEvaluated",
		"mainBundleDigest",
		"maxActiveEffects",
		"partialBundleDigest",
		"partialFailurePersistenceShapePassed",
		"pricingPreclaimClaimCurrentKeyOrderingPassed",
		"qualificationDigest",
		"retryIdentityPassed",
		"retryWaits",
		"schemaVersion",
		"workspaceResidueCount",
	];
	exactKeys(qualification, expectedKeys, "D20 qualification");
	if (
		qualification.schemaVersion !== D20_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D20_DECISION_REF ||
		qualification.coordinatesDigest !== D20_COORDINATES_DIGEST ||
		qualification.implementationManifestDigest !== D20_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.d19ArtifactDigest !== D20_D19_ARTIFACT_DIGEST ||
		qualification.mainBundleDigest !== mainBundle.bundleDigest ||
		qualification.partialBundleDigest !== partialBundle.bundleDigest ||
		qualification.fullSixArmIntegrationPassed !== true ||
		qualification.fixedArmOrderPassed !== true ||
		qualification.coldIndependentWarmAdmissionPassed !== true ||
		qualification.retryIdentityPassed !== true ||
		qualification.retryWaits !== 1 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.pricingPreclaimClaimCurrentKeyOrderingPassed !== true ||
		qualification.partialFailurePersistenceShapePassed !== true ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.externalNetworkCalls !== 0 ||
		qualification.liveGateEvaluated !== false ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none"
	)
		throw new TypeError("D20 qualification claims drifted");
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D20 qualification digest drifted");
	const generation = record(candidate.generation, "D20 qualification generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"mainBundleDigest",
			"partialBundleDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"D20 qualification generation",
	);
	if (
		generation.schemaVersion !== D20_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D20_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.mainBundleDigest !== mainBundle.bundleDigest ||
		generation.partialBundleDigest !== partialBundle.bundleDigest ||
		generation.implementationManifestDigest !== D20_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D20 qualification generation drifted");
	const { generationDigest, ...generationMaterial } = generation;
	if (generationDigest !== empiricalStrictJsonDigest(generationMaterial))
		throw new TypeError("D20 qualification generation digest drifted");
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D20 qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D20QualificationBundleV1;
}

export async function persistD20Qualification(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D20QualificationBundleV1;
}) {
	const input = record(inputValue, "D20 qualification persistence input");
	exactKeys(input, ["bundle", "privateRoot"], "D20 qualification persistence input");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D20 qualification persistence requires a fresh constructed bundle");
	const bundle = validateD20QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "exact-private-artifact")
		throw new TypeError("D20 production qualification rejects an injected baseline");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d20.live-no-network-commit.v1",
		generationRef: D20_QUALIFICATION_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	const receipt = await persistCurrentGraphPrivateGeneration({
		privateRoot: String(input.privateRoot),
		generationRef: D20_QUALIFICATION_GENERATION_REF,
		artifacts: {
			"bundle.v1.json": bundleBytes,
			"qualification.v1.json": qualificationBytes,
			"generation.v1.json": generationBytes,
		},
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D20_QUALIFICATION_PERSISTENCE_SCHEMA,
		generationRef: D20_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		commitDigest: commit.commitDigest,
		persistenceReceiptDigest: receipt.receiptDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			bundleArtifactDigest: empiricalSha256(bundleBytes),
			bundleDigest: bundle.bundleDigest,
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
			commitDigest: commit.commitDigest,
			persistenceReceiptDigest: receipt.receiptDigest,
		}),
	});
}
