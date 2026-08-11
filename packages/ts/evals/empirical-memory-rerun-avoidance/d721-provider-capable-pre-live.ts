import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import type { D719CleanBudgetLimitsV1 } from "./d719-clean-graph-ledger.js";
import type {
	D720EffectCeilingsV2,
	D720GraphNativeEvalBundleV1,
} from "./d720-graph-native-eval.js";
import { validateD720GraphNativeEvalBundle } from "./d720-graph-native-eval.js";
import {
	consumeD721AdapterRunReceipt,
	D721_PROVIDER_CAPABLE_ADAPTER_REVISION,
	type D721ProviderCapableEffectAdapterV1,
	isD721InjectedNoNetworkQualificationAdapter,
	runD721ProviderCapableEffectAdapter,
} from "./d721-provider-capable-effect-adapter.js";

export const D721_DECISION_REF = "decision.D721" as const;
export const D721_DECISION_REVISION = "2026-08-10.v1" as const;
export const D721_D720_BASELINE_COMMIT = "c2aee022" as const;
export const D721_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d721.provider-capable-pre-live-qualification.v2" as const;
export const D721_GENERATION_SCHEMA =
	"graphrefly.b112.d721.provider-capable-pre-live-generation.v2" as const;
export const D721_BUNDLE_SCHEMA =
	"graphrefly.b112.d721.provider-capable-pre-live-bundle.v2" as const;
export const D721_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d721.provider-capable-pre-live-persistence.v2" as const;
export const D721_GENERATION_REF = "d721-provider-capable-pre-live-v2" as const;
export const D721_ADAPTER_IMPLEMENTATION_DIGEST =
	"sha256:b9a4f1514456da142e5a6791af0fa5a837569a413116ec3c02dda8dc2086c0ec" as const;

const EFFECT_KINDS = [
	"materialization",
	"provider-request",
	"retry-wait",
	"tool-action",
	"hidden-verifier",
	"cleanup",
] as const;
const REQUIRED_RETRY_REASONS = [
	"d671-rate-limit-exceeded",
	"d675-und-err-socket",
	"d710-untyped-http-429",
] as const;
const EXPECTED_EFFECT_COUNTS = Object.freeze({
	materialization: 6,
	"provider-request": 15,
	"retry-wait": 3,
	"tool-action": 24,
	"hidden-verifier": 6,
	cleanup: 6,
});

type EffectCounts = Readonly<Record<(typeof EFFECT_KINDS)[number], number>>;

export interface D721ProviderCapablePreLiveQualificationV1 {
	readonly schemaVersion: typeof D721_QUALIFICATION_SCHEMA;
	readonly decisionRef: typeof D721_DECISION_REF;
	readonly decisionRevision: typeof D721_DECISION_REVISION;
	readonly d720BaselineCommit: typeof D721_D720_BASELINE_COMMIT;
	readonly adapterRevision: typeof D721_PROVIDER_CAPABLE_ADAPTER_REVISION;
	readonly adapterImplementationDigest: string;
	readonly executionClass: "provider-capable-injected-no-network";
	readonly underlyingBundleDigest: string;
	readonly graphEvidenceDigest: string;
	readonly graphAdmittedEffectCount: number;
	readonly effectKindCounts: EffectCounts;
	readonly exercisedRetryReasons: readonly (typeof REQUIRED_RETRY_REASONS)[number][];
	readonly completedArmCount: 6;
	readonly maxActiveInvocations: 1;
	readonly allEffectsGraphAdmitted: true;
	readonly allUsageGraphReconciled: true;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualificationDigest: string;
}

export interface D721ProviderCapablePreLiveGenerationV1 {
	readonly schemaVersion: typeof D721_GENERATION_SCHEMA;
	readonly generationRef: typeof D721_GENERATION_REF;
	readonly qualificationDigest: string;
	readonly underlyingBundleDigest: string;
	readonly graphEvidenceDigest: string;
	readonly adapterImplementationDigest: string;
	readonly d720BaselineCommit: typeof D721_D720_BASELINE_COMMIT;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly generationDigest: string;
}

