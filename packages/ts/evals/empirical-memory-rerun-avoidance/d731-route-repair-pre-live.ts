import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
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
import {
	admitD724TerminalHttpEvidence,
	createD724TerminalHttpAuthority,
} from "./d724-terminal-http-evidence.js";
import { type D729LiveBundleV1, validateD729LiveBundle } from "./d729-graph-native-live.js";
import {
	consumeD731ImplementationAttestation,
	D731_IMPLEMENTATION_MANIFEST_DIGEST,
	type D731ImplementationAttestationV1,
} from "./d731-implementation-manifest.js";
import {
	consumeD731RouteParameterEligibility,
	D731_DECISION_REF,
	D731_DECISION_REVISION,
	type D731RouteParameterEligibilityV1,
	validateD731RouteParameterEligibility,
} from "./d731-route-parameter-eligibility.js";

export const D731_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d731.route-repair-pre-live-qualification.v1" as const;
export const D731_GENERATION_SCHEMA =
	"graphrefly.b112.d731.route-repair-pre-live-generation.v1" as const;
export const D731_BUNDLE_SCHEMA = "graphrefly.b112.d731.route-repair-pre-live-bundle.v1" as const;
export const D731_GENERATION_REF = "d731-route-repair-pre-live-2026-08-11-v1" as const;

export interface D731PreLiveQualificationV1 extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: typeof D731_QUALIFICATION_SCHEMA;
	readonly qualificationDigest: string;
}

export interface D731PreLiveBundleV1 {
	readonly schemaVersion: typeof D731_BUNDLE_SCHEMA;
	readonly routeEligibility: D731RouteParameterEligibilityV1;
	readonly qualification: D731PreLiveQualificationV1;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

export interface D731PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d731.persistence-fault.v1";
}

const constructedQualifications = new WeakSet<object>();
const constructedBundles = new WeakSet<object>();
const faults = new WeakMap<object, "after-write" | "after-rename">();

function validateWireBody(bytes: Uint8Array): string {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 1_048_576)
		throw new TypeError("D731 captured wire body is outside the bound");
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("D731 captured wire body is not bounded UTF-8 JSON", { cause: error });
	}
	const body = record(decoded, "d731.wireBody");
	exactKeys(
		body,
		["messages", "model", "provider", "reasoning", "stream", "tool_choice", "tools"],
		"d731.wireBody",
	);
	literal(body.model, "deepseek/deepseek-v4-flash", "d731.wireBody.model");
	literal(body.stream, false, "d731.wireBody.stream");
	if (Object.hasOwn(body, "parallel_tool_calls"))
		throw new TypeError("D731 wire body retained parallel_tool_calls");
	const provider = record(body.provider, "d731.wireBody.provider");
	exactKeys(
		provider,
		["allow_fallbacks", "only", "order", "require_parameters"],
		"d731.wireBody.provider",
	);
	literal(provider.allow_fallbacks, false, "d731.wireBody.provider.allowFallbacks");
	literal(provider.require_parameters, true, "d731.wireBody.provider.requireParameters");
	literal(
		empiricalStrictJsonDigest(provider.order),
		empiricalStrictJsonDigest(["deepinfra/fp4"]),
		"d731.wireBody.provider.order",
	);
	literal(
		empiricalStrictJsonDigest(provider.only),
		empiricalStrictJsonDigest(["deepinfra/fp4"]),
		"d731.wireBody.provider.only",
	);
	array(body.messages, "d731.wireBody.messages");
	array(body.tools, "d731.wireBody.tools");
	return empiricalSha256(bytes);
}

