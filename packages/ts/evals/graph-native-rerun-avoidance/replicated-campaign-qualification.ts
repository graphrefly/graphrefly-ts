import { constants } from "node:fs";
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, empiricalStrictJsonDigest, record, strictSnapshot } from "./canonical.js";
import { D65_D64_BASELINE_PROJECTION } from "./frozen-baseline-fixture.js";
import { validateD45CanonicalEvidence } from "./graph-tool-authority.js";
import { createD65InjectedReplicateExecutor } from "./injected-replicate-executor.js";
import type { D44LiveExecutorV1 } from "./live-effect-executor.js";
import { runD65ReplicateMeasurement } from "./replicate-measurement.js";
import {
	admitD65PartialReplicateResult,
	admitD65ReplicateResult,
	createD65GraphCampaignAuthority,
	D65_CONTINUATION_HARD_CAP_MICROUSD,
	D65_D64_ARTIFACT_DIGEST,
	D65_D64_BUNDLE_DIGEST,
	D65_D64_EVIDENCE_DIGEST,
	D65_REPLICATE_COUNT,
	type D65CampaignEvidenceV1,
	deriveD65ReplicatedGate,
	snapshotD65CampaignEvidence,
	snapshotD65PartialCampaignEvidence,
	startD65ReplicateExecution,
	takeD65AdmittedReplicate,
	validateD65CampaignEvidenceWithBaseline,
	validateD65PartialCampaignEvidenceWithBaseline,
} from "./replicated-campaign-authority.js";

export const D65_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d65.replicated-campaign-qualification.v1" as const;
export const D65_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d65.replicated-campaign-qualification-bundle.v1" as const;
export const D65_QUALIFICATION_GENERATION_REF =
	"current-graph-native-replicated-campaign-2026-08-22-d65-v5" as const;

