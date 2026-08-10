import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
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
import {
	type D703MutationFirstObservationV1,
	type D703MutationFirstScorecardV1,
	type D703PreflightCapabilityV1,
	type D703PreLiveOperationalQualificationV1,
	runD703MutationFirstBlockForD710Qualification,
	validateD703Observation,
	validateD703PreLiveOperationalQualification,
	validateD703Scorecard,
} from "./d703-mutation-first-recovery-live.js";
import {
	D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS,
	D710_UNTYPED_HTTP_429_RETRY_POLICY,
	D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST,
	d710UntypedHttp429RetryDelayMs,
} from "./d710-untyped-http-429-retry-policy.js";
import type { EmpiricalSmokeRunObservationV3 } from "./empirical-smoke-evidence.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import type { OpenRouterMatchedTrialBlockInputV4 } from "./openrouter-first-task-smoke.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D710_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.d710-untyped-http-429-retry-qualification.v1" as const;
export const D710_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d710-untyped-http-429-retry-generation.v1" as const;
export const D710_CLAIM_BOUNDARY =
	"offline-untyped-http-429-single-same-route-retry-no-provider-no-efficacy-claim" as const;
export const D710_STAGE_ORDER = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
export const D710_PRIVATE_GENERATION_REF =
	"d710-untyped-http-429-no-network-qualified-2026-08-09-v1" as const;
export const D710_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:619a99f4b5c4c112dc1047d4eb896e08ef634e5844e39ac1fd4dbb09c28f5498" as const;
export const D710_GENERATION_ARTIFACT_DIGEST =
	"sha256:14d69c80af9131f505f87b3ec0c9369a022ab29d6310e33dd416b11d1366e332" as const;

export interface D710RetryLifecycleV1 {
	readonly stage: (typeof D710_STAGE_ORDER)[number];
	readonly stepIndex: number;
	readonly firstAttemptOrdinal: 1;
	readonly secondAttemptOrdinal: 2;
	readonly requestDigest: string;
	readonly firstIssueDigest: string;
	readonly firstStatus: "non-evaluable";
	readonly secondStatus: "completed" | "non-evaluable";
	readonly scheduledDelayMs: number;
	readonly exactRequestReused: true;
	readonly attemptAccountingBound: true;
}

