import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	assertCanonicalBytes,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	strictSnapshot,
} from "./canonical.js";
import { D691_PRIVATE_PERSISTENCE_ROOT } from "./d691-historical-transfer-live.js";
import {
	commitD696PrivateStagingDirectory,
	failD696PrivateStagingGeneration,
} from "./d696-continuation-assisted-live.js";
import {
	D703_DRY_RUN_GENERATION_DIGEST,
	D703_DRY_RUN_OBSERVATION_DIGEST,
	D703_DRY_RUN_SCORECARD_DIGEST,
} from "./d703-mutation-first-recovery-live.js";
import {
	D705_APPROVAL_REF,
	D705_APPROVAL_REVISION,
	D705_PRICING_REVISION,
} from "./d705-mutation-first-live.js";
import {
	consumeD707FreshPricingReadForPreflight,
	D707_D705_MODULE_SOURCE_DIGEST,
	D707_OFFICIAL_PRICING_GET_REVISION,
	type D707FreshPricingReadV1,
	validateD707FreshPricingRead,
} from "./d707-official-pricing-read.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import { OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION } from "./openrouter-route-qualification.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D707_PRELIVE_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.d707-fresh-pricing-prelive-observation.v1" as const;
export const D707_PRELIVE_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.d707-fresh-pricing-prelive-scorecard.v1" as const;
export const D707_PRELIVE_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d707-fresh-pricing-prelive-generation.v1" as const;
export const D707_PRELIVE_CLAIM_BOUNDARY =
	"d705-exact-six-arm-baseline-d706-fresh-pricing-only-no-live-authority" as const;
export const D707_PRELIVE_GENERATION_REF =
	"d707-fresh-pricing-no-network-qualified-2026-08-09-v1" as const;
export const D707_PRELIVE_OBSERVATION_DIGEST =
	"sha256:e0bef8eca042fbdb832d70c5f10bd5a01dff5c8c19a039ab9ccac9e24a57a51d" as const;
export const D707_PRELIVE_SCORECARD_DIGEST =
	"sha256:b40c5703a35bd7aaa117d1545b2e9afdb3ad5a579b172ae38a5f473e85dc335f" as const;
export const D707_PRELIVE_GENERATION_DIGEST =
	"sha256:ee3b78bb1a34e5f12d684cfd3d9fd261d18f9e2ddcd93a8c8f8f453ffe6a6271" as const;
export const D707_PRELIVE_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:a8d627a283aae15bd0d97a8502831857565e78adb8b1055bccdd8a4199fdd9d0" as const;
export const D707_PRELIVE_SCORECARD_ARTIFACT_DIGEST =
	"sha256:d5f33884dcc4f657f3bdb335e795092881199e8b60e77c7f0f55eabc18e0cb59" as const;
export const D707_PRELIVE_GENERATION_ARTIFACT_DIGEST =
	"sha256:828fce63be1f3e8f5acc439a2c302645e611ce819541e300232e7c3543e1c323" as const;

const D707_STAGE_ORDER = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export interface D707PreLiveObservationV1 {
	readonly schemaVersion: typeof D707_PRELIVE_OBSERVATION_SCHEMA;
	readonly claimBoundary: typeof D707_PRELIVE_CLAIM_BOUNDARY;
	readonly decisionRef: "decision.D707";
	readonly decisionRevision: typeof D707_OFFICIAL_PRICING_GET_REVISION;
	readonly executionClass: "simulated-contract";
	readonly baselineDecisionRef: typeof D705_APPROVAL_REF;
	readonly baselineDecisionRevision: typeof D705_APPROVAL_REVISION;
	readonly baselineFreshnessRevisionRejected: typeof D705_PRICING_REVISION;
	readonly baselineFailureKind: "pre-inference-route-pricing-revision-mismatch";
	readonly d705ModuleSourceDigest: typeof D707_D705_MODULE_SOURCE_DIGEST;
	readonly d703ObservationDigest: typeof D703_DRY_RUN_OBSERVATION_DIGEST;
	readonly d703ScorecardDigest: typeof D703_DRY_RUN_SCORECARD_DIGEST;
	readonly d703GenerationDigest: typeof D703_DRY_RUN_GENERATION_DIGEST;
	readonly stageOrder: typeof D707_STAGE_ORDER;
	readonly fullSixArmDryRunBound: true;
	readonly stoppingUnchanged: true;
	readonly freshPricingRead: D707FreshPricingReadV1;
	readonly frozenRoutePricingRevision: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION;
	readonly routeSchemaChanged: false;
	readonly historicalEvidenceReinterpreted: false;
	readonly credentialReads: 0;
	readonly controlPlaneCalls: 0;
	readonly networkCalls: 0;
	readonly providerCalls: 0;
	readonly dispatchClaims: 0;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly observationDigest: string;
}

