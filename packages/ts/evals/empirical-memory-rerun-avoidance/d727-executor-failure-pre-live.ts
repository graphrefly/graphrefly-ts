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
	oneOf,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import { createD726ArmLocalTerminalProviderPolicy } from "./d722-graph-native-effect-runtime.js";
import {
	type D724TerminalHttpGraphEvidenceV1,
	validateD724TerminalHttpGraphEvidence,
} from "./d724-terminal-http-evidence.js";
import {
	type D726ProviderAdapterV1,
	runD726InjectedNoNetworkQualification,
	validateD726TerminalProviderCoverage,
} from "./d726-graph-native-live.js";
import {
	D727_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD727Implementation,
} from "./d727-implementation-manifest.js";

export const D727_DECISION_REF = "decision.D727" as const;
export const D727_DECISION_REVISION = "2026-08-11.v1" as const;
export const D727_EXECUTOR_FAILURE_FACT_SCHEMA =
	"graphrefly.b112.d727.executor-failure-fact.v1" as const;
export const D727_PARTIAL_FAILURE_BUNDLE_SCHEMA =
	"graphrefly.b112.d727.partial-failure-bundle.v1" as const;
export const D727_TERMINAL_RECEIPT_SCHEMA =
	"graphrefly.b112.d727.partial-failure-terminal-receipt.v1" as const;
export const D727_GENERATION_REF = "d727-d726-executor-failure-pre-live-2026-08-11-v1" as const;

export const D727_CONSUMED_D726_COORDINATES = Object.freeze({
	claimArtifactSha256: "sha256:c3c81063a228e36aff05f953155a08948318687ae30b12753e6262891e303911",
	claimDigest: "sha256:5afe4e682cd90aaf443d3234cad806c62d9893fa19e25d573c05cfca1f8911c2",
	currentKeyAdmissionArtifactSha256:
		"sha256:ad480d3378b7daf858a7e7d42b2286815932ea7be2a176fb71a94e3091d114f8",
	currentKeyAdmissionDigest:
		"sha256:14ae4b5aa6c74cbcc7625b211261a7f0df54c80f98f33913993aeeed019bcea7",
	pricingReadDigest: "sha256:97ee876ce83f56bdd493e97d6aa7bfac08b896ac76af201630d6128849c24a2f",
	remainingMicrousdAtAdmission: 19_424_009,
	generationDisposition: "absent-after-failure" as const,
});

export interface D727PartialFailureBundleV1 {
	readonly schemaVersion: typeof D727_PARTIAL_FAILURE_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D727_DECISION_REF;
	readonly decisionRevision: typeof D727_DECISION_REVISION;
	readonly historicalD726: typeof D727_CONSUMED_D726_COORDINATES;
	readonly implementationManifestDigest: string;
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly terminalHttpGraphEvidence: D724TerminalHttpGraphEvidenceV1;
	readonly executorFailureFacts: readonly Readonly<Record<string, unknown>>[];
	readonly cleanupFacts: readonly Readonly<Record<string, unknown>>[];
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

export interface D727PersistenceReceiptV1 {
	readonly generationRef: typeof D727_GENERATION_REF;
	readonly bundleDigest: string;
	readonly terminalReceiptDigest: string;
	readonly artifactDigests: readonly string[];
}

export interface D727PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d727.persistence-fault.v1";
}

const constructedBundles = new WeakSet<object>();
const persistenceFaults = new WeakMap<
	object,
	{ stage: "after-write" | "after-rename"; consumed: boolean }
>();

export function createD727PersistenceFault(
	stage: "after-write" | "after-rename",
): D727PersistenceFaultV1 {
	oneOf(stage, ["after-write", "after-rename"], "d727.persistenceFault.stage");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d727.persistence-fault.v1" as const,
	});
	persistenceFaults.set(capability, { stage, consumed: false });
	return capability;
}