export interface D721ProviderCapablePreLiveBundleV1 {
	readonly schemaVersion: typeof D721_BUNDLE_SCHEMA;
	readonly underlyingBundle: D720GraphNativeEvalBundleV1;
	readonly qualification: D721ProviderCapablePreLiveQualificationV1;
	readonly generation: D721ProviderCapablePreLiveGenerationV1;
	readonly bundleDigest: string;
}

export interface D721PersistenceReceiptV1 {
	readonly schemaVersion: typeof D721_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof D721_GENERATION_REF;
	readonly graphArtifactDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly generationArtifactDigest: string;
	readonly bundleArtifactDigest: string;
	readonly bundleDigest: string;
	readonly persistenceDigest: string;
}

export interface D721PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d721.persistence-fault.v1";
}

const constructedBundles = new WeakSet<object>();
const constructedPersistenceFaults = new WeakMap<
	object,
	{
		readonly stage: "after-claim" | "after-artifacts-rename";
		consumed: boolean;
	}
>();

export function createD721PersistenceFaultForTest(
	stage: "after-claim" | "after-artifacts-rename",
): D721PersistenceFaultV1 {
	if (stage !== "after-claim" && stage !== "after-artifacts-rename")
		throw new TypeError("D721 persistence fault stage is invalid");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d721.persistence-fault.v1" as const,
	});
	constructedPersistenceFaults.set(capability, { stage, consumed: false });
	return capability;
}

async function measureAdapterImplementation(): Promise<string> {
	const bytes = await readFile(
		new URL("./d721-provider-capable-effect-adapter.ts", import.meta.url),
	);
	const measured = empiricalSha256(bytes);
	if (measured !== D721_ADAPTER_IMPLEMENTATION_DIGEST)
		throw new TypeError("D721 adapter implementation digest drifted");
	return measured;
}

function deriveGraphCoverage(underlyingValue: unknown): {
	readonly underlying: D720GraphNativeEvalBundleV1;
	readonly count: number;
	readonly counts: EffectCounts;
	readonly retryReasons: readonly (typeof REQUIRED_RETRY_REASONS)[number][];
} {
	const underlying = validateD720GraphNativeEvalBundle(underlyingValue);
	const effectFacts = underlying.graphEvidence.effectRuns.flatMap((run) =>
		run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted"),
	);
	const admissions = underlying.graphEvidence.ledger.effectAdmissions.filter((x) => x.admitted);
	const reconciliations = underlying.graphEvidence.ledger.effectReconciliations;
	if (effectFacts.length !== admissions.length || admissions.length !== reconciliations.length)
		throw new TypeError("D721 Graph effect/admission/reconciliation coverage drifted");
	if (reconciliations.some((x) => x.basis !== "measured"))
		throw new TypeError("D721 successful qualification contains conservative usage evidence");
	const counts = Object.freeze(
		Object.fromEntries(
			EFFECT_KINDS.map((kind) => [
				kind,
				effectFacts.filter((x) => x.request.effectKind === kind).length,
			]),
		),
	) as EffectCounts;
	const retrySet = new Set(
		effectFacts.map((fact) => fact.request.retryReason).filter((reason) => reason !== "none"),
	);
	const retryReasons = Object.freeze(
		REQUIRED_RETRY_REASONS.filter((reason) => retrySet.has(reason)),
	);
	return Object.freeze({ underlying, count: effectFacts.length, counts, retryReasons });
}

function validateCounts(value: unknown): EffectCounts {
	const candidate = record(value, "d721.effectKindCounts");
	exactKeys(candidate, EFFECT_KINDS, "d721.effectKindCounts");
	for (const kind of EFFECT_KINDS)
		safeInteger(candidate[kind], `d721.effectKindCounts.${kind}`, { max: 6_144 });
	return strictSnapshot(candidate) as EffectCounts;
}