export interface D65QualificationBundleV1 {
	readonly schemaVersion: typeof D65_QUALIFICATION_BUNDLE_SCHEMA;
	readonly campaignEvidence: D65CampaignEvidenceV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D65_QUALIFICATION_SCHEMA;
		readonly decisionRef: "graphrefly-ts:D65";
		readonly exactReplicates: 5;
		readonly exactSixArmReplicates: 5;
		readonly exactThirtyArmsEvaluable: true;
		readonly exactSerialReplicateAdmission: true;
		readonly noEarlySnapshot: true;
		readonly activeReplicateReplayRejected: true;
		readonly doubleExecutionRejected: true;
		readonly crossReplicateSubstitutionRejected: true;
		readonly completeNonEvaluableRetained: true;
		readonly impossibleGateDidNotStopCampaign: true;
		readonly retryWaitReconciled: true;
		readonly cleanupFailureCanonicalized: true;
		readonly canonicalReplayQualified: true;
		readonly partialCampaignEvidenceQualified: true;
		readonly aggregateBudgetTerminalQualified: true;
		readonly frozenPositiveGateQualified: true;
		readonly wrongScopeOneOfFiveBoundaryQualified: true;
		readonly wrongScopeTwoOfFiveRejected: true;
		readonly relevantFourOfFiveRejected: true;
		readonly continuationHardCapMicrousd: 6_000_000;
		readonly aggregateHeadroomMonotonic: true;
		readonly replicatePolicyBudgetLoweringQualified: true;
		readonly optionalStoppingAllowed: false;
		readonly selectiveDiscardAllowed: false;
		readonly providerNetworkCalls: 0;
		readonly credentialReads: 0;
		readonly dispatchClaims: 0;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualificationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export async function verifyD65PrivateD64Baseline(artifactPath: string): Promise<void> {
	if (!isAbsolute(artifactPath))
		throw new TypeError("D65 private D64 artifact path must be absolute");
	const bytes = new Uint8Array(await readFile(artifactPath));
	if (empiricalSha256(bytes) !== D65_D64_ARTIFACT_DIGEST)
		throw new TypeError("D65 immutable D64 baseline artifact drifted");
	const bundle = strictJsonCodec.decode(bytes) as Record<string, unknown>;
	if (bundle.bundleDigest !== D65_D64_BUNDLE_DIGEST)
		throw new TypeError("D65 immutable D64 bundle digest drifted");
	const { bundleDigest: _bundleDigest, ...bundleMaterial } = bundle;
	if (empiricalStrictJsonDigest(bundleMaterial) !== D65_D64_BUNDLE_DIGEST)
		throw new TypeError("D65 immutable D64 bundle canonical identity drifted");
	const baselineEvidence = validateD45CanonicalEvidence(bundle.graphEvidence);
	if (
		bundle.disposition !== "success" ||
		bundle.implementationCommit !== "79e20cb94ba5989c4acb14f2c9071907a351a96a" ||
		bundle.implementationManifestDigest !==
			"sha256:a0d595298b8faf6a0b830cddbb5dc26df655aac22f604b400d01e9b9ed36e7a8" ||
		bundle.qualificationArtifactDigest !==
			"sha256:5bfb6164077d521058e0356d309c8ecf363a870bd22aa90f5ae63a68e156673c" ||
		bundle.qualificationDigest !==
			"sha256:1ee7dd45de7ab5da06d5f1906816f7f663a5e39d243884bcb949bf91bd1b61ae" ||
		bundle.providerCalls !== 39 ||
		baselineEvidence.evidenceDigest !== D65_D64_EVIDENCE_DIGEST ||
		baselineEvidence.lifecycle.arms.find((arm) => arm.arm === "relevant-applied")?.taskOutcome !==
			"passed" ||
		baselineEvidence.lifecycle.arms.find((arm) => arm.arm === "wrong-scope-applied")
			?.taskOutcome !== "passed"
	)
		throw new TypeError("D65 immutable D64 baseline outcome coordinates drifted");
}

function expectThrows(run: () => unknown, message: string): void {
	try {
		run();
	} catch {
		return;
	}
	throw new TypeError(message);
}

async function expectRejects(run: () => Promise<unknown>, message: string): Promise<void> {
	try {
		await run();
	} catch {
		return;
	}
	throw new TypeError(message);
}

function withOutcome(
	replicate: D65CampaignEvidenceV1["replicates"][number],
	armRef: "relevant-applied" | "wrong-scope-applied",
	taskOutcome: "passed" | "failed",
) {
	const arms = replicate.arms.map((arm) =>
		arm.arm === armRef
			? Object.freeze({
					...arm,
					taskOutcome,
				})
			: arm,
	);
	const material = strictSnapshot({
		replicateIndex: replicate.replicateIndex,
		source: replicate.source,
		evidenceDigest: replicate.evidenceDigest,
		executionShapeDigest: replicate.executionShapeDigest,
		arms,
		providerAttempts: replicate.providerAttempts,
		confirmedCostMicrousd: replicate.confirmedCostMicrousd,
		confirmedElapsedMs: replicate.confirmedElapsedMs,
	});
	return Object.freeze({ ...material, projectionDigest: empiricalStrictJsonDigest(material) });
}

export async function runD65InjectedNoNetworkQualification(): Promise<D65QualificationBundleV1> {
	const baselineProjection = D65_D64_BASELINE_PROJECTION;
	const baselineArtifactDigest = D65_D64_ARTIFACT_DIGEST;
	const baselineBundleDigest = D65_D64_BUNDLE_DIGEST;
	const authority = createD65GraphCampaignAuthority({
		baselineArtifactDigest,
		baselineBundleDigest,
		baselineProjection,
		campaignMode: { executionClass: "qualification", liveClaimDigest: null },
	});
	expectThrows(
		() => snapshotD65CampaignEvidence(authority),
		"D65 qualification allowed an early campaign snapshot",
	);
	let priorHeadroom = D65_CONTINUATION_HARD_CAP_MICROUSD + 1;
	let firstContinuationMeasurement: Extract<
		Awaited<ReturnType<typeof runD65ReplicateMeasurement>>,
		{ disposition: "success" }
	> | null = null;
	for (let replicateIndex = 2; replicateIndex <= D65_REPLICATE_COUNT; replicateIndex += 1) {
		const effect = takeD65AdmittedReplicate(authority);
		if (
			effect === null ||
			effect.replicateIndex !== replicateIndex ||
			effect.remainingContinuationCostMicrousd >= priorHeadroom
		)
			throw new TypeError("D65 qualification replicate admission or aggregate headroom drifted");
		priorHeadroom = effect.remainingContinuationCostMicrousd;
		expectThrows(
			() => takeD65AdmittedReplicate(authority),
			"D65 qualification admitted overlapping replicates",
		);
		const execution = startD65ReplicateExecution(authority, effect);
		expectThrows(
			() => startD65ReplicateExecution(authority, effect),
			"D65 qualification allowed the same replicate to execute twice",
		);
		const injected = createD65InjectedReplicateExecutor();
		const measurement = await runD65ReplicateMeasurement({
			executor: injected.executor,
			injectedNoNetwork: true,
			replicateExecution: execution,
		});
		const observation = injected.observation();
		if (
			measurement.disposition !== "success" ||
			measurement.providerCalls !== observation.providerCalls ||
			!observation.disposed ||
			observation.maxActiveEffects !== 1 ||
			measurement.evidence.lifecycle.policy.campaign.maxCostMicrousd !==
				effect.remainingContinuationCostMicrousd
		)
			throw new TypeError("D65 injected replicate runner integration drifted");
		if (replicateIndex === 2) firstContinuationMeasurement = measurement;
		if (replicateIndex === 2) {
			const duplicateInjected = createD65InjectedReplicateExecutor();
			await expectRejects(
				() =>
					runD65ReplicateMeasurement({
						executor: duplicateInjected.executor,
						injectedNoNetwork: true,
						replicateExecution: execution,
					}),
				"D65 qualification executed one Graph capability twice",
			);
		}
		if (replicateIndex === 3 && firstContinuationMeasurement !== null)
			expectThrows(
				() =>
					admitD65ReplicateResult(
						authority,
						execution,
						firstContinuationMeasurement!.evidence,
						firstContinuationMeasurement!.retryWaitElapsedMs,
					),
				"D65 qualification accepted evidence from another replicate execution",
			);
		admitD65ReplicateResult(
			authority,
			execution,
			measurement.evidence,
			measurement.retryWaitElapsedMs,
		);
		expectThrows(
			() =>
				admitD65ReplicateResult(
					authority,
					execution,
					measurement.evidence,
					measurement.retryWaitElapsedMs,
				),
			"D65 qualification accepted a replayed replicate result",
		);
	}
	if (takeD65AdmittedReplicate(authority) !== null)
		throw new TypeError("D65 qualification admitted a sixth replicate");
	const campaignEvidence = snapshotD65CampaignEvidence(authority);
	if (!campaignEvidence.frozenGatePassed || campaignEvidence.efficacyClaim !== "none")
		throw new TypeError(
			`D65 qualification positive replicated gate did not pass: ${JSON.stringify({ exact: campaignEvidence.exactThirtyArmsEvaluable, relevant: campaignEvidence.relevantPassCount, controls: campaignEvidence.controlPassCounts, shapes: campaignEvidence.replicates.map((replicate) => replicate.executionShapeDigest) })}`,
		);
	const replayed = validateD65CampaignEvidenceWithBaseline({
		evidence: campaignEvidence,
		baselineProjection,
	});
	if (replayed.evidenceDigest !== campaignEvidence.evidenceDigest)
		throw new TypeError("D65 qualification canonical replay changed evidence identity");

	const partialAuthority = createD65GraphCampaignAuthority({
		baselineArtifactDigest,
		baselineBundleDigest,
		baselineProjection,
		campaignMode: { executionClass: "qualification", liveClaimDigest: null },
	});
	const partialEffect = takeD65AdmittedReplicate(partialAuthority);
	if (partialEffect === null) throw new TypeError("D65 partial qualification omitted admission");
	const partialExecution = startD65ReplicateExecution(partialAuthority, partialEffect);
	const partialInjected = createD65InjectedReplicateExecutor();
	let injectedFailure = false;
	const partialExecutor: D44LiveExecutorV1 = Object.freeze({
		revision: partialInjected.executor.revision,
		async execute(authorityValue: object, effect: Parameters<D44LiveExecutorV1["execute"]>[1]) {
			if (!injectedFailure && effect.effectKind === "provider-proposal") {
				injectedFailure = true;
				throw new TypeError("D65 bounded injected provider failure");
			}
			return partialInjected.executor.execute(authorityValue, effect);
		},
		dispose: () => partialInjected.executor.dispose(),
	});
	const partialMeasurement = await runD65ReplicateMeasurement({
		executor: partialExecutor,
		injectedNoNetwork: false,
		replicateExecution: partialExecution,
	});
	if (
		partialMeasurement.disposition !== "partial-failure" ||
		!injectedFailure ||
		!partialInjected.observation().disposed
	)
		throw new TypeError("D65 injected partial measurement did not fail closed");
	admitD65PartialReplicateResult(
		partialAuthority,
		partialExecution,
		partialMeasurement.partialEvidence,
		partialMeasurement.retryWaitElapsedMs,
	);
	expectThrows(
		() =>
			admitD65PartialReplicateResult(
				partialAuthority,
				partialExecution,
				partialMeasurement.partialEvidence,
				partialMeasurement.retryWaitElapsedMs,
			),
		"D65 qualification accepted a replayed partial result",
	);
	const partialCampaignEvidence = snapshotD65PartialCampaignEvidence(partialAuthority);
	if (
		partialCampaignEvidence.terminalCauseCode !== "replicate-partial-failure" ||
		partialCampaignEvidence.partialReplicateEvidence?.evidenceDigest !==
			partialMeasurement.partialEvidence.evidenceDigest ||
		validateD65PartialCampaignEvidenceWithBaseline({
			evidence: partialCampaignEvidence,
			baselineProjection,
		}).evidenceDigest !== partialCampaignEvidence.evidenceDigest
	)
		throw new TypeError("D65 partial campaign canonical replay drifted");

	const probeAuthority = createD65GraphCampaignAuthority({
		baselineArtifactDigest,
		baselineBundleDigest,
		baselineProjection,
		campaignMode: { executionClass: "qualification", liveClaimDigest: null },
	});
	const probeEffect = takeD65AdmittedReplicate(probeAuthority);
	if (probeEffect === null) throw new TypeError("D65 budget probe omitted admission");
	const probeExecution = startD65ReplicateExecution(probeAuthority, probeEffect);
	const probeInjected = createD65InjectedReplicateExecutor({ providerCostMicrousd: 0 });
	const probe = await runD65ReplicateMeasurement({
		executor: probeInjected.executor,
		injectedNoNetwork: true,
		replicateExecution: probeExecution,
	});
	if (probe.disposition !== "success" || probe.providerCalls < 1)
		throw new TypeError("D65 budget probe did not complete");
	const budgetAuthority = createD65GraphCampaignAuthority({
		baselineArtifactDigest,
		baselineBundleDigest,
		baselineProjection,
		campaignMode: { executionClass: "qualification", liveClaimDigest: null },
	});
	const budgetEffect = takeD65AdmittedReplicate(budgetAuthority);
	if (budgetEffect === null) throw new TypeError("D65 budget qualification omitted admission");
	const providerCostMicrousd = Math.floor(
		(D65_CONTINUATION_HARD_CAP_MICROUSD - 50_000) / (probe.providerCalls * 2),
	);
	let nextBudgetEffect = budgetEffect;
	for (let budgetReplicate = 0; budgetReplicate < 2; budgetReplicate += 1) {
		const budgetInjected = createD65InjectedReplicateExecutor({ providerCostMicrousd });
		const budgetExecution = startD65ReplicateExecution(budgetAuthority, nextBudgetEffect);
		const budgetMeasurement = await runD65ReplicateMeasurement({
			executor: budgetInjected.executor,
			injectedNoNetwork: true,
			replicateExecution: budgetExecution,
		});
		if (budgetMeasurement.disposition !== "success")
			throw new TypeError("D65 budget-bound replicate did not complete");
		admitD65ReplicateResult(
			budgetAuthority,
			budgetExecution,
			budgetMeasurement.evidence,
			budgetMeasurement.retryWaitElapsedMs,
		);
		if (budgetReplicate === 0) {
			const admitted = takeD65AdmittedReplicate(budgetAuthority);
			if (admitted === null)
				throw new TypeError("D65 aggregate budget terminated before its exact headroom boundary");
			nextBudgetEffect = admitted;
		}
	}
	if (takeD65AdmittedReplicate(budgetAuthority) !== null)
		throw new TypeError("D65 aggregate budget terminal admitted another replicate");
	const budgetTerminalEvidence = snapshotD65PartialCampaignEvidence(budgetAuthority);
	if (
		budgetTerminalEvidence.terminalCauseCode !== "aggregate-budget-exhausted" ||
		budgetTerminalEvidence.continuationConfirmedCostMicrousd > D65_CONTINUATION_HARD_CAP_MICROUSD ||
		D65_CONTINUATION_HARD_CAP_MICROUSD - budgetTerminalEvidence.continuationConfirmedCostMicrousd >=
			100_000 ||
		validateD65PartialCampaignEvidenceWithBaseline({
			evidence: budgetTerminalEvidence,
			baselineProjection,
		}).evidenceDigest !== budgetTerminalEvidence.evidenceDigest
	)
		throw new TypeError("D65 aggregate budget terminal replay drifted");
	const oneWrongScope = campaignEvidence.replicates;
	const twoWrongScope = oneWrongScope.map((replicate, index) =>
		index === 1 ? withOutcome(replicate, "wrong-scope-applied", "passed") : replicate,
	);
	const relevantFour = campaignEvidence.replicates.map((replicate, index) =>
		index === 4 ? withOutcome(replicate, "relevant-applied", "failed") : replicate,
	);
	if (
		!deriveD65ReplicatedGate(oneWrongScope).frozenGatePassed ||
		deriveD65ReplicatedGate(twoWrongScope).frozenGatePassed ||
		deriveD65ReplicatedGate(relevantFour).frozenGatePassed
	)
		throw new TypeError("D65 qualification frozen efficacy threshold drifted");

	const impossibleAuthority = createD65GraphCampaignAuthority({
		baselineArtifactDigest,
		baselineBundleDigest,
		baselineProjection,
		campaignMode: { executionClass: "qualification", liveClaimDigest: null },
	});
	let retryReconciled = false;
	for (let replicateIndex = 2; replicateIndex <= D65_REPLICATE_COUNT; replicateIndex += 1) {
		const effect = takeD65AdmittedReplicate(impossibleAuthority);
		if (effect === null || effect.replicateIndex !== replicateIndex)
			throw new TypeError("D65 impossible-gate campaign stopped early");
		const execution = startD65ReplicateExecution(impossibleAuthority, effect);
		const injected = createD65InjectedReplicateExecutor(
			replicateIndex === 2
				? { providerFailureArm: "relevant-applied", retryOnceDelayMs: 60_000 }
				: undefined,
		);
		const measurement = await runD65ReplicateMeasurement({
			executor: injected.executor,
			injectedNoNetwork: true,
			replicateExecution: execution,
		});
		if (measurement.disposition !== "success")
			throw new TypeError("D65 impossible-gate replicate did not remain a complete measurement");
		admitD65ReplicateResult(
			impossibleAuthority,
			execution,
			measurement.evidence,
			measurement.retryWaitElapsedMs,
		);
		if (replicateIndex === 2) retryReconciled = measurement.retryWaitElapsedMs === 60_000;
	}
	const impossibleEvidence = snapshotD65CampaignEvidence(impossibleAuthority);
	if (
		impossibleEvidence.exactFiveReplicatesCompleted !== true ||
		impossibleEvidence.exactThirtyArmsEvaluable ||
		impossibleEvidence.frozenGatePassed ||
		impossibleEvidence.efficacyClaim !== "none" ||
		!retryReconciled ||
		impossibleEvidence.replicates[1]!.confirmedElapsedMs < 60_000
	)
		throw new TypeError(
			`D65 non-evaluable/no-optional-stopping qualification drifted: ${JSON.stringify({ exact: impossibleEvidence.exactFiveReplicatesCompleted, evaluable: impossibleEvidence.exactThirtyArmsEvaluable, gate: impossibleEvidence.frozenGatePassed, claim: impossibleEvidence.efficacyClaim, retryReconciled, elapsed: impossibleEvidence.replicates[1]!.confirmedElapsedMs, outcomes: impossibleEvidence.replicates[1]!.arms })}`,
		);

	const cleanupAuthority = createD65GraphCampaignAuthority({
		baselineArtifactDigest,
		baselineBundleDigest,
		baselineProjection,
		campaignMode: { executionClass: "qualification", liveClaimDigest: null },
	});
	const cleanupEffect = takeD65AdmittedReplicate(cleanupAuthority);
	if (cleanupEffect === null) throw new TypeError("D65 cleanup qualification omitted admission");
	const cleanupExecution = startD65ReplicateExecution(cleanupAuthority, cleanupEffect);
	const cleanupInjected = createD65InjectedReplicateExecutor({ failDispose: true });
	const cleanupMeasurement = await runD65ReplicateMeasurement({
		executor: cleanupInjected.executor,
		injectedNoNetwork: true,
		replicateExecution: cleanupExecution,
	});
	if (cleanupMeasurement.disposition !== "partial-failure")
		throw new TypeError("D65 cleanup failure escaped the runner result boundary");
	admitD65PartialReplicateResult(
		cleanupAuthority,
		cleanupExecution,
		cleanupMeasurement.partialEvidence,
		cleanupMeasurement.retryWaitElapsedMs,
	);
	if (
		snapshotD65PartialCampaignEvidence(cleanupAuthority).terminalCauseCode !==
		"replicate-partial-failure"
	)
		throw new TypeError("D65 cleanup failure escaped canonical campaign evidence");

	const qualificationMaterial = strictSnapshot({
		schemaVersion: D65_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		exactReplicates: 5 as const,
		exactSixArmReplicates: 5 as const,
		exactThirtyArmsEvaluable: true as const,
		exactSerialReplicateAdmission: true as const,
		noEarlySnapshot: true as const,
		activeReplicateReplayRejected: true as const,
		doubleExecutionRejected: true as const,
		crossReplicateSubstitutionRejected: true as const,
		completeNonEvaluableRetained: true as const,
		impossibleGateDidNotStopCampaign: true as const,
		retryWaitReconciled: true as const,
		cleanupFailureCanonicalized: true as const,
		canonicalReplayQualified: true as const,
		partialCampaignEvidenceQualified: true as const,
		aggregateBudgetTerminalQualified: true as const,
		frozenPositiveGateQualified: true as const,
		wrongScopeOneOfFiveBoundaryQualified: true as const,
		wrongScopeTwoOfFiveRejected: true as const,
		relevantFourOfFiveRejected: true as const,
		continuationHardCapMicrousd: D65_CONTINUATION_HARD_CAP_MICROUSD,
		aggregateHeadroomMonotonic: true as const,
		replicatePolicyBudgetLoweringQualified: true as const,
		optionalStoppingAllowed: false as const,
		selectiveDiscardAllowed: false as const,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D65_QUALIFICATION_BUNDLE_SCHEMA,
		campaignEvidence,
		qualification,
	});
	return Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
}

export async function persistD65Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D65QualificationBundleV1;
}): Promise<Readonly<{ artifactDigest: string; receiptDigest: string }>> {
	if (!isAbsolute(input.privateRoot)) throw new TypeError("D65 persistence root must be absolute");
	const validatedBundle = validateD65QualificationBundle(input.bundle, D65_D64_BASELINE_PROJECTION);
	const generationRoot = join(input.privateRoot, D65_QUALIFICATION_GENERATION_REF);
	await mkdir(generationRoot, { recursive: true, mode: 0o700 });
	await chmod(generationRoot, 0o700);
	const target = join(generationRoot, "bundle.v1.json");
	const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
	const bytes = strictJsonCodec.encode(validatedBundle);
	try {
		const existing = new Uint8Array(await readFile(target));
		if (!Buffer.from(existing).equals(Buffer.from(bytes)))
			throw new TypeError("D65 immutable qualification artifact already exists with other bytes");
		validateD65QualificationBundle(strictJsonCodec.decode(existing), D65_D64_BASELINE_PROJECTION);
		const artifactDigest = empiricalSha256(existing);
		return Object.freeze({
			artifactDigest,
			receiptDigest: empiricalStrictJsonDigest({
				artifactDigest,
				bundleDigest: validatedBundle.bundleDigest,
			}),
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	let writer: Awaited<ReturnType<typeof open>> | null = null;
	try {
		writer = await open(
			temp,
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await writer.writeFile(bytes);
			await writer.sync();
		} finally {
			await writer.close();
			writer = null;
		}
		await link(temp, target);
	} finally {
		await writer?.close().catch(() => undefined);
		await unlink(temp).catch(() => undefined);
	}
	const directory = await open(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
	const persisted = new Uint8Array(await readFile(target));
	if (!Buffer.from(persisted).equals(Buffer.from(bytes)))
		throw new TypeError("D65 persisted qualification bytes drifted");
	validateD65QualificationBundle(strictJsonCodec.decode(persisted), D65_D64_BASELINE_PROJECTION);
	const artifactDigest = empiricalSha256(persisted);
	return Object.freeze({
		artifactDigest,
		receiptDigest: empiricalStrictJsonDigest({
			artifactDigest,
			bundleDigest: validatedBundle.bundleDigest,
		}),
	});
}

export function validateD65QualificationBundle(
	value: unknown,
	baselineProjection: unknown,
): D65QualificationBundleV1 {
	const candidate = record(value, "D65 qualification bundle");
	if (
		candidate.schemaVersion !== D65_QUALIFICATION_BUNDLE_SCHEMA ||
		JSON.stringify(Object.keys(candidate).sort()) !==
			JSON.stringify(["bundleDigest", "campaignEvidence", "qualification", "schemaVersion"])
	)
		throw new TypeError("D65 qualification bundle keys or schema drifted");
	const suppliedBundleDigest = String(candidate.bundleDigest);
	const { bundleDigest: _bundleDigest, ...bundleMaterial } = candidate;
	if (empiricalStrictJsonDigest(bundleMaterial) !== suppliedBundleDigest)
		throw new TypeError("D65 qualification bundle digest drifted");
	const qualification = record(candidate.qualification, "D65 qualification");
	const suppliedQualificationDigest = String(qualification.qualificationDigest);
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
	const expectedQualification = strictSnapshot({
		schemaVersion: D65_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		exactReplicates: 5 as const,
		exactSixArmReplicates: 5 as const,
		exactThirtyArmsEvaluable: true as const,
		exactSerialReplicateAdmission: true as const,
		noEarlySnapshot: true as const,
		activeReplicateReplayRejected: true as const,
		doubleExecutionRejected: true as const,
		crossReplicateSubstitutionRejected: true as const,
		completeNonEvaluableRetained: true as const,
		impossibleGateDidNotStopCampaign: true as const,
		retryWaitReconciled: true as const,
		cleanupFailureCanonicalized: true as const,
		canonicalReplayQualified: true as const,
		partialCampaignEvidenceQualified: true as const,
		aggregateBudgetTerminalQualified: true as const,
		frozenPositiveGateQualified: true as const,
		wrongScopeOneOfFiveBoundaryQualified: true as const,
		wrongScopeTwoOfFiveRejected: true as const,
		relevantFourOfFiveRejected: true as const,
		continuationHardCapMicrousd: D65_CONTINUATION_HARD_CAP_MICROUSD,
		aggregateHeadroomMonotonic: true as const,
		replicatePolicyBudgetLoweringQualified: true as const,
		optionalStoppingAllowed: false as const,
		selectiveDiscardAllowed: false as const,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	if (
		empiricalStrictJsonDigest(qualificationMaterial) !== suppliedQualificationDigest ||
		empiricalStrictJsonDigest(qualificationMaterial) !==
			empiricalStrictJsonDigest(expectedQualification)
	)
		throw new TypeError("D65 qualification coordinates drifted");
	const replayed = validateD65CampaignEvidenceWithBaseline({
		evidence: candidate.campaignEvidence,
		baselineProjection,
	});
	if (
		!replayed.frozenGatePassed ||
		replayed.efficacyClaim !== "none" ||
		replayed.campaignMode.executionClass !== "qualification" ||
		replayed.campaignMode.liveClaimDigest !== null
	)
		throw new TypeError("D65 qualification campaign evidence was not synthetic-only");
	return strictSnapshot(candidate) as unknown as D65QualificationBundleV1;
}
