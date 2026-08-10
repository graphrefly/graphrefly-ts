import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	assertCanonicalBytes,
	boolean,
	coordinate,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import { commitD696PrivateStagingDirectory } from "./d696-continuation-assisted-live.js";
import {
	type D703PreflightCapabilityV1,
	runD703MutationFirstBlockForD712Qualification,
	validateD703Observation,
	validateD703PreLiveOperationalQualification,
	validateD703Scorecard,
} from "./d703-mutation-first-recovery-live.js";
import {
	D710_UNTYPED_HTTP_429_RETRY_POLICY,
	D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST,
	d710UntypedHttp429RetryDelayMs,
} from "./d710-untyped-http-429-retry-policy.js";
import {
	D710_GENERATION_ARTIFACT_DIGEST,
	D710_QUALIFICATION_ARTIFACT_DIGEST,
	D710_STAGE_ORDER,
	validateD710QualifiedArtifactBytes,
} from "./d710-untyped-http-429-retry-qualification.js";
import {
	bindD712FreshPricingObservationToRoute,
	createD712FreshPricingObservation,
	D712_APPROVAL_REF,
	D712_APPROVAL_REVISION,
	D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	type D712FreshPricingObservationV1,
	validateD712FreshPricingObservation,
} from "./d712-pricing-schedule.js";
import type {
	EmpiricalSmokeRunObservationV3,
	EmpiricalTrialBlockObservationV3,
} from "./empirical-smoke-evidence.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import type { OpenRouterMatchedTrialBlockInputV4 } from "./openrouter-first-task-smoke.js";
import { OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE } from "./openrouter-route-qualification.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D712_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.d712-v4-pricing-qualification.v1" as const;
export const D712_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d712-v4-pricing-generation.v1" as const;
export const D712_CLAIM_BOUNDARY =
	"offline-v4-pricing-d710-six-arm-no-provider-no-efficacy-claim" as const;
export const D712_PRIVATE_GENERATION_REF =
	"d712-v4-pricing-d710-no-network-qualified-2026-08-10-v1" as const;
export const D712_PRICING_OBSERVATION_FILE = "v4-pricing-observation.v1.json" as const;
export const D712_QUALIFICATION_FILE = "v4-pricing-qualification.v1.json" as const;
export const D712_GENERATION_FILE = "generation.v1.json" as const;

export const D712_PRICING_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:9681a165560e7f7ea76b6bfe1cb7bdcbd6594901a0c037eacbe9c061e0b084de" as const;
export const D712_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:c7dd4e5477de78914dd92bf57bbf26c2a811b4aad03575fbd13d18933525304f" as const;
export const D712_GENERATION_ARTIFACT_DIGEST =
	"sha256:7547ac3b42ea5cdbb3b5d762bc65c14bc37fdc23af6af8dab6ed1fc112365d48" as const;

export interface D712RetryLifecycleV1 {
	readonly stage: (typeof D710_STAGE_ORDER)[number];
	readonly stepIndex: number;
	readonly requestDigest: string;
	readonly firstIssueDigest: string;
	readonly scheduledDelayMs: number;
	readonly exactRequestReused: true;
	readonly attemptAccountingBound: true;
}

