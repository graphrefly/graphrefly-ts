import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	coordinate,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
	string,
} from "./canonical.js";
import type {
	EmpiricalTaskQualificationReportV1,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import {
	createD682MechanicalQualificationScorecard,
	type D682MechanicalQualificationCatalogV1,
	type D682MechanicalQualificationScorecardV1,
	validateD682MechanicalQualificationCatalog,
} from "./d682-mechanical-qualification.js";
import {
	aggregateDeveloperGuidanceScorecard,
	createDeveloperGuidanceRecommendation,
	type DeveloperGuidanceObservationV2,
	type DeveloperGuidanceRecommendationV1,
	type DeveloperGuidanceScorecardV2,
	validateDeveloperGuidanceObservation,
} from "./developer-guidance-utility.js";
import {
	B112_CALIBRATION_CAMPAIGN_SCORECARD_SCHEMA,
	type B112CalibrationCampaignScorecardV4,
	type B112CalibrationTerminalSlotV4,
	createB112CalibrationCampaignScorecard,
	validateB112CalibrationTerminalSlots,
} from "./empirical-calibration.js";
import {
	createEmpiricalCampaignScorecard,
	type EmpiricalCalibrationTrialBlockObservationV4,
	type EmpiricalCampaignScorecardV3,
	type EmpiricalTrialBlockObservationV3,
	validateEmpiricalCampaignScorecard,
	validateEmpiricalTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
	MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
} from "./exact-private-needle-protection.js";
import { executeEmpiricalProtection } from "./model-execution.js";

export const PRIVATE_SMOKE_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.empirical-smoke-generation.v3";
const PRIVATE_OWNERSHIP_DIRECTORY = "empirical-memory-rerun-avoidance";
const OBSERVATION_FILE = "trial-block-observation.v3.json";
const SCORECARD_FILE = "campaign-scorecard.v3.json";
const GENERATION_FILE = "generation.v3.json";
export const PRIVATE_CALIBRATION_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.empirical-calibration-generation.v4";
const CALIBRATION_MANIFEST_FILE = "campaign-manifest.v1.json";
const CALIBRATION_SLOTS_FILE = "terminal-slots.v4.json";
const CALIBRATION_SCORECARD_FILE = "campaign-scorecard.v4.json";
const CALIBRATION_GENERATION_FILE = "generation.v4.json";
export const PRIVATE_D682_MECHANICAL_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d682-mechanical-qualification-generation.v1";
const D682_MECHANICAL_CATALOG_FILE = "mechanical-fixture-catalog.v1.json";
const D682_MECHANICAL_OBSERVATIONS_FILE = "mechanical-observations.v1.json";
const D682_MECHANICAL_SCORECARD_FILE = "mechanical-scorecard.v1.json";
const D682_MECHANICAL_GENERATION_FILE = "generation.v1.json";
export const PRIVATE_DEVELOPER_GUIDANCE_CALIBRATION_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.developer-guidance-calibration-generation.v1";
const GUIDANCE_CALIBRATION_MANIFEST_FILE = "campaign-manifest.v1.json";
const GUIDANCE_CALIBRATION_SLOTS_FILE = "terminal-slots.v4.json";
const GUIDANCE_CALIBRATION_SOURCE_SCORECARD_FILE = "source-campaign-scorecard.v4.json";
const GUIDANCE_CALIBRATION_OBSERVATIONS_FILE = "developer-guidance-observations.v2.json";
const GUIDANCE_CALIBRATION_SCORECARD_FILE = "developer-guidance-scorecard.v2.json";
const GUIDANCE_CALIBRATION_RECOMMENDATION_FILE = "developer-guidance-recommendation.v1.json";
const GUIDANCE_CALIBRATION_GENERATION_FILE = "generation.v1.json";
const PRIVATE_ARTIFACT_SCAN_CHUNK_CODE_UNITS = 32_768;
const PRIVATE_ARTIFACT_SCAN_CHUNK_OVERLAP_CODE_UNITS = MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS - 1;

export interface PersistedPrivateSmokeGenerationV3 {
	readonly generationPath: string;
	readonly generationDigest: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
}

export interface PersistedPrivateCalibrationGenerationV4 {
	readonly generationPath: string;
	readonly generationDigest: string;
	readonly manifestDigest: string;
	readonly terminalSlotsDigest: string;
	readonly scorecardDigest: string;
}

export interface PersistedPrivateD682MechanicalQualificationGenerationV1 {
	readonly generationPath: string;
	readonly generationDigest: string;
	readonly catalogDigest: string;
	readonly observationsDigest: string;
	readonly scorecardDigest: string;
}

export interface PersistedPrivateDeveloperGuidanceCalibrationGenerationV1 {
	readonly generationPath: string;
	readonly generationDigest: string;
	readonly manifestDigest: string;
	readonly terminalSlotsDigest: string;
	readonly sourceScorecardDigest: string;
	readonly guidanceObservationsDigest: string;
	readonly guidanceScorecardDigest: string;
	readonly recommendationDigest: string;
}

async function assertSafePrivateRoot(privateRoot: string): Promise<string> {
	if (!isAbsolute(privateRoot)) throw new TypeError("private smoke root must be absolute");
	if (
		basename(privateRoot) !== PRIVATE_OWNERSHIP_DIRECTORY ||
		basename(dirname(privateRoot)) !== ".private"
	) {
		throw new TypeError("private smoke root is outside the existing gitignored ownership path");
	}
	const rootStatus = await lstat(privateRoot);
	if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
		throw new TypeError("private smoke root must be a real directory");
	}
	if ((rootStatus.mode & 0o777) !== 0o700) {
		throw new TypeError("private smoke root must have exact 0700 permissions");
	}
	const canonicalRoot = await realpath(privateRoot);
	if (
		basename(canonicalRoot) !== PRIVATE_OWNERSHIP_DIRECTORY ||
		basename(dirname(canonicalRoot)) !== ".private"
	) {
		throw new TypeError("canonical private smoke root escaped its ownership path");
	}
	return canonicalRoot;
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	const persisted = await stat(path);
	if (
		!persisted.isFile() ||
		persisted.size !== bytes.byteLength ||
		(persisted.mode & 0o777) !== 0o600
	) {
		throw new TypeError("private smoke artifact did not persist with exact 0600 ownership");
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function* privateArtifactStrings(value: StrictJsonValue): Generator<string> {
	if (typeof value === "string") {
		yield value;
		return;
	}
	if (value === null || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const entry of value) yield* privateArtifactStrings(entry);
		return;
	}
	for (const [key, entry] of Object.entries(value)) {
		yield key;
		yield* privateArtifactStrings(entry);
	}
}

function* boundedPrivateArtifactStringChunks(value: string): Generator<string> {
	if (value.length <= PRIVATE_ARTIFACT_SCAN_CHUNK_CODE_UNITS) {
		yield value;
		return;
	}
	const stride =
		PRIVATE_ARTIFACT_SCAN_CHUNK_CODE_UNITS - PRIVATE_ARTIFACT_SCAN_CHUNK_OVERLAP_CODE_UNITS;
	for (let start = 0; start < value.length; start += stride) {
		yield value.slice(start, start + PRIVATE_ARTIFACT_SCAN_CHUNK_CODE_UNITS);
		if (start + PRIVATE_ARTIFACT_SCAN_CHUNK_CODE_UNITS >= value.length) return;
	}
}

/**
 * Applies the existing exact-known-needle policy to every string value and key
 * in one canonical artifact without weakening D655's per-inspection bounds.
 * The exact-needle policy itself compares strings independently, so this
 * bounded projection preserves its semantics while allowing a valid aggregate
 * artifact to contain more than 4,096 structural JSON nodes.
 */
export function assertPrivateArtifactProtection(input: {
	readonly subject: unknown;
	readonly label: string;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): void {
	const canonicalSubject = strictJsonCodec.decode(
		strictJsonCodec.encode(input.subject),
	) as StrictJsonValue;
	for (const value of privateArtifactStrings(canonicalSubject)) {
		for (const subject of boundedPrivateArtifactStringChunks(value)) {
			const protection = executeEmpiricalProtection(input.protectionExecutor, {
				policyRef: input.protectionExecutor.policyRef,
				policyRevision: input.protectionExecutor.policyRevision,
				stage: "model-egress",
				subject,
			});
			if (protection.receipt.disposition !== "allowed" || protection.issueCode !== null) {
				throw new TypeError(`${input.label} failed artifact-persistence protection`);
			}
		}
	}
}

/**
 * Persists only validated, bounded evidence projections. A complete generation
 * becomes visible in one directory rename; failures never return a success
 * receipt and best-effort remove their private staging directory.
 */
export async function persistPrivateSmokeGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: EmpiricalTrialBlockObservationV3;
	readonly scorecard: EmpiricalCampaignScorecardV3;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<PersistedPrivateSmokeGenerationV3> {
	const privateRoot = await assertSafePrivateRoot(input.privateRoot);
	const generationRef = coordinate(input.generationRef, "privateSmoke.generationRef");
	if (
		basename(generationRef) !== generationRef ||
		generationRef === "." ||
		generationRef === ".."
	) {
		throw new TypeError("private smoke generation ref must be one path-free coordinate");
	}
	const observation = validateEmpiricalTrialBlockObservation(input.observation);
	const scorecard = validateEmpiricalCampaignScorecard(input.scorecard);
	const expectedObservationDigest = scorecard.observationDigests[0];
	const observationBytes = strictJsonCodec.encode(observation);
	const scorecardBytes = strictJsonCodec.encode(scorecard);
	const observationDigest = empiricalSha256(observationBytes);
	const scorecardDigest = empiricalSha256(scorecardBytes);
	if (observationDigest !== expectedObservationDigest) {
		throw new TypeError("private smoke scorecard does not bind the supplied observation");
	}
	const deterministicScorecard = createEmpiricalCampaignScorecard(
		observation,
		scorecard.aggregationRevision,
	);
	if (empiricalStrictJsonDigest(deterministicScorecard) !== scorecardDigest) {
		throw new TypeError(
			"private smoke scorecard is not the canonical aggregation of its observation",
		);
	}
	const generation = strictSnapshot({
		schemaVersion: PRIVATE_SMOKE_GENERATION_SCHEMA,
		generationRef,
		observation: {
			file: OBSERVATION_FILE,
			digest: observationDigest,
			byteLength: observationBytes.byteLength,
		},
		scorecard: {
			file: SCORECARD_FILE,
			digest: scorecardDigest,
			byteLength: scorecardBytes.byteLength,
		},
	});
	for (const [subject, label] of [
		[observation, "observation"],
		[scorecard, "scorecard"],
		[generation, "generation"],
	] as const) {
		assertPrivateArtifactProtection({
			subject,
			label: `private smoke ${label}`,
			protectionExecutor: input.protectionExecutor,
		});
	}
	const generationBytes = strictJsonCodec.encode(generation);
	const generationDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	const stagingPath = join(privateRoot, `.staging-${randomUUID()}`);
	await mkdir(stagingPath, { mode: 0o700 });
	let committed = false;
	try {
		await chmod(stagingPath, 0o700);
		await writePrivateFile(join(stagingPath, OBSERVATION_FILE), observationBytes);
		await writePrivateFile(join(stagingPath, SCORECARD_FILE), scorecardBytes);
		await writePrivateFile(join(stagingPath, GENERATION_FILE), generationBytes);
		await syncDirectory(stagingPath);
		await rename(stagingPath, finalPath);
		committed = true;
		// Directory rename is the atomic visibility commit point. A best-effort
		// parent fsync strengthens crash durability without turning an already
		// visible complete generation into a reported persistence failure.
		await syncDirectory(privateRoot).catch(() => undefined);
		return Object.freeze({
			generationPath: finalPath,
			generationDigest,
			observationDigest,
			scorecardDigest,
		});
	} finally {
		if (!committed) {
			await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}

/** Persists one complete D677 fifteen-slot calibration generation atomically. */
export async function persistPrivateCalibrationGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly terminalSlots: readonly B112CalibrationTerminalSlotV4[];
	readonly scorecard: B112CalibrationCampaignScorecardV4;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<PersistedPrivateCalibrationGenerationV4> {
	const request = record(input, "privateCalibration.input");
	exactKeys(
		request,
		[
			"frozen",
			"generationRef",
			"privateRoot",
			"protectionExecutor",
			"qualificationReport",
			"scorecard",
			"terminalSlots",
		],
		"privateCalibration.input",
	);
	const frozen = request.frozen as FrozenEmpiricalCampaignManifestV1;
	const qualificationReport = request.qualificationReport as EmpiricalTaskQualificationReportV1;
	const protectionExecutor =
		request.protectionExecutor as EmpiricalExactPrivateNeedleProtectionExecutorV1;
	const suppliedScorecard = request.scorecard as B112CalibrationCampaignScorecardV4;
	const privateRootInput = string(request.privateRoot, "privateCalibration.privateRoot", 4_096);
	const generationRef = coordinate(request.generationRef, "privateCalibration.generationRef");
	if (
		basename(generationRef) !== generationRef ||
		generationRef === "." ||
		generationRef === ".."
	) {
		throw new TypeError("private calibration generation ref must be one path-free coordinate");
	}
	if (
		frozen.manifest.trialPlan.profile !== "calibration" ||
		empiricalStrictJsonDigest(frozen.manifest) !== frozen.manifestDigest
	) {
		throw new TypeError("private calibration manifest is not one frozen calibration authority");
	}
	if (
		!isEmpiricalExactPrivateNeedleProtectionExecutor(protectionExecutor) ||
		protectionExecutor.policyRef !== frozen.manifest.policies.protectionPolicyRef ||
		protectionExecutor.policyRevision !== frozen.manifest.policies.protectionPolicyRevision
	) {
		throw new TypeError(
			"private calibration protection executor does not match the frozen D656 policy",
		);
	}
	const terminalSlots = validateB112CalibrationTerminalSlots(
		frozen,
		qualificationReport,
		request.terminalSlots,
	);
	const deterministicScorecard = createB112CalibrationCampaignScorecard(
		frozen,
		qualificationReport,
		terminalSlots,
	);
	if (
		suppliedScorecard.schemaVersion !== B112_CALIBRATION_CAMPAIGN_SCORECARD_SCHEMA ||
		empiricalStrictJsonDigest(suppliedScorecard) !==
			empiricalStrictJsonDigest(deterministicScorecard)
	) {
		throw new TypeError(
			"private calibration scorecard is not the canonical terminal-slot aggregate",
		);
	}
	const manifestBytes = strictJsonCodec.encode(frozen.manifest);
	const terminalSlotsBytes = strictJsonCodec.encode(terminalSlots);
	const scorecardBytes = strictJsonCodec.encode(deterministicScorecard);
	const manifestDigest = empiricalSha256(manifestBytes);
	const terminalSlotsDigest = empiricalSha256(terminalSlotsBytes);
	const scorecardDigest = empiricalSha256(scorecardBytes);
	if (manifestDigest !== frozen.manifestDigest) {
		throw new TypeError("private calibration manifest bytes do not match the frozen digest");
	}
	const generation = strictSnapshot({
		schemaVersion: PRIVATE_CALIBRATION_GENERATION_SCHEMA,
		generationRef,
		manifest: {
			file: CALIBRATION_MANIFEST_FILE,
			digest: manifestDigest,
			byteLength: manifestBytes.byteLength,
		},
		terminalSlots: {
			file: CALIBRATION_SLOTS_FILE,
			digest: terminalSlotsDigest,
			byteLength: terminalSlotsBytes.byteLength,
			count: 15,
		},
		scorecard: {
			file: CALIBRATION_SCORECARD_FILE,
			digest: scorecardDigest,
			byteLength: scorecardBytes.byteLength,
		},
	});
	const protectedSubjects: readonly (readonly [unknown, string])[] = [
		[frozen.manifest, "manifest"],
		...terminalSlots.map((slot, index) => [slot, `terminal-slot-${index + 1}`] as const),
		[deterministicScorecard, "scorecard"],
		[generation, "generation"],
	];
	for (const [subject, label] of protectedSubjects) {
		assertPrivateArtifactProtection({
			subject,
			label: `private calibration ${label}`,
			protectionExecutor,
		});
	}
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const generationBytes = strictJsonCodec.encode(generation);
	const generationDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	const stagingPath = join(privateRoot, `.staging-${randomUUID()}`);
	await mkdir(stagingPath, { mode: 0o700 });
	let committed = false;
	try {
		await chmod(stagingPath, 0o700);
		await writePrivateFile(join(stagingPath, CALIBRATION_MANIFEST_FILE), manifestBytes);
		await writePrivateFile(join(stagingPath, CALIBRATION_SLOTS_FILE), terminalSlotsBytes);
		await writePrivateFile(join(stagingPath, CALIBRATION_SCORECARD_FILE), scorecardBytes);
		await writePrivateFile(join(stagingPath, CALIBRATION_GENERATION_FILE), generationBytes);
		await syncDirectory(stagingPath);
		await rename(stagingPath, finalPath);
		committed = true;
		await syncDirectory(privateRoot).catch(() => undefined);
		return Object.freeze({
			generationPath: finalPath,
			generationDigest,
			manifestDigest,
			terminalSlotsDigest,
			scorecardDigest,
		});
	} finally {
		if (!committed) {
			await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}

/** Persists one complete D682 three-fixture mechanical qualification atomically. */
export async function persistPrivateD682MechanicalQualificationGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly catalog: D682MechanicalQualificationCatalogV1;
	readonly observations: readonly EmpiricalCalibrationTrialBlockObservationV4[];
	readonly scorecard: D682MechanicalQualificationScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<PersistedPrivateD682MechanicalQualificationGenerationV1> {
	const generationRef = coordinate(input.generationRef, "privateD682Mechanical.generationRef");
	if (
		basename(generationRef) !== generationRef ||
		generationRef === "." ||
		generationRef === ".."
	) {
		throw new TypeError("private D682 mechanical generation ref must be one path-free coordinate");
	}
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(input.protectionExecutor)) {
		throw new TypeError("private D682 mechanical generation requires the D656 protection executor");
	}
	const catalog = validateD682MechanicalQualificationCatalog(input.catalog);
	const deterministicScorecard = createD682MechanicalQualificationScorecard({
		catalog,
		observations: input.observations,
	});
	if (
		empiricalStrictJsonDigest(deterministicScorecard) !== empiricalStrictJsonDigest(input.scorecard)
	) {
		throw new TypeError("private D682 mechanical scorecard is not its canonical aggregate");
	}
	const catalogBytes = strictJsonCodec.encode(catalog);
	const observationsBytes = strictJsonCodec.encode(input.observations);
	const scorecardBytes = strictJsonCodec.encode(deterministicScorecard);
	const catalogDigest = empiricalSha256(catalogBytes);
	const observationsDigest = empiricalSha256(observationsBytes);
	const scorecardDigest = empiricalSha256(scorecardBytes);
	const generation = strictSnapshot({
		schemaVersion: PRIVATE_D682_MECHANICAL_QUALIFICATION_GENERATION_SCHEMA,
		generationRef,
		catalog: {
			file: D682_MECHANICAL_CATALOG_FILE,
			digest: catalogDigest,
			byteLength: catalogBytes.byteLength,
		},
		observations: {
			file: D682_MECHANICAL_OBSERVATIONS_FILE,
			digest: observationsDigest,
			byteLength: observationsBytes.byteLength,
			count: 3,
		},
		scorecard: {
			file: D682_MECHANICAL_SCORECARD_FILE,
			digest: scorecardDigest,
			byteLength: scorecardBytes.byteLength,
		},
	});
	for (const [subject, label] of [
		[catalog, "catalog"],
		...input.observations.map((observation, index) => [observation, `observation-${index + 1}`]),
		[deterministicScorecard, "scorecard"],
		[generation, "generation"],
	] as const) {
		assertPrivateArtifactProtection({
			subject,
			label: `private D682 mechanical ${label}`,
			protectionExecutor: input.protectionExecutor,
		});
	}
	const privateRoot = await assertSafePrivateRoot(input.privateRoot);
	const generationBytes = strictJsonCodec.encode(generation);
	const generationDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	const stagingPath = join(privateRoot, `.staging-${randomUUID()}`);
	await mkdir(stagingPath, { mode: 0o700 });
	let committed = false;
	try {
		await chmod(stagingPath, 0o700);
		await writePrivateFile(join(stagingPath, D682_MECHANICAL_CATALOG_FILE), catalogBytes);
		await writePrivateFile(join(stagingPath, D682_MECHANICAL_OBSERVATIONS_FILE), observationsBytes);
		await writePrivateFile(join(stagingPath, D682_MECHANICAL_SCORECARD_FILE), scorecardBytes);
		await writePrivateFile(join(stagingPath, D682_MECHANICAL_GENERATION_FILE), generationBytes);
		await syncDirectory(stagingPath);
		await rename(stagingPath, finalPath);
		committed = true;
		await syncDirectory(privateRoot).catch(() => undefined);
		return Object.freeze({
			generationPath: finalPath,
			generationDigest,
			catalogDigest,
			observationsDigest,
			scorecardDigest,
		});
	} finally {
		if (!committed) {
			await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}

/** Atomically persists one complete D688 source campaign and D684 guidance projection. */
export async function persistPrivateDeveloperGuidanceCalibrationGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly terminalSlots: readonly B112CalibrationTerminalSlotV4[];
	readonly sourceScorecard: B112CalibrationCampaignScorecardV4;
	readonly guidanceObservations: readonly DeveloperGuidanceObservationV2[];
	readonly guidanceScorecard: DeveloperGuidanceScorecardV2;
	readonly recommendation: DeveloperGuidanceRecommendationV1;
	readonly expectedTaskIds: readonly [string, string, string, string, string];
	readonly assessedActionCounts: readonly {
		readonly observationId: string;
		readonly actionCount: number;
	}[];
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<PersistedPrivateDeveloperGuidanceCalibrationGenerationV1> {
	const generationRef = coordinate(input.generationRef, "privateDeveloperGuidance.generationRef");
	if (
		basename(generationRef) !== generationRef ||
		generationRef === "." ||
		generationRef === ".."
	) {
		throw new TypeError(
			"private developer guidance generation ref must be one path-free coordinate",
		);
	}
	if (
		input.frozen.manifest.trialPlan.profile !== "calibration" ||
		empiricalStrictJsonDigest(input.frozen.manifest) !== input.frozen.manifestDigest ||
		!isEmpiricalExactPrivateNeedleProtectionExecutor(input.protectionExecutor) ||
		input.protectionExecutor.policyRef !== input.frozen.manifest.policies.protectionPolicyRef ||
		input.protectionExecutor.policyRevision !==
			input.frozen.manifest.policies.protectionPolicyRevision
	) {
		throw new TypeError("private developer guidance authority is invalid");
	}
	const terminalSlots = validateB112CalibrationTerminalSlots(
		input.frozen,
		input.qualificationReport,
		input.terminalSlots,
	);
	const sourceScorecard = createB112CalibrationCampaignScorecard(
		input.frozen,
		input.qualificationReport,
		terminalSlots,
	);
	if (
		empiricalStrictJsonDigest(sourceScorecard) !== empiricalStrictJsonDigest(input.sourceScorecard)
	) {
		throw new TypeError("private developer guidance source scorecard is not canonical");
	}
	const guidanceObservations = input.guidanceObservations
		.map(validateDeveloperGuidanceObservation)
		.sort((left, right) =>
			left.observationId < right.observationId
				? -1
				: left.observationId > right.observationId
					? 1
					: 0,
		);
	const assessedActionCounts = new Map(
		input.assessedActionCounts.map((entry) => [entry.observationId, entry.actionCount] as const),
	);
	for (const observation of guidanceObservations) {
		const sourceSlot = terminalSlots.find(
			(slot) =>
				slot.taskRef === observation.taskId &&
				slot.observation?.trialBlockRef === observation.matchedBlockId,
		);
		const sourceObservation = sourceSlot?.observation;
		const sourceBranch = sourceObservation?.warmBranches.find(
			(branch) => branch.branchKind === observation.arm,
		);
		if (
			sourceObservation === undefined ||
			sourceBranch?.attempted !== true ||
			sourceBranch.run === null ||
			observation.evidence.sourceObservationDigest !==
				empiricalStrictJsonDigest(sourceObservation) ||
			observation.evidence.sourceRunDigest !== empiricalStrictJsonDigest(sourceBranch.run) ||
			observation.evidence.actionTraceDigest !== sourceBranch.run.actionTraceDigest ||
			assessedActionCounts.get(observation.observationId) !== sourceBranch.run.actionTrace.length
		) {
			throw new TypeError("private developer guidance observation is not source-run-bound");
		}
	}
	const guidanceScorecard = aggregateDeveloperGuidanceScorecard(guidanceObservations);
	if (
		empiricalStrictJsonDigest(guidanceScorecard) !==
		empiricalStrictJsonDigest(input.guidanceScorecard)
	) {
		throw new TypeError("private developer guidance scorecard is not canonical");
	}
	const recommendation = createDeveloperGuidanceRecommendation({
		observations: guidanceObservations,
		scorecard: guidanceScorecard,
		expectedTaskIds: input.expectedTaskIds,
		assessedActionCounts: input.assessedActionCounts,
	});
	if (
		empiricalStrictJsonDigest(recommendation) !== empiricalStrictJsonDigest(input.recommendation)
	) {
		throw new TypeError("private developer guidance recommendation is not canonical");
	}
	const manifestBytes = strictJsonCodec.encode(input.frozen.manifest);
	const terminalSlotsBytes = strictJsonCodec.encode(terminalSlots);
	const sourceScorecardBytes = strictJsonCodec.encode(sourceScorecard);
	const guidanceObservationsBytes = strictJsonCodec.encode(guidanceObservations);
	const guidanceScorecardBytes = strictJsonCodec.encode(guidanceScorecard);
	const recommendationBytes = strictJsonCodec.encode(recommendation);
	const manifestDigest = empiricalSha256(manifestBytes);
	const terminalSlotsDigest = empiricalSha256(terminalSlotsBytes);
	const sourceScorecardDigest = empiricalSha256(sourceScorecardBytes);
	const guidanceObservationsDigest = empiricalSha256(guidanceObservationsBytes);
	const guidanceScorecardDigest = empiricalSha256(guidanceScorecardBytes);
	const recommendationDigest = empiricalSha256(recommendationBytes);
	if (manifestDigest !== input.frozen.manifestDigest) {
		throw new TypeError("private developer guidance manifest bytes changed");
	}
	const generation = strictSnapshot({
		schemaVersion: PRIVATE_DEVELOPER_GUIDANCE_CALIBRATION_GENERATION_SCHEMA,
		generationRef,
		manifest: {
			file: GUIDANCE_CALIBRATION_MANIFEST_FILE,
			digest: manifestDigest,
			byteLength: manifestBytes.byteLength,
		},
		terminalSlots: {
			file: GUIDANCE_CALIBRATION_SLOTS_FILE,
			digest: terminalSlotsDigest,
			byteLength: terminalSlotsBytes.byteLength,
			count: terminalSlots.length,
		},
		sourceScorecard: {
			file: GUIDANCE_CALIBRATION_SOURCE_SCORECARD_FILE,
			digest: sourceScorecardDigest,
			byteLength: sourceScorecardBytes.byteLength,
		},
		guidanceObservations: {
			file: GUIDANCE_CALIBRATION_OBSERVATIONS_FILE,
			digest: guidanceObservationsDigest,
			byteLength: guidanceObservationsBytes.byteLength,
			count: guidanceObservations.length,
		},
		guidanceScorecard: {
			file: GUIDANCE_CALIBRATION_SCORECARD_FILE,
			digest: guidanceScorecardDigest,
			byteLength: guidanceScorecardBytes.byteLength,
		},
		recommendation: {
			file: GUIDANCE_CALIBRATION_RECOMMENDATION_FILE,
			digest: recommendationDigest,
			byteLength: recommendationBytes.byteLength,
		},
	});
	for (const [subject, label] of [
		[input.frozen.manifest, "manifest"],
		...terminalSlots.map((slot, index) => [slot, `terminal-slot-${index + 1}`]),
		[sourceScorecard, "source-scorecard"],
		...guidanceObservations.map((observation, index) => [
			observation,
			`guidance-observation-${index + 1}`,
		]),
		[guidanceScorecard, "guidance-scorecard"],
		[recommendation, "recommendation"],
		[generation, "generation"],
	] as const) {
		assertPrivateArtifactProtection({
			subject,
			label: `private developer guidance ${label}`,
			protectionExecutor: input.protectionExecutor,
		});
	}
	const privateRoot = await assertSafePrivateRoot(input.privateRoot);
	const generationBytes = strictJsonCodec.encode(generation);
	const generationDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	const stagingPath = join(privateRoot, `.staging-${randomUUID()}`);
	await mkdir(stagingPath, { mode: 0o700 });
	let committed = false;
	try {
		await chmod(stagingPath, 0o700);
		await writePrivateFile(join(stagingPath, GUIDANCE_CALIBRATION_MANIFEST_FILE), manifestBytes);
		await writePrivateFile(join(stagingPath, GUIDANCE_CALIBRATION_SLOTS_FILE), terminalSlotsBytes);
		await writePrivateFile(
			join(stagingPath, GUIDANCE_CALIBRATION_SOURCE_SCORECARD_FILE),
			sourceScorecardBytes,
		);
		await writePrivateFile(
			join(stagingPath, GUIDANCE_CALIBRATION_OBSERVATIONS_FILE),
			guidanceObservationsBytes,
		);
		await writePrivateFile(
			join(stagingPath, GUIDANCE_CALIBRATION_SCORECARD_FILE),
			guidanceScorecardBytes,
		);
		await writePrivateFile(
			join(stagingPath, GUIDANCE_CALIBRATION_RECOMMENDATION_FILE),
			recommendationBytes,
		);
		await writePrivateFile(
			join(stagingPath, GUIDANCE_CALIBRATION_GENERATION_FILE),
			generationBytes,
		);
		await syncDirectory(stagingPath);
		await rename(stagingPath, finalPath);
		committed = true;
		await syncDirectory(privateRoot).catch(() => undefined);
		return Object.freeze({
			generationPath: finalPath,
			generationDigest,
			manifestDigest,
			terminalSlotsDigest,
			sourceScorecardDigest,
			guidanceObservationsDigest,
			guidanceScorecardDigest,
			recommendationDigest,
		});
	} finally {
		if (!committed) {
			await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}
