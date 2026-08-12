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
import { validateD729LiveBundle } from "./d729-graph-native-live.js";
import {
	D733_DECISION_REF,
	D733_DECISION_REVISION,
	type D733GraphNativeRouteAdmissionV1,
	type D733GraphNativeRouteProfileV1,
	readD733AdmittedRouteProfile,
	validateD733GraphNativeRouteAdmission,
	validateD733GraphNativeRouteProfile,
} from "./d733-graph-native-route-profile.js";
import {
	consumeD733ImplementationAttestation,
	D733_IMPLEMENTATION_MANIFEST_DIGEST,
	type D733ImplementationAttestationV1,
} from "./d733-implementation-manifest.js";

export const D733_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d733.route-profile-pre-live-qualification.v1" as const;
export const D733_GENERATION_SCHEMA =
	"graphrefly.b112.d733.route-profile-pre-live-generation.v1" as const;
export const D733_BUNDLE_SCHEMA = "graphrefly.b112.d733.route-profile-pre-live-bundle.v1" as const;
export const D733_GENERATION_REF = "d733-route-profile-pre-live-2026-08-11-v1" as const;
export const D733_D732_BUNDLE_SHA256 =
	"sha256:16c3430277d403d07e0cdac8a9aed93adb8d3bc53eff92430d08f3d3d3d7fbb6" as const;
export const D733_D732_BUNDLE_DIGEST =
	"sha256:a8fede3d9d9583e4938465dc5a7c1daadba7b391d4eb97894f0f509b178843d4" as const;

export interface D733RouteProfilePreLiveBundleV1 {
	readonly schemaVersion: typeof D733_BUNDLE_SCHEMA;
	readonly routeProfiles: readonly [D733GraphNativeRouteProfileV1, D733GraphNativeRouteProfileV1];
	readonly routeAdmissions: readonly [
		D733GraphNativeRouteAdmissionV1,
		D733GraphNativeRouteAdmissionV1,
	];
	readonly qualification: Readonly<Record<string, StrictJsonValue>>;
	readonly generation: Readonly<Record<string, StrictJsonValue>>;
	readonly bundleDigest: string;
}

const constructedBundles = new WeakSet<object>();

function validateWireBody(bytesValue: Uint8Array, profile: D733GraphNativeRouteProfileV1): string {
	if (
		!(bytesValue instanceof Uint8Array) ||
		bytesValue.byteLength < 1 ||
		bytesValue.byteLength > 262_144
	)
		throw new TypeError("D733 captured wire body is outside the bound");
	const bytes = new Uint8Array(bytesValue);
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("D733 captured wire body is not UTF-8 JSON", { cause: error });
	}
	const body = record(decoded, "d733.wireBody");
	exactKeys(
		body,
		["messages", "model", "provider", "reasoning", "stream", "tool_choice", "tools"],
		"d733.wireBody",
	);
	literal(body.model, profile.requestModel, "d733.wireBody.model");
	literal(body.stream, false, "d733.wireBody.stream");
	if (Object.hasOwn(body, "parallel_tool_calls"))
		throw new TypeError("D733 wire body retained parallel_tool_calls");
	array(body.messages, "d733.wireBody.messages");
	array(body.tools, "d733.wireBody.tools");
	const provider = record(body.provider, "d733.wireBody.provider");
	exactKeys(
		provider,
		["allow_fallbacks", "only", "order", "require_parameters"],
		"d733.wireBody.provider",
	);
	literal(provider.allow_fallbacks, false, "d733.wireBody.provider.allowFallbacks");
	literal(provider.require_parameters, true, "d733.wireBody.provider.requireParameters");
	literal(
		empiricalStrictJsonDigest(provider.order),
		empiricalStrictJsonDigest([profile.providerTag]),
		"d733.wireBody.provider.order",
	);
	literal(
		empiricalStrictJsonDigest(provider.only),
		empiricalStrictJsonDigest([profile.providerTag]),
		"d733.wireBody.provider.only",
	);
	const reasoning = record(body.reasoning, "d733.wireBody.reasoning");
	exactKeys(reasoning, ["effort"], "d733.wireBody.reasoning");
	literal(reasoning.effort, profile.reasoningEffort, "d733.wireBody.reasoning.effort");
	return empiricalSha256(bytes);
}

function validateHistoricalD732(bytesValue: Uint8Array): void {
	if (
		!(bytesValue instanceof Uint8Array) ||
		bytesValue.byteLength < 1 ||
		bytesValue.byteLength > 1_048_576
	)
		throw new TypeError("D733 historical D732 bytes are outside the bound");
	const bytes = new Uint8Array(bytesValue);
	literal(empiricalSha256(bytes), D733_D732_BUNDLE_SHA256, "d733.historicalD732.sha256");
	const bundle = validateD729LiveBundle(strictJsonCodec.decode(bytes));
	literal(bundle.bundleDigest, D733_D732_BUNDLE_DIGEST, "d733.historicalD732.bundleDigest");
	literal(bundle.disposition, "partial-failure", "d733.historicalD732.disposition");
	literal(bundle.graphEvidence.ledger.completedArms.length, 6, "d733.historicalD732.completedArms");
}