export interface D707PreLiveScorecardV1 {
	readonly schemaVersion: typeof D707_PRELIVE_SCORECARD_SCHEMA;
	readonly claimBoundary: typeof D707_PRELIVE_CLAIM_BOUNDARY;
	readonly observationDigests: readonly [string];
	readonly attemptedQualifications: 1;
	readonly qualifiedQualifications: 1;
	readonly fullSixArmDryRunBound: true;
	readonly freshPricingMatchesFrozenSchedule: true;
	readonly liveAuthorityGranted: false;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly status: "pre-live-qualified-no-live-authority";
	readonly scorecardDigest: string;
}

export interface D707PreLiveGenerationV1 {
	readonly schemaVersion: typeof D707_PRELIVE_GENERATION_SCHEMA;
	readonly generationRef: typeof D707_PRELIVE_GENERATION_REF;
	readonly claimBoundary: typeof D707_PRELIVE_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly observation: {
		readonly file: "fresh-pricing-prelive-observation.v1.json";
		readonly digest: string;
	};
	readonly scorecard: {
		readonly file: "fresh-pricing-prelive-scorecard.v1.json";
		readonly digest: string;
	};
	readonly generationDigest: string;
}

const constructedObservations = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();

function validateStageOrder(value: unknown): typeof D707_STAGE_ORDER {
	const stages = array(value, "d707.stageOrder");
	if (stages.length !== D707_STAGE_ORDER.length)
		throw new TypeError("D707 stage order length drifted");
	for (let index = 0; index < D707_STAGE_ORDER.length; index += 1) {
		literal(stages[index], D707_STAGE_ORDER[index], `d707.stageOrder[${index}]`);
	}
	return D707_STAGE_ORDER;
}