export interface D712OfflineQualificationV1 {
	readonly schemaVersion: typeof D712_QUALIFICATION_SCHEMA;
	readonly authorityRef: typeof D712_APPROVAL_REF;
	readonly authorityRevision: typeof D712_APPROVAL_REVISION;
	readonly claimBoundary: typeof D712_CLAIM_BOUNDARY;
	readonly pricingObservationDigest: string;
	readonly pricingResponseDigest: string;
	readonly pricingRevision: typeof D712_DEEPSEEK_V4_FLASH_PRICING_REVISION;
	readonly inputMicrousdPerMillionTokens: typeof D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS;
	readonly outputMicrousdPerMillionTokens: typeof D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS;
	readonly cacheReadMicrousdPerMillionTokens: typeof D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS;
	readonly d710QualificationArtifactDigest: typeof D710_QUALIFICATION_ARTIFACT_DIGEST;
	readonly d710GenerationArtifactDigest: typeof D710_GENERATION_ARTIFACT_DIGEST;
	readonly d710PolicyDigest: typeof D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST;
	readonly d703ObservationDigest: string;
	readonly d703ScorecardDigest: string;
	readonly operationalQualificationDigest: string;
	readonly retryLifecycle: D712RetryLifecycleV1;
	readonly stageOrder: typeof D710_STAGE_ORDER;
	readonly attemptedStageCount: 6;
	readonly warmRunsAttempted: 5;
	readonly maximumConcurrentTransportCalls: 1;
	readonly simulatedTransportCalls: 43;
	readonly simulatedRequestCount: 43;
	readonly simulatedAttemptCount: 43;
	readonly retryWaitCalls: 1;
	readonly historicalV3ArtifactsImmutable: true;
	readonly onlyPricingScheduleChanged: true;
	readonly serialTransportQualified: true;
	readonly retryAccountingQualified: true;
	readonly cleanupQualified: true;
	readonly providerCallCount: 0;
	readonly networkCallCount: 0;
	readonly chargedCostMicrousd: 0;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualified: true;
	readonly qualificationDigest: string;
}

const constructedObservations = new WeakSet<object>();
const constructedQualifications = new WeakSet<object>();

function runEntries(observation: EmpiricalTrialBlockObservationV3): readonly {
	readonly stage: (typeof D710_STAGE_ORDER)[number];
	readonly run: EmpiricalSmokeRunObservationV3;
}[] {
	if (
		observation.result.warmRunsAttempted !== 5 ||
		observation.warmBranches.length !== 5 ||
		observation.warmBranches.some(
			(branch, index) =>
				!branch.attempted ||
				branch.branchKind !== D710_STAGE_ORDER[index + 1] ||
				branch.run === null,
		)
	) {
		throw new TypeError("D712 requires the complete ordered six-arm D710 dry-run");
	}
	return Object.freeze([
		{ stage: "cold", run: observation.cold },
		...observation.warmBranches.map((branch, index) => ({
			stage: D710_STAGE_ORDER[index + 1] as (typeof D710_STAGE_ORDER)[number],
			run: branch.run as EmpiricalSmokeRunObservationV3,
		})),
	]);
}

function deriveRetryLifecycle(observation: EmpiricalTrialBlockObservationV3): D712RetryLifecycleV1 {
	const candidates: D712RetryLifecycleV1[] = [];
	for (const { stage, run } of runEntries(observation)) {
		for (const first of run.attemptTrace) {
			const delay = d710UntypedHttp429RetryDelayMs(first, first.attemptOrdinal);
			if (delay === null) continue;
			const second = run.attemptTrace.find(
				(attempt) =>
					attempt.stepIndex === first.stepIndex &&
					attempt.attemptOrdinal === 2 &&
					attempt.requestDigest === first.requestDigest,
			);
			const wait = run.retryWaitTrace.find(
				(entry) =>
					entry.stepIndex === first.stepIndex &&
					entry.afterAttemptOrdinal === 1 &&
					entry.scheduledDelayMs === delay &&
					entry.elapsedMs >= delay,
			);
			if (second === undefined || wait === undefined) {
				throw new TypeError("D712 retry did not preserve request/wait/attempt identity");
			}
			candidates.push(
				strictSnapshot({
					stage,
					stepIndex: first.stepIndex,
					requestDigest: first.requestDigest,
					firstIssueDigest: empiricalStrictJsonDigest(first.issueCodes),
					scheduledDelayMs: delay,
					exactRequestReused: true as const,
					attemptAccountingBound: true as const,
				}),
			);
		}
	}
	if (candidates.length !== 1) {
		throw new TypeError("D712 requires exactly one qualified D710 retry lifecycle");
	}
	return candidates[0] as D712RetryLifecycleV1;
}