function repeatedTerminalEvidence(bundleValue: unknown) {
	const bundle = validateD729LiveBundle(bundleValue);
	const facts = bundle.terminalHttpGraphEvidence.facts;
	if (
		bundle.disposition !== "partial-failure" ||
		bundle.graphEvidence.ledger.completedArms.length !== 6 ||
		bundle.executorFailureFacts.length !== 0 ||
		facts.length !== 6
	)
		throw new TypeError("D731 repeated-terminal Graph fixture is incomplete");
	if (facts.some((fact) => fact.terminalHttpEvidence.httpStatus !== 404))
		throw new TypeError("D731 repeated-terminal fixture must contain only HTTP 404");
	if (new Set(facts.map((fact) => fact.effectAdmissionDigest)).size !== 6)
		throw new TypeError("D731 repeated-terminal admissions are not unique");
	if (new Set(facts.map((fact) => fact.effectRequestDigest)).size !== 6)
		throw new TypeError("D731 repeated-terminal requests are not unique");
	if (new Set(facts.map((fact) => fact.providerResultDigest)).size !== 1)
		throw new TypeError("D731 fixture does not prove repeated identical provider results");
	const first = facts[0]!;
	const authority = createD724TerminalHttpAuthority();
	const input = {
		effectRequestDigest: first.effectRequestDigest,
		effectAdmissionDigest: first.effectAdmissionDigest,
		providerResultDigest: first.providerResultDigest,
		terminalHttpEvidence: first.terminalHttpEvidence,
	};
	admitD724TerminalHttpEvidence(authority, input);
	let replayRejected = false;
	try {
		admitD724TerminalHttpEvidence(authority, input);
	} catch {
		replayRejected = true;
	}
	if (!replayRejected) throw new TypeError("D731 same-admission replay was accepted");
	return Object.freeze({ bundle, facts, replayRejected });
}