function deriveExecutorFailureFacts(graphEvidence: D722CanonicalGraphEvidenceV1) {
	const facts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) => {
			if (
				fact.kind !== "graph-effect-result-admitted" ||
				fact.result.effectKind !== "provider-request" ||
				fact.result.status !== "terminal-failure" ||
				fact.result.failureProvenance !== "executor-failure"
			)
				return [];
			const classification = oneOf(
				fact.result.executorFailureClassification,
				[
					"graph-admission-denied",
					"executor-threw",
					"invalid-executor-result",
					"transport-failure",
					"route-evidence-failure",
					"response-decode-failure",
				],
				"d727.executorFailure.classification",
			);
			const material = strictSnapshot({
				schemaVersion: D727_EXECUTOR_FAILURE_FACT_SCHEMA,
				runSequence: run.runSequence,
				effectSequence: fact.request.effectSequence,
				effectRequestDigest: fact.request.requestDigest,
				effectAdmissionDigest: fact.admissionDigest,
				providerResultDigest: fact.resultDigest,
				classification,
			});
			return [strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) })];
		}),
	);
	if (facts.length > 256) throw new TypeError("D727 executor failure fact cardinality is invalid");
	return Object.freeze(facts);
}

function deriveCleanupFacts(graphEvidence: D722CanonicalGraphEvidenceV1) {
	const facts = graphEvidence.effectRuns.map((run) => {
		const cleanup = run.facts.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "cleanup",
		);
		if (cleanup.length !== 1)
			throw new TypeError("D727 requires one Graph cleanup fact per admitted arm");
		const fact = cleanup[0]!;
		if (fact.kind !== "graph-effect-result-admitted" || fact.result.effectKind !== "cleanup")
			throw new TypeError("D727 cleanup fact is invalid");
		return strictSnapshot({
			runSequence: run.runSequence,
			status: fact.result.status,
			effectRequestDigest: fact.request.requestDigest,
			effectAdmissionDigest: fact.admissionDigest,
			resultDigest: fact.resultDigest,
		});
	});
	return Object.freeze(facts);
}

function replayGraph(value: unknown): D722CanonicalGraphEvidenceV1 {
	const candidate = record(value, "d727.graphEvidence");
	const effectRuns = array(candidate.effectRuns, "d727.graphEvidence.effectRuns");
	if (effectRuns.length > 12) {
		throw new TypeError("D727 graph evidence effect-run bound exceeded");
	}
	const replay = deriveD722CanonicalGraphEvidence(
		candidate.ledger,
		effectRuns as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
	);
	literal(
		empiricalStrictJsonDigest(replay),
		empiricalStrictJsonDigest(candidate),
		"d727.graphEvidence.replay",
	);
	return replay;
}

