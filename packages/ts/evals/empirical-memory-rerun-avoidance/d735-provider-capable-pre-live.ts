import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
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
import { deriveD722CanonicalGraphEvidence } from "./d722-graph-completion-memory-insight.js";
import { createD726ArmLocalTerminalProviderPolicy } from "./d722-graph-native-effect-runtime.js";
import { invokeD725OpenRouterGraphTurn } from "./d725-terminal-http-real-provider.js";
import {
	createD726ExecutorFailureProviderTurn,
	createD726ProviderAdapter,
	createD726ProviderTurn,
} from "./d726-graph-native-live.js";
import { runD727InjectedNoNetworkQualification } from "./d727-executor-failure-pre-live.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST } from "./d733-coordinates.js";
import type {
	D733GraphNativeRouteAdmissionV1,
	D733GraphNativeRouteProfileV1,
} from "./d733-graph-native-route-profile.js";
import {
	readD733AdmittedRouteProfile,
	validateD733GraphNativeRouteProfile,
} from "./d733-graph-native-route-profile.js";
import { createD734InjectedRouteProfileFixture } from "./d734-injected-route-profile-fixture.js";
import {
	D734_BUNDLE_SCHEMA,
	type D734RouteProfileIntegrationPreLiveBundleV1,
	validateD734RouteProfileIntegrationPreLiveBundle,
} from "./d734-route-profile-integration-pre-live.js";
import {
	consumeD735ImplementationAttestation,
	type D735ImplementationAttestationV1,
} from "./d735-implementation-manifest.js";
import {
	createD735ProviderCapableRouteAdapter,
	createD735SimulatedLivePreflight,
	D735_DECISION_REF,
	D735_DECISION_REVISION,
	D735_PREFLIGHT_STAGES,
	runD735ProviderCapableSixArmPreflight,
	validateD735AdapterProvenance,
	validateD735FailureClassification,
	validateD735PreflightGraphEvidence,
} from "./d735-provider-capable-route-preflight.js";

export const D735_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d735.provider-capable-pre-live-qualification.v1" as const;
export const D735_GENERATION_SCHEMA =
	"graphrefly.b112.d735.provider-capable-pre-live-generation.v1" as const;
export const D735_BUNDLE_SCHEMA =
	"graphrefly.b112.d735.provider-capable-pre-live-bundle.v1" as const;
export const D735_GENERATION_REF = "d735-provider-capable-pre-live-2026-08-11-v1" as const;
export const D735_D734_ARTIFACT_SHA256 =
	"sha256:a8b28d8a738e214a09d75bfa09ee6bec5b5c6a910fc6b13fb04a5cbf83010389" as const;
export const D735_D734_BUNDLE_DIGEST =
	"sha256:cff6e72ae3886fda409d7b16bd2e311305a77edaa0da7695c3c5f8ab8c7d8ff3" as const;

interface D735RunEvidenceV1 {
	readonly profileDigest: string;
	readonly routeAdmissionDigest: string;
	readonly preflightEvidence: unknown;
	readonly adapterProvenance: unknown;
	readonly graphEvidence: unknown;
	readonly routeGraphEvidence: unknown;
}

export interface D735ProviderCapablePreLiveBundleV1 {
	readonly schemaVersion: typeof D735_BUNDLE_SCHEMA;
	readonly runs: readonly [D735RunEvidenceV1, D735RunEvidenceV1];
	readonly qualification: Readonly<Record<string, StrictJsonValue>>;
	readonly generation: Readonly<Record<string, StrictJsonValue>>;
	readonly bundleDigest: string;
}

const constructedBundles = new WeakSet<object>();