export function createD731PreLiveQualification(inputValue: {
	readonly implementationAttestation: D731ImplementationAttestationV1;
	readonly routeEligibility: D731RouteParameterEligibilityV1;
	readonly capturedWireBody: Uint8Array;
	readonly repeatedTerminalBundle: D729LiveBundleV1;
}): D731PreLiveBundleV1 {
	const input = record(inputValue, "d731.qualification.input");
	exactKeys(
		input,
		["capturedWireBody", "implementationAttestation", "repeatedTerminalBundle", "routeEligibility"],
		"d731.qualification.input",
	);
	const implementationManifestDigest = consumeD731ImplementationAttestation(
		input.implementationAttestation,
	);
	const eligibility = consumeD731RouteParameterEligibility(input.routeEligibility);
	if (!(input.capturedWireBody instanceof Uint8Array))
		throw new TypeError("D731 captured wire body must be Uint8Array");
	const wireBodyDigest = validateWireBody(new Uint8Array(input.capturedWireBody));
	const repeated = repeatedTerminalEvidence(input.repeatedTerminalBundle);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D731_QUALIFICATION_SCHEMA,
		decisionRef: D731_DECISION_REF,
		decisionRevision: D731_DECISION_REVISION,
		executionClass: "injected-no-network" as const,
		implementationManifestDigest,
		routeEligibilityDigest: eligibility.eligibilityDigest,
		wireBodyDigest,
		parallelToolCallsFieldPresent: false as const,
		repeatedTerminalGraphEvidenceDigest: repeated.bundle.terminalHttpGraphEvidence.evidenceDigest,
		repeatedTerminalBundleDigest: repeated.bundle.bundleDigest,
		repeatedTerminalCount: repeated.facts.length,
		uniqueEffectAdmissionCount: new Set(repeated.facts.map((fact) => fact.effectAdmissionDigest))
			.size,
		uniqueEffectRequestCount: new Set(repeated.facts.map((fact) => fact.effectRequestDigest)).size,
		uniqueProviderResultDigestCount: new Set(
			repeated.facts.map((fact) => fact.providerResultDigest),
		).size,
		sameAdmissionReplayRejected: repeated.replayRejected,
		completedArms: repeated.bundle.graphEvidence.ledger.completedArms.length,
		executorFailureCount: repeated.bundle.executorFailureFacts.length,
		maxActiveEffects: 1 as const,
		providerCalls: 0 as const,
		networkCalls: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	}) as unknown as D731PreLiveQualificationV1;
	const generationMaterial = strictSnapshot({
		schemaVersion: D731_GENERATION_SCHEMA,
		generationRef: D731_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		implementationManifestDigest,
		routeEligibilityDigest: eligibility.eligibilityDigest,
		repeatedTerminalBundleDigest: repeated.bundle.bundleDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D731_BUNDLE_SCHEMA,
		routeEligibility: eligibility,
		qualification,
		generation,
	});
	const bundle = strictSnapshot({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D731PreLiveBundleV1;
	constructedQualifications.add(bundle.qualification as object);
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD731PreLiveBundle(value: unknown): D731PreLiveBundleV1 {
	const candidate = record(value, "d731.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "qualification", "routeEligibility", "schemaVersion"],
		"d731.bundle",
	);
	literal(candidate.schemaVersion, D731_BUNDLE_SCHEMA, "d731.bundle.schema");
	const routeEligibility = validateD731RouteParameterEligibility(candidate.routeEligibility);
	const qualification = record(candidate.qualification, "d731.qualification");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"completedArms",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executionClass",
			"executorFailureCount",
			"implementationManifestDigest",
			"maxActiveEffects",
			"networkCalls",
			"parallelToolCallsFieldPresent",
			"providerCalls",
			"qualificationDigest",
			"qualified",
			"repeatedTerminalBundleDigest",
			"repeatedTerminalCount",
			"repeatedTerminalGraphEvidenceDigest",
			"routeEligibilityDigest",
			"sameAdmissionReplayRejected",
			"schemaVersion",
			"uniqueEffectAdmissionCount",
			"uniqueEffectRequestCount",
			"uniqueProviderResultDigestCount",
			"wireBodyDigest",
		],
		"d731.qualification",
	);
	literal(qualification.schemaVersion, D731_QUALIFICATION_SCHEMA, "d731.qualification.schema");
	literal(qualification.decisionRef, D731_DECISION_REF, "d731.qualification.decision");
	literal(qualification.decisionRevision, D731_DECISION_REVISION, "d731.qualification.revision");
	literal(qualification.executionClass, "injected-no-network", "d731.qualification.class");
	for (const [key, expected] of [
		["parallelToolCallsFieldPresent", false],
		["repeatedTerminalCount", 6],
		["uniqueEffectAdmissionCount", 6],
		["uniqueEffectRequestCount", 6],
		["uniqueProviderResultDigestCount", 1],
		["sameAdmissionReplayRejected", true],
		["completedArms", 6],
		["executorFailureCount", 0],
		["maxActiveEffects", 1],
		["providerCalls", 0],
		["networkCalls", 0],
		["causalAttribution", "undetermined"],
		["efficacyClaim", "none"],
		["qualified", true],
	] as const)
		literal(qualification[key], expected, `d731.qualification.${key}`);
	for (const key of [
		"implementationManifestDigest",
		"routeEligibilityDigest",
		"wireBodyDigest",
		"repeatedTerminalGraphEvidenceDigest",
		"repeatedTerminalBundleDigest",
	] as const)
		digest(qualification[key], `d731.qualification.${key}`);
	literal(
		qualification.routeEligibilityDigest,
		routeEligibility.eligibilityDigest,
		"d731.qualification.routeEligibility",
	);
	const qualificationDigest = digest(
		qualification.qualificationDigest,
		"d731.qualification.digest",
	);
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d731.qualification.digest",
	);
	const generation = record(candidate.generation, "d731.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"qualificationDigest",
			"repeatedTerminalBundleDigest",
			"routeEligibilityDigest",
			"schemaVersion",
		],
		"d731.generation",
	);
	literal(generation.schemaVersion, D731_GENERATION_SCHEMA, "d731.generation.schema");
	literal(generation.generationRef, D731_GENERATION_REF, "d731.generation.ref");
	literal(
		generation.implementationManifestDigest,
		D731_IMPLEMENTATION_MANIFEST_DIGEST,
		"d731.generation.implementationManifest",
	);
	literal(
		qualification.implementationManifestDigest,
		D731_IMPLEMENTATION_MANIFEST_DIGEST,
		"d731.qualification.implementationManifest",
	);
	literal(generation.qualificationDigest, qualificationDigest, "d731.generation.qualification");
	literal(
		generation.routeEligibilityDigest,
		digest(qualification.routeEligibilityDigest, "d731.qualification.routeEligibilityDigest"),
		"d731.generation.eligibility",
	);
	literal(
		generation.repeatedTerminalBundleDigest,
		digest(
			qualification.repeatedTerminalBundleDigest,
			"d731.qualification.repeatedTerminalBundleDigest",
		),
		"d731.generation.repeatedTerminal",
	);
	const generationDigest = digest(generation.generationDigest, "d731.generation.digest");
	const { generationDigest: _generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d731.generation.digest",
	);
	const material = strictSnapshot({
		schemaVersion: D731_BUNDLE_SCHEMA,
		routeEligibility,
		qualification,
		generation,
	});
	literal(candidate.bundleDigest, empiricalStrictJsonDigest(material), "d731.bundle.digest");
	return strictSnapshot({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as unknown as D731PreLiveBundleV1;
}

export function createD731PersistenceFaultForTest(
	stage: "after-write" | "after-rename",
): D731PersistenceFaultV1 {
	const fault = Object.freeze({ revision: "graphrefly.b112.d731.persistence-fault.v1" as const });
	faults.set(fault, stage);
	return fault;
}

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
}

