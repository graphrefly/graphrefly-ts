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
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import { deriveD722CanonicalGraphEvidence } from "./d722-graph-completion-memory-insight.js";
import { createD726ArmLocalTerminalProviderPolicy } from "./d722-graph-native-effect-runtime.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST } from "./d733-coordinates.js";
import {
	type D733GraphNativeRouteAdmissionV1,
	type D733GraphNativeRouteProfileV1,
	readD733AdmittedRouteProfile,
	validateD733GraphNativeRouteProfile,
} from "./d733-graph-native-route-profile.js";
import { D733_IMPLEMENTATION_MANIFEST_DIGEST } from "./d733-implementation-manifest.js";
import {
	D733_BUNDLE_SCHEMA,
	type D733RouteProfilePreLiveBundleV1,
	validateD733RouteProfilePreLiveBundle,
} from "./d733-route-profile-pre-live.js";
import {
	consumeD734ImplementationAttestation,
	D734_IMPLEMENTATION_MANIFEST_DIGEST,
	type D734ImplementationAttestationV1,
} from "./d734-implementation-manifest.js";
import { createD734InjectedRouteProfileFixture } from "./d734-injected-route-profile-fixture.js";
import {
	D734_DECISION_REF,
	D734_DECISION_REVISION,
	type D734RouteGraphEvidenceV1,
	runD734RouteProfileSixArmIntegration,
	validateD734RouteGraphEvidence,
} from "./d734-route-profile-provider-integration.js";

export const D734_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d734.route-profile-six-arm-qualification.v1" as const;
export const D734_GENERATION_SCHEMA =
	"graphrefly.b112.d734.route-profile-six-arm-generation.v1" as const;
export const D734_BUNDLE_SCHEMA = "graphrefly.b112.d734.route-profile-six-arm-bundle.v1" as const;
export const D734_GENERATION_REF = "d734-route-profile-six-arm-pre-live-2026-08-11-v1" as const;
export const D734_D733_ARTIFACT_SHA256 =
	"sha256:69bd1a459b731415b24ffc4776334c76e7319b0eb8fcc03aeae9f3a8dbd9a363" as const;
export const D734_D733_BUNDLE_DIGEST =
	"sha256:11bab2108c88d87d41dc124c4b0edf1c8ac61f1fce6220ab19c8b14df811d4b3" as const;

interface RunEvidenceV1 {
	readonly profileDigest: string;
	readonly routeAdmissionDigest: string;
	readonly graphEvidence: ReturnType<typeof deriveD722CanonicalGraphEvidence>;
	readonly routeGraphEvidence: D734RouteGraphEvidenceV1;
	readonly providerCalls: number;
	readonly retryableProviderFacts: number;
	readonly successfulRouteFacts: number;
	readonly maxActiveInvocations: 1;
	readonly activeWorkspaceCount: 0;
	readonly networkCalls: 0;
	readonly wireBodyDigests: readonly string[];
}

export interface D734RouteProfileIntegrationPreLiveBundleV1 {
	readonly schemaVersion: typeof D734_BUNDLE_SCHEMA;
	readonly runs: readonly [RunEvidenceV1, RunEvidenceV1];
	readonly qualification: Readonly<Record<string, StrictJsonValue>>;
	readonly generation: Readonly<Record<string, StrictJsonValue>>;
	readonly bundleDigest: string;
}

const constructedBundles = new WeakSet<object>();

