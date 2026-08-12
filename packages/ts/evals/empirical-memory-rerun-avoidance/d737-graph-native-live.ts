import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StrictJsonValue } from "../../src/json/codec.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD737GraphObjectivePhaseRecoveryPolicy,
} from "./d722-graph-native-effect-runtime.js";
import { validateD724TerminalHttpGraphEvidence } from "./d724-terminal-http-evidence.js";
import {
	type D734RouteBoundProviderAdapterV1,
	runD734RouteProfileSixArmLiveIntegration,
	validateD734RouteGraphEvidence,
} from "./d734-route-profile-provider-integration.js";
import { validateD736LiveBundle } from "./d736-graph-native-live.js";
import {
	D737_COORDINATES_DIGEST,
	D737_D736_PARTIAL_ARTIFACT_SHA256,
	D737_D736_PARTIAL_BUNDLE_DIGEST,
	D737_D736_PARTIAL_GENERATION_DIGEST,
	D737_DECISION_REF,
	D737_DECISION_REVISION,
	D737_GENERATION_REF,
	D737_ROUTE_PROFILE,
	D737_ROUTE_PROFILE_DIGEST,
} from "./d737-coordinates.js";
import {
	consumeD737ExecutionAuthority,
	type D737ExecutionAuthorityV1,
} from "./d737-single-use-dispatch-claim.js";

export const D737_QUALIFICATION_SCHEMA = "graphrefly.b112.d737.live-qualification.v1" as const;
export const D737_OBSERVATION_SCHEMA = "graphrefly.b112.d737.live-observation.v1" as const;
export const D737_GENERATION_SCHEMA = "graphrefly.b112.d737.success-generation.v1" as const;
export const D737_PARTIAL_SCHEMA = "graphrefly.b112.d737.partial-failure-generation.v1" as const;
export const D737_TERMINAL_SCHEMA = "graphrefly.b112.d737.terminal-receipt.v1" as const;
export const D737_BUNDLE_SCHEMA = "graphrefly.b112.d737.live-bundle.v1" as const;

export interface D737LiveBundleV1 {
	readonly schemaVersion: typeof D737_BUNDLE_SCHEMA;
	readonly disposition: "success" | "partial-failure";
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly terminalHttpGraphEvidence: Readonly<Record<string, unknown>>;
	readonly routeEvidence: Readonly<Record<string, unknown>>;
	readonly executorFailureFacts: readonly Readonly<Record<string, unknown>>[];
	readonly cleanupFacts: readonly Readonly<Record<string, unknown>>[];
	readonly observation: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

const constructedBundles = new WeakSet<object>();

function replayGraph(value: unknown): D722CanonicalGraphEvidenceV1 {
	const candidate = record(value, "d737.graphEvidence");
	const runs = array(candidate.effectRuns, "d737.graphEvidence.effectRuns");
	if (runs.length > 12) throw new TypeError("D737 Graph run bound exceeded");
	const replay = deriveD722CanonicalGraphEvidence(
		candidate.ledger,
		runs as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
		createD737GraphObjectivePhaseRecoveryPolicy(),
	);
	literal(
		empiricalStrictJsonDigest(replay),
		empiricalStrictJsonDigest(candidate),
		"d737.graph.replay",
	);
	return replay;
}

function executorFailureFacts(graph: D722CanonicalGraphEvidenceV1) {
	return Object.freeze(
		graph.effectRuns.flatMap((run) =>
			run.facts.flatMap((fact) => {
				if (
					fact.kind !== "graph-effect-result-admitted" ||
					fact.result.effectKind !== "provider-request" ||
					fact.result.failureProvenance !== "executor-failure"
				)
					return [];
				const material = strictSnapshot({
					runSequence: run.runSequence,
					effectSequence: fact.request.effectSequence,
					requestDigest: fact.request.requestDigest,
					admissionDigest: fact.admissionDigest,
					resultDigest: fact.resultDigest,
					classification: fact.result.executorFailureClassification,
				});
				return [strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) })];
			}),
		),
	);
}

function cleanupFacts(graph: D722CanonicalGraphEvidenceV1) {
	return Object.freeze(
		graph.effectRuns.map((run) => {
			const facts = run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "cleanup",
			);
			if (facts.length !== 1 || facts[0]?.kind !== "graph-effect-result-admitted")
				throw new TypeError("D737 requires one Graph cleanup fact per arm");
			const fact = facts[0];
			return strictSnapshot({
				runSequence: run.runSequence,
				status: fact.result.status,
				requestDigest: fact.request.requestDigest,
				admissionDigest: fact.admissionDigest,
				resultDigest: fact.resultDigest,
			});
		}),
	);
}

