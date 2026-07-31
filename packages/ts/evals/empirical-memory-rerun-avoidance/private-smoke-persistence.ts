import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	coordinate,
	empiricalSha256,
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "./canonical.js";
import {
	createEmpiricalCampaignScorecard,
	type EmpiricalCampaignScorecardV3,
	type EmpiricalTrialBlockObservationV3,
	validateEmpiricalCampaignScorecard,
	validateEmpiricalTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
import type { EmpiricalExactPrivateNeedleProtectionExecutorV1 } from "./exact-private-needle-protection.js";
import { executeEmpiricalProtection } from "./model-execution.js";

export const PRIVATE_SMOKE_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.empirical-smoke-generation.v3";
const PRIVATE_OWNERSHIP_DIRECTORY = "empirical-memory-rerun-avoidance";
const OBSERVATION_FILE = "trial-block-observation.v3.json";
const SCORECARD_FILE = "campaign-scorecard.v3.json";
const GENERATION_FILE = "generation.v3.json";

export interface PersistedPrivateSmokeGenerationV3 {
	readonly generationPath: string;
	readonly generationDigest: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
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
		const protectedSubject = strictJsonCodec.decode(
			strictJsonCodec.encode(subject),
		) as StrictJsonValue;
		const protection = executeEmpiricalProtection(input.protectionExecutor, {
			policyRef: input.protectionExecutor.policyRef,
			policyRevision: input.protectionExecutor.policyRevision,
			// D655's closed stage set is unchanged; persistence reuses the
			// already-locked model-egress inspection capability immediately
			// before writing the sanitized projection.
			stage: "model-egress",
			subject: protectedSubject,
		});
		if (protection.receipt.disposition !== "allowed" || protection.issueCode !== null) {
			throw new TypeError(`private smoke ${label} failed artifact-persistence protection`);
		}
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