function createBundle(input: {
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly terminalHttpGraphEvidence: D724TerminalHttpGraphEvidenceV1;
}): D727PartialFailureBundleV1 {
	validateD726TerminalProviderCoverage(input.graphEvidence, input.terminalHttpGraphEvidence);
	const executorFailureFacts = deriveExecutorFailureFacts(input.graphEvidence);
	if (executorFailureFacts.length === 0 && input.terminalHttpGraphEvidence.facts.length === 0)
		throw new TypeError("D727 partial failure bundle lacks a terminal failure provenance fact");
	const cleanupFacts = deriveCleanupFacts(input.graphEvidence);
	const terminalReceiptMaterial = strictSnapshot({
		schemaVersion: D727_TERMINAL_RECEIPT_SCHEMA,
		status: "partial-failure" as const,
		graphEvidenceDigest: input.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: input.terminalHttpGraphEvidence.evidenceDigest,
		executorFailureFactDigests: executorFailureFacts.map((fact) => fact.factDigest),
		executorFailureClassifications: executorFailureFacts.map((fact) => fact.classification),
		cleanupFactDigest: empiricalStrictJsonDigest(cleanupFacts),
		claimDigest: D727_CONSUMED_D726_COORDINATES.claimDigest,
		currentKeyAdmissionDigest: D727_CONSUMED_D726_COORDINATES.currentKeyAdmissionDigest,
		pricingReadDigest: D727_CONSUMED_D726_COORDINATES.pricingReadDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const terminalReceipt = strictSnapshot({
		...terminalReceiptMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalReceiptMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D727_PARTIAL_FAILURE_BUNDLE_SCHEMA,
		decisionRef: D727_DECISION_REF,
		decisionRevision: D727_DECISION_REVISION,
		historicalD726: D727_CONSUMED_D726_COORDINATES,
		implementationManifestDigest: D727_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidence: input.graphEvidence,
		terminalHttpGraphEvidence: input.terminalHttpGraphEvidence,
		executorFailureFacts,
		cleanupFacts,
		terminalReceipt,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = strictSnapshot({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D727PartialFailureBundleV1;
	constructedBundles.add(bundle);
	return bundle;
}

export async function runD727InjectedNoNetworkQualification(input: {
	readonly adapter: D726ProviderAdapterV1;
	readonly signal: AbortSignal;
}): Promise<D727PartialFailureBundleV1> {
	const implementationManifestDigest = await measureD727Implementation();
	const run = await runD726InjectedNoNetworkQualification({
		sourceDigest: implementationManifestDigest,
		adapter: input.adapter,
		signal: input.signal,
	});
	return createBundle({
		graphEvidence: run.graphEvidence,
		terminalHttpGraphEvidence: run.terminalHttpGraphEvidence,
	});
}

export function validateD727PartialFailureBundle(value: unknown): D727PartialFailureBundleV1 {
	const candidate = record(value, "d727.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"cleanupFacts",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executorFailureFacts",
			"graphEvidence",
			"historicalD726",
			"implementationManifestDigest",
			"schemaVersion",
			"terminalHttpGraphEvidence",
			"terminalReceipt",
		],
		"d727.bundle",
	);
	literal(candidate.schemaVersion, D727_PARTIAL_FAILURE_BUNDLE_SCHEMA, "d727.bundle.schema");
	literal(candidate.decisionRef, D727_DECISION_REF, "d727.bundle.decision");
	literal(candidate.decisionRevision, D727_DECISION_REVISION, "d727.bundle.revision");
	literal(
		empiricalStrictJsonDigest(candidate.historicalD726),
		empiricalStrictJsonDigest(D727_CONSUMED_D726_COORDINATES),
		"d727.bundle.history",
	);
	literal(
		digest(candidate.implementationManifestDigest, "d727.bundle.implementation"),
		D727_IMPLEMENTATION_MANIFEST_DIGEST,
		"d727.bundle.implementation",
	);
	const graphEvidence = replayGraph(candidate.graphEvidence);
	const terminalHttpGraphEvidence = validateD724TerminalHttpGraphEvidence(
		candidate.terminalHttpGraphEvidence,
	);
	validateD726TerminalProviderCoverage(graphEvidence, terminalHttpGraphEvidence);
	const expectedExecutorFacts = deriveExecutorFailureFacts(graphEvidence);
	if (expectedExecutorFacts.length === 0 && terminalHttpGraphEvidence.facts.length === 0)
		throw new TypeError("D727 partial failure bundle lacks a terminal failure provenance fact");
	const expectedCleanupFacts = deriveCleanupFacts(graphEvidence);
	literal(
		empiricalStrictJsonDigest(candidate.executorFailureFacts),
		empiricalStrictJsonDigest(expectedExecutorFacts),
		"d727.bundle.executorFacts",
	);
	literal(
		empiricalStrictJsonDigest(candidate.cleanupFacts),
		empiricalStrictJsonDigest(expectedCleanupFacts),
		"d727.bundle.cleanupFacts",
	);
	const receipt = record(candidate.terminalReceipt, "d727.terminalReceipt");
	exactKeys(
		receipt,
		[
			"causalAttribution",
			"claimDigest",
			"cleanupFactDigest",
			"currentKeyAdmissionDigest",
			"efficacyClaim",
			"executorFailureFactDigests",
			"executorFailureClassifications",
			"graphEvidenceDigest",
			"pricingReadDigest",
			"schemaVersion",
			"status",
			"terminalHttpGraphEvidenceDigest",
			"terminalReceiptDigest",
		],
		"d727.terminalReceipt",
	);
	literal(receipt.schemaVersion, D727_TERMINAL_RECEIPT_SCHEMA, "d727.terminalReceipt.schema");
	literal(receipt.status, "partial-failure", "d727.terminalReceipt.status");
	literal(receipt.graphEvidenceDigest, graphEvidence.evidenceDigest, "d727.terminalReceipt.graph");
	literal(
		receipt.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d727.terminalReceipt.http",
	);
	literal(
		empiricalStrictJsonDigest(receipt.executorFailureFactDigests),
		empiricalStrictJsonDigest(expectedExecutorFacts.map((fact) => fact.factDigest)),
		"d727.terminalReceipt.executorFacts",
	);
	literal(
		empiricalStrictJsonDigest(receipt.executorFailureClassifications),
		empiricalStrictJsonDigest(expectedExecutorFacts.map((fact) => fact.classification)),
		"d727.terminalReceipt.executorClassifications",
	);
	literal(
		receipt.cleanupFactDigest,
		empiricalStrictJsonDigest(expectedCleanupFacts),
		"d727.terminalReceipt.cleanup",
	);
	literal(
		receipt.claimDigest,
		D727_CONSUMED_D726_COORDINATES.claimDigest,
		"d727.terminalReceipt.claim",
	);
	literal(
		receipt.currentKeyAdmissionDigest,
		D727_CONSUMED_D726_COORDINATES.currentKeyAdmissionDigest,
		"d727.terminalReceipt.currentKey",
	);
	literal(
		receipt.pricingReadDigest,
		D727_CONSUMED_D726_COORDINATES.pricingReadDigest,
		"d727.terminalReceipt.pricing",
	);
	literal(receipt.causalAttribution, "undetermined", "d727.terminalReceipt.attribution");
	literal(receipt.efficacyClaim, "none", "d727.terminalReceipt.efficacy");
	const receiptDigest = digest(receipt.terminalReceiptDigest, "d727.terminalReceipt.digest");
	const { terminalReceiptDigest: _receiptDigest, ...receiptMaterial } = receipt;
	literal(receiptDigest, empiricalStrictJsonDigest(receiptMaterial), "d727.terminalReceipt.digest");
	literal(candidate.causalAttribution, "undetermined", "d727.bundle.attribution");
	literal(candidate.efficacyClaim, "none", "d727.bundle.efficacy");
	const bundleDigest = digest(candidate.bundleDigest, "d727.bundle.digest");
	const { bundleDigest: _bundleDigest, ...bundleMaterial } = candidate;
	literal(bundleDigest, empiricalStrictJsonDigest(bundleMaterial), "d727.bundle.digest");
	return strictSnapshot({
		...bundleMaterial,
		graphEvidence,
		terminalHttpGraphEvidence,
		bundleDigest,
	}) as unknown as D727PartialFailureBundleV1;
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
		throw new TypeError("D727 persistence directory identity drifted");
}

async function writeCanonical(path: string, bytes: Uint8Array): Promise<FileIdentity> {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D727 canonical artifact is not an owned 0600 file");
		await handle.writeFile(bytes);
		await handle.sync();
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertFile(
	path: string,
	identity: FileIdentity,
	expected: Uint8Array,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		const actual = await handle.readFile();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(actual, expected)
		)
			throw new TypeError("D727 artifact identity or bytes drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD727PartialFailureBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D727PartialFailureBundleV1;
	readonly fault?: D727PersistenceFaultV1;
}): Promise<D727PersistenceReceiptV1> {
	const input = record(inputValue, "d727.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d727.persist",
	);
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D727 persistence requires an unconsumed constructed bundle");
	const bundle = validateD727PartialFailureBundle(input.bundle);
	const privateRoot = resolve(input.privateRoot as string);
	const rootStat = await lstat(privateRoot);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		(await realpath(privateRoot)) !== privateRoot
	)
		throw new TypeError("D727 private root identity is invalid");
	let faultStage: "after-write" | "after-rename" | null = null;
	if (Object.hasOwn(input, "fault")) {
		const state = persistenceFaults.get(input.fault as object);
		if (state === undefined || state.consumed)
			throw new TypeError("D727 persistence fault is invalid or consumed");
		state.consumed = true;
		faultStage = state.stage;
	}
	const finalRoot = join(privateRoot, D727_GENERATION_REF);
	const parentHandle = await open(privateRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
	let parentIdentity: FileIdentity | null = null;
	let claimCreated = false;
	let finalIdentity: FileIdentity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsIdentity: FileIdentity | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactDigests: readonly string[] = [];
	let operationError: unknown = null;
	try {
		const parentStat = await parentHandle.stat();
		parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
		if (parentIdentity.dev !== rootStat.dev || parentIdentity.ino !== rootStat.ino)
			throw new TypeError("D727 private root changed before stable-handle acquisition");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		try {
			await mkdir(finalRoot, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				throw new TypeError("D727 partial-failure generation already exists");
			throw error;
		}
		claimCreated = true;
		finalHandle = await open(finalRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const finalStat = await finalHandle.stat();
		if (!finalStat.isDirectory() || (finalStat.mode & 0o777) !== 0o700)
			throw new TypeError("D727 claimed generation identity is invalid");
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		const graphBytes = strictJsonCodec.encode(bundle.graphEvidence);
		const executorBytes = strictJsonCodec.encode(bundle.executorFailureFacts);
		const terminalBytes = strictJsonCodec.encode(bundle.terminalReceipt);
		const bundleBytes = strictJsonCodec.encode(bundle);
		const artifacts = [
			["graph-evidence.v1.json", graphBytes],
			["executor-failure-facts.v1.json", executorBytes],
			["terminal-receipt.v1.json", terminalBytes],
			["partial-failure-bundle.v1.json", bundleBytes],
		] as const;
		artifactDigests = Object.freeze(artifacts.map(([, bytes]) => empiricalSha256(bytes)));
		const staging = join(finalRoot, `.d727-staging-${randomUUID()}`);
		await mkdir(staging, { mode: 0o700 });
		const stagingStat = await lstat(staging);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectoryIdentity(staging, stagingIdentity, 0o700);
		const identities = new Map<string, FileIdentity>();
		for (const [name, bytes] of artifacts)
			identities.set(name, await writeCanonical(join(staging, name), bytes));
		const stagingHandle = await open(staging, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of artifacts)
			await assertFile(join(staging, name), identities.get(name)!, bytes);
		if (faultStage === "after-write") throw new TypeError("D727 injected post-write failure");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(staging, artifactsRoot);
		artifactsHandle = await open(artifactsRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const artifactsStat = await artifactsHandle.stat();
		artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			!artifactsStat.isDirectory() ||
			(artifactsStat.mode & 0o777) !== 0o700 ||
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D727 committed artifacts identity drifted");
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		if (faultStage === "after-rename") throw new TypeError("D727 injected post-rename failure");
		const commitBytes = strictJsonCodec.encode({
			schemaVersion: "graphrefly.b112.d727.partial-failure-commit.v1",
			bundleDigest: bundle.bundleDigest,
			terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest,
			artifactsDirectory: "artifacts",
		});
		const commitIdentity = await writeCanonical(join(finalRoot, "commit.v1.json"), commitBytes);
		await finalHandle.sync();
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		await parentHandle.sync();
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
			throw new TypeError("D727 stable directory handle identity drifted");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
	} catch (error) {
		operationError = error;
	}
	const closeResults = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closeResults
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map((result) => result.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D727 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && claimCreated) {
		if (parentIdentity === null || finalIdentity === null) {
			cleanupError = new TypeError("D727 exact cleanup ownership was not established");
		} else {
			const currentRoot = await lstat(privateRoot).catch(() => null);
			const currentFinal = await lstat(finalRoot).catch(() => null);
			if (
				currentRoot === null ||
				currentRoot.dev !== parentIdentity.dev ||
				currentRoot.ino !== parentIdentity.ino ||
				currentFinal === null ||
				currentFinal.dev !== finalIdentity.dev ||
				currentFinal.ino !== finalIdentity.ino
			) {
				cleanupError = new TypeError("D727 cleanup refused after ownership drift");
			} else {
				try {
					await rm(finalRoot, { recursive: true, force: true });
					await parentHandle.sync();
				} catch (error) {
					cleanupError = error;
				}
			}
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	const parentCloseError = parentClose[0]?.status === "rejected" ? parentClose[0].reason : null;
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentCloseError !== null) errors.push(parentCloseError);
		if (errors.length > 1)
			throw new AggregateError(errors, "D727 partial-failure persistence cleanup failed");
		throw operationError;
	}
	void parentCloseError;
	return Object.freeze({
		generationRef: D727_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest as string,
		artifactDigests,
	});
}