function validateHistoricalD736Partial(bytes: Uint8Array): void {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D737 D736 partial artifact bytes are invalid");
	literal(empiricalSha256(bytes), D737_D736_PARTIAL_ARTIFACT_SHA256, "d737.d736Partial.artifact");
	const bundle = validateD736LiveBundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.disposition, "partial-failure", "d737.d736Partial.disposition");
	literal(bundle.bundleDigest, D737_D736_PARTIAL_BUNDLE_DIGEST, "d737.d736Partial.bundle");
	literal(
		bundle.generation.generationDigest,
		D737_D736_PARTIAL_GENERATION_DIGEST,
		"d737.d736Partial.generation",
	);
}

function buildBundle(
	integration: Awaited<ReturnType<typeof runD734RouteProfileSixArmLiveIntegration>>,
	input: {
		readonly claimDigest: string;
		readonly currentKeyAdmissionDigest: string;
		readonly pricingReadDigest: string;
		readonly pricingObservationDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly implementationManifestDigest: string;
		readonly providerTransportCalls: number;
	},
): D737LiveBundleV1 {
	const graphEvidence = replayGraph(integration.run.graphEvidence);
	const terminalHttpGraphEvidence = validateD724TerminalHttpGraphEvidence(
		integration.run.terminalHttpGraphEvidence,
	);
	const routeEvidence = validateD734RouteGraphEvidence(integration.routeEvidence);
	for (const fact of routeEvidence.facts)
		literal(fact.routeProfileDigest, D737_ROUTE_PROFILE_DIGEST, "d737.route.profile");
	const failures = executorFailureFacts(graphEvidence);
	const cleanups = cleanupFacts(graphEvidence);
	const providerTransportCalls = safeInteger(input.providerTransportCalls, "d737.providerCalls", {
		max: 96,
	});
	literal(providerTransportCalls, integration.run.usage.requests, "d737.providerCalls");
	const success =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		terminalHttpGraphEvidence.facts.length === 0 &&
		failures.length === 0 &&
		cleanups.every((fact) => fact.status === "succeeded");
	const disposition = success ? ("success" as const) : ("partial-failure" as const);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D737_QUALIFICATION_SCHEMA,
		decisionRef: D737_DECISION_REF,
		decisionRevision: D737_DECISION_REVISION,
		coordinatesDigest: D737_COORDINATES_DIGEST,
		d736PartialArtifactSha256: D737_D736_PARTIAL_ARTIFACT_SHA256,
		d736PartialBundleDigest: D737_D736_PARTIAL_BUNDLE_DIGEST,
		d736PartialGenerationDigest: D737_D736_PARTIAL_GENERATION_DIGEST,
		implementationManifestDigest: digest(input.implementationManifestDigest, "d737.implementation"),
		routeProfileDigest: D737_ROUTE_PROFILE_DIGEST,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: terminalHttpGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		claimDigest: digest(input.claimDigest, "d737.claim"),
		currentKeyAdmissionDigest: digest(input.currentKeyAdmissionDigest, "d737.currentKey"),
		pricingReadDigest: digest(input.pricingReadDigest, "d737.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d737.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d737.zeroByok"),
		providerTransportCalls,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const observationMaterial = strictSnapshot({
		schemaVersion: D737_OBSERVATION_SCHEMA,
		disposition,
		model: D737_ROUTE_PROFILE.requestModel,
		selectedEndpointModel: D737_ROUTE_PROFILE.selectedEndpointModel,
		provider: D737_ROUTE_PROFILE.providerName,
		providerTag: D737_ROUTE_PROFILE.providerTag,
		quantization: D737_ROUTE_PROFILE.quantization,
		endpointProtocol: D737_ROUTE_PROFILE.endpointProtocol,
		reasoningEffort: D737_ROUTE_PROFILE.reasoningEffort,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: terminalHttpGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		graphRunStatus: graphEvidence.runStatus,
		completedArms: graphEvidence.ledger.completedArms,
		findings: graphEvidence.ledger.findings,
		usage: integration.run.usage,
		providerTransportCalls,
		fallbackUsed: false,
		providerSwitchUsed: false,
		routeSwitchUsed: false,
		parallelOrBackgroundCalls: false,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const observation = strictSnapshot({
		...observationMaterial,
		observationDigest: empiricalStrictJsonDigest(observationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: success ? D737_GENERATION_SCHEMA : D737_PARTIAL_SCHEMA,
		generationRef: D737_GENERATION_REF,
		disposition,
		qualificationDigest: qualification.qualificationDigest,
		observationDigest: observation.observationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: terminalHttpGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		claimDigest: input.claimDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const terminalMaterial = strictSnapshot({
		schemaVersion: D737_TERMINAL_SCHEMA,
		status: disposition,
		claimDigest: input.claimDigest,
		currentKeyAdmissionDigest: input.currentKeyAdmissionDigest,
		pricingReadDigest: input.pricingReadDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: terminalHttpGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		providerTransportCalls,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const terminalReceipt = strictSnapshot({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D737_BUNDLE_SCHEMA,
		disposition,
		qualification,
		graphEvidence,
		terminalHttpGraphEvidence,
		routeEvidence,
		executorFailureFacts: failures,
		cleanupFacts: cleanups,
		observation,
		generation,
		terminalReceipt,
	});
	const bundle = strictSnapshot({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructedBundles.add(bundle);
	return bundle as unknown as D737LiveBundleV1;
}

export async function runD737LiveReplacement(inputValue: {
	readonly d736PartialBundleBytes: Uint8Array;
	readonly implementationManifestDigest: string;
	readonly adapter: D734RouteBoundProviderAdapterV1;
	readonly executionAuthority: D737ExecutionAuthorityV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D737LiveBundleV1> {
	const input = record(inputValue, "d737.run");
	exactKeys(
		input,
		[
			"adapter",
			"d736PartialBundleBytes",
			"executionAuthority",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"providerTransportCalls",
			"signal",
		],
		"d737.run",
	);
	validateHistoricalD736Partial(input.d736PartialBundleBytes as Uint8Array);
	const authority = consumeD737ExecutionAuthority(input.executionAuthority);
	const pricingReadDigest = digest(input.pricingReadDigest, "d737.run.pricingReadDigest");
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"d737.run.implementationManifestDigest",
	);
	literal(
		authority.claim.d736PartialBundleDigest,
		D737_D736_PARTIAL_BUNDLE_DIGEST,
		"d737.authority.d736Partial",
	);
	literal(authority.claim.routeProfileDigest, D737_ROUTE_PROFILE_DIGEST, "d737.authority.route");
	literal(authority.claim.pricingReadDigest, pricingReadDigest, "d737.authority.pricing");
	literal(
		authority.claim.implementationManifestDigest,
		implementationManifestDigest,
		"d737.authority.implementation",
	);
	if (typeof input.providerTransportCalls !== "function")
		throw new TypeError("D737 provider call counter is invalid");
	const integration = await runD734RouteProfileSixArmLiveIntegration({
		sourceDigest: empiricalStrictJsonDigest({
			decisionRef: D737_DECISION_REF,
			coordinatesDigest: D737_COORDINATES_DIGEST,
			claimDigest: authority.claim.claimDigest,
			implementationManifestDigest,
		}),
		adapter: input.adapter as D734RouteBoundProviderAdapterV1,
		objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
		signal: input.signal as AbortSignal,
	});
	return buildBundle(integration, {
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		pricingReadDigest,
		pricingObservationDigest: input.pricingObservationDigest as string,
		zeroByokObservationDigest: authority.claim.zeroByokObservationDigest,
		implementationManifestDigest,
		providerTransportCalls: (input.providerTransportCalls as () => number)(),
	});
}

export async function runD737InjectedNoNetworkQualification(inputValue: {
	readonly d736PartialBundleBytes: Uint8Array;
	readonly implementationManifestDigest: string;
	readonly adapter: D734RouteBoundProviderAdapterV1;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D737LiveBundleV1> {
	const input = record(inputValue, "d737.injectedRun");
	exactKeys(
		input,
		[
			"adapter",
			"d736PartialBundleBytes",
			"implementationManifestDigest",
			"providerTransportCalls",
			"signal",
		],
		"d737.injectedRun",
	);
	validateHistoricalD736Partial(input.d736PartialBundleBytes as Uint8Array);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"d737.injectedRun.implementation",
	);
	if (typeof input.providerTransportCalls !== "function")
		throw new TypeError("D737 injected provider call counter is invalid");
	const integration = await runD734RouteProfileSixArmLiveIntegration({
		sourceDigest: empiricalStrictJsonDigest({
			decisionRef: D737_DECISION_REF,
			executionClass: "injected-no-network",
			implementationManifestDigest,
		}),
		adapter: input.adapter as D734RouteBoundProviderAdapterV1,
		objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
		signal: input.signal as AbortSignal,
	});
	return buildBundle(integration, {
		claimDigest: empiricalStrictJsonDigest({ d737: "injected-claim" }),
		currentKeyAdmissionDigest: empiricalStrictJsonDigest({ d737: "injected-current-key" }),
		pricingReadDigest: empiricalStrictJsonDigest({ d737: "injected-pricing-read" }),
		pricingObservationDigest: empiricalStrictJsonDigest({ d737: "injected-pricing-observation" }),
		zeroByokObservationDigest: empiricalStrictJsonDigest({ d737: "injected-zero-byok" }),
		implementationManifestDigest,
		providerTransportCalls: (input.providerTransportCalls as () => number)(),
	});
}

export function validateD737LiveBundle(value: unknown): D737LiveBundleV1 {
	const candidate = record(value, "d737.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"cleanupFacts",
			"disposition",
			"executorFailureFacts",
			"generation",
			"graphEvidence",
			"observation",
			"qualification",
			"routeEvidence",
			"schemaVersion",
			"terminalHttpGraphEvidence",
			"terminalReceipt",
		],
		"d737.bundle",
	);
	literal(candidate.schemaVersion, D737_BUNDLE_SCHEMA, "d737.bundle.schema");
	const graph = replayGraph(candidate.graphEvidence);
	const terminal = validateD724TerminalHttpGraphEvidence(candidate.terminalHttpGraphEvidence);
	const route = validateD734RouteGraphEvidence(candidate.routeEvidence);
	const failures = executorFailureFacts(graph);
	const cleanups = cleanupFacts(graph);
	literal(
		empiricalStrictJsonDigest(candidate.executorFailureFacts),
		empiricalStrictJsonDigest(failures),
		"d737.failures",
	);
	literal(
		empiricalStrictJsonDigest(candidate.cleanupFacts),
		empiricalStrictJsonDigest(cleanups),
		"d737.cleanups",
	);
	const expectedDisposition =
		graph.runStatus === "complete" &&
		graph.ledger.completedArms.length === 6 &&
		terminal.facts.length === 0 &&
		failures.length === 0 &&
		cleanups.every((fact) => fact.status === "succeeded")
			? "success"
			: "partial-failure";
	literal(
		oneOf(candidate.disposition, ["success", "partial-failure"], "d737.disposition"),
		expectedDisposition,
		"d737.disposition",
	);
	const qualification = record(candidate.qualification, "d737.qualification");
	const observation = record(candidate.observation, "d737.observation");
	const generation = record(candidate.generation, "d737.generation");
	const terminalReceipt = record(candidate.terminalReceipt, "d737.terminalReceipt");
	for (const [object, key, path] of [
		[qualification, "qualificationDigest", "d737.qualification"],
		[observation, "observationDigest", "d737.observation"],
		[generation, "generationDigest", "d737.generation"],
		[terminalReceipt, "terminalReceiptDigest", "d737.terminalReceipt"],
	] as const) {
		const expected = digest(object[key], `${path}.digest`);
		const { [key]: _discarded, ...material } = object;
		literal(expected, empiricalStrictJsonDigest(material), `${path}.digest`);
	}
	literal(
		qualification.coordinatesDigest,
		D737_COORDINATES_DIGEST,
		"d737.qualification.coordinates",
	);
	literal(
		qualification.d736PartialArtifactSha256,
		D737_D736_PARTIAL_ARTIFACT_SHA256,
		"d737.qualification.d736PartialArtifact",
	);
	literal(
		qualification.d736PartialBundleDigest,
		D737_D736_PARTIAL_BUNDLE_DIGEST,
		"d737.qualification.d736PartialBundle",
	);
	literal(
		qualification.d736PartialGenerationDigest,
		D737_D736_PARTIAL_GENERATION_DIGEST,
		"d737.qualification.d736PartialGeneration",
	);
	literal(qualification.routeProfileDigest, D737_ROUTE_PROFILE_DIGEST, "d737.qualification.route");
	literal(qualification.graphEvidenceDigest, graph.evidenceDigest, "d737.qualification.graph");
	literal(
		qualification.routeEvidenceDigest,
		route.evidenceDigest,
		"d737.qualification.routeEvidence",
	);
	literal(
		qualification.terminalHttpGraphEvidenceDigest,
		terminal.evidenceDigest,
		"d737.qualification.terminal",
	);
	literal(observation.graphEvidenceDigest, graph.evidenceDigest, "d737.observation.graph");
	literal(observation.routeEvidenceDigest, route.evidenceDigest, "d737.observation.route");
	literal(
		digest(generation.observationDigest, "d737.generation.observationDigest"),
		digest(observation.observationDigest, "d737.observation.observationDigest"),
		"d737.generation.observation",
	);
	literal(terminalReceipt.graphEvidenceDigest, graph.evidenceDigest, "d737.terminal.graph");
	for (const object of [qualification, observation, generation, terminalReceipt]) {
		literal(object.causalAttribution, "undetermined", "d737.attribution");
		literal(object.efficacyClaim, "none", "d737.efficacy");
	}
	const bundleDigest = digest(candidate.bundleDigest, "d737.bundle.digest");
	const { bundleDigest: _bundleDigest, ...material } = candidate;
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d737.bundle.digest");
	return strictSnapshot(candidate) as unknown as D737LiveBundleV1;
}

interface Identity {
	readonly dev: number;
	readonly ino: number;
}

async function assertDirectory(path: string, identity: Identity): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D737 persistence directory identity drifted");
}

async function writeArtifact(path: string, bytes: Uint8Array): Promise<Identity> {
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
			throw new TypeError("D737 persistence file identity drifted");
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertArtifact(path: string, identity: Identity, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("D737 persistence file readback drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD737LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D737LiveBundleV1;
}) {
	const input = record(inputValue, "d737.persist");
	exactKeys(input, ["bundle", "privateRoot"], "d737.persist");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D737 persistence requires the exact constructed bundle");
	const bundle = validateD737LiveBundle(input.bundle);
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D737 persistence root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	const parent = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	const parentStat = await parent.stat();
	if (!parentStat.isDirectory() || (parentStat.mode & 0o777) !== 0o700)
		throw new TypeError("D737 persistence root is invalid");
	const finalRoot = join(privateRoot, D737_GENERATION_REF);
	let finalIdentity: Identity | null = null;
	try {
		await mkdir(finalRoot, { recursive: false, mode: 0o700 });
		const finalStat = await lstat(finalRoot);
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectory(finalRoot, finalIdentity);
		const staging = join(finalRoot, `.d737-staging-${randomUUID()}`);
		await mkdir(staging, { recursive: false, mode: 0o700 });
		const stagingStat = await lstat(staging);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectory(staging, stagingIdentity);
		const artifacts = [
			["qualification.v1.json", bundle.qualification],
			["graph-evidence.v1.json", bundle.graphEvidence],
			["terminal-http-graph-evidence.v1.json", bundle.terminalHttpGraphEvidence],
			["route-evidence.v1.json", bundle.routeEvidence],
			["executor-failure-facts.v1.json", bundle.executorFailureFacts],
			["cleanup-facts.v1.json", bundle.cleanupFacts],
			["observation.v1.json", bundle.observation],
			[
				bundle.disposition === "success"
					? "success-generation.v1.json"
					: "partial-failure-generation.v1.json",
				bundle.generation,
			],
			["terminal-receipt.v1.json", bundle.terminalReceipt],
			["bundle.v1.json", bundle],
		] as const;
		const encoded = artifacts.map(
			([name, value]) => [name, strictJsonCodec.encode(value as StrictJsonValue)] as const,
		);
		const identities = new Map<string, Identity>();
		for (const [name, bytes] of encoded)
			identities.set(name, await writeArtifact(join(staging, name), bytes));
		const stagingHandle = await open(
			staging,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of encoded)
			await assertArtifact(join(staging, name), identities.get(name)!, bytes);
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(staging, artifactsRoot);
		const artifactsStat = await lstat(artifactsRoot);
		const artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D737 persistence rename identity drifted");
		const commit = strictSnapshot({
			schemaVersion: "graphrefly.b112.d737.atomic-commit.v1",
			generationRef: D737_GENERATION_REF,
			disposition: bundle.disposition,
			bundleDigest: bundle.bundleDigest,
			terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest,
		});
		const commitBytes = strictJsonCodec.encode(commit);
		const commitIdentity = await writeArtifact(join(finalRoot, "commit.v1.json"), commitBytes);
		const finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await finalHandle.sync();
		} finally {
			await finalHandle.close();
		}
		await parent.sync();
		for (const [name, bytes] of encoded)
			await assertArtifact(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertArtifact(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		await assertDirectory(finalRoot, finalIdentity);
		await assertDirectory(artifactsRoot, artifactsIdentity);
		return Object.freeze({
			generationRef: D737_GENERATION_REF,
			disposition: bundle.disposition,
			bundleDigest: bundle.bundleDigest,
			bundleSha256: empiricalSha256(strictJsonCodec.encode(bundle as unknown as StrictJsonValue)),
		});
	} catch (error) {
		if (finalIdentity !== null) {
			const current = await lstat(finalRoot).catch(() => null);
			if (
				current?.isDirectory() &&
				!current.isSymbolicLink() &&
				current.dev === finalIdentity.dev &&
				current.ino === finalIdentity.ino
			)
				await rm(finalRoot, { recursive: true, force: true });
		}
		throw error;
	} finally {
		await parent.close();
	}
}
