import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type CurrentManagedCloudPublicSemanticValidationV1,
	runCurrentManagedCloudPublicSemanticValidation,
	validateCurrentManagedCloudPublicSemanticValidation,
} from "./current-managed-cloud-public-semantic-validation.js";
import {
	CURRENT_GRAPH_ARMS,
	CURRENT_GRAPH_QUALIFICATION_LIMITS,
	type CurrentGraphAdmittedEffectV1,
	type CurrentGraphEffectResultInputV1,
	type CurrentGraphNativeEvidenceV1,
	runCurrentGraphNativeEval,
	validateCurrentGraphNativeEvidence,
} from "./d5-graph-native-eval-authority.js";
import {
	CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphImplementation,
} from "./d5-inspection-batch-implementation-manifest.js";

export const CURRENT_GRAPH_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d5.current-graph-native-qualification.v1" as const;
export const CURRENT_GRAPH_GENERATION_SCHEMA =
	"graphrefly-ts.d5.current-graph-native-generation.v1" as const;
export const CURRENT_GRAPH_BUNDLE_SCHEMA =
	"graphrefly-ts.d5.current-graph-native-bundle.v1" as const;
export const CURRENT_GRAPH_GENERATION_REF =
	"d5-inspection-batch-no-network-qualification-2026-08-14-v3" as const;
export const CURRENT_GRAPH_MAX_BUNDLE_BYTES = 1_048_576 as const;