export function createD733RouteProfilePreLiveQualification(inputValue: {
	readonly implementationAttestation: D733ImplementationAttestationV1;
	readonly expectedPrimaryProfileDigest: string;
	readonly primaryAdmission: D733GraphNativeRouteAdmissionV1;
	readonly alternateAdmission: D733GraphNativeRouteAdmissionV1;
	readonly primaryWireBodies: readonly Uint8Array[];
	readonly alternateWireBody: Uint8Array;
	readonly historicalD732BundleBytes: Uint8Array;
}): D733RouteProfilePreLiveBundleV1 {
	const input = record(inputValue, "d733.qualification.input");
	exactKeys(
		input,
		[
			"alternateAdmission",
			"alternateWireBody",
			"historicalD732BundleBytes",
			"implementationAttestation",
			"expectedPrimaryProfileDigest",
			"primaryAdmission",
			"primaryWireBodies",
		],
		"d733.qualification.input",
	);
	const implementationManifestDigest = consumeD733ImplementationAttestation(
		input.implementationAttestation,
	);
	const primaryProfile = readD733AdmittedRouteProfile(input.primaryAdmission);
	const alternateProfile = readD733AdmittedRouteProfile(input.alternateAdmission);
	const expectedPrimaryProfileDigest = digest(
		input.expectedPrimaryProfileDigest,
		"d733.qualification.expectedPrimaryProfileDigest",
	);
	literal(
		primaryProfile.profileDigest,
		expectedPrimaryProfileDigest,
		"d733.qualification.primaryProfileDigest",
	);
	if (primaryProfile.profileDigest === alternateProfile.profileDigest)
		throw new TypeError("D733 qualification requires two distinct route profiles");
	const primaryBodies = array(input.primaryWireBodies, "d733.qualification.primaryWireBodies");
	if (primaryBodies.length !== 6)
		throw new TypeError("D733 qualification requires exactly six primary Graph request bodies");
	const primaryWireBodyDigests = primaryBodies.map((body) => {
		if (!(body instanceof Uint8Array)) throw new TypeError("D733 primary wire body is invalid");
		return validateWireBody(body, primaryProfile);
	});
	if (!(input.alternateWireBody instanceof Uint8Array))
		throw new TypeError("D733 alternate wire body is invalid");
	const alternateWireBodyDigest = validateWireBody(input.alternateWireBody, alternateProfile);
	if (!(input.historicalD732BundleBytes instanceof Uint8Array))
		throw new TypeError("D733 historical bytes are invalid");
	validateHistoricalD732(input.historicalD732BundleBytes);
	const primaryAdmission = validateD733GraphNativeRouteAdmission(input.primaryAdmission);
	const alternateAdmission = validateD733GraphNativeRouteAdmission(input.alternateAdmission);
	const routeProfiles = Object.freeze([primaryProfile, alternateProfile]) as readonly [
		D733GraphNativeRouteProfileV1,
		D733GraphNativeRouteProfileV1,
	];
	const routeAdmissions = Object.freeze([primaryAdmission, alternateAdmission]) as readonly [
		D733GraphNativeRouteAdmissionV1,
		D733GraphNativeRouteAdmissionV1,
	];
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D733_QUALIFICATION_SCHEMA,
		decisionRef: D733_DECISION_REF,
		decisionRevision: D733_DECISION_REVISION,
		executionClass: "injected-no-network" as const,
		primaryProfileDigest: primaryProfile.profileDigest,
		expectedPrimaryProfileDigest,
		alternateProfileDigest: alternateProfile.profileDigest,
		primaryAdmissionDigest: primaryAdmission.admissionDigest,
		alternateAdmissionDigest: alternateAdmission.admissionDigest,
		primaryWireBodyDigests,
		alternateWireBodyDigest,
		historicalD732BundleSha256: D733_D732_BUNDLE_SHA256,
		historicalD732BundleDigest: D733_D732_BUNDLE_DIGEST,
		implementationManifestDigest,
		completedGraphArms: 6,
		maxActiveEffects: 1,
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
		schemaVersion: D733_GENERATION_SCHEMA,
		generationRef: D733_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		primaryProfileDigest: primaryProfile.profileDigest,
		expectedPrimaryProfileDigest,
		alternateProfileDigest: alternateProfile.profileDigest,
		historicalD732BundleSha256: D733_D732_BUNDLE_SHA256,
		implementationManifestDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D733_BUNDLE_SCHEMA,
		routeProfiles,
		routeAdmissions,
		qualification,
		generation,
	});
	const bundle = strictSnapshot({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D733RouteProfilePreLiveBundleV1;
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD733RouteProfilePreLiveBundle(
	value: unknown,
): D733RouteProfilePreLiveBundleV1 {
	const candidate = record(value, "d733.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"generation",
			"qualification",
			"routeAdmissions",
			"routeProfiles",
			"schemaVersion",
		],
		"d733.bundle",
	);
	literal(candidate.schemaVersion, D733_BUNDLE_SCHEMA, "d733.bundle.schema");
	const profilesRaw = array(candidate.routeProfiles, "d733.bundle.routeProfiles");
	const admissionsRaw = array(candidate.routeAdmissions, "d733.bundle.routeAdmissions");
	if (profilesRaw.length !== 2 || admissionsRaw.length !== 2)
		throw new TypeError("D733 bundle route tuple is invalid");
	const routeProfiles = Object.freeze([
		validateD733GraphNativeRouteProfile(profilesRaw[0]),
		validateD733GraphNativeRouteProfile(profilesRaw[1]),
	]) as readonly [D733GraphNativeRouteProfileV1, D733GraphNativeRouteProfileV1];
	const routeAdmissions = Object.freeze([
		validateD733GraphNativeRouteAdmission(admissionsRaw[0]),
		validateD733GraphNativeRouteAdmission(admissionsRaw[1]),
	]) as readonly [D733GraphNativeRouteAdmissionV1, D733GraphNativeRouteAdmissionV1];
	for (const index of [0, 1] as const)
		literal(
			routeAdmissions[index].profileDigest,
			routeProfiles[index].profileDigest,
			`d733.bundle.routeBinding[${index}]`,
		);
	const qualification = record(candidate.qualification, "d733.bundle.qualification");
	exactKeys(
		qualification,
		[
			"alternateAdmissionDigest",
			"alternateProfileDigest",
			"alternateWireBodyDigest",
			"causalAttribution",
			"completedGraphArms",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executionClass",
			"expectedPrimaryProfileDigest",
			"historicalD732BundleDigest",
			"historicalD732BundleSha256",
			"implementationManifestDigest",
			"maxActiveEffects",
			"networkCalls",
			"primaryAdmissionDigest",
			"primaryProfileDigest",
			"primaryWireBodyDigests",
			"providerCalls",
			"qualificationDigest",
			"qualified",
			"schemaVersion",
		],
		"d733.bundle.qualification",
	);
	for (const [key, expected] of [
		["schemaVersion", D733_QUALIFICATION_SCHEMA],
		["decisionRef", D733_DECISION_REF],
		["decisionRevision", D733_DECISION_REVISION],
		["executionClass", "injected-no-network"],
		["historicalD732BundleSha256", D733_D732_BUNDLE_SHA256],
		["historicalD732BundleDigest", D733_D732_BUNDLE_DIGEST],
		["implementationManifestDigest", D733_IMPLEMENTATION_MANIFEST_DIGEST],
		["completedGraphArms", 6],
		["maxActiveEffects", 1],
		["providerCalls", 0],
		["networkCalls", 0],
		["causalAttribution", "undetermined"],
		["efficacyClaim", "none"],
		["qualified", true],
	] as const)
		literal(qualification[key], expected, `d733.qualification.${key}`);
	literal(
		qualification.primaryProfileDigest,
		routeProfiles[0].profileDigest,
		"d733.qualification.primaryProfile",
	);
	literal(
		digest(
			qualification.expectedPrimaryProfileDigest,
			"d733.qualification.expectedPrimaryProfileDigest",
		),
		routeProfiles[0].profileDigest,
		"d733.qualification.expectedPrimaryProfileDigest",
	);
	literal(
		qualification.alternateProfileDigest,
		routeProfiles[1].profileDigest,
		"d733.qualification.alternateProfile",
	);
	literal(
		qualification.primaryAdmissionDigest,
		routeAdmissions[0].admissionDigest,
		"d733.qualification.primaryAdmission",
	);
	literal(
		qualification.alternateAdmissionDigest,
		routeAdmissions[1].admissionDigest,
		"d733.qualification.alternateAdmission",
	);
	const wireDigests = array(
		qualification.primaryWireBodyDigests,
		"d733.qualification.primaryWireBodyDigests",
	);
	if (wireDigests.length !== 6) throw new TypeError("D733 qualification wire count is invalid");
	for (const [index, value] of wireDigests.entries())
		digest(value, `d733.qualification.primaryWireBodyDigests[${index}]`);
	digest(qualification.alternateWireBodyDigest, "d733.qualification.alternateWireBodyDigest");
	const qualificationDigest = digest(
		qualification.qualificationDigest,
		"d733.qualification.qualificationDigest",
	);
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d733.qualification.qualificationDigest",
	);
	const generation = record(candidate.generation, "d733.bundle.generation");
	exactKeys(
		generation,
		[
			"alternateProfileDigest",
			"causalAttribution",
			"efficacyClaim",
			"expectedPrimaryProfileDigest",
			"generationDigest",
			"generationRef",
			"historicalD732BundleSha256",
			"implementationManifestDigest",
			"primaryProfileDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"d733.bundle.generation",
	);
	for (const [key, expected] of [
		["schemaVersion", D733_GENERATION_SCHEMA],
		["generationRef", D733_GENERATION_REF],
		["qualificationDigest", qualificationDigest],
		["primaryProfileDigest", routeProfiles[0].profileDigest],
		["expectedPrimaryProfileDigest", routeProfiles[0].profileDigest],
		["alternateProfileDigest", routeProfiles[1].profileDigest],
		["historicalD732BundleSha256", D733_D732_BUNDLE_SHA256],
		["implementationManifestDigest", D733_IMPLEMENTATION_MANIFEST_DIGEST],
		["causalAttribution", "undetermined"],
		["efficacyClaim", "none"],
	] as const)
		literal(generation[key], expected, `d733.generation.${key}`);
	const generationDigest = digest(generation.generationDigest, "d733.generation.generationDigest");
	const { generationDigest: _generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d733.generation.generationDigest",
	);
	const material = strictSnapshot({
		schemaVersion: D733_BUNDLE_SCHEMA,
		routeProfiles,
		routeAdmissions,
		qualification,
		generation,
	});
	literal(candidate.bundleDigest, empiricalStrictJsonDigest(material), "d733.bundle.bundleDigest");
	return strictSnapshot({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as unknown as D733RouteProfilePreLiveBundleV1;
}

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
}

async function writeFileExclusive(path: string, bytes: Uint8Array): Promise<FileIdentity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D733 persisted artifact identity is invalid");
		await handle.writeFile(bytes);
		await handle.sync();
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
			throw new TypeError("D733 persisted artifact drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD733RouteProfilePreLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D733RouteProfilePreLiveBundleV1;
}) {
	const input = record(inputValue, "d733.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d733.persist.input");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D733 persistence requires the exact constructed bundle");
	const bundle = validateD733RouteProfilePreLiveBundle(input.bundle);
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D733 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D733 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D733 private root ownership is invalid");
	const finalRoot = join(privateRoot, D733_GENERATION_REF);
	let claimed = false;
	let finalIdentity: FileIdentity | null = null;
	try {
		await mkdir(finalRoot, { recursive: false, mode: 0o700 });
		claimed = true;
		const finalStat = await lstat(finalRoot);
		if (
			!finalStat.isDirectory() ||
			finalStat.isSymbolicLink() ||
			(finalStat.mode & 0o777) !== 0o700
		)
			throw new TypeError("D733 generation claim identity is invalid");
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		const staging = join(finalRoot, `.d733-staging-${randomUUID()}`);
		await mkdir(staging, { recursive: false, mode: 0o700 });
		const artifacts = [
			{ name: "route-profiles.v1.json", value: bundle.routeProfiles },
			{ name: "route-admissions.v1.json", value: bundle.routeAdmissions },
			{ name: "qualification.v1.json", value: bundle.qualification },
			{ name: "generation.v1.json", value: bundle.generation },
			{ name: "bundle.v1.json", value: bundle },
		] as const;
		const written = [] as Array<{ path: string; identity: FileIdentity; bytes: Uint8Array }>;
		for (const artifact of artifacts) {
			const path = join(staging, artifact.name);
			const bytes = strictJsonCodec.encode(artifact.value as StrictJsonValue);
			written.push({ path, bytes, identity: await writeFileExclusive(path, bytes) });
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
			await assertFile(
				join(artifactsRoot, artifact.path.slice(artifact.path.lastIndexOf("/") + 1)),
				artifact.identity,
				artifact.bytes,
			);
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
			generationRef: D733_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleSha256: empiricalSha256(strictJsonCodec.encode(bundle as unknown as StrictJsonValue)),
		});
	} catch (error) {
		if (claimed) {
			const current = await lstat(finalRoot).catch(() => null);
			if (
				current !== null &&
				finalIdentity !== null &&
				current.isDirectory() &&
				!current.isSymbolicLink() &&
				current.dev === finalIdentity.dev &&
				current.ino === finalIdentity.ino
			)
				await rm(finalRoot, { recursive: true, force: true });
		}
		throw error;
	}
}