export interface D710OfflineQualificationV1 {
	readonly schemaVersion: typeof D710_QUALIFICATION_SCHEMA;
	readonly authorityRef: "decision.D710";
	readonly authorityRevision: "decision.D710.2026-08-09.v1";
	readonly claimBoundary: typeof D710_CLAIM_BOUNDARY;
	readonly policyDigest: string;
	readonly d703ObservationDigest: string;
	readonly d703ScorecardDigest: string;
	readonly operationalQualificationDigest: string;
	readonly stageOrder: typeof D710_STAGE_ORDER;
	readonly attemptedStageCount: 6;
	readonly warmRunsAttempted: 5;
	readonly retryLifecycle: D710RetryLifecycleV1;
	readonly fallbackDelayQualified: true;
	readonly retryAfterQualified: true;
	readonly typed429Excluded: true;
	readonly secondUntyped429Excluded: true;
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

const QUALIFICATION_FILE = "untyped-http-429-retry-qualification.v1.json";
const GENERATION_FILE = "generation.v1.json";
const constructedQualifications = new WeakSet<object>();

function untypedIssues(retryAfter: "absent" | "invalid" | "parsed"): readonly string[] {
	return Object.freeze(
		[
			"openrouter-error-body-shape:json-object",
			"openrouter-error-media-class:json",
			"openrouter-error-recognized-code:absent",
			"openrouter-error-recognized-type:absent",
			"openrouter-http-status:429",
			"openrouter-quota-rate-limit",
			...(retryAfter === "parsed" ? ["openrouter-retry-after-ms:7000"] : []),
			`openrouter-retry-after-parse:${retryAfter}`,
			`openrouter-retry-after-presence:${retryAfter === "absent" ? "absent" : "present"}`,
		].sort(),
	);
}

function assertPolicyMatrix(): void {
	const outcome = (issueCodes: readonly string[]) => ({
		status: "non-evaluable" as const,
		issueCodes,
	});
	if (
		d710UntypedHttp429RetryDelayMs(outcome(untypedIssues("absent")), 1) !==
			D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS ||
		d710UntypedHttp429RetryDelayMs(outcome(untypedIssues("invalid")), 1) !==
			D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS ||
		d710UntypedHttp429RetryDelayMs(outcome(untypedIssues("parsed")), 1) !== 7_000 ||
		d710UntypedHttp429RetryDelayMs(outcome(untypedIssues("absent")), 2) !== null ||
		d710UntypedHttp429RetryDelayMs(
			outcome([...untypedIssues("absent"), "openrouter-error-type:payment_required"]),
			1,
		) !== null
	) {
		throw new TypeError("D710 policy matrix drifted from its frozen retry boundary");
	}
}

function runs(observation: D703MutationFirstObservationV1): readonly {
	readonly stage: (typeof D710_STAGE_ORDER)[number];
	readonly run: EmpiricalSmokeRunObservationV3;
}[] {
	const underlying = observation.underlying;
	if (
		underlying.result.warmRunsAttempted !== 5 ||
		underlying.warmBranches.length !== 5 ||
		underlying.warmBranches.some(
			(branch, index) =>
				!branch.attempted ||
				branch.branchKind !== D710_STAGE_ORDER[index + 1] ||
				branch.run === null,
		)
	) {
		throw new TypeError("D710 qualification requires the complete ordered six-arm dry-run");
	}
	return Object.freeze([
		{ stage: "cold", run: underlying.cold },
		...underlying.warmBranches.map((branch, index) => ({
			stage: D710_STAGE_ORDER[index + 1] as (typeof D710_STAGE_ORDER)[number],
			run: branch.run as EmpiricalSmokeRunObservationV3,
		})),
	]);
}

function deriveRetryLifecycle(observation: D703MutationFirstObservationV1): D710RetryLifecycleV1 {
	const candidates: D710RetryLifecycleV1[] = [];
	for (const { stage, run } of runs(observation)) {
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
				throw new TypeError("D710 retry did not preserve its request/wait/attempt binding");
			}
			candidates.push(
				strictSnapshot({
					stage,
					stepIndex: first.stepIndex,
					firstAttemptOrdinal: 1 as const,
					secondAttemptOrdinal: 2 as const,
					requestDigest: first.requestDigest,
					firstIssueDigest: empiricalStrictJsonDigest(first.issueCodes),
					firstStatus: "non-evaluable" as const,
					secondStatus: second.status,
					scheduledDelayMs: delay,
					exactRequestReused: true as const,
					attemptAccountingBound: true as const,
				}),
			);
		}
	}
	if (candidates.length !== 1) {
		throw new TypeError("D710 qualification requires exactly one untyped-429 retry lifecycle");
	}
	return candidates[0] as D710RetryLifecycleV1;
}

function createQualification(input: {
	readonly observation: D703MutationFirstObservationV1;
	readonly scorecard: D703MutationFirstScorecardV1;
	readonly operationalQualification: D703PreLiveOperationalQualificationV1;
	readonly constructed: boolean;
}): D710OfflineQualificationV1 {
	assertPolicyMatrix();
	const observation = validateD703Observation(input.observation);
	const scorecard = validateD703Scorecard(input.scorecard, observation);
	const operational = validateD703PreLiveOperationalQualification(
		input.operationalQualification,
		observation,
	);
	const orderedRuns = runs(observation);
	const attempts = orderedRuns.reduce((total, entry) => total + entry.run.attempts, 0);
	const requests = orderedRuns.reduce((total, entry) => total + entry.run.requests, 0);
	if (
		observation.executionClass !== "simulated-contract" ||
		observation.underlying.result.costMicrousd !== 0 ||
		attempts !== observation.underlying.result.attempts ||
		requests !== observation.underlying.result.requests ||
		operational.transportCalls !== requests ||
		operational.maximumConcurrentTransportCalls !== 1 ||
		operational.fallbackUsed ||
		operational.providerSwitchUsed ||
		!operational.initialWorkspaceCleanupPassed ||
		operational.workspaceResidueCount !== 0
	) {
		throw new TypeError("D710 operational/accounting boundary is not qualified");
	}
	const retryLifecycle = deriveRetryLifecycle(observation);
	const material = strictSnapshot({
		schemaVersion: D710_QUALIFICATION_SCHEMA,
		authorityRef: "decision.D710" as const,
		authorityRevision: "decision.D710.2026-08-09.v1" as const,
		claimBoundary: D710_CLAIM_BOUNDARY,
		policyDigest: D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST,
		d703ObservationDigest: observation.observationDigest,
		d703ScorecardDigest: empiricalStrictJsonDigest(scorecard),
		operationalQualificationDigest: operational.qualificationDigest,
		stageOrder: D710_STAGE_ORDER,
		attemptedStageCount: 6 as const,
		warmRunsAttempted: 5 as const,
		retryLifecycle,
		fallbackDelayQualified: true as const,
		retryAfterQualified: true as const,
		typed429Excluded: true as const,
		secondUntyped429Excluded: true as const,
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
	});
	if (input.constructed) constructedQualifications.add(qualification);
	return qualification;
}