export interface CurrentGraphQualificationBundleV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_BUNDLE_SCHEMA;
	readonly graphEvidence: CurrentGraphNativeEvidenceV1;
	readonly publicBehaviorEvidence: CurrentManagedCloudPublicSemanticValidationV1;
	readonly qualification: Readonly<{
		schemaVersion: typeof CURRENT_GRAPH_QUALIFICATION_SCHEMA;
		decisionRef: "graphrefly-ts:D5";
		executionClass: "injected-no-network";
		implementationManifestDigest: string;
		graphEvidenceDigest: string;
		publicBehaviorEvidenceDigest: string;
		exactSixArmsCompleted: true;
		coldDidNotCensorWarm: true;
		fourReadInspectionBatchCount: 12;
		serialReadEffectCount: 48;
		replacementRecoveryCount: 6;
		semanticRecoveryCount: 6;
		publicSemanticFindingCount: 6;
		hiddenVerifierFindingCount: 0;
		workspaceResidueCount: 0;
		networkCalls: 0;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualified: true;
		qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		schemaVersion: typeof CURRENT_GRAPH_GENERATION_SCHEMA;
		generationRef: typeof CURRENT_GRAPH_GENERATION_REF;
		qualificationDigest: string;
		graphEvidenceDigest: string;
		implementationManifestDigest: string;
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface CurrentGraphPersistenceReceiptV1 {
	readonly generationRef: string;
	readonly bundleDigest: string;
	readonly bundleArtifactDigest: string;
	readonly finalRoot: string;
	readonly receiptDigest: string;
}

type FaultStage = "after-claim" | "after-write" | "after-rename";
export type CurrentGraphPersistenceFaultV1 = Readonly<{ __currentGraphPersistenceFault: true }>;

const constructedBundles = new WeakSet<object>();
const persistenceFaults = new WeakMap<object, FaultStage>();

export function createCurrentGraphPersistenceFaultForTest(
	stage: FaultStage,
): CurrentGraphPersistenceFaultV1 {
	if (!["after-claim", "after-write", "after-rename"].includes(stage))
		throw new TypeError("current persistence fault stage is invalid");
	const capability = Object.freeze({ __currentGraphPersistenceFault: true as const });
	persistenceFaults.set(capability, stage);
	return capability;
}

function resultDigest(input: unknown) {
	return empiricalStrictJsonDigest(input);
}

function createInjectedExecutor() {
	const replacementRejected = new Set<number>();
	const semanticRejected = new Set<number>();
	return async (effect: CurrentGraphAdmittedEffectV1): Promise<CurrentGraphEffectResultInputV1> => {
		const request = effect.request;
		const base = { actualCostMicrousd: 0 as const, actualElapsedMs: 1 };
		if (request.effectKind === "materialization") {
			const workspaceStateDigest = resultDigest({ arm: request.arm, state: "materialized" });
			return Object.freeze({
				...base,
				effectKind: "materialization" as const,
				status: "completed" as const,
				workspaceStateDigest,
				evidenceDigest: resultDigest({ request: request.requestDigest, workspaceStateDigest }),
			});
		}
		if (request.effectKind === "provider-request") {
			const correction = request.correctionDirective;
			const inspectionBatch = ["read-file", "read-file", "read-file", "read-file"] as const;
			const toolIntents =
				correction?.stage === "reinspect"
					? inspectionBatch
					: request.phaseBefore === "none"
						? inspectionBatch
						: (["replace-exact", "workspace-diff", "focused-validation"] as const);
			return Object.freeze({
				effectKind: "provider-request" as const,
				status: "completed" as const,
				disposition: "tool-intents" as const,
				toolIntents,
				failureCode: null,
				evidenceDigest: resultDigest({ request: request.requestDigest, toolIntents }),
				actualCostMicrousd: 10,
				actualElapsedMs: 2,
			});
		}
		if (request.effectKind === "tool-action") {
			const before = request.workspaceStateDigest;
			if (before === null || request.toolRef === null)
				throw new TypeError("current injected tool request is incomplete");
			if (request.toolRef === "replace-exact" && !replacementRejected.has(request.runSequence)) {
				replacementRejected.add(request.runSequence);
				return Object.freeze({
					...base,
					effectKind: "tool-action" as const,
					toolRef: request.toolRef,
					status: "failed" as const,
					causeCode: "exact-replacement-unchanged" as const,
					workspaceStateBeforeDigest: before,
					workspaceStateAfterDigest: before,
					nonEmptyDiff: false,
					evidenceDigest: resultDigest({ request: request.requestDigest, rejected: true }),
				});
			}
			const after =
				request.toolRef === "replace-exact"
					? resultDigest({ before, request: request.requestDigest, mutation: "fresh" })
					: before;
			return Object.freeze({
				...base,
				effectKind: "tool-action" as const,
				toolRef: request.toolRef,
				status: "succeeded" as const,
				causeCode: null,
				workspaceStateBeforeDigest: before,
				workspaceStateAfterDigest: after,
				nonEmptyDiff: request.toolRef === "workspace-diff",
				evidenceDigest: resultDigest({ request: request.requestDigest, after }),
			});
		}
		if (request.effectKind === "public-semantic-validation") {
			if (request.workspaceStateDigest === null)
				throw new TypeError("current injected semantic request is incomplete");
			const first = !semanticRejected.has(request.runSequence);
			semanticRejected.add(request.runSequence);
			const criterionFailures = first
				? (["local-reconstruction-not-rejected"] as const)
				: ([] as const);
			return Object.freeze({
				...base,
				effectKind: "public-semantic-validation" as const,
				status: first ? ("failed" as const) : ("passed" as const),
				criterionFailures,
				workspaceStateDigest: request.workspaceStateDigest,
				evidenceDigest: resultDigest({ request: request.requestDigest, criterionFailures }),
			});
		}
		if (request.effectKind === "hidden-verifier") {
			if (request.workspaceStateDigest === null)
				throw new TypeError("current injected verifier request is incomplete");
			return Object.freeze({
				...base,
				effectKind: "hidden-verifier" as const,
				status: "passed" as const,
				workspaceStateDigest: request.workspaceStateDigest,
				evidenceDigest: resultDigest({ request: request.requestDigest, hidden: "passed" }),
			});
		}
		return Object.freeze({
			...base,
			effectKind: "cleanup" as const,
			status: "completed" as const,
			workspaceStateDigest: null,
			evidenceDigest: resultDigest({ request: request.requestDigest, cleanup: "completed" }),
		});
	};
}

export async function runCurrentGraphNativeNoNetworkQualification(): Promise<CurrentGraphQualificationBundleV1> {
	if ((await measureCurrentGraphImplementation()) !== CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D5 Graph implementation manifest drifted before qualification");
	const publicBehaviorEvidence = await runCurrentManagedCloudPublicSemanticValidation();
	if (publicBehaviorEvidence.status !== "passed")
		throw new TypeError(
			"current actor-visible public semantic validator did not pass its baseline",
		);
	const graphEvidence = validateCurrentGraphNativeEvidence(
		await runCurrentGraphNativeEval({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
			execute: createInjectedExecutor(),
		}),
	);
	const replacementRecoveryCount = graphEvidence.runs.filter(
		(run) => run.replacementRecoveryUsed,
	).length;
	const semanticRecoveryCount = graphEvidence.runs.filter((run) => run.semanticRecoveryUsed).length;
	const publicSemanticFindingCount = graphEvidence.findings.filter(
		(finding) => finding.code === "public-semantic-validation-failed",
	).length;
	const hiddenVerifierFindingCount = graphEvidence.findings.filter(
		(finding) => finding.code === "hidden-verifier-failed",
	).length;
	const fourReadInspectionBatchCount = graphEvidence.facts.filter(
		(fact) =>
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "completed" &&
			fact.result.disposition === "tool-intents" &&
			fact.result.toolIntents.length === 4 &&
			fact.result.toolIntents.every((tool) => tool === "read-file"),
	).length;
	const serialReadEffectCount = graphEvidence.facts.filter(
		(fact) =>
			fact.request.effectKind === "tool-action" &&
			fact.request.toolRef === "read-file" &&
			fact.result.effectKind === "tool-action" &&
			fact.result.toolRef === "read-file" &&
			fact.result.status === "succeeded",
	).length;
	if (
		graphEvidence.runStatus !== "complete" ||
		graphEvidence.runs.length !== CURRENT_GRAPH_ARMS.length ||
		graphEvidence.runs.some(
			(run, index) =>
				run.arm !== CURRENT_GRAPH_ARMS[index] ||
				run.status !== "completed" ||
				!run.replacementRecoveryUsed ||
				!run.semanticRecoveryUsed ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		replacementRecoveryCount !== 6 ||
		semanticRecoveryCount !== 6 ||
		fourReadInspectionBatchCount !== 12 ||
		serialReadEffectCount !== 48 ||
		publicSemanticFindingCount !== 6 ||
		hiddenVerifierFindingCount !== 0
	)
		throw new TypeError("D5 Graph exact six-arm qualification lifecycle drifted");
	if (
		graphEvidence.findings.some(
			(finding) =>
				finding.code === "hidden-verifier-failed" ||
				!graphEvidence.facts.some((fact) => fact.factDigest === finding.sourceFactDigest),
		)
	)
		throw new TypeError("D5 Graph finding provenance drifted");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D5" as const,
		executionClass: "injected-no-network" as const,
		implementationManifestDigest: CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		publicBehaviorEvidenceDigest: publicBehaviorEvidence.evidenceDigest,
		exactSixArmsCompleted: true as const,
		coldDidNotCensorWarm: true as const,
		fourReadInspectionBatchCount: 12 as const,
		serialReadEffectCount: 48 as const,
		replacementRecoveryCount: 6 as const,
		semanticRecoveryCount: 6 as const,
		publicSemanticFindingCount: 6 as const,
		hiddenVerifierFindingCount: 0 as const,
		workspaceResidueCount: 0 as const,
		networkCalls: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_GENERATION_SCHEMA,
		generationRef: CURRENT_GRAPH_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		implementationManifestDigest: CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_BUNDLE_SCHEMA,
		graphEvidence,
		publicBehaviorEvidence,
		qualification,
		generation,
	});
	const bundle = Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as CurrentGraphQualificationBundleV1;
	if (strictJsonCodec.encode(bundle).byteLength > CURRENT_GRAPH_MAX_BUNDLE_BYTES)
		throw new TypeError("D5 Graph qualification bundle exceeded its byte bound");
	constructedBundles.add(bundle);
	if ((await measureCurrentGraphImplementation()) !== CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D5 Graph implementation manifest drifted after qualification");
	return bundle;
}

export function validateCurrentGraphQualificationBundle(
	value: unknown,
): CurrentGraphQualificationBundleV1 {
	const candidate = record(value, "current.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"generation",
			"graphEvidence",
			"publicBehaviorEvidence",
			"qualification",
			"schemaVersion",
		],
		"current.bundle",
	);
	const qualification = record(candidate.qualification, "current.bundle.qualification");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"coldDidNotCensorWarm",
			"decisionRef",
			"efficacyClaim",
			"exactSixArmsCompleted",
			"executionClass",
			"fourReadInspectionBatchCount",
			"graphEvidenceDigest",
			"hiddenVerifierFindingCount",
			"implementationManifestDigest",
			"networkCalls",
			"publicBehaviorEvidenceDigest",
			"publicSemanticFindingCount",
			"qualificationDigest",
			"qualified",
			"replacementRecoveryCount",
			"schemaVersion",
			"semanticRecoveryCount",
			"serialReadEffectCount",
			"workspaceResidueCount",
		],
		"current.bundle.qualification",
	);
	const generation = record(candidate.generation, "current.bundle.generation");
	exactKeys(
		generation,
		[
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"current.bundle.generation",
	);
	if (
		candidate?.schemaVersion !== CURRENT_GRAPH_BUNDLE_SCHEMA ||
		qualification.schemaVersion !== CURRENT_GRAPH_QUALIFICATION_SCHEMA ||
		generation.schemaVersion !== CURRENT_GRAPH_GENERATION_SCHEMA ||
		generation.generationRef !== CURRENT_GRAPH_GENERATION_REF ||
		qualification.decisionRef !== "graphrefly-ts:D5" ||
		qualification.executionClass !== "injected-no-network" ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.coldDidNotCensorWarm !== true ||
		qualification.fourReadInspectionBatchCount !== 12 ||
		qualification.serialReadEffectCount !== 48 ||
		qualification.qualified !== true ||
		qualification.implementationManifestDigest !== CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.efficacyClaim !== "none" ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.networkCalls !== 0 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.replacementRecoveryCount !== 6 ||
		qualification.semanticRecoveryCount !== 6 ||
		qualification.publicSemanticFindingCount !== 6 ||
		qualification.hiddenVerifierFindingCount !== 0 ||
		generation.implementationManifestDigest !== CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D5 Graph qualification coordinates drifted");
	const graphEvidence = validateCurrentGraphNativeEvidence(candidate.graphEvidence);
	const derivedFourReadInspectionBatchCount = graphEvidence.facts.filter(
		(fact) =>
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "completed" &&
			fact.result.disposition === "tool-intents" &&
			fact.result.toolIntents.length === 4 &&
			fact.result.toolIntents.every((tool) => tool === "read-file"),
	).length;
	const derivedSerialReadEffectCount = graphEvidence.facts.filter(
		(fact) =>
			fact.request.effectKind === "tool-action" &&
			fact.request.toolRef === "read-file" &&
			fact.result.effectKind === "tool-action" &&
			fact.result.toolRef === "read-file" &&
			fact.result.status === "succeeded",
	).length;
	if (derivedFourReadInspectionBatchCount !== 12 || derivedSerialReadEffectCount !== 48)
		throw new TypeError("D5 inspection-batch evidence drifted");
	const publicBehaviorEvidence = validateCurrentManagedCloudPublicSemanticValidation(
		candidate.publicBehaviorEvidence,
	);
	if (publicBehaviorEvidence.status !== "passed")
		throw new TypeError("current public behavior qualification did not pass");
	if (
		qualification.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		qualification.publicBehaviorEvidenceDigest !== publicBehaviorEvidence.evidenceDigest ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.graphEvidenceDigest !== graphEvidence.evidenceDigest
	)
		throw new TypeError("D5 Graph qualification cross-binding drifted");
	digest(qualification.qualificationDigest, "current.bundle.qualification.qualificationDigest");
	digest(generation.generationDigest, "current.bundle.generation.generationDigest");
	digest(candidate.bundleDigest, "current.bundle.bundleDigest");
	const qualificationMaterial = { ...qualification };
	delete qualificationMaterial.qualificationDigest;
	if (empiricalStrictJsonDigest(qualificationMaterial) !== qualification.qualificationDigest)
		throw new TypeError("D5 Graph qualification digest drifted");
	const generationMaterial = { ...generation };
	delete generationMaterial.generationDigest;
	if (empiricalStrictJsonDigest(generationMaterial) !== generation.generationDigest)
		throw new TypeError("D5 Graph generation digest drifted");
	const bundleMaterial = { ...candidate };
	delete bundleMaterial.bundleDigest;
	if (empiricalStrictJsonDigest(bundleMaterial) !== candidate.bundleDigest)
		throw new TypeError("D5 Graph bundle digest drifted");
	const validated = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		graphEvidence,
		publicBehaviorEvidence,
		qualification,
		generation,
		bundleDigest: candidate.bundleDigest,
	}) as CurrentGraphQualificationBundleV1;
	if (strictJsonCodec.encode(validated).byteLength > CURRENT_GRAPH_MAX_BUNDLE_BYTES)
		throw new TypeError("D5 Graph qualification bundle exceeded its byte bound");
	return validated;
}