function validateHistoricalD733(bytesValue: unknown): D733RouteProfilePreLiveBundleV1 {
	if (
		!(bytesValue instanceof Uint8Array) ||
		bytesValue.byteLength < 1 ||
		bytesValue.byteLength > 2_097_152
	)
		throw new TypeError("D734 historical D733 bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	literal(empiricalSha256(bytes), D734_D733_ARTIFACT_SHA256, "d734.historicalD733.sha256");
	const historical = validateD733RouteProfilePreLiveBundle(strictJsonCodec.decode(bytes));
	literal(historical.schemaVersion, D733_BUNDLE_SCHEMA, "d734.historicalD733.schema");
	literal(historical.bundleDigest, D734_D733_BUNDLE_DIGEST, "d734.historicalD733.bundleDigest");
	literal(
		historical.routeProfiles[0].profileDigest,
		D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
		"d734.historicalD733.primaryProfile",
	);
	return historical;
}

function validateWireBodies(
	values: readonly Uint8Array[],
	profile: D733GraphNativeRouteProfileV1,
): readonly string[] {
	if (values.length < 6 || values.length > 96)
		throw new TypeError("D734 wire body count is outside the bound");
	return Object.freeze(
		values.map((body, index) => {
			if (!(body instanceof Uint8Array) || body.byteLength < 1 || body.byteLength > 262_144)
				throw new TypeError(`D734 wire body ${index} is outside the bound`);
			const bytes = new Uint8Array(body);
			let parsed: unknown;
			try {
				parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
			} catch (error) {
				throw new TypeError("D734 wire body is not UTF-8 JSON", { cause: error });
			}
			const value = record(parsed, `d734.wireBodies[${index}]`);
			literal(value.model, profile.requestModel, `d734.wireBodies[${index}].model`);
			const provider = record(value.provider, `d734.wireBodies[${index}].provider`);
			literal(
				empiricalStrictJsonDigest(provider.only),
				empiricalStrictJsonDigest([profile.providerTag]),
				`d734.wireBodies[${index}].provider.only`,
			);
			literal(provider.allow_fallbacks, false, `d734.wireBodies[${index}].fallbacks`);
			if (Object.hasOwn(value, "parallel_tool_calls"))
				throw new TypeError("D734 wire body contains parallel_tool_calls");
			return empiricalSha256(bytes);
		}),
	);
}

async function executeRun(
	profile: D733GraphNativeRouteProfileV1,
	admission: D733GraphNativeRouteAdmissionV1,
): Promise<RunEvidenceV1> {
	const fixture = createD734InjectedRouteProfileFixture({ profile, routeAdmission: admission });
	const result = await runD734RouteProfileSixArmIntegration({
		sourceDigest: empiricalStrictJsonDigest({ d734: "six-arm", profile: profile.profileDigest }),
		adapter: fixture.adapter,
		signal: new AbortController().signal,
	});
	if (fixture.maxActiveInvocations() !== 1 || fixture.activeWorkspaceCount() !== 0)
		throw new TypeError("D734 injected operational cleanup or seriality drifted");
	const retryableProviderFacts = result.routeEvidence.facts.filter(
		(fact) => fact.actualRouteEvidenceDigest === null,
	).length;
	const successfulRouteFacts = result.routeEvidence.facts.length - retryableProviderFacts;
	if (retryableProviderFacts !== 6 || successfulRouteFacts < 6)
		throw new TypeError("D734 injected route success/retry coverage drifted");
	const bodies = fixture.capturedWireBodies();
	if (bodies.length !== fixture.providerCalls())
		throw new TypeError("D734 injected provider/wire call coverage drifted");
	return strictSnapshot({
		profileDigest: profile.profileDigest,
		routeAdmissionDigest: admission.admissionDigest,
		graphEvidence: result.run.graphEvidence,
		routeGraphEvidence: result.routeEvidence,
		providerCalls: fixture.providerCalls(),
		retryableProviderFacts,
		successfulRouteFacts,
		maxActiveInvocations: 1 as const,
		activeWorkspaceCount: 0 as const,
		networkCalls: fixture.networkCalls(),
		wireBodyDigests: validateWireBodies(bodies, profile),
	}) as unknown as RunEvidenceV1;
}

function validateRun(value: unknown): RunEvidenceV1 {
	const candidate = record(value, "d734.runEvidence");
	exactKeys(
		candidate,
		[
			"activeWorkspaceCount",
			"graphEvidence",
			"maxActiveInvocations",
			"networkCalls",
			"profileDigest",
			"providerCalls",
			"retryableProviderFacts",
			"routeAdmissionDigest",
			"routeGraphEvidence",
			"successfulRouteFacts",
			"wireBodyDigests",
		],
		"d734.runEvidence",
	);
	const rawGraph = record(candidate.graphEvidence, "d734.runEvidence.graphEvidence");
	const graphEvidence = deriveD722CanonicalGraphEvidence(
		rawGraph.ledger,
		array(rawGraph.effectRuns, "d734.runEvidence.graphEvidence.effectRuns") as never,
		createD726ArmLocalTerminalProviderPolicy(),
	);
	literal(
		rawGraph.evidenceDigest,
		graphEvidence.evidenceDigest,
		"d734.runEvidence.graphEvidence.digest",
	);
	literal(
		empiricalStrictJsonDigest(rawGraph),
		empiricalStrictJsonDigest(graphEvidence),
		"d734.runEvidence.graphEvidence.canonical",
	);
	const routeGraphEvidence = validateD734RouteGraphEvidence(candidate.routeGraphEvidence);
	const providerFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "provider-request"
				? [fact]
				: [],
		),
	);
	const providerCalls = safeInteger(candidate.providerCalls, "d734.runEvidence.providerCalls", {
		min: 6,
		max: 96,
	});
	literal(providerCalls, providerFacts.length, "d734.runEvidence.providerFactCoverage");
	literal(providerCalls, routeGraphEvidence.facts.length, "d734.runEvidence.routeFactCoverage");
	for (const providerFact of providerFacts) {
		const matches = routeGraphEvidence.facts.filter(
			(fact) =>
				fact.effectRequestDigest === providerFact.request.requestDigest &&
				fact.effectAdmissionDigest === providerFact.admissionDigest &&
				fact.providerResultDigest === providerFact.resultDigest,
		);
		if (matches.length !== 1) throw new TypeError("D734 run route/Graph fact bijection failed");
	}
	const profileDigest = digest(candidate.profileDigest, "d734.runEvidence.profileDigest");
	const routeAdmissionDigest = digest(
		candidate.routeAdmissionDigest,
		"d734.runEvidence.routeAdmissionDigest",
	);
	const retryable = safeInteger(
		candidate.retryableProviderFacts,
		"d734.runEvidence.retryableProviderFacts",
		{ max: 96 },
	);
	literal(retryable, 6, "d734.runEvidence.retryableProviderFacts");
	const successful = safeInteger(
		candidate.successfulRouteFacts,
		"d734.runEvidence.successfulRouteFacts",
		{ min: 6, max: 96 },
	);
	literal(successful + retryable, providerCalls, "d734.runEvidence.resultPartition");
	for (const providerFact of providerFacts) {
		const routeFact = routeGraphEvidence.facts.find(
			(fact) => fact.effectAdmissionDigest === providerFact.admissionDigest,
		);
		if (routeFact === undefined) throw new TypeError("D734 route fact is missing");
		literal(routeFact.routeProfileDigest, profileDigest, "d734.runEvidence.factProfile");
		literal(routeFact.routeAdmissionDigest, routeAdmissionDigest, "d734.runEvidence.factAdmission");
		const retryableResult = providerFact.result.status === "retryable-failure";
		if (retryableResult !== (routeFact.actualRouteEvidenceDigest === null))
			throw new TypeError("D734 actual route evidence disposition drifted");
	}
	literal(candidate.maxActiveInvocations, 1, "d734.runEvidence.maxActive");
	literal(candidate.activeWorkspaceCount, 0, "d734.runEvidence.workspaces");
	literal(candidate.networkCalls, 0, "d734.runEvidence.networkCalls");
	const wireDigests = array(candidate.wireBodyDigests, "d734.runEvidence.wireBodyDigests");
	literal(wireDigests.length, providerCalls, "d734.runEvidence.wireCoverage");
	for (const [index, value] of wireDigests.entries())
		digest(value, `d734.runEvidence.wireBodyDigests[${index}]`);
	literal(graphEvidence.runStatus, "complete", "d734.runEvidence.status");
	literal(graphEvidence.ledger.completedArms.length, 6, "d734.runEvidence.completedArms");
	return strictSnapshot({
		...candidate,
		graphEvidence,
		routeGraphEvidence,
	}) as unknown as RunEvidenceV1;
}