export function createD707PreLiveQualification(input: {
	readonly freshPricingRead: D707FreshPricingReadV1;
}): {
	readonly observation: D707PreLiveObservationV1;
	readonly scorecard: D707PreLiveScorecardV1;
} {
	const candidate = record(input, "d707.preLiveQualification");
	exactKeys(candidate, ["freshPricingRead"], "d707.preLiveQualification");
	const pricing = consumeD707FreshPricingReadForPreflight(candidate.freshPricingRead);
	literal(
		pricing.read.historicalPreflightDigest,
		pricing.historicalPreflight.historicalPreflightDigest,
		"d707.historicalPreflightDigest",
	);
	literal(
		pricing.historicalPreflight.d705ModuleSourceDigest,
		D707_D705_MODULE_SOURCE_DIGEST,
		"d707.d705ModuleSourceDigest",
	);
	const material = strictSnapshot({
		schemaVersion: D707_PRELIVE_OBSERVATION_SCHEMA,
		claimBoundary: D707_PRELIVE_CLAIM_BOUNDARY,
		decisionRef: "decision.D707" as const,
		decisionRevision: D707_OFFICIAL_PRICING_GET_REVISION,
		executionClass: "simulated-contract" as const,
		baselineDecisionRef: D705_APPROVAL_REF,
		baselineDecisionRevision: D705_APPROVAL_REVISION,
		baselineFreshnessRevisionRejected: D705_PRICING_REVISION,
		baselineFailureKind: "pre-inference-route-pricing-revision-mismatch" as const,
		d705ModuleSourceDigest: D707_D705_MODULE_SOURCE_DIGEST,
		d703ObservationDigest: pricing.historicalPreflight.d703ObservationDigest,
		d703ScorecardDigest: pricing.historicalPreflight.d703ScorecardDigest,
		d703GenerationDigest: pricing.historicalPreflight.d703GenerationDigest,
		stageOrder: D707_STAGE_ORDER,
		fullSixArmDryRunBound: true as const,
		stoppingUnchanged: true as const,
		freshPricingRead: pricing.read,
		frozenRoutePricingRevision: pricing.match.frozenScheduleRevision,
		routeSchemaChanged: false as const,
		historicalEvidenceReinterpreted: false as const,
		credentialReads: 0 as const,
		controlPlaneCalls: 0 as const,
		networkCalls: 0 as const,
		providerCalls: 0 as const,
		dispatchClaims: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const observation = strictSnapshot({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D707PreLiveObservationV1;
	validateD707PreLiveObservation(observation);
	constructedObservations.add(observation);
	return Object.freeze({ observation, scorecard: createD707PreLiveScorecard(observation) });
}

export function validateD707PreLiveObservation(value: unknown): D707PreLiveObservationV1 {
	const candidate = record(value, "d707.observation");
	exactKeys(
		candidate,
		[
			"baselineDecisionRef",
			"baselineDecisionRevision",
			"baselineFailureKind",
			"baselineFreshnessRevisionRejected",
			"causalAttribution",
			"claimBoundary",
			"controlPlaneCalls",
			"credentialReads",
			"d703GenerationDigest",
			"d703ObservationDigest",
			"d703ScorecardDigest",
			"d705ModuleSourceDigest",
			"decisionRef",
			"decisionRevision",
			"dispatchClaims",
			"efficacyClaim",
			"executionClass",
			"freshPricingRead",
			"frozenRoutePricingRevision",
			"fullSixArmDryRunBound",
			"historicalEvidenceReinterpreted",
			"networkCalls",
			"observationDigest",
			"providerCalls",
			"routeSchemaChanged",
			"schemaVersion",
			"stageOrder",
			"stoppingUnchanged",
		],
		"d707.observation",
	);
	literal(candidate.schemaVersion, D707_PRELIVE_OBSERVATION_SCHEMA, "d707.schema");
	literal(candidate.claimBoundary, D707_PRELIVE_CLAIM_BOUNDARY, "d707.claimBoundary");
	literal(candidate.decisionRef, "decision.D707", "d707.decisionRef");
	literal(candidate.decisionRevision, D707_OFFICIAL_PRICING_GET_REVISION, "d707.decisionRevision");
	literal(candidate.executionClass, "simulated-contract", "d707.executionClass");
	literal(candidate.baselineDecisionRef, D705_APPROVAL_REF, "d707.baselineDecisionRef");
	literal(
		candidate.baselineDecisionRevision,
		D705_APPROVAL_REVISION,
		"d707.baselineDecisionRevision",
	);
	literal(
		candidate.baselineFreshnessRevisionRejected,
		D705_PRICING_REVISION,
		"d707.baselineFreshnessRevisionRejected",
	);
	literal(
		candidate.baselineFailureKind,
		"pre-inference-route-pricing-revision-mismatch",
		"d707.baselineFailureKind",
	);
	literal(candidate.d705ModuleSourceDigest, D707_D705_MODULE_SOURCE_DIGEST, "d707.d705Source");
	literal(candidate.d703ObservationDigest, D703_DRY_RUN_OBSERVATION_DIGEST, "d707.d703Observation");
	literal(candidate.d703ScorecardDigest, D703_DRY_RUN_SCORECARD_DIGEST, "d707.d703Scorecard");
	literal(candidate.d703GenerationDigest, D703_DRY_RUN_GENERATION_DIGEST, "d707.d703Generation");
	validateStageOrder(candidate.stageOrder);
	literal(candidate.fullSixArmDryRunBound, true, "d707.fullSixArmDryRunBound");
	literal(candidate.stoppingUnchanged, true, "d707.stoppingUnchanged");
	const pricingRead = validateD707FreshPricingRead(candidate.freshPricingRead);
	if (pricingRead.historicalPreflightDigest === null) {
		throw new TypeError("D707 observation requires an exact historical preflight digest");
	}
	literal(
		candidate.frozenRoutePricingRevision,
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		"d707.frozenRoutePricingRevision",
	);
	literal(candidate.routeSchemaChanged, false, "d707.routeSchemaChanged");
	literal(candidate.historicalEvidenceReinterpreted, false, "d707.historicalEvidenceReinterpreted");
	for (const key of [
		"credentialReads",
		"controlPlaneCalls",
		"networkCalls",
		"providerCalls",
		"dispatchClaims",
	] as const) {
		literal(candidate[key], 0, `d707.${key}`);
	}
	literal(candidate.causalAttribution, "undetermined", "d707.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d707.efficacyClaim");
	const observationDigest = digest(candidate.observationDigest, "d707.observationDigest");
	const { observationDigest: _ignored, ...observationMaterial } = candidate;
	literal(
		observationDigest,
		empiricalStrictJsonDigest(observationMaterial),
		"d707.observationDigest",
	);
	return strictSnapshot(candidate) as unknown as D707PreLiveObservationV1;
}

export function createD707PreLiveScorecard(
	value: D707PreLiveObservationV1,
): D707PreLiveScorecardV1 {
	const observation = validateD707PreLiveObservation(value);
	const material = strictSnapshot({
		schemaVersion: D707_PRELIVE_SCORECARD_SCHEMA,
		claimBoundary: D707_PRELIVE_CLAIM_BOUNDARY,
		observationDigests: [observation.observationDigest] as const,
		attemptedQualifications: 1 as const,
		qualifiedQualifications: 1 as const,
		fullSixArmDryRunBound: true as const,
		freshPricingMatchesFrozenSchedule: true as const,
		liveAuthorityGranted: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		status: "pre-live-qualified-no-live-authority" as const,
	});
	const scorecard = strictSnapshot({
		...material,
		scorecardDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D707PreLiveScorecardV1;
	constructedScorecards.add(scorecard);
	return scorecard;
}

export function validateD707PreLiveScorecard(
	value: unknown,
	observation: D707PreLiveObservationV1,
): D707PreLiveScorecardV1 {
	const candidate = record(value, "d707.scorecard");
	const expected = createD707PreLiveScorecard(observation);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(expected)) {
		throw new TypeError("D707 scorecard is not exactly derived from its observation");
	}
	return expected;
}

function capturedArtifactBytes(value: unknown): Readonly<{
	observationBytes: Uint8Array;
	scorecardBytes: Uint8Array;
	generationBytes: Uint8Array;
}> {
	const candidate = record(value, "d707.artifacts");
	exactKeys(candidate, ["generationBytes", "observationBytes", "scorecardBytes"], "d707.artifacts");
	const copy = (key: "observationBytes" | "scorecardBytes" | "generationBytes", max: number) => {
		const raw = candidate[key];
		if (!(raw instanceof Uint8Array)) throw new TypeError(`d707.artifacts.${key}: expected bytes`);
		const bytes = new Uint8Array(raw);
		if (bytes.byteLength === 0 || bytes.byteLength > max) {
			throw new TypeError(`d707.artifacts.${key}: byte bound exceeded`);
		}
		return bytes;
	};
	return Object.freeze({
		observationBytes: copy("observationBytes", 64_000),
		scorecardBytes: copy("scorecardBytes", 16_000),
		generationBytes: copy("generationBytes", 16_000),
	});
}

export function validateD707PreLiveArtifactBytes(value: unknown): {
	readonly observationDigest: typeof D707_PRELIVE_OBSERVATION_DIGEST;
	readonly scorecardDigest: typeof D707_PRELIVE_SCORECARD_DIGEST;
	readonly generationDigest: typeof D707_PRELIVE_GENERATION_DIGEST;
} {
	const bytes = capturedArtifactBytes(value);
	for (const [key, expected] of [
		["observationBytes", D707_PRELIVE_OBSERVATION_ARTIFACT_DIGEST],
		["scorecardBytes", D707_PRELIVE_SCORECARD_ARTIFACT_DIGEST],
		["generationBytes", D707_PRELIVE_GENERATION_ARTIFACT_DIGEST],
	] as const) {
		literal(empiricalSha256(bytes[key]), expected, `d707.artifacts.${key}.digest`);
	}
	const observationDecoded = strictJsonCodec.decode(bytes.observationBytes);
	assertCanonicalBytes(observationDecoded, bytes.observationBytes, "d707.artifacts.observation");
	const observation = validateD707PreLiveObservation(observationDecoded);
	literal(
		observation.observationDigest,
		D707_PRELIVE_OBSERVATION_DIGEST,
		"d707.artifacts.observationDigest",
	);
	const scorecardDecoded = strictJsonCodec.decode(bytes.scorecardBytes);
	assertCanonicalBytes(scorecardDecoded, bytes.scorecardBytes, "d707.artifacts.scorecard");
	const scorecard = validateD707PreLiveScorecard(scorecardDecoded, observation);
	literal(
		scorecard.scorecardDigest,
		D707_PRELIVE_SCORECARD_DIGEST,
		"d707.artifacts.scorecardDigest",
	);
	const generationDecoded = strictJsonCodec.decode(bytes.generationBytes);
	assertCanonicalBytes(generationDecoded, bytes.generationBytes, "d707.artifacts.generation");
	const generation = record(generationDecoded, "d707.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"claimBoundary",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"observation",
			"schemaVersion",
			"scorecard",
		],
		"d707.generation",
	);
	literal(generation.schemaVersion, D707_PRELIVE_GENERATION_SCHEMA, "d707.generation.schema");
	literal(generation.generationRef, D707_PRELIVE_GENERATION_REF, "d707.generation.ref");
	literal(generation.claimBoundary, D707_PRELIVE_CLAIM_BOUNDARY, "d707.generation.claim");
	literal(generation.causalAttribution, "undetermined", "d707.generation.attribution");
	literal(generation.efficacyClaim, "none", "d707.generation.efficacy");
	for (const [key, file, expected] of [
		["observation", "fresh-pricing-prelive-observation.v1.json", D707_PRELIVE_OBSERVATION_DIGEST],
		["scorecard", "fresh-pricing-prelive-scorecard.v1.json", D707_PRELIVE_SCORECARD_DIGEST],
	] as const) {
		const ref = record(generation[key], `d707.generation.${key}`);
		exactKeys(ref, ["digest", "file"], `d707.generation.${key}`);
		literal(ref.file, file, `d707.generation.${key}.file`);
		literal(ref.digest, expected, `d707.generation.${key}.digest`);
	}
	const generationDigest = digest(generation.generationDigest, "d707.generation.digest");
	const { generationDigest: _ignored, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d707.generation.digest",
	);
	literal(generationDigest, D707_PRELIVE_GENERATION_DIGEST, "d707.generation.frozenDigest");
	return Object.freeze({
		observationDigest: D707_PRELIVE_OBSERVATION_DIGEST,
		scorecardDigest: D707_PRELIVE_SCORECARD_DIGEST,
		generationDigest: D707_PRELIVE_GENERATION_DIGEST,
	});
}

export async function persistD707PreLiveGeneration(input: {
	readonly privateRoot: string;
	readonly observation: D707PreLiveObservationV1;
	readonly scorecard: D707PreLiveScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const candidate = record(input, "d707.persistence");
	exactKeys(
		candidate,
		["observation", "privateRoot", "protectionExecutor", "scorecard"],
		"d707.persistence",
	);
	if (!constructedObservations.has(candidate.observation as object)) {
		throw new TypeError("D707 persistence requires same-process observation");
	}
	const observation = validateD707PreLiveObservation(candidate.observation);
	if (!constructedScorecards.has(candidate.scorecard as object)) {
		throw new TypeError("D707 persistence requires same-process scorecard");
	}
	const scorecard = validateD707PreLiveScorecard(candidate.scorecard, observation);
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(candidate.protectionExecutor)) {
		throw new TypeError("D707 persistence requires constructed protection");
	}
	const privateRoot = await assertSafePrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT);
	if (candidate.privateRoot !== privateRoot) throw new TypeError("D707 persistence root drifted");
	const generationMaterial = strictSnapshot({
		schemaVersion: D707_PRELIVE_GENERATION_SCHEMA,
		generationRef: D707_PRELIVE_GENERATION_REF,
		claimBoundary: D707_PRELIVE_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		observation: {
			file: "fresh-pricing-prelive-observation.v1.json" as const,
			digest: observation.observationDigest,
		},
		scorecard: {
			file: "fresh-pricing-prelive-scorecard.v1.json" as const,
			digest: scorecard.scorecardDigest,
		},
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	}) as unknown as D707PreLiveGenerationV1;
	for (const [label, subject] of [
		["D707 observation", observation],
		["D707 scorecard", scorecard],
		["D707 generation", generation],
	] as const) {
		assertPrivateArtifactProtection({
			label,
			subject,
			protectionExecutor:
				candidate.protectionExecutor as EmpiricalExactPrivateNeedleProtectionExecutorV1,
		});
	}
	const finalPath = join(privateRoot, D707_PRELIVE_GENERATION_REF);
	try {
		await lstat(finalPath);
		throw new TypeError("D707 generation already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d707-staging-${randomUUID()}`);
	const files = Object.freeze([
		{
			file: "fresh-pricing-prelive-observation.v1.json",
			bytes: strictJsonCodec.encode(observation),
		},
		{
			file: "fresh-pricing-prelive-scorecard.v1.json",
			bytes: strictJsonCodec.encode(scorecard),
		},
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
	]);
	try {
		await mkdir(stagingPath, { mode: 0o700 });
		for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
		await syncDirectory(stagingPath);
		for (const file of files) {
			const persisted = new Uint8Array(await readFile(join(stagingPath, file.file)));
			if (!Buffer.from(persisted).equals(file.bytes)) {
				throw new TypeError("D707 persistence readback failed");
			}
		}
		await commitD696PrivateStagingDirectory({ stagingPath, finalPath, privateRoot });
	} catch (error) {
		await failD696PrivateStagingGeneration(stagingPath, error);
	}
	return Object.freeze({
		generationPath: finalPath,
		observationDigest: observation.observationDigest,
		scorecardDigest: scorecard.scorecardDigest,
		generationDigest: generation.generationDigest,
	});
}