function validateHistoricalD734(bytesValue: unknown): D734RouteProfileIntegrationPreLiveBundleV1 {
	if (
		!(bytesValue instanceof Uint8Array) ||
		bytesValue.byteLength < 1 ||
		bytesValue.byteLength > 4_194_304
	)
		throw new TypeError("D735 historical D734 bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	literal(empiricalSha256(bytes), D735_D734_ARTIFACT_SHA256, "d735.historicalD734.sha256");
	const historical = validateD734RouteProfileIntegrationPreLiveBundle(
		strictJsonCodec.decode(bytes),
	);
	literal(historical.schemaVersion, D734_BUNDLE_SCHEMA, "d735.historicalD734.schema");
	literal(historical.bundleDigest, D735_D734_BUNDLE_DIGEST, "d735.historicalD734.bundleDigest");
	return historical;
}

function stageDigests(seed: string): readonly string[] {
	return Object.freeze(
		D735_PREFLIGHT_STAGES.map((stage, sequence) =>
			empiricalStrictJsonDigest({ stage, sequence, seed }),
		),
	);
}

async function executeRun(input: {
	readonly profile: D733GraphNativeRouteProfileV1;
	readonly admission: D733GraphNativeRouteAdmissionV1;
	readonly sourceDigest: string;
}): Promise<D735RunEvidenceV1> {
	const admittedProfile = readD733AdmittedRouteProfile(input.admission);
	literal(admittedProfile.profileDigest, input.profile.profileDigest, "d735.run.profile");
	const fixture = createD734InjectedRouteProfileFixture({
		profile: input.profile,
		routeAdmission: input.admission,
	});
	const adapter = createD735ProviderCapableRouteAdapter({
		routeAdmission: input.admission,
		baseAdapter: fixture.adapter,
		adapterSourceDigest: input.sourceDigest,
		executionClass: "injected-no-network",
	});
	const preflight = createD735SimulatedLivePreflight({
		routeAdmission: input.admission,
		stageEvidenceDigests: stageDigests(input.sourceDigest),
	});
	const result = await runD735ProviderCapableSixArmPreflight({
		sourceDigest: input.sourceDigest,
		adapter,
		preflight,
		signal: new AbortController().signal,
	});
	if (
		result.integration.run.graphEvidence.ledger.completedArms.length !== 6 ||
		fixture.maxActiveInvocations() !== 1 ||
		fixture.activeWorkspaceCount() !== 0 ||
		fixture.networkCalls() !== 0
	)
		throw new TypeError("D735 injected six-arm operational boundary failed");
	return strictSnapshot({
		profileDigest: input.profile.profileDigest,
		routeAdmissionDigest: input.admission.admissionDigest,
		preflightEvidence: result.preflightEvidence,
		adapterProvenance: result.adapterProvenance,
		graphEvidence: result.integration.run.graphEvidence,
		routeGraphEvidence: result.integration.routeEvidence,
	});
}

function validateRun(value: unknown, expectedProfileDigest: string): D735RunEvidenceV1 {
	const candidate = record(value, "d735.runEvidence");
	exactKeys(
		candidate,
		[
			"adapterProvenance",
			"graphEvidence",
			"preflightEvidence",
			"profileDigest",
			"routeAdmissionDigest",
			"routeGraphEvidence",
		],
		"d735.runEvidence",
	);
	literal(candidate.profileDigest, expectedProfileDigest, "d735.runEvidence.profile");
	digest(candidate.routeAdmissionDigest, "d735.runEvidence.admission");
	const preflight = validateD735PreflightGraphEvidence(candidate.preflightEvidence);
	const provenance = validateD735AdapterProvenance(candidate.adapterProvenance);
	literal(
		preflight.facts[0]?.routeAdmissionDigest,
		candidate.routeAdmissionDigest as string,
		"d735.runEvidence.preflightAdmission",
	);
	literal(
		provenance.admissionDigest,
		candidate.routeAdmissionDigest as string,
		"d735.runEvidence.adapterAdmission",
	);
	const graph = record(candidate.graphEvidence, "d735.runEvidence.graph");
	const canonicalGraph = deriveD722CanonicalGraphEvidence(
		graph.ledger,
		array(graph.effectRuns, "d735.runEvidence.graph.effectRuns") as never,
		createD726ArmLocalTerminalProviderPolicy(),
	);
	literal(graph.evidenceDigest, canonicalGraph.evidenceDigest, "d735.runEvidence.graph.digest");
	literal(
		empiricalStrictJsonDigest(graph),
		empiricalStrictJsonDigest(canonicalGraph),
		"d735.runEvidence.graph.canonical",
	);
	const completed = canonicalGraph.ledger.completedArms;
	if (completed.length !== 6) throw new TypeError("D735 run did not complete six Graph arms");
	literal(canonicalGraph.runStatus, "complete", "d735.runEvidence.graph.status");
	const retryReasons = new Set(
		canonicalGraph.effectRuns.flatMap((run) =>
			run.facts.flatMap((fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.status === "retryable-failure"
					? [fact.result.failureDiscriminator]
					: [],
			),
		),
	);
	for (const required of [
		"d671-rate-limit-exceeded",
		"d675-und-err-socket",
		"d710-untyped-http-429",
	] as const)
		if (!retryReasons.has(required)) throw new TypeError(`D735 retry coverage omitted ${required}`);
	const route = record(candidate.routeGraphEvidence, "d735.runEvidence.routeGraph");
	digest(route.evidenceDigest, "d735.runEvidence.routeGraph.digest");
	return strictSnapshot({
		...candidate,
		graphEvidence: canonicalGraph,
	}) as unknown as D735RunEvidenceV1;
}

function createFailureAdapter(
	classification:
		| "terminal-http"
		| "response-decode-failure"
		| "transport-failure"
		| "route-evidence-failure",
) {
	const workspaces = new Set<number>();
	let providerCalls = 0;
	const evidence = (label: string) => empiricalStrictJsonDigest({ classification, label });
	const adapter = createD726ProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			workspaces.add(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization" as const,
					status: "ready" as const,
					workspaceStateDigest: evidence(`workspace-${effectRequest.runSequence}`),
					evidenceDigest: evidence(`materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest({ effectRequest, signal }) {
			providerCalls += 1;
			if (classification !== "terminal-http")
				return createD726ExecutorFailureProviderTurn({
					classification,
					evidenceDigest: evidence(`provider-${effectRequest.requestDigest}`),
				});
			return createD726ProviderTurn(
				await invokeD725OpenRouterGraphTurn({
					effectRequest,
					credential: {
						bearerToken: "not-a-live-d735-injected-credential",
						credentialBindingRef: "d735.injected-no-network",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request() {
							return {
								status: 400,
								retryAfterMs: null,
								retryAfterDisposition: "absent" as const,
								body: new TextEncoder().encode(
									JSON.stringify({ error: { code: "invalid_request" } }),
								),
							};
						},
					},
					taskStatement: "D735 injected terminal HTTP qualification",
					conversation: { messages: [] },
					signal: signal ?? new AbortController().signal,
					monotonicNowMs: () => providerCalls,
				}),
			);
		},
		async retryWait() {
			throw new TypeError("D735 terminal failure cannot retry");
		},
		async toolAction() {
			throw new TypeError("D735 terminal failure cannot execute tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D735 terminal failure cannot verify");
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: evidence(`cleanup-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return { adapter, workspaces, providerCalls: () => providerCalls };
}

async function failureCoverage() {
	const cases = [];
	for (const classification of [
		"terminal-http",
		"response-decode-failure",
		"transport-failure",
		"route-evidence-failure",
	] as const) {
		const fixture = createFailureAdapter(classification);
		const bundle = await runD727InjectedNoNetworkQualification({
			adapter: fixture.adapter,
			signal: new AbortController().signal,
		});
		const executorFacts = bundle.executorFailureFacts;
		const terminalFacts = bundle.terminalHttpGraphEvidence.facts;
		const providerCalls = fixture.providerCalls();
		if (
			fixture.workspaces.size !== 0 ||
			providerCalls < 1 ||
			providerCalls > 6 ||
			bundle.cleanupFacts.length !== 6
		)
			throw new TypeError(
				`D735 injected failure cleanup coverage failed:${classification}:${fixture.workspaces.size}:${providerCalls}:${bundle.cleanupFacts.length}`,
			);
		if (
			classification === "terminal-http"
				? terminalFacts.length !== providerCalls ||
					executorFacts.some((fact) => fact.classification !== "graph-admission-denied")
				: terminalFacts.length !== 0 ||
					executorFacts.filter((fact) => fact.classification === classification).length !==
						providerCalls ||
					executorFacts.some(
						(fact) =>
							fact.classification !== classification &&
							fact.classification !== "graph-admission-denied",
					)
		)
			throw new TypeError(`D735 ${classification} provenance coverage failed`);
		const material = strictSnapshot({
			classification: validateD735FailureClassification(classification),
			graphAdmitted: true,
			partialFailureOnly: true,
			cleanupRequired: true,
			graphEvidenceDigest: bundle.graphEvidence.evidenceDigest,
			provenanceEvidenceDigest:
				classification === "terminal-http"
					? bundle.terminalHttpGraphEvidence.evidenceDigest
					: empiricalStrictJsonDigest(bundle.executorFailureFacts),
		});
		cases.push(
			strictSnapshot({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) }),
		);
	}
	return Object.freeze(cases);
}

function validateFailureCoverage(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	const values = array(value, "d735.failureCoverage");
	if (values.length !== 4) throw new TypeError("D735 failure coverage is incomplete");
	const expected = [
		"terminal-http",
		"response-decode-failure",
		"transport-failure",
		"route-evidence-failure",
	] as const;
	return Object.freeze(
		values.map((value, index) => {
			const candidate = record(value, `d735.failureCoverage[${index}]`);
			exactKeys(
				candidate,
				[
					"classification",
					"cleanupRequired",
					"evidenceDigest",
					"graphAdmitted",
					"graphEvidenceDigest",
					"partialFailureOnly",
					"provenanceEvidenceDigest",
				],
				`d735.failureCoverage[${index}]`,
			);
			literal(candidate.classification, expected[index], `d735.failureCoverage[${index}].class`);
			literal(candidate.graphAdmitted, true, `d735.failureCoverage[${index}].admitted`);
			literal(candidate.partialFailureOnly, true, `d735.failureCoverage[${index}].partial`);
			literal(candidate.cleanupRequired, true, `d735.failureCoverage[${index}].cleanup`);
			digest(candidate.evidenceDigest, `d735.failureCoverage[${index}].digest`);
			digest(candidate.graphEvidenceDigest, `d735.failureCoverage[${index}].graphDigest`);
			digest(candidate.provenanceEvidenceDigest, `d735.failureCoverage[${index}].provenanceDigest`);
			const evidenceDigest = candidate.evidenceDigest;
			const { evidenceDigest: _evidenceDigest, ...material } = candidate;
			literal(
				evidenceDigest,
				empiricalStrictJsonDigest(material),
				`d735.failureCoverage[${index}].digest`,
			);
			return strictSnapshot(candidate);
		}),
	);
}

export async function runD735InjectedNoNetworkQualification(inputValue: {
	readonly primaryProfile: D733GraphNativeRouteProfileV1;
	readonly primaryAdmission: D733GraphNativeRouteAdmissionV1;
	readonly alternateProfile: D733GraphNativeRouteProfileV1;
	readonly alternateAdmission: D733GraphNativeRouteAdmissionV1;
	readonly historicalD734BundleBytes: Uint8Array;
	readonly implementationAttestation: D735ImplementationAttestationV1;
}): Promise<D735ProviderCapablePreLiveBundleV1> {
	const input = record(inputValue, "d735.qualification.input");
	exactKeys(
		input,
		[
			"alternateAdmission",
			"alternateProfile",
			"historicalD734BundleBytes",
			"implementationAttestation",
			"primaryAdmission",
			"primaryProfile",
		],
		"d735.qualification.input",
	);
	validateHistoricalD734(input.historicalD734BundleBytes);
	const primary = validateD733GraphNativeRouteProfile(input.primaryProfile);
	const alternate = validateD733GraphNativeRouteProfile(input.alternateProfile);
	literal(primary.profileDigest, D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST, "d735.primary");
	if (primary.profileDigest === alternate.profileDigest)
		throw new TypeError("D735 alternate profile must be independent");
	const implementationManifestDigest = consumeD735ImplementationAttestation(
		input.implementationAttestation,
	);
	const runs = Object.freeze([
		await executeRun({
			profile: primary,
			admission: input.primaryAdmission as D733GraphNativeRouteAdmissionV1,
			sourceDigest: implementationManifestDigest,
		}),
		await executeRun({
			profile: alternate,
			admission: input.alternateAdmission as D733GraphNativeRouteAdmissionV1,
			sourceDigest: implementationManifestDigest,
		}),
	]) as readonly [D735RunEvidenceV1, D735RunEvidenceV1];
	const failures = await failureCoverage();
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D735_QUALIFICATION_SCHEMA,
		decisionRef: D735_DECISION_REF,
		decisionRevision: D735_DECISION_REVISION,
		executionClass: "injected-no-network",
		historicalD734ArtifactSha256: D735_D734_ARTIFACT_SHA256,
		historicalD734BundleDigest: D735_D734_BUNDLE_DIGEST,
		d734ImplementationManifestDigest: D735_FROZEN_D734_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest,
		runDigests: runs.map(empiricalStrictJsonDigest),
		profileDigests: runs.map((run) => run.profileDigest),
		failureCoverage: failures,
		completedGraphArms: 12,
		providerCalls: 0,
		networkCalls: 0,
		causalAttribution: "undetermined",
		efficacyClaim: "none",
		qualified: true,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D735_GENERATION_SCHEMA,
		generationRef: D735_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		implementationManifestDigest,
		runDigests: qualification.runDigests,
		disposition: "qualified-no-network",
		causalAttribution: "undetermined",
		efficacyClaim: "none",
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D735_BUNDLE_SCHEMA,
		runs,
		qualification,
		generation,
	});
	const bundle = strictSnapshot({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D735ProviderCapablePreLiveBundleV1;
	validateD735ProviderCapablePreLiveBundle(bundle);
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD735ProviderCapablePreLiveBundle(
	value: unknown,
): D735ProviderCapablePreLiveBundleV1 {
	const candidate = record(value, "d735.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "qualification", "runs", "schemaVersion"],
		"d735.bundle",
	);
	literal(candidate.schemaVersion, D735_BUNDLE_SCHEMA, "d735.bundle.schema");
	const values = array(candidate.runs, "d735.bundle.runs");
	if (values.length !== 2) throw new TypeError("D735 requires two profile runs");
	const qualification = record(candidate.qualification, "d735.bundle.qualification");
	const generation = record(candidate.generation, "d735.bundle.generation");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"completedGraphArms",
			"d734ImplementationManifestDigest",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executionClass",
			"failureCoverage",
			"historicalD734ArtifactSha256",
			"historicalD734BundleDigest",
			"implementationManifestDigest",
			"networkCalls",
			"profileDigests",
			"providerCalls",
			"qualificationDigest",
			"qualified",
			"runDigests",
			"schemaVersion",
		],
		"d735.bundle.qualification",
	);
	exactKeys(
		generation,
		[
			"causalAttribution",
			"disposition",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"qualificationDigest",
			"runDigests",
			"schemaVersion",
		],
		"d735.bundle.generation",
	);
	literal(qualification.schemaVersion, D735_QUALIFICATION_SCHEMA, "d735.qualification.schema");
	literal(generation.schemaVersion, D735_GENERATION_SCHEMA, "d735.generation.schema");
	literal(qualification.qualified, true, "d735.qualification.qualified");
	literal(qualification.providerCalls, 0, "d735.qualification.providerCalls");
	literal(qualification.networkCalls, 0, "d735.qualification.networkCalls");
	literal(qualification.causalAttribution, "undetermined", "d735.qualification.attribution");
	literal(qualification.efficacyClaim, "none", "d735.qualification.efficacy");
	literal(qualification.decisionRef, D735_DECISION_REF, "d735.qualification.decisionRef");
	literal(
		qualification.decisionRevision,
		D735_DECISION_REVISION,
		"d735.qualification.decisionRevision",
	);
	literal(
		qualification.historicalD734ArtifactSha256,
		D735_D734_ARTIFACT_SHA256,
		"d735.qualification.historicalArtifact",
	);
	literal(
		qualification.historicalD734BundleDigest,
		D735_D734_BUNDLE_DIGEST,
		"d735.qualification.historicalBundle",
	);
	literal(
		qualification.d734ImplementationManifestDigest,
		D735_FROZEN_D734_IMPLEMENTATION_MANIFEST_DIGEST,
		"d735.qualification.d734Implementation",
	);
	digest(qualification.implementationManifestDigest, "d735.qualification.implementation");
	literal(qualification.completedGraphArms, 12, "d735.qualification.completedGraphArms");
	validateFailureCoverage(qualification.failureCoverage);
	const runDigests = array(qualification.runDigests, "d735.qualification.runDigests");
	const profileDigests = array(qualification.profileDigests, "d735.qualification.profileDigests");
	if (runDigests.length !== 2) throw new TypeError("D735 qualification run coverage drifted");
	if (profileDigests.length !== 2)
		throw new TypeError("D735 qualification profile coverage drifted");
	literal(profileDigests[0], D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST, "d735.primaryProfile");
	if (profileDigests[0] === profileDigests[1])
		throw new TypeError("D735 qualification profiles are not independent");
	for (const [index, run] of values.entries()) {
		validateRun(run, digest(profileDigests[index], `d735.profile[${index}]`));
		literal(runDigests[index], empiricalStrictJsonDigest(run), `d735.qualification.run[${index}]`);
	}
	const qualificationDigest = digest(
		qualification.qualificationDigest,
		"d735.qualification.digest",
	);
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d735.qualification.digest",
	);
	literal(generation.qualificationDigest, qualificationDigest, "d735.generation.qualification");
	literal(generation.generationRef, D735_GENERATION_REF, "d735.generation.ref");
	literal(generation.disposition, "qualified-no-network", "d735.generation.disposition");
	literal(generation.causalAttribution, "undetermined", "d735.generation.attribution");
	literal(generation.efficacyClaim, "none", "d735.generation.efficacy");
	literal(
		generation.implementationManifestDigest,
		digest(qualification.implementationManifestDigest, "d735.qualification.implementation"),
		"d735.generation.implementation",
	);
	if (
		!sameBytes(
			strictJsonCodec.encode(generation.runDigests as StrictJsonValue),
			strictJsonCodec.encode(qualification.runDigests as StrictJsonValue),
		)
	)
		throw new TypeError("D735 generation run binding drifted");
	const generationDigest = digest(generation.generationDigest, "d735.generation.digest");
	const { generationDigest: _generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d735.generation.digest",
	);
	const bundleDigest = digest(candidate.bundleDigest, "d735.bundle.digest");
	const material = strictSnapshot({
		schemaVersion: D735_BUNDLE_SCHEMA,
		runs: values,
		qualification,
		generation,
	});
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d735.bundle.digest");
	return strictSnapshot({
		...material,
		bundleDigest,
	}) as unknown as D735ProviderCapablePreLiveBundleV1;
}

async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
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
			throw new TypeError("D735 artifact identity is invalid");
	} finally {
		await handle.close();
	}
}