export async function runD710OfflineQualification(input: {
	readonly preflight: D703PreflightCapabilityV1;
	readonly block: OpenRouterMatchedTrialBlockInputV4;
}): Promise<{
	readonly qualification: D710OfflineQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}> {
	const result = await runD703MutationFirstBlockForD710Qualification(input);
	return Object.freeze({
		qualification: createQualification({ ...result, constructed: true }),
		protectionExecutor: result.protectionExecutor,
	});
}

export function validateD710OfflineQualification(value: unknown): D710OfflineQualificationV1 {
	const candidate = record(value, "d710.qualification");
	exactKeys(
		candidate,
		[
			"attemptedStageCount",
			"authorityRef",
			"authorityRevision",
			"causalAttribution",
			"chargedCostMicrousd",
			"claimBoundary",
			"cleanupQualified",
			"d703ObservationDigest",
			"d703ScorecardDigest",
			"efficacyClaim",
			"fallbackDelayQualified",
			"networkCallCount",
			"operationalQualificationDigest",
			"policyDigest",
			"providerCallCount",
			"qualificationDigest",
			"qualified",
			"retryAccountingQualified",
			"retryAfterQualified",
			"retryLifecycle",
			"schemaVersion",
			"secondUntyped429Excluded",
			"serialTransportQualified",
			"stageOrder",
			"typed429Excluded",
			"warmRunsAttempted",
		],
		"d710.qualification",
	);
	literal(candidate.schemaVersion, D710_QUALIFICATION_SCHEMA, "d710.qualification.schema");
	literal(candidate.authorityRef, "decision.D710", "d710.qualification.authority");
	literal(
		candidate.authorityRevision,
		"decision.D710.2026-08-09.v1",
		"d710.qualification.revision",
	);
	literal(candidate.claimBoundary, D710_CLAIM_BOUNDARY, "d710.qualification.claim");
	literal(candidate.policyDigest, D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST, "d710.policy");
	for (const [key, expected] of [
		["attemptedStageCount", 6],
		["warmRunsAttempted", 5],
		["providerCallCount", 0],
		["networkCallCount", 0],
		["chargedCostMicrousd", 0],
	] as const) {
		literal(
			safeInteger(candidate[key], `d710.qualification.${key}`, { min: expected, max: expected }),
			expected,
			`d710.qualification.${key}`,
		);
	}
	for (const key of [
		"fallbackDelayQualified",
		"retryAfterQualified",
		"typed429Excluded",
		"secondUntyped429Excluded",
		"serialTransportQualified",
		"retryAccountingQualified",
		"cleanupQualified",
		"qualified",
	] as const) {
		literal(
			boolean(candidate[key], `d710.qualification.${key}`),
			true,
			`d710.qualification.${key}`,
		);
	}
	literal(candidate.causalAttribution, "undetermined", "d710.qualification.attribution");
	literal(candidate.efficacyClaim, "none", "d710.qualification.efficacy");
	for (const key of [
		"d703ObservationDigest",
		"d703ScorecardDigest",
		"operationalQualificationDigest",
	] as const)
		digest(candidate[key], `d710.qualification.${key}`);
	const order = array(candidate.stageOrder, "d710.qualification.stageOrder");
	if (
		order.length !== D710_STAGE_ORDER.length ||
		order.some((entry, index) => entry !== D710_STAGE_ORDER[index])
	) {
		throw new TypeError("D710 stage order drifted");
	}
	const lifecycle = record(candidate.retryLifecycle, "d710.qualification.retryLifecycle");
	exactKeys(
		lifecycle,
		[
			"attemptAccountingBound",
			"exactRequestReused",
			"firstAttemptOrdinal",
			"firstIssueDigest",
			"firstStatus",
			"requestDigest",
			"scheduledDelayMs",
			"secondAttemptOrdinal",
			"secondStatus",
			"stage",
			"stepIndex",
		],
		"d710.qualification.retryLifecycle",
	);
	if (!D710_STAGE_ORDER.includes(lifecycle.stage as (typeof D710_STAGE_ORDER)[number]))
		throw new TypeError("D710 retry stage is invalid");
	literal(lifecycle.firstAttemptOrdinal, 1, "d710.retry.firstOrdinal");
	literal(lifecycle.secondAttemptOrdinal, 2, "d710.retry.secondOrdinal");
	literal(lifecycle.firstStatus, "non-evaluable", "d710.retry.firstStatus");
	if (lifecycle.secondStatus !== "completed" && lifecycle.secondStatus !== "non-evaluable")
		throw new TypeError("D710 retry second status is invalid");
	digest(lifecycle.requestDigest, "d710.retry.requestDigest");
	digest(lifecycle.firstIssueDigest, "d710.retry.firstIssueDigest");
	safeInteger(lifecycle.stepIndex, "d710.retry.stepIndex", { min: 0, max: 31 });
	safeInteger(lifecycle.scheduledDelayMs, "d710.retry.delay", {
		min: 1,
		max: D710_UNTYPED_HTTP_429_RETRY_POLICY.maxRetryAfterMs,
	});
	literal(lifecycle.exactRequestReused, true, "d710.retry.requestReused");
	literal(lifecycle.attemptAccountingBound, true, "d710.retry.accounting");
	const { qualificationDigest, ...material } = candidate;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(strictSnapshot(material)),
		"d710.qualification.digest",
	);
	return strictSnapshot(candidate) as unknown as D710OfflineQualificationV1;
}