export async function runD712OfflineQualification(input: {
	readonly preflight: D703PreflightCapabilityV1;
	readonly block: OpenRouterMatchedTrialBlockInputV4;
	readonly officialResponseBytes: Uint8Array;
	readonly d710QualificationArtifacts: {
		readonly qualificationBytes: Uint8Array;
		readonly generationBytes: Uint8Array;
	};
}): Promise<{
	readonly pricingObservation: D712FreshPricingObservationV1;
	readonly qualification: D712OfflineQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}> {
	const request = record(input, "d712.input");
	exactKeys(
		request,
		["block", "d710QualificationArtifacts", "officialResponseBytes", "preflight"],
		"d712.input",
	);
	validateD710QualifiedArtifactBytes(request.d710QualificationArtifacts);
	const blockRecord = record(request.block, "d712.block");
	const routeQualification = strictSnapshot(
		record(blockRecord.routeQualification, "d712.block.routeQualification"),
	);
	const block = Object.freeze({
		...blockRecord,
		routeQualification,
	}) as unknown as OpenRouterMatchedTrialBlockInputV4;
	const pricingObservation = createD712FreshPricingObservation({
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		responseBytes: request.officialResponseBytes as Uint8Array,
	});
	bindD712FreshPricingObservationToRoute({
		observation: pricingObservation,
		routePricing: block.routeQualification.pricing,
	});
	const result = await runD703MutationFirstBlockForD712Qualification({
		preflight: request.preflight as D703PreflightCapabilityV1,
		block,
	});
	const observation = validateD703Observation(result.observation);
	const scorecard = validateD703Scorecard(result.scorecard, observation);
	const operational = validateD703PreLiveOperationalQualification(
		result.operationalQualification,
		observation,
	);
	const entries = runEntries(observation.underlying);
	const retryWaitCalls = entries.reduce(
		(total, entry) => total + entry.run.retryWaitTrace.length,
		0,
	);
	if (
		observation.executionClass !== "simulated-contract" ||
		observation.underlying.result.costMicrousd !== 0 ||
		operational.maximumConcurrentTransportCalls !== 1 ||
		operational.transportCalls !== observation.underlying.result.requests ||
		operational.transportCalls !== 43 ||
		observation.underlying.result.requests !== 43 ||
		observation.underlying.result.attempts !== 43 ||
		operational.retryWaitCalls !== retryWaitCalls ||
		retryWaitCalls !== 1 ||
		operational.fallbackUsed ||
		operational.providerSwitchUsed ||
		!operational.initialWorkspaceCleanupPassed ||
		operational.workspaceResidueCount !== 0
	) {
		throw new TypeError("D712 complete no-network operational boundary is not qualified");
	}
	const material = strictSnapshot({
		schemaVersion: D712_QUALIFICATION_SCHEMA,
		authorityRef: D712_APPROVAL_REF,
		authorityRevision: D712_APPROVAL_REVISION,
		claimBoundary: D712_CLAIM_BOUNDARY,
		pricingObservationDigest: pricingObservation.observationDigest,
		pricingResponseDigest: pricingObservation.responseDigest,
		pricingRevision: D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		inputMicrousdPerMillionTokens: D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
		outputMicrousdPerMillionTokens: D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
		cacheReadMicrousdPerMillionTokens: D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
		d710QualificationArtifactDigest: D710_QUALIFICATION_ARTIFACT_DIGEST,
		d710GenerationArtifactDigest: D710_GENERATION_ARTIFACT_DIGEST,
		d710PolicyDigest: D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST,
		d703ObservationDigest: observation.observationDigest,
		d703ScorecardDigest: empiricalStrictJsonDigest(scorecard),
		operationalQualificationDigest: operational.qualificationDigest,
		retryLifecycle: deriveRetryLifecycle(observation.underlying),
		stageOrder: D710_STAGE_ORDER,
		attemptedStageCount: 6 as const,
		warmRunsAttempted: 5 as const,
		maximumConcurrentTransportCalls: 1 as const,
		simulatedTransportCalls: 43 as const,
		simulatedRequestCount: 43 as const,
		simulatedAttemptCount: 43 as const,
		retryWaitCalls: 1 as const,
		historicalV3ArtifactsImmutable: true as const,
		onlyPricingScheduleChanged: true as const,
		serialTransportQualified: true as const,
		retryAccountingQualified: true as const,
		cleanupQualified: true as const,
		providerCallCount: 0 as const,
		networkCallCount: 0 as const,
		chargedCostMicrousd: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = strictSnapshot({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	}) as D712OfflineQualificationV1;
	constructedObservations.add(pricingObservation);
	constructedQualifications.add(qualification);
	return Object.freeze({
		pricingObservation,
		qualification,
		protectionExecutor: result.protectionExecutor,
	});
}

export function validateD712OfflineQualification(value: unknown): D712OfflineQualificationV1 {
	const candidate = record(value, "d712.qualification");
	exactKeys(
		candidate,
		[
			"attemptedStageCount",
			"authorityRef",
			"authorityRevision",
			"cacheReadMicrousdPerMillionTokens",
			"causalAttribution",
			"chargedCostMicrousd",
			"claimBoundary",
			"cleanupQualified",
			"d703ObservationDigest",
			"d703ScorecardDigest",
			"d710GenerationArtifactDigest",
			"d710PolicyDigest",
			"d710QualificationArtifactDigest",
			"efficacyClaim",
			"historicalV3ArtifactsImmutable",
			"inputMicrousdPerMillionTokens",
			"maximumConcurrentTransportCalls",
			"networkCallCount",
			"onlyPricingScheduleChanged",
			"operationalQualificationDigest",
			"outputMicrousdPerMillionTokens",
			"pricingObservationDigest",
			"pricingResponseDigest",
			"pricingRevision",
			"providerCallCount",
			"qualificationDigest",
			"qualified",
			"retryAccountingQualified",
			"retryLifecycle",
			"retryWaitCalls",
			"schemaVersion",
			"serialTransportQualified",
			"simulatedAttemptCount",
			"simulatedRequestCount",
			"simulatedTransportCalls",
			"stageOrder",
			"warmRunsAttempted",
		],
		"d712.qualification",
	);
	literal(candidate.schemaVersion, D712_QUALIFICATION_SCHEMA, "d712.schema");
	literal(candidate.authorityRef, D712_APPROVAL_REF, "d712.authorityRef");
	literal(candidate.authorityRevision, D712_APPROVAL_REVISION, "d712.authorityRevision");
	literal(candidate.claimBoundary, D712_CLAIM_BOUNDARY, "d712.claimBoundary");
	literal(candidate.pricingRevision, D712_DEEPSEEK_V4_FLASH_PRICING_REVISION, "d712.pricing");
	for (const [key, expected] of [
		["inputMicrousdPerMillionTokens", D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS],
		["outputMicrousdPerMillionTokens", D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS],
		["cacheReadMicrousdPerMillionTokens", D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS],
		["attemptedStageCount", 6],
		["warmRunsAttempted", 5],
		["maximumConcurrentTransportCalls", 1],
		["simulatedTransportCalls", 43],
		["simulatedRequestCount", 43],
		["simulatedAttemptCount", 43],
		["retryWaitCalls", 1],
		["providerCallCount", 0],
		["networkCallCount", 0],
		["chargedCostMicrousd", 0],
	] as const) {
		literal(
			safeInteger(candidate[key], `d712.${key}`, { min: expected, max: expected }),
			expected,
			`d712.${key}`,
		);
	}
	for (const key of [
		"historicalV3ArtifactsImmutable",
		"onlyPricingScheduleChanged",
		"serialTransportQualified",
		"retryAccountingQualified",
		"cleanupQualified",
		"qualified",
	] as const) {
		literal(boolean(candidate[key], `d712.${key}`), true, `d712.${key}`);
	}
	for (const key of [
		"pricingObservationDigest",
		"pricingResponseDigest",
		"d703ObservationDigest",
		"d703ScorecardDigest",
		"operationalQualificationDigest",
	] as const)
		digest(candidate[key], `d712.${key}`);
	literal(
		candidate.d710QualificationArtifactDigest,
		D710_QUALIFICATION_ARTIFACT_DIGEST,
		"d712.d710Qualification",
	);
	literal(
		candidate.d710GenerationArtifactDigest,
		D710_GENERATION_ARTIFACT_DIGEST,
		"d712.d710Generation",
	);
	literal(candidate.d710PolicyDigest, D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST, "d712.d710Policy");
	literal(candidate.causalAttribution, "undetermined", "d712.attribution");
	literal(candidate.efficacyClaim, "none", "d712.efficacy");
	const order = array(candidate.stageOrder, "d712.stageOrder");
	if (
		order.length !== D710_STAGE_ORDER.length ||
		order.some((entry, index) => entry !== D710_STAGE_ORDER[index])
	) {
		throw new TypeError("D712 stage order drifted");
	}
	const lifecycle = record(candidate.retryLifecycle, "d712.retryLifecycle");
	exactKeys(
		lifecycle,
		[
			"attemptAccountingBound",
			"exactRequestReused",
			"firstIssueDigest",
			"requestDigest",
			"scheduledDelayMs",
			"stage",
			"stepIndex",
		],
		"d712.retryLifecycle",
	);
	if (!D710_STAGE_ORDER.includes(lifecycle.stage as (typeof D710_STAGE_ORDER)[number])) {
		throw new TypeError("D712 retry stage is invalid");
	}
	digest(lifecycle.requestDigest, "d712.retry.requestDigest");
	digest(lifecycle.firstIssueDigest, "d712.retry.firstIssueDigest");
	safeInteger(lifecycle.stepIndex, "d712.retry.stepIndex", { min: 0, max: 31 });
	safeInteger(lifecycle.scheduledDelayMs, "d712.retry.delay", {
		min: 1,
		max: D710_UNTYPED_HTTP_429_RETRY_POLICY.maxRetryAfterMs,
	});
	literal(lifecycle.exactRequestReused, true, "d712.retry.requestReused");
	literal(lifecycle.attemptAccountingBound, true, "d712.retry.accounting");
	const { qualificationDigest, ...material } = candidate;
	literal(qualificationDigest, empiricalStrictJsonDigest(strictSnapshot(material)), "d712.digest");
	return strictSnapshot(candidate) as unknown as D712OfflineQualificationV1;
}

export async function persistD712OfflineQualification(input: {
	readonly privateRoot: string;
	readonly generationRef: typeof D712_PRIVATE_GENERATION_REF;
	readonly pricingObservation: D712FreshPricingObservationV1;
	readonly qualification: D712OfflineQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly pricingObservationArtifactDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly generationArtifactDigest: string;
}> {
	const candidate = record(input, "d712.persistence");
	exactKeys(
		candidate,
		["generationRef", "pricingObservation", "privateRoot", "protectionExecutor", "qualification"],
		"d712.persistence",
	);
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(candidate.protectionExecutor)) {
		throw new TypeError("D712 requires constructed private protection");
	}
	if (!constructedObservations.has(candidate.pricingObservation as object)) {
		throw new TypeError("D712 persistence requires its same-process pricing observation");
	}
	if (!constructedQualifications.has(candidate.qualification as object)) {
		throw new TypeError("D712 persistence requires its same-process qualification");
	}
	const pricingObservation = validateD712FreshPricingObservation(candidate.pricingObservation);
	const qualification = validateD712OfflineQualification(candidate.qualification);
	literal(
		qualification.pricingObservationDigest,
		pricingObservation.observationDigest,
		"d712.persistence.observationBinding",
	);
	const privateRoot = await assertSafePrivateRoot(
		string(candidate.privateRoot, "d712.privateRoot", 4_096),
	);
	const generationRef = coordinate(candidate.generationRef, "d712.generationRef");
	if (generationRef !== D712_PRIVATE_GENERATION_REF || basename(generationRef) !== generationRef) {
		throw new TypeError("D712 generation ref drifted");
	}
	const observationBytes = strictJsonCodec.encode(pricingObservation);
	const qualificationBytes = strictJsonCodec.encode(qualification);
	const observationArtifactDigest = empiricalSha256(observationBytes);
	const qualificationArtifactDigest = empiricalSha256(qualificationBytes);
	const generationMaterial = strictSnapshot({
		schemaVersion: D712_GENERATION_SCHEMA,
		generationRef,
		pricingObservation: {
			file: D712_PRICING_OBSERVATION_FILE,
			digest: observationArtifactDigest,
			byteLength: observationBytes.byteLength,
		},
		qualification: {
			file: D712_QUALIFICATION_FILE,
			digest: qualificationArtifactDigest,
			byteLength: qualificationBytes.byteLength,
		},
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	for (const [label, subject] of [
		["D712 pricing observation", pricingObservation],
		["D712 qualification", qualification],
		["D712 generation", generation],
	] as const) {
		assertPrivateArtifactProtection({
			subject,
			label,
			protectionExecutor: candidate.protectionExecutor,
		});
	}
	const generationBytes = strictJsonCodec.encode(generation);
	const generationArtifactDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D712 generation already exists");
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d712-staging-${randomUUID()}`);
	await mkdir(stagingPath, { mode: 0o700 });
	try {
		await chmod(stagingPath, 0o700);
		for (const [file, bytes] of [
			[D712_PRICING_OBSERVATION_FILE, observationBytes],
			[D712_QUALIFICATION_FILE, qualificationBytes],
			[D712_GENERATION_FILE, generationBytes],
		] as const)
			await writePrivateFile(join(stagingPath, file), bytes);
		for (const [file, expected] of [
			[D712_PRICING_OBSERVATION_FILE, observationArtifactDigest],
			[D712_QUALIFICATION_FILE, qualificationArtifactDigest],
			[D712_GENERATION_FILE, generationArtifactDigest],
		] as const) {
			if (empiricalSha256(new Uint8Array(await readFile(join(stagingPath, file)))) !== expected) {
				throw new TypeError(`D712 staging readback failed: ${file}`);
			}
		}
		await syncDirectory(stagingPath);
		await commitD696PrivateStagingDirectory({ stagingPath, finalPath, privateRoot });
		return Object.freeze({
			generationPath: finalPath,
			pricingObservationArtifactDigest: observationArtifactDigest,
			qualificationArtifactDigest,
			generationArtifactDigest,
		});
	} catch (error) {
		try {
			await rm(stagingPath, { recursive: true, force: true });
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "D712 staging cleanup failed");
		}
		throw error;
	}
}

export function validateD712QualifiedArtifactBytes(value: unknown): {
	readonly pricingObservationArtifactDigest: typeof D712_PRICING_OBSERVATION_ARTIFACT_DIGEST;
	readonly qualificationArtifactDigest: typeof D712_QUALIFICATION_ARTIFACT_DIGEST;
	readonly generationArtifactDigest: typeof D712_GENERATION_ARTIFACT_DIGEST;
} {
	const candidate = record(value, "d712.qualifiedArtifacts");
	exactKeys(
		candidate,
		["generationBytes", "pricingObservationBytes", "qualificationBytes"],
		"d712.qualifiedArtifacts",
	);
	const copy = (key: string, max: number): Uint8Array => {
		const raw = candidate[key];
		if (!(raw instanceof Uint8Array) || Object.getPrototypeOf(raw) !== Uint8Array.prototype) {
			throw new TypeError(`d712.qualifiedArtifacts.${key}: expected plain bytes`);
		}
		const bytes = new Uint8Array(raw);
		if (bytes.byteLength === 0 || bytes.byteLength > max) {
			throw new TypeError(`d712.qualifiedArtifacts.${key}: byte bound exceeded`);
		}
		return bytes;
	};
	const pricingObservationBytes = copy("pricingObservationBytes", 32_768);
	const qualificationBytes = copy("qualificationBytes", 64_000);
	const generationBytes = copy("generationBytes", 16_384);
	literal(
		empiricalSha256(pricingObservationBytes),
		D712_PRICING_OBSERVATION_ARTIFACT_DIGEST,
		"d712.artifact.observation",
	);
	literal(
		empiricalSha256(qualificationBytes),
		D712_QUALIFICATION_ARTIFACT_DIGEST,
		"d712.artifact.qualification",
	);
	literal(
		empiricalSha256(generationBytes),
		D712_GENERATION_ARTIFACT_DIGEST,
		"d712.artifact.generation",
	);
	const observationDecoded = strictJsonCodec.decode(pricingObservationBytes);
	assertCanonicalBytes(observationDecoded, pricingObservationBytes, "d712.artifact.observation");
	const observation = validateD712FreshPricingObservation(observationDecoded);
	const qualificationDecoded = strictJsonCodec.decode(qualificationBytes);
	assertCanonicalBytes(qualificationDecoded, qualificationBytes, "d712.artifact.qualification");
	const qualification = validateD712OfflineQualification(qualificationDecoded);
	literal(
		qualification.pricingObservationDigest,
		observation.observationDigest,
		"d712.artifact.binding",
	);
	const generationDecoded = strictJsonCodec.decode(generationBytes);
	assertCanonicalBytes(generationDecoded, generationBytes, "d712.artifact.generation");
	const generation = record(generationDecoded, "d712.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"pricingObservation",
			"qualification",
			"schemaVersion",
		],
		"d712.generation",
	);
	literal(generation.schemaVersion, D712_GENERATION_SCHEMA, "d712.generation.schema");
	literal(generation.generationRef, D712_PRIVATE_GENERATION_REF, "d712.generation.ref");
	literal(generation.causalAttribution, "undetermined", "d712.generation.attribution");
	literal(generation.efficacyClaim, "none", "d712.generation.efficacy");
	for (const [key, file, digestValue, byteLength] of [
		[
			"pricingObservation",
			D712_PRICING_OBSERVATION_FILE,
			D712_PRICING_OBSERVATION_ARTIFACT_DIGEST,
			pricingObservationBytes.byteLength,
		],
		[
			"qualification",
			D712_QUALIFICATION_FILE,
			D712_QUALIFICATION_ARTIFACT_DIGEST,
			qualificationBytes.byteLength,
		],
	] as const) {
		const ref = record(generation[key], `d712.generation.${key}`);
		exactKeys(ref, ["byteLength", "digest", "file"], `d712.generation.${key}`);
		literal(ref.file, file, `d712.generation.${key}.file`);
		literal(ref.digest, digestValue, `d712.generation.${key}.digest`);
		literal(ref.byteLength, byteLength, `d712.generation.${key}.byteLength`);
	}
	const generationDigest = digest(generation.generationDigest, "d712.generation.digest");
	const { generationDigest: _ignored, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d712.generation.binding",
	);
	return Object.freeze({
		pricingObservationArtifactDigest: D712_PRICING_OBSERVATION_ARTIFACT_DIGEST,
		qualificationArtifactDigest: D712_QUALIFICATION_ARTIFACT_DIGEST,
		generationArtifactDigest: D712_GENERATION_ARTIFACT_DIGEST,
	});
}