export async function persistD735ProviderCapablePreLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D735ProviderCapablePreLiveBundleV1;
	readonly disposition?: "qualified" | "partial-failure";
}) {
	const input = record(inputValue, "d735.persist");
	exactKeys(
		input,
		["bundle", "privateRoot", ...(Object.hasOwn(input, "disposition") ? ["disposition"] : [])],
		"d735.persist",
	);
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D735 persistence requires the exact constructed bundle");
	const bundle = validateD735ProviderCapablePreLiveBundle(input.bundle);
	const disposition = Object.hasOwn(input, "disposition") ? input.disposition : "qualified";
	if (disposition !== "qualified" && disposition !== "partial-failure")
		throw new TypeError("D735 persistence disposition is invalid");
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D735 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D735 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D735 private root ownership is invalid");
	const finalRoot = join(privateRoot, `${D735_GENERATION_REF}-${disposition}`);
	let owned: { dev: number; ino: number } | null = null;
	try {
		await mkdir(finalRoot, { recursive: false, mode: 0o700 });
		const claimed = await lstat(finalRoot);
		if (!claimed.isDirectory() || claimed.isSymbolicLink() || (claimed.mode & 0o777) !== 0o700)
			throw new TypeError("D735 generation claim is invalid");
		owned = { dev: claimed.dev, ino: claimed.ino };
		const staging = join(finalRoot, `.d735-staging-${randomUUID()}`);
		await mkdir(staging, { recursive: false, mode: 0o700 });
		const artifacts = [
			["runs.v1.json", bundle.runs],
			["qualification.v1.json", bundle.qualification],
			["generation.v1.json", bundle.generation],
			["bundle.v1.json", bundle],
		] as const;
		for (const [name, value] of artifacts)
			await writeFile(join(staging, name), strictJsonCodec.encode(value as StrictJsonValue));
		const stagingHandle = await open(
			staging,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(staging, artifactsRoot);
		const finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await finalHandle.sync();
		} finally {
			await finalHandle.close();
		}
		for (const [name, value] of artifacts) {
			const expected = strictJsonCodec.encode(value as StrictJsonValue);
			const reader = await open(
				join(artifactsRoot, name),
				constants.O_RDONLY | constants.O_NOFOLLOW,
			);
			try {
				const stat = await reader.stat();
				if (
					!stat.isFile() ||
					(stat.mode & 0o777) !== 0o600 ||
					stat.nlink !== 1 ||
					!sameBytes(new Uint8Array(await reader.readFile()), expected)
				)
					throw new TypeError("D735 artifact readback drifted");
			} finally {
				await reader.close();
			}
		}
		const parentHandle = await open(
			privateRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await parentHandle.sync();
		} finally {
			await parentHandle.close();
		}
		return Object.freeze({
			generationRef: D735_GENERATION_REF,
			disposition,
			bundleDigest: bundle.bundleDigest,
			bundleSha256: empiricalSha256(strictJsonCodec.encode(bundle as unknown as StrictJsonValue)),
		});
	} catch (error) {
		if (owned !== null) {
			const current = await lstat(finalRoot).catch(() => null);
			if (
				current?.isDirectory() &&
				!current.isSymbolicLink() &&
				current.dev === owned.dev &&
				current.ino === owned.ino
			)
				await rm(finalRoot, { recursive: true, force: true });
		}
		throw error;
	}
}

const D735_FROZEN_D734_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:2904159b917f2e677f0357f034b30bec9e9fca207dfca8ca891010b9c508a5a3" as const;