export async function persistD710OfflineQualification(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly qualification: D710OfflineQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly qualificationDigest: string;
	readonly generationDigest: string;
}> {
	const candidate = record(input, "d710.persistence");
	exactKeys(
		candidate,
		["generationRef", "privateRoot", "protectionExecutor", "qualification"],
		"d710.persistence",
	);
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(candidate.protectionExecutor))
		throw new TypeError("D710 requires constructed private protection");
	if (
		candidate.qualification === null ||
		typeof candidate.qualification !== "object" ||
		!constructedQualifications.has(candidate.qualification)
	)
		throw new TypeError("D710 persistence requires a same-process qualification");
	const qualification = validateD710OfflineQualification(candidate.qualification);
	const privateRoot = await assertSafePrivateRoot(
		string(candidate.privateRoot, "d710.persistence.privateRoot", 4_096),
	);
	const generationRef = coordinate(candidate.generationRef, "d710.persistence.generationRef");
	if (basename(generationRef) !== generationRef || generationRef === "." || generationRef === "..")
		throw new TypeError("D710 generation ref must be path-free");
	const qualificationBytes = strictJsonCodec.encode(qualification);
	const qualificationDigest = empiricalSha256(qualificationBytes);
	const generationMaterial = strictSnapshot({
		schemaVersion: D710_GENERATION_SCHEMA,
		generationRef,
		qualification: {
			file: QUALIFICATION_FILE,
			digest: qualificationDigest,
			byteLength: qualificationBytes.byteLength,
		},
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	assertPrivateArtifactProtection({
		subject: qualification,
		label: "D710 qualification",
		protectionExecutor: candidate.protectionExecutor,
	});
	assertPrivateArtifactProtection({
		subject: generation,
		label: "D710 generation",
		protectionExecutor: candidate.protectionExecutor,
	});
	const generationBytes = strictJsonCodec.encode(generation);
	const generationDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D710 generation already exists");
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d710-staging-${randomUUID()}`);
	await mkdir(stagingPath, { mode: 0o700 });
	try {
		await chmod(stagingPath, 0o700);
		await writePrivateFile(join(stagingPath, QUALIFICATION_FILE), qualificationBytes);
		await writePrivateFile(join(stagingPath, GENERATION_FILE), generationBytes);
		if (
			empiricalSha256(new Uint8Array(await readFile(join(stagingPath, QUALIFICATION_FILE)))) !==
				qualificationDigest ||
			empiricalSha256(new Uint8Array(await readFile(join(stagingPath, GENERATION_FILE)))) !==
				generationDigest
		)
			throw new TypeError("D710 persistence readback failed");
		await syncDirectory(stagingPath);
		await rename(stagingPath, finalPath);
		try {
			await syncDirectory(privateRoot);
		} catch (error) {
			try {
				await rm(finalPath, { recursive: true, force: true });
				await syncDirectory(privateRoot);
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "D710 final cleanup failed");
			}
			throw error;
		}
		return Object.freeze({ generationPath: finalPath, qualificationDigest, generationDigest });
	} catch (error) {
		try {
			await rm(stagingPath, { recursive: true, force: true });
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "D710 staging cleanup failed");
		}
		throw error;
	}
}

export function validateD710QualifiedArtifactBytes(value: unknown): {
	readonly qualificationDigest: typeof D710_QUALIFICATION_ARTIFACT_DIGEST;
	readonly generationDigest: typeof D710_GENERATION_ARTIFACT_DIGEST;
} {
	const candidate = record(value, "d710.qualifiedArtifacts");
	exactKeys(candidate, ["generationBytes", "qualificationBytes"], "d710.qualifiedArtifacts");
	const copy = (key: "generationBytes" | "qualificationBytes", max: number): Uint8Array => {
		const raw = candidate[key];
		if (!(raw instanceof Uint8Array) || Object.getPrototypeOf(raw) !== Uint8Array.prototype) {
			throw new TypeError(`d710.qualifiedArtifacts.${key}: expected plain bytes`);
		}
		const bytes = new Uint8Array(raw);
		if (bytes.byteLength === 0 || bytes.byteLength > max) {
			throw new TypeError(`d710.qualifiedArtifacts.${key}: byte bound exceeded`);
		}
		return bytes;
	};
	const qualificationBytes = copy("qualificationBytes", 32_768);
	const generationBytes = copy("generationBytes", 16_384);
	literal(
		empiricalSha256(qualificationBytes),
		D710_QUALIFICATION_ARTIFACT_DIGEST,
		"d710.qualifiedArtifacts.qualificationDigest",
	);
	literal(
		empiricalSha256(generationBytes),
		D710_GENERATION_ARTIFACT_DIGEST,
		"d710.qualifiedArtifacts.generationDigest",
	);
	const qualificationDecoded = strictJsonCodec.decode(qualificationBytes);
	assertCanonicalBytes(
		qualificationDecoded,
		qualificationBytes,
		"d710.qualifiedArtifacts.qualification",
	);
	const qualification = validateD710OfflineQualification(qualificationDecoded);
	const generationDecoded = strictJsonCodec.decode(generationBytes);
	assertCanonicalBytes(generationDecoded, generationBytes, "d710.qualifiedArtifacts.generation");
	const generation = record(generationDecoded, "d710.qualifiedArtifacts.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"qualification",
			"schemaVersion",
		],
		"d710.qualifiedArtifacts.generation",
	);
	literal(generation.schemaVersion, D710_GENERATION_SCHEMA, "d710.generation.schema");
	literal(generation.generationRef, D710_PRIVATE_GENERATION_REF, "d710.generation.ref");
	literal(generation.causalAttribution, "undetermined", "d710.generation.attribution");
	literal(generation.efficacyClaim, "none", "d710.generation.efficacy");
	const qualificationRef = record(generation.qualification, "d710.generation.qualification");
	exactKeys(qualificationRef, ["byteLength", "digest", "file"], "d710.generation.qualification");
	literal(qualificationRef.file, QUALIFICATION_FILE, "d710.generation.qualification.file");
	literal(
		qualificationRef.digest,
		D710_QUALIFICATION_ARTIFACT_DIGEST,
		"d710.generation.qualification.digest",
	);
	literal(
		qualificationRef.byteLength,
		qualificationBytes.byteLength,
		"d710.generation.qualification.byteLength",
	);
	const generationDigest = digest(generation.generationDigest, "d710.generation.digest");
	const { generationDigest: _ignored, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d710.generation.binding",
	);
	if (!qualification.qualified) throw new TypeError("D710 qualified artifact is not qualified");
	return Object.freeze({
		qualificationDigest: D710_QUALIFICATION_ARTIFACT_DIGEST,
		generationDigest: D710_GENERATION_ARTIFACT_DIGEST,
	});
}