function assertFullQualificationCoverage(
	underlying: D720GraphNativeEvalBundleV1,
	count: number,
	counts: EffectCounts,
	retryReasons: readonly string[],
): void {
	if (
		underlying.runStatus !== "complete" ||
		underlying.graphEvidence.ledger.completedArms.length !== 6 ||
		underlying.graphEvidence.effectRuns.length !== 6
	)
		throw new TypeError("D721 qualification requires a complete independent six-arm Graph run");
	if (
		count !== 60 ||
		empiricalStrictJsonDigest(counts) !== empiricalStrictJsonDigest(EXPECTED_EFFECT_COUNTS)
	)
		throw new TypeError("D721 Graph-derived effect coverage drifted");
	if (empiricalStrictJsonDigest(retryReasons) !== empiricalStrictJsonDigest(REQUIRED_RETRY_REASONS))
		throw new TypeError("D721 pre-live run did not exercise every frozen retry family");
}

export async function runD721ProviderCapablePreLiveQualification(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly adapter: D721ProviderCapableEffectAdapterV1;
	readonly signal?: AbortSignal;
}): Promise<D721ProviderCapablePreLiveBundleV1> {
	const input = record(inputValue, "d721.qualificationRun");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["adapter", "budgetLimits", "effectCeilings", "signal", "sourceDigest"]
			: ["adapter", "budgetLimits", "effectCeilings", "sourceDigest"],
		"d721.qualificationRun",
	);
	if (!isD721InjectedNoNetworkQualificationAdapter(input.adapter))
		throw new TypeError("D721 qualification requires the exact injected no-network adapter");
	const adapterImplementationDigest = await measureAdapterImplementation();
	const adapterRun = await runD721ProviderCapableEffectAdapter(
		Object.hasOwn(input, "signal")
			? {
					sourceDigest: input.sourceDigest as string,
					budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
					effectCeilings: input.effectCeilings as D720EffectCeilingsV2,
					adapter: input.adapter as D721ProviderCapableEffectAdapterV1,
					signal: input.signal as AbortSignal,
				}
			: {
					sourceDigest: input.sourceDigest as string,
					budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
					effectCeilings: input.effectCeilings as D720EffectCeilingsV2,
					adapter: input.adapter as D721ProviderCapableEffectAdapterV1,
				},
	);
	const traversal = consumeD721AdapterRunReceipt(adapterRun.receipt, adapterRun.underlyingBundle);
	const coverage = deriveGraphCoverage(adapterRun.underlyingBundle);
	assertFullQualificationCoverage(
		coverage.underlying,
		coverage.count,
		coverage.counts,
		coverage.retryReasons,
	);
	if (
		traversal.failedEffectCount !== 0 ||
		traversal.executedEffectCount !== coverage.count ||
		traversal.maxActiveInvocations !== 1
	)
		throw new TypeError("D721 injected adapter traversal was not serial and complete");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D721_QUALIFICATION_SCHEMA,
		decisionRef: D721_DECISION_REF,
		decisionRevision: D721_DECISION_REVISION,
		d720BaselineCommit: D721_D720_BASELINE_COMMIT,
		adapterRevision: D721_PROVIDER_CAPABLE_ADAPTER_REVISION,
		adapterImplementationDigest,
		executionClass: "provider-capable-injected-no-network" as const,
		underlyingBundleDigest: coverage.underlying.bundleDigest,
		graphEvidenceDigest: coverage.underlying.graphEvidenceDigest,
		graphAdmittedEffectCount: coverage.count,
		effectKindCounts: coverage.counts,
		exercisedRetryReasons: coverage.retryReasons,
		completedArmCount: 6 as const,
		maxActiveInvocations: 1 as const,
		allEffectsGraphAdmitted: true as const,
		allUsageGraphReconciled: true as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D721_GENERATION_SCHEMA,
		generationRef: D721_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		underlyingBundleDigest: coverage.underlying.bundleDigest,
		graphEvidenceDigest: coverage.underlying.graphEvidenceDigest,
		adapterImplementationDigest,
		d720BaselineCommit: D721_D720_BASELINE_COMMIT,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D721_BUNDLE_SCHEMA,
		underlyingBundle: coverage.underlying,
		qualification,
		generation,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	});
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD721ProviderCapablePreLiveBundle(
	value: unknown,
): D721ProviderCapablePreLiveBundleV1 {
	const candidate = record(value, "d721.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "qualification", "schemaVersion", "underlyingBundle"],
		"d721.bundle",
	);
	if (candidate.schemaVersion !== D721_BUNDLE_SCHEMA)
		throw new TypeError("D721 bundle schema drifted");
	const coverage = deriveGraphCoverage(candidate.underlyingBundle);
	assertFullQualificationCoverage(
		coverage.underlying,
		coverage.count,
		coverage.counts,
		coverage.retryReasons,
	);
	const qualificationCandidate = record(candidate.qualification, "d721.qualification");
	exactKeys(
		qualificationCandidate,
		[
			"adapterImplementationDigest",
			"adapterRevision",
			"allEffectsGraphAdmitted",
			"allUsageGraphReconciled",
			"causalAttribution",
			"completedArmCount",
			"d720BaselineCommit",
			"decisionRef",
			"decisionRevision",
			"effectKindCounts",
			"efficacyClaim",
			"executionClass",
			"exercisedRetryReasons",
			"graphAdmittedEffectCount",
			"graphEvidenceDigest",
			"maxActiveInvocations",
			"qualificationDigest",
			"schemaVersion",
			"underlyingBundleDigest",
		],
		"d721.qualification",
	);
	const counts = validateCounts(qualificationCandidate.effectKindCounts);
	if (
		!Array.isArray(qualificationCandidate.exercisedRetryReasons) ||
		qualificationCandidate.exercisedRetryReasons.length !== REQUIRED_RETRY_REASONS.length
	)
		throw new TypeError("D721 retry reasons are invalid");
	const retryReasons = array(
		qualificationCandidate.exercisedRetryReasons,
		"d721.qualification.exercisedRetryReasons",
	).map((value, index) =>
		oneOf(value, REQUIRED_RETRY_REASONS, `d721.qualification.exercisedRetryReasons[${index}]`),
	);
	safeInteger(qualificationCandidate.graphAdmittedEffectCount, "d721.graphAdmittedEffectCount", {
		max: 6_144,
	});
	for (const key of [
		"adapterImplementationDigest",
		"graphEvidenceDigest",
		"qualificationDigest",
		"underlyingBundleDigest",
	] as const)
		digest(qualificationCandidate[key], `d721.qualification.${key}`);
	if (
		qualificationCandidate.schemaVersion !== D721_QUALIFICATION_SCHEMA ||
		qualificationCandidate.decisionRef !== D721_DECISION_REF ||
		qualificationCandidate.decisionRevision !== D721_DECISION_REVISION ||
		qualificationCandidate.d720BaselineCommit !== D721_D720_BASELINE_COMMIT ||
		qualificationCandidate.adapterRevision !== D721_PROVIDER_CAPABLE_ADAPTER_REVISION ||
		qualificationCandidate.executionClass !== "provider-capable-injected-no-network" ||
		qualificationCandidate.completedArmCount !== 6 ||
		qualificationCandidate.maxActiveInvocations !== 1 ||
		qualificationCandidate.allEffectsGraphAdmitted !== true ||
		qualificationCandidate.allUsageGraphReconciled !== true ||
		qualificationCandidate.causalAttribution !== "undetermined" ||
		qualificationCandidate.efficacyClaim !== "none"
	)
		throw new TypeError("D721 qualification scalar coordinates drifted");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D721_QUALIFICATION_SCHEMA,
		decisionRef: D721_DECISION_REF,
		decisionRevision: D721_DECISION_REVISION,
		d720BaselineCommit: D721_D720_BASELINE_COMMIT,
		adapterRevision: D721_PROVIDER_CAPABLE_ADAPTER_REVISION,
		adapterImplementationDigest: qualificationCandidate.adapterImplementationDigest,
		executionClass: "provider-capable-injected-no-network" as const,
		underlyingBundleDigest: qualificationCandidate.underlyingBundleDigest,
		graphEvidenceDigest: qualificationCandidate.graphEvidenceDigest,
		graphAdmittedEffectCount: qualificationCandidate.graphAdmittedEffectCount,
		effectKindCounts: counts,
		exercisedRetryReasons: retryReasons,
		completedArmCount: 6 as const,
		maxActiveInvocations: 1 as const,
		allEffectsGraphAdmitted: true as const,
		allUsageGraphReconciled: true as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualificationDigest: qualificationCandidate.qualificationDigest,
	}) as unknown as D721ProviderCapablePreLiveQualificationV1;
	const qualificationDigest = digest(
		qualificationMaterial.qualificationDigest,
		"d721.qualification.qualificationDigest",
	);
	const { qualificationDigest: _ignoredQualificationDigest, ...qualificationBody } =
		qualificationMaterial;
	if (
		qualificationMaterial.schemaVersion !== D721_QUALIFICATION_SCHEMA ||
		qualificationMaterial.decisionRef !== D721_DECISION_REF ||
		qualificationMaterial.decisionRevision !== D721_DECISION_REVISION ||
		qualificationMaterial.d720BaselineCommit !== D721_D720_BASELINE_COMMIT ||
		qualificationMaterial.adapterRevision !== D721_PROVIDER_CAPABLE_ADAPTER_REVISION ||
		qualificationMaterial.adapterImplementationDigest !== D721_ADAPTER_IMPLEMENTATION_DIGEST ||
		qualificationMaterial.executionClass !== "provider-capable-injected-no-network" ||
		qualificationMaterial.underlyingBundleDigest !== coverage.underlying.bundleDigest ||
		qualificationMaterial.graphEvidenceDigest !== coverage.underlying.graphEvidenceDigest ||
		qualificationMaterial.graphAdmittedEffectCount !== coverage.count ||
		empiricalStrictJsonDigest(counts) !== empiricalStrictJsonDigest(coverage.counts) ||
		empiricalStrictJsonDigest(retryReasons) !== empiricalStrictJsonDigest(coverage.retryReasons) ||
		qualificationMaterial.completedArmCount !== 6 ||
		qualificationMaterial.maxActiveInvocations !== 1 ||
		qualificationMaterial.allEffectsGraphAdmitted !== true ||
		qualificationMaterial.allUsageGraphReconciled !== true ||
		qualificationMaterial.causalAttribution !== "undetermined" ||
		qualificationMaterial.efficacyClaim !== "none" ||
		qualificationDigest !== empiricalStrictJsonDigest(qualificationBody)
	)
		throw new TypeError("D721 qualification coordinates or digest drifted");
	const qualification = Object.freeze(qualificationMaterial);
	const generationCandidate = record(candidate.generation, "d721.generation");
	exactKeys(
		generationCandidate,
		[
			"adapterImplementationDigest",
			"causalAttribution",
			"d720BaselineCommit",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"qualificationDigest",
			"schemaVersion",
			"underlyingBundleDigest",
		],
		"d721.generation",
	);
	for (const key of [
		"adapterImplementationDigest",
		"generationDigest",
		"graphEvidenceDigest",
		"qualificationDigest",
		"underlyingBundleDigest",
	] as const)
		digest(generationCandidate[key], `d721.generation.${key}`);
	if (
		generationCandidate.schemaVersion !== D721_GENERATION_SCHEMA ||
		generationCandidate.generationRef !== D721_GENERATION_REF ||
		generationCandidate.d720BaselineCommit !== D721_D720_BASELINE_COMMIT ||
		generationCandidate.causalAttribution !== "undetermined" ||
		generationCandidate.efficacyClaim !== "none"
	)
		throw new TypeError("D721 generation scalar coordinates drifted");
	const generation = strictSnapshot({
		schemaVersion: D721_GENERATION_SCHEMA,
		generationRef: D721_GENERATION_REF,
		qualificationDigest: generationCandidate.qualificationDigest,
		underlyingBundleDigest: generationCandidate.underlyingBundleDigest,
		graphEvidenceDigest: generationCandidate.graphEvidenceDigest,
		adapterImplementationDigest: generationCandidate.adapterImplementationDigest,
		d720BaselineCommit: D721_D720_BASELINE_COMMIT,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		generationDigest: generationCandidate.generationDigest,
	}) as unknown as D721ProviderCapablePreLiveGenerationV1;
	const { generationDigest: _ignoredGenerationDigest, ...generationBody } = generation;
	if (
		generation.schemaVersion !== D721_GENERATION_SCHEMA ||
		generation.generationRef !== D721_GENERATION_REF ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.underlyingBundleDigest !== coverage.underlying.bundleDigest ||
		generation.graphEvidenceDigest !== coverage.underlying.graphEvidenceDigest ||
		generation.adapterImplementationDigest !== D721_ADAPTER_IMPLEMENTATION_DIGEST ||
		generation.d720BaselineCommit !== D721_D720_BASELINE_COMMIT ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none" ||
		digest(generation.generationDigest, "d721.generation.generationDigest") !==
			empiricalStrictJsonDigest(generationBody)
	)
		throw new TypeError("D721 generation coordinates or digest drifted");
	const bundleMaterial = strictSnapshot({
		schemaVersion: D721_BUNDLE_SCHEMA,
		underlyingBundle: coverage.underlying,
		qualification,
		generation,
	});
	const bundleDigest = digest(candidate.bundleDigest, "d721.bundle.bundleDigest");
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D721 bundle digest mismatch");
	return Object.freeze({ ...bundleMaterial, bundleDigest });
}

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
}