interface CurrentGraphFileIdentity {
	readonly dev: number;
	readonly ino: number;
}

async function assertDirectoryIdentity(
	path: string,
	identity: CurrentGraphFileIdentity,
	mode: number,
): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== mode ||
		stat.nlink < 1 ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D5 Graph persistence directory identity drifted");
}

async function assertPrivateRoot(path: string): Promise<CurrentGraphFileIdentity> {
	if (!isAbsolute(path)) throw new TypeError("D5 Graph private root must be absolute");
	const stat = await lstat(path);
	const identity = Object.freeze({ dev: stat.dev, ino: stat.ino });
	await assertDirectoryIdentity(path, identity, 0o700);
	return identity;
}

async function writePrivateFile(
	path: string,
	bytes: Uint8Array,
): Promise<CurrentGraphFileIdentity> {
	const handle = await open(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D5 Graph persistence artifact identity drifted");
		return Object.freeze({ dev: stat.dev, ino: stat.ino });
	} finally {
		await handle.close();
	}
}

async function assertPrivateFile(
	path: string,
	identity: CurrentGraphFileIdentity,
	bytes: Uint8Array,
): Promise<void> {
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
			throw new TypeError("D5 Graph persistence artifact readback drifted");
	} finally {
		await handle.close();
	}
}