export async function runD734InjectedNoNetworkQualification(inputValue: {
	readonly primaryProfile: D733GraphNativeRouteProfileV1;
	readonly primaryAdmission: D733GraphNativeRouteAdmissionV1;
	readonly alternateProfile: D733GraphNativeRouteProfileV1;
	readonly alternateAdmission: D733GraphNativeRouteAdmissionV1;
	readonly historicalD733BundleBytes: Uint8Array;
	readonly implementationAttestation: D734ImplementationAttestationV1;
}): Promise<D734RouteProfileIntegrationPreLiveBundleV1> {
	const input = record(inputValue, "d734.qualification.input");
	exactKeys(
		input,
		[
			"alternateAdmission",
			"alternateProfile",
			"historicalD733BundleBytes",
			"implementationAttestation",
			"primaryAdmission",
			"primaryProfile",
		],
		"d734.qualification.input",
	);
	const historical = validateHistoricalD733(input.historicalD733BundleBytes);
	const primaryAdmission = input.primaryAdmission as D733GraphNativeRouteAdmissionV1;
	const alternateAdmission = input.alternateAdmission as D733GraphNativeRouteAdmissionV1;
	const primaryProfile = readD733AdmittedRouteProfile(primaryAdmission);
	const alternateProfile = readD733AdmittedRouteProfile(alternateAdmission);
	literal(
		empiricalStrictJsonDigest(validateD733GraphNativeRouteProfile(input.primaryProfile)),
		empiricalStrictJsonDigest(primaryProfile),
		"d734.primaryProfile.admissionBinding",
	);
	literal(
		empiricalStrictJsonDigest(validateD733GraphNativeRouteProfile(input.alternateProfile)),
		empiricalStrictJsonDigest(alternateProfile),
		"d734.alternateProfile.admissionBinding",
	);
	if (primaryProfile.profileDigest === alternateProfile.profileDigest)
		throw new TypeError("D734 qualification requires two distinct profiles");
	literal(
		primaryProfile.profileDigest,
		historical.routeProfiles[0].profileDigest,
		"d734.primaryProfile",
	);
	const implementationManifestDigest = consumeD734ImplementationAttestation(
		input.implementationAttestation,
	);
	const runs = Object.freeze([
		await executeRun(primaryProfile, primaryAdmission),
		await executeRun(alternateProfile, alternateAdmission),
	]) as readonly [RunEvidenceV1, RunEvidenceV1];
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D734_QUALIFICATION_SCHEMA,
		decisionRef: D734_DECISION_REF,
		decisionRevision: D734_DECISION_REVISION,
		executionClass: "injected-no-network" as const,
		primaryProfileDigest: runs[0].profileDigest,
		alternateProfileDigest: runs[1].profileDigest,
		primaryGraphEvidenceDigest: runs[0].graphEvidence.evidenceDigest,
		alternateGraphEvidenceDigest: runs[1].graphEvidence.evidenceDigest,
		primaryRouteGraphEvidenceDigest: runs[0].routeGraphEvidence.evidenceDigest,
		alternateRouteGraphEvidenceDigest: runs[1].routeGraphEvidence.evidenceDigest,
		historicalD733ArtifactSha256: D734_D733_ARTIFACT_SHA256,
		historicalD733BundleDigest: D734_D733_BUNDLE_DIGEST,
		d733ImplementationManifestDigest: D733_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest,
		completedGraphArms: 12,
		maxActiveEffects: 1,
		injectedTransportCalls: runs[0].providerCalls + runs[1].providerCalls,
		providerCalls: 0,
		networkCalls: 0,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D734_GENERATION_SCHEMA,
		generationRef: D734_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		primaryGraphEvidenceDigest: runs[0].graphEvidence.evidenceDigest,
		alternateGraphEvidenceDigest: runs[1].graphEvidence.evidenceDigest,
		implementationManifestDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D734_BUNDLE_SCHEMA,
		runs,
		qualification,
		generation,
	});
	const bundle = strictSnapshot({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D734RouteProfileIntegrationPreLiveBundleV1;
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD734RouteProfileIntegrationPreLiveBundle(
	value: unknown,
): D734RouteProfileIntegrationPreLiveBundleV1 {
	const candidate = record(value, "d734.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "qualification", "runs", "schemaVersion"],
		"d734.bundle",
	);
	literal(candidate.schemaVersion, D734_BUNDLE_SCHEMA, "d734.bundle.schema");
	const rawRuns = array(candidate.runs, "d734.bundle.runs");
	if (rawRuns.length !== 2) throw new TypeError("D734 bundle requires two runs");
	const runs = Object.freeze(rawRuns.map(validateRun)) as readonly [RunEvidenceV1, RunEvidenceV1];
	if (runs[0].profileDigest === runs[1].profileDigest)
		throw new TypeError("D734 bundle route profiles are not distinct");
	const qualification = record(candidate.qualification, "d734.bundle.qualification");
	exactKeys(
		qualification,
		[
			"alternateGraphEvidenceDigest",
			"alternateProfileDigest",
			"alternateRouteGraphEvidenceDigest",
			"causalAttribution",
			"completedGraphArms",
			"d733ImplementationManifestDigest",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executionClass",
			"historicalD733ArtifactSha256",
			"historicalD733BundleDigest",
			"implementationManifestDigest",
			"injectedTransportCalls",
			"maxActiveEffects",
			"networkCalls",
			"primaryGraphEvidenceDigest",
			"primaryProfileDigest",
			"primaryRouteGraphEvidenceDigest",
			"providerCalls",
			"qualificationDigest",
			"qualified",
			"schemaVersion",
		],
		"d734.bundle.qualification",
	);
	for (const [key, expected] of [
		["schemaVersion", D734_QUALIFICATION_SCHEMA],
		["decisionRef", D734_DECISION_REF],
		["decisionRevision", D734_DECISION_REVISION],
		["executionClass", "injected-no-network"],
		["primaryProfileDigest", runs[0].profileDigest],
		["alternateProfileDigest", runs[1].profileDigest],
		["primaryGraphEvidenceDigest", runs[0].graphEvidence.evidenceDigest],
		["alternateGraphEvidenceDigest", runs[1].graphEvidence.evidenceDigest],
		["primaryRouteGraphEvidenceDigest", runs[0].routeGraphEvidence.evidenceDigest],
		["alternateRouteGraphEvidenceDigest", runs[1].routeGraphEvidence.evidenceDigest],
		["historicalD733ArtifactSha256", D734_D733_ARTIFACT_SHA256],
		["historicalD733BundleDigest", D734_D733_BUNDLE_DIGEST],
		["d733ImplementationManifestDigest", D733_IMPLEMENTATION_MANIFEST_DIGEST],
		["completedGraphArms", 12],
		["maxActiveEffects", 1],
		["injectedTransportCalls", runs[0].providerCalls + runs[1].providerCalls],
		["providerCalls", 0],
		["networkCalls", 0],
		["causalAttribution", "undetermined"],
		["efficacyClaim", "none"],
		["qualified", true],
	] as const)
		literal(qualification[key], expected, `d734.qualification.${key}`);
	literal(
		qualification.implementationManifestDigest,
		D734_IMPLEMENTATION_MANIFEST_DIGEST,
		"d734.qualification.implementation",
	);
	const qualificationDigest = digest(
		qualification.qualificationDigest,
		"d734.qualification.digest",
	);
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d734.qualification.digest",
	);
	const generation = record(candidate.generation, "d734.bundle.generation");
	exactKeys(
		generation,
		[
			"alternateGraphEvidenceDigest",
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"primaryGraphEvidenceDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"d734.bundle.generation",
	);
	const implementationManifestDigest = digest(
		qualification.implementationManifestDigest,
		"d734.generation.implementation",
	);
	for (const [key, expected] of [
		["schemaVersion", D734_GENERATION_SCHEMA],
		["generationRef", D734_GENERATION_REF],
		["qualificationDigest", qualificationDigest],
		["primaryGraphEvidenceDigest", runs[0].graphEvidence.evidenceDigest],
		["alternateGraphEvidenceDigest", runs[1].graphEvidence.evidenceDigest],
		["implementationManifestDigest", implementationManifestDigest],
		["causalAttribution", "undetermined"],
		["efficacyClaim", "none"],
	] as const)
		literal(generation[key], expected, `d734.generation.${key}`);
	const generationDigest = digest(generation.generationDigest, "d734.generation.digest");
	const { generationDigest: _generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d734.generation.digest",
	);
	const material = strictSnapshot({
		schemaVersion: D734_BUNDLE_SCHEMA,
		runs,
		qualification,
		generation,
	});
	literal(candidate.bundleDigest, empiricalStrictJsonDigest(material), "d734.bundle.digest");
	return strictSnapshot({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as unknown as D734RouteProfileIntegrationPreLiveBundleV1;
}

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<FileIdentity> {
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
			throw new TypeError("D734 persisted file identity is invalid");
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertFile(path: string, identity: FileIdentity, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("D734 persisted file drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD734RouteProfileIntegrationPreLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D734RouteProfileIntegrationPreLiveBundleV1;
}) {
	const input = record(inputValue, "d734.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d734.persist.input");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D734 persistence requires the exact constructed bundle");
	const bundle = validateD734RouteProfileIntegrationPreLiveBundle(input.bundle);
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D734 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D734 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D734 private root ownership is invalid");
	const finalRoot = join(privateRoot, D734_GENERATION_REF);
	let finalIdentity: FileIdentity | null = null;
	try {
		await mkdir(finalRoot, { recursive: false, mode: 0o700 });
		const stat = await lstat(finalRoot);
		if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700)
			throw new TypeError("D734 generation claim identity is invalid");
		finalIdentity = { dev: stat.dev, ino: stat.ino };
		const staging = join(finalRoot, `.d734-staging-${randomUUID()}`);
		await mkdir(staging, { recursive: false, mode: 0o700 });
		const artifacts = [
			{ name: "graph-runs.v1.json", value: bundle.runs },
			{ name: "qualification.v1.json", value: bundle.qualification },
			{ name: "generation.v1.json", value: bundle.generation },
			{ name: "bundle.v1.json", value: bundle },
		] as const;
		const written: Array<{ name: string; bytes: Uint8Array; identity: FileIdentity }> = [];
		for (const artifact of artifacts) {
			const bytes = strictJsonCodec.encode(artifact.value as StrictJsonValue);
			written.push({
				name: artifact.name,
				bytes,
				identity: await writeExclusive(join(staging, artifact.name), bytes),
			});
		}
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
		for (const artifact of written)
			await assertFile(join(artifactsRoot, artifact.name), artifact.identity, artifact.bytes);
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
			generationRef: D734_GENERATION_REF,
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
	}
}