async function canonicalPrivateRoot(
	value: unknown,
): Promise<{ readonly path: string; readonly identity: FileIdentity }> {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError("D721 privateRoot is invalid");
	const absolute = resolve(value);
	if (absolute !== value) throw new TypeError("D721 privateRoot must be absolute and canonical");
	const stat = await lstat(absolute);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700)
		throw new TypeError("D721 privateRoot must be a real 0700 directory");
	if ((await realpath(absolute)) !== absolute)
		throw new TypeError("D721 privateRoot realpath drifted");
	return Object.freeze({ path: absolute, identity: { dev: stat.dev, ino: stat.ino } });
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
		throw new TypeError("D721 directory identity drifted");
}

async function writeCanonical(path: string, bytes: Uint8Array): Promise<FileIdentity> {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D721 canonical artifact is not an owned 0600 file");
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
			throw new TypeError("D721 artifact identity or bytes drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD721ProviderCapablePreLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D721ProviderCapablePreLiveBundleV1;
	readonly fault?: D721PersistenceFaultV1;
}): Promise<D721PersistenceReceiptV1> {
	const input = record(inputValue, "d721.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d721.persist",
	);
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.has(input.bundle)
	)
		throw new TypeError("D721 persistence requires a same-process constructed bundle");
	const bundle = validateD721ProviderCapablePreLiveBundle(input.bundle);
	let faultStage: "after-claim" | "after-artifacts-rename" | null = null;
	if (Object.hasOwn(input, "fault")) {
		if (typeof input.fault !== "object" || input.fault === null)
			throw new TypeError("D721 persistence fault capability is invalid");
		const fault = constructedPersistenceFaults.get(input.fault);
		if (fault === undefined || fault.consumed)
			throw new TypeError("D721 persistence fault capability is invalid or consumed");
		fault.consumed = true;
		faultStage = fault.stage;
	}
	const validatedRoot = await canonicalPrivateRoot(input.privateRoot);
	const privateRoot = validatedRoot.path;
	const parentHandle = await open(privateRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
	const finalRoot = join(privateRoot, D721_GENERATION_REF);
	let parentIdentity: FileIdentity | null = null;
	let claimCreated = false;
	let finalIdentity: FileIdentity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsIdentity: FileIdentity | null = null;
	let graphBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let qualificationBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let generationBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let bundleBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let operationError: unknown = null;
	try {
		const parentStat = await parentHandle.stat();
		parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
		if (
			parentIdentity.dev !== validatedRoot.identity.dev ||
			parentIdentity.ino !== validatedRoot.identity.ino
		)
			throw new TypeError("D721 privateRoot changed before stable-handle acquisition");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		try {
			await mkdir(finalRoot, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				throw new TypeError("D721 generation already exists");
			throw error;
		}
		claimCreated = true;
		finalHandle = await open(finalRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const finalStat = await finalHandle.stat();
		if (!finalStat.isDirectory() || (finalStat.mode & 0o777) !== 0o700)
			throw new TypeError("D721 claimed generation identity is invalid");
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		if (faultStage === "after-claim") throw new TypeError("D721 injected after-claim failure");
		graphBytes = strictJsonCodec.encode(bundle.underlyingBundle.graphEvidence);
		qualificationBytes = strictJsonCodec.encode(bundle.qualification);
		generationBytes = strictJsonCodec.encode(bundle.generation);
		bundleBytes = strictJsonCodec.encode(bundle);
		const artifacts = [
			["graph-evidence.v1.json", graphBytes],
			["qualification.v1.json", qualificationBytes],
			["generation.v1.json", generationBytes],
			["bundle.v1.json", bundleBytes],
		] as const;
		const stagingRoot = join(finalRoot, `.d721-staging-${randomUUID()}`);
		await mkdir(stagingRoot, { mode: 0o700 });
		const stagingStat = await lstat(stagingRoot);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectoryIdentity(stagingRoot, stagingIdentity, 0o700);
		const identities = new Map<string, FileIdentity>();
		for (const [name, bytes] of artifacts)
			identities.set(name, await writeCanonical(join(stagingRoot, name), bytes));
		const stagingHandle = await open(stagingRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of artifacts)
			await assertFile(join(stagingRoot, name), identities.get(name)!, bytes);
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(stagingRoot, artifactsRoot);
		artifactsHandle = await open(artifactsRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const artifactsStat = await artifactsHandle.stat();
		artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			!artifactsStat.isDirectory() ||
			(artifactsStat.mode & 0o777) !== 0o700 ||
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D721 committed artifacts identity drifted");
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		if (faultStage === "after-artifacts-rename")
			throw new TypeError("D721 injected post-rename failure");
		const commitBytes = strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly.b112.d721.provider-capable-pre-live-commit.v2",
				generationDigest: bundle.generation.generationDigest,
				bundleDigest: bundle.bundleDigest,
				artifactsDirectory: "artifacts",
			}),
		);
		const commitIdentity = await writeCanonical(join(finalRoot, "commit.v2.json"), commitBytes);
		await finalHandle.sync();
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v2.json"), commitIdentity, commitBytes);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await parentHandle.sync();
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v2.json"), commitIdentity, commitBytes);
		const finalHandleStat = await finalHandle.stat();
		const artifactsHandleStat = await artifactsHandle.stat();
		if (
			finalHandleStat.dev !== finalIdentity.dev ||
			finalHandleStat.ino !== finalIdentity.ino ||
			artifactsHandleStat.dev !== artifactsIdentity.dev ||
			artifactsHandleStat.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D721 stable directory handle identity drifted");
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
			"D721 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && claimCreated) {
		if (parentIdentity === null || finalIdentity === null) {
			cleanupError = new TypeError("D721 exact cleanup ownership was not established");
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
				cleanupError = new TypeError("D721 cleanup refused after ownership drift");
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
		if (errors.length > 1) throw new AggregateError(errors, "D721 persistence cleanup failed");
		throw operationError;
	}
	// The transaction linearizes at the final stable-handle/path rebind, second
	// readback, and parent fsync above. A later close failure cannot revoke that
	// durable commit or turn it into a false failed generation.
	void parentCloseError;
	const material = strictSnapshot({
		schemaVersion: D721_PERSISTENCE_SCHEMA,
		generationRef: D721_GENERATION_REF,
		graphArtifactDigest: empiricalSha256(graphBytes),
		qualificationArtifactDigest: empiricalSha256(qualificationBytes),
		generationArtifactDigest: empiricalSha256(generationBytes),
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
	});
	return Object.freeze({ ...material, persistenceDigest: empiricalStrictJsonDigest(material) });
}