async function removeOwnedGeneration(
	path: string,
	identity: CurrentGraphFileIdentity,
	privateRoot: string,
	parentHandle: Awaited<ReturnType<typeof open>>,
): Promise<void> {
	await assertDirectoryIdentity(path, identity, 0o700);
	const tombstone = join(privateRoot, `.d5-inspection-batch-tombstone-${randomUUID()}`);
	await rename(path, tombstone);
	const moved = await lstat(tombstone);
	if (moved.dev !== identity.dev || moved.ino !== identity.ino)
		throw new TypeError("D5 Graph cleanup tombstone ownership drifted");
	await rm(tombstone, { recursive: true, force: true });
	await parentHandle.sync();
}

export async function persistCurrentGraphQualificationBundle(input: {
	readonly privateRoot: string;
	readonly bundle: CurrentGraphQualificationBundleV1;
	readonly fault?: CurrentGraphPersistenceFaultV1;
}): Promise<CurrentGraphPersistenceReceiptV1> {
	const captured = record(input, "current.persistence");
	exactKeys(
		captured,
		Object.hasOwn(captured, "fault")
			? ["bundle", "fault", "privateRoot"]
			: ["bundle", "privateRoot"],
		"current.persistence",
	);
	if (typeof captured.bundle !== "object" || captured.bundle === null)
		throw new TypeError("D5 Graph persistence bundle is invalid");
	if (!constructedBundles.has(captured.bundle))
		throw new TypeError("D5 Graph persistence requires a same-process qualified bundle");
	constructedBundles.delete(captured.bundle);
	const bundle = validateCurrentGraphQualificationBundle(captured.bundle);
	const fault = Object.hasOwn(captured, "fault") ? captured.fault : undefined;
	const faultStage = fault === undefined ? null : persistenceFaults.get(fault as object);
	if (fault !== undefined && faultStage === undefined)
		throw new TypeError("D5 Graph persistence fault is forged or replayed");
	if (fault !== undefined) persistenceFaults.delete(fault as object);
	if (typeof captured.privateRoot !== "string")
		throw new TypeError("D5 Graph private root must be a string");
	const privateRoot = captured.privateRoot;
	const rootIdentity = await assertPrivateRoot(privateRoot);
	const finalRoot = join(privateRoot, CURRENT_GRAPH_GENERATION_REF);
	const stagingRoot = join(finalRoot, ".staging");
	const artifactsRoot = join(finalRoot, "artifacts");
	const bundlePath = join(artifactsRoot, "bundle.v1.json");
	const markerPath = join(finalRoot, "commit.v1.json");
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let finalIdentity: CurrentGraphFileIdentity | null = null;
	let artifactsIdentity: CurrentGraphFileIdentity | null = null;
	let operationError: unknown = null;
	let receipt: CurrentGraphPersistenceReceiptV1 | null = null;
	try {
		const parentStat = await parentHandle.stat();
		if (parentStat.dev !== rootIdentity.dev || parentStat.ino !== rootIdentity.ino)
			throw new TypeError("D5 Graph private root handle drifted");
		await mkdir(finalRoot, { mode: 0o700 });
		await chmod(finalRoot, 0o700);
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const finalStat = await finalHandle.stat();
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await finalHandle.sync();
		await parentHandle.sync();
		if (faultStage === "after-claim") throw new TypeError("current injected after-claim failure");
		await mkdir(stagingRoot, { mode: 0o700 });
		const bytes = strictJsonCodec.encode(bundle);
		if (bytes.byteLength > CURRENT_GRAPH_MAX_BUNDLE_BYTES)
			throw new TypeError("D5 Graph persistence bundle exceeded its byte bound");
		const stagingHandle = await open(
			stagingRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		artifactsHandle = stagingHandle;
		const stagingStat = await stagingHandle.stat();
		artifactsIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		const stagingBundlePath = join(stagingRoot, "bundle.v1.json");
		const bundleIdentity = await writePrivateFile(stagingBundlePath, bytes);
		await stagingHandle.sync();
		await assertPrivateFile(stagingBundlePath, bundleIdentity, bytes);
		if (faultStage === "after-write") throw new TypeError("current injected after-write failure");
		await rename(stagingRoot, artifactsRoot);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		await finalHandle.sync();
		if (faultStage === "after-rename") throw new TypeError("current injected after-rename failure");
		const markerMaterial = strictSnapshot({
			schemaVersion: "graphrefly-ts.d5.current-graph-native-commit.v1",
			generationRef: CURRENT_GRAPH_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: empiricalSha256(bytes),
		});
		const markerBytes = strictJsonCodec.encode(markerMaterial);
		const markerIdentity = await writePrivateFile(markerPath, markerBytes);
		await finalHandle.sync();
		await parentHandle.sync();
		await assertPrivateFile(bundlePath, bundleIdentity, bytes);
		await assertPrivateFile(markerPath, markerIdentity, markerBytes);
		const [finalStable, artifactsStable, parentStable] = await Promise.all([
			finalHandle.stat(),
			artifactsHandle.stat(),
			parentHandle.stat(),
		]);
		if (
			finalStable.dev !== finalIdentity.dev ||
			finalStable.ino !== finalIdentity.ino ||
			artifactsStable.dev !== artifactsIdentity.dev ||
			artifactsStable.ino !== artifactsIdentity.ino ||
			parentStable.dev !== rootIdentity.dev ||
			parentStable.ino !== rootIdentity.ino
		)
			throw new TypeError("D5 Graph stable persistence handle drifted");
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(privateRoot, rootIdentity, 0o700);
		await assertPrivateFile(bundlePath, bundleIdentity, bytes);
		await assertPrivateFile(markerPath, markerIdentity, markerBytes);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(privateRoot, rootIdentity, 0o700);
		const receiptMaterial = strictSnapshot({
			generationRef: CURRENT_GRAPH_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: empiricalSha256(bytes),
			finalRoot,
		});
		receipt = Object.freeze({
			...receiptMaterial,
			receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
		});
	} catch (error) {
		operationError = error;
	}
	const closes = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closes
		.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
		.map((entry) => entry.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D5 Graph persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && finalIdentity !== null) {
		try {
			await removeOwnedGeneration(finalRoot, finalIdentity, privateRoot, parentHandle);
		} catch (error) {
			cleanupError = error;
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1) throw new AggregateError(errors, "D5 Graph persistence cleanup failed");
		throw operationError;
	}
	if (receipt === null) throw new TypeError("D5 Graph persistence did not linearize");
	return receipt;
}