async function assertDirectoryIdentity(
	path: string,
	identity: FileIdentity,
	mode: number,
): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== mode ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D731 directory identity drifted");
}

async function writeCanonical(path: string, bytes: Uint8Array): Promise<FileIdentity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D731 canonical artifact identity is invalid");
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
			throw new TypeError("D731 artifact identity or bytes drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD731PreLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D731PreLiveBundleV1;
	readonly fault?: D731PersistenceFaultV1;
}) {
	const input = record(inputValue, "d731.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d731.persist",
	);
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D731 persistence requires the exact constructed bundle");
	const exactBundle = input.bundle as unknown as D731PreLiveBundleV1;
	const bundle = validateD731PreLiveBundle(exactBundle);
	if (!constructedQualifications.delete(exactBundle.qualification as object))
		throw new TypeError("D731 persistence requires the exact constructed qualification");
	let fault: "after-write" | "after-rename" | null = null;
	if (Object.hasOwn(input, "fault")) {
		if (typeof input.fault !== "object" || input.fault === null)
			throw new TypeError("D731 persistence fault is invalid");
		fault = faults.get(input.fault) ?? null;
		if (fault === null) throw new TypeError("D731 persistence fault is invalid or consumed");
		faults.delete(input.fault);
	}
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D731 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D731 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D731 private root ownership is invalid");
	const finalRoot = join(privateRoot, D731_GENERATION_REF);
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let finalIdentity: FileIdentity | null = null;
	let artifactsIdentity: FileIdentity | null = null;
	let claimCreated = false;
	let operationError: unknown = null;
	let result: {
		readonly generationRef: string;
		readonly bundleDigest: string;
		readonly bundleSha256: string;
	} | null = null;
	try {
		const parentStat = await parentHandle.stat();
		const parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
		if (parentIdentity.dev !== rootStat.dev || parentIdentity.ino !== rootStat.ino)
			throw new TypeError("D731 private root changed before stable-handle acquisition");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		try {
			await mkdir(finalRoot, { recursive: false, mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				throw new TypeError("D731 generation already exists");
			throw error;
		}
		claimCreated = true;
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const finalStat = await finalHandle.stat();
		if (!finalStat.isDirectory() || (finalStat.mode & 0o777) !== 0o700)
			throw new TypeError("D731 claimed generation identity is invalid");
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		const staging = join(finalRoot, `.d731-staging-${randomUUID()}`);
		await mkdir(staging, { recursive: false, mode: 0o700 });
		const stagingStat = await lstat(staging);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectoryIdentity(staging, stagingIdentity, 0o700);
		const artifacts = [
			["route-eligibility.v1.json", strictJsonCodec.encode(bundle.routeEligibility)],
			["qualification.v1.json", strictJsonCodec.encode(bundle.qualification)],
			["generation.v1.json", strictJsonCodec.encode(bundle.generation)],
			["bundle.v1.json", strictJsonCodec.encode(bundle)],
		] as const;
		const identities = new Map<string, FileIdentity>();
		for (const [name, bytes] of artifacts)
			identities.set(name, await writeCanonical(join(staging, name), bytes));
		const stagingHandle = await open(
			staging,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of artifacts)
			await assertFile(join(staging, name), identities.get(name)!, bytes);
		if (fault === "after-write") throw new TypeError("D731 injected post-write failure");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(staging, artifactsRoot);
		artifactsHandle = await open(
			artifactsRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStat = await artifactsHandle.stat();
		artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			!artifactsStat.isDirectory() ||
			(artifactsStat.mode & 0o777) !== 0o700 ||
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D731 committed artifacts identity drifted");
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		if (fault === "after-rename") throw new TypeError("D731 injected post-rename failure");
		const commitBytes = strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly.b112.d731.atomic-commit.v1",
				generationRef: D731_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				artifactsDirectory: "artifacts",
			}),
		);
		const commitIdentity = await writeCanonical(join(finalRoot, "commit.v1.json"), commitBytes);
		await finalHandle.sync();
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		await parentHandle.sync();
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		const finalHandleStat = await finalHandle.stat();
		const artifactsHandleStat = await artifactsHandle.stat();
		if (
			finalHandleStat.dev !== finalIdentity.dev ||
			finalHandleStat.ino !== finalIdentity.ino ||
			artifactsHandleStat.dev !== artifactsIdentity.dev ||
			artifactsHandleStat.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D731 stable directory handle identity drifted");
		result = Object.freeze({
			generationRef: D731_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleSha256: empiricalSha256(strictJsonCodec.encode(bundle)),
		});
	} catch (error) {
		operationError = error;
	}
	const stableCloseResults = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const stableCloseErrors = stableCloseResults
		.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
		.map((entry) => entry.reason);
	if (stableCloseErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? stableCloseErrors : [operationError, ...stableCloseErrors],
			"D731 persistence stable-handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && claimCreated) {
		if (finalIdentity === null) {
			cleanupError = new TypeError("D731 exact cleanup ownership was not established");
		} else {
			const currentRoot = await lstat(privateRoot).catch(() => null);
			const currentFinal = await lstat(finalRoot).catch(() => null);
			if (
				currentRoot === null ||
				currentRoot.dev !== rootStat.dev ||
				currentRoot.ino !== rootStat.ino ||
				currentFinal === null ||
				currentFinal.dev !== finalIdentity.dev ||
				currentFinal.ino !== finalIdentity.ino
			)
				cleanupError = new TypeError("D731 cleanup refused after ownership drift");
			else
				try {
					await rm(finalRoot, { recursive: true, force: true });
					await parentHandle.sync();
				} catch (error) {
					cleanupError = error;
				}
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	const parentCloseError = parentClose[0]?.status === "rejected" ? parentClose[0].reason : null;
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentCloseError !== null) errors.push(parentCloseError);
		if (errors.length > 1) throw new AggregateError(errors, "D731 persistence cleanup failed");
		throw operationError;
	}
	void parentCloseError;
	if (result === null) throw new TypeError("D731 persistence omitted its committed receipt");
	return result;
}
