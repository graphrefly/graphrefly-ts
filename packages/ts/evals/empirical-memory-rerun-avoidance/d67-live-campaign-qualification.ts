import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import type { D44LiveExecutorV1 } from "./d44-d45-live-composition.js";
import type {
	D44D45CredentialV1,
	D44D45PricingObservationV1,
	D44D45ZeroByokObservationV1,
} from "./d44-d45-live-gates.js";
import { createD65InjectedReplicateExecutor } from "./d65-injected-replicate-executor.js";
import { runD65ReplicateMeasurement } from "./d65-replicate-measurement.js";
import { D65_REPLICATE_COUNT } from "./d65-replicated-campaign-authority.js";
import { runD66RetryIdentityQualification } from "./d66-retry-identity-qualification.js";
import {
	admitD67LivePartialReplicateResult,
	admitD67LiveReplicateResult,
	createD67LiveGraphCampaignAuthority,
	snapshotD67LiveCampaignEvidence,
	snapshotD67LivePartialCampaignEvidence,
	startD67LiveReplicateExecution,
	takeD67LiveAdmittedReplicate,
	validateD67LiveCampaignEvidence,
	validateD67LivePartialCampaignEvidence,
} from "./d67-live-campaign-authority.js";
import {
	constructD67LiveCampaignBundle,
	persistD67LiveCampaignBundle,
	validateD67LiveCampaignBundle,
} from "./d67-live-campaign-bundle.js";
import {
	acquireD67LiveDispatchClaim,
	composeD67LivePreclaim,
	consumeD67LiveDispatchClaim,
	prepareD67LivePrivateRoot,
} from "./d67-live-campaign-claim.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

export const D67_LIVE_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d67.live-campaign-qualification.v1" as const;

function fakeLiveCoordinates(): {
	readonly credential: D44D45CredentialV1;
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
} {
	const credential = Object.freeze({
		bearerToken: "sk-or-v1-d67-injected-no-network-token",
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-21.d45.v1" as const,
	});
	const pricingMaterial = strictSnapshot({
		sourceUrl:
			"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const,
		modelRef: "deepseek/deepseek-v4-flash-0731" as const,
		endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
		providerName: "DeepInfra" as const,
		providerTag: "deepinfra/fp8" as const,
		quantization: "fp8" as const,
		inputMicrousdPerMillionTokens: 80_000 as const,
		outputMicrousdPerMillionTokens: 180_000 as const,
		cacheReadMicrousdPerMillionTokens: 16_000 as const,
		supportedParametersDigest: `sha256:${"1".repeat(64)}`,
		officialResponseDigest: `sha256:${"2".repeat(64)}`,
		observedAtMs: 1_777_000_000_000,
	});
	const zeroByokMaterial = strictSnapshot({
		workspaceSlug: "graph-re-fly" as const,
		keyName: "Local Eval 2" as const,
		byokCredentialCount: 0 as const,
		providerObservation: "DeepInfra Not configured" as const,
		observedAtMs: 1_777_000_000_000,
		sourceArtifactDigest: `sha256:${"3".repeat(64)}`,
	});
	return Object.freeze({
		credential,
		pricing: Object.freeze({
			...pricingMaterial,
			observationDigest: empiricalStrictJsonDigest(pricingMaterial),
		}),
		zeroByok: Object.freeze({
			...zeroByokMaterial,
			observationDigest: empiricalStrictJsonDigest(zeroByokMaterial),
		}),
	});
}

export async function runD67LiveInjectedNoNetworkQualification() {
	const d66Qualification = runD66RetryIdentityQualification();
	const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d67-live-")));
	await chmod(root, 0o700);
	try {
		await prepareD67LivePrivateRoot(root);
		const { credential, pricing, zeroByok } = fakeLiveCoordinates();
		const preclaim = composeD67LivePreclaim({ credential, pricing, zeroByok });
		const claim = await acquireD67LiveDispatchClaim({
			privateRoot: root,
			preclaim,
			implementationCommit: "a".repeat(40),
			implementationManifestDigest: `sha256:${"4".repeat(64)}`,
			qualificationArtifactDigest: `sha256:${"5".repeat(64)}`,
			qualificationDigest: `sha256:${"6".repeat(64)}`,
		});
		let currentKeyCalls = 0;
		const currentKeyAdmission = await createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: async () => {
				currentKeyCalls += 1;
				return new Response(
					JSON.stringify({
						data: {
							limit: 32,
							limit_remaining: 31,
							usage: 1,
							limit_reset: null,
							is_management_key: false,
						},
					}),
					{ status: 200 },
				);
			},
		}).read({
			credential,
			expectedLimitMicrousd: 32_000_000,
			requiredRemainingMicrousd: 6_000_000,
			signal: AbortSignal.timeout(1_000),
		});
		const liveCapability = await consumeD67LiveDispatchClaim({ claim, currentKeyAdmission });
		const authority = createD67LiveGraphCampaignAuthority({
			liveCampaignCapability: liveCapability,
		});
		let liveCapabilityReplayRejected = false;
		try {
			createD67LiveGraphCampaignAuthority({ liveCampaignCapability: liveCapability });
		} catch {
			liveCapabilityReplayRejected = true;
		}
		if (!liveCapabilityReplayRejected)
			throw new TypeError("D67 live qualification replayed a consumed campaign capability");
		let forgedLiveCapabilityRejected = false;
		try {
			createD67LiveGraphCampaignAuthority({
				liveCampaignCapability: Object.freeze({ ...liveCapability }),
			});
		} catch {
			forgedLiveCapabilityRejected = true;
		}
		if (!forgedLiveCapabilityRejected)
			throw new TypeError("D67 live qualification accepted a structural campaign capability");
		let providerCalls = 0;
		for (let index = 2; index <= D65_REPLICATE_COUNT; index += 1) {
			const effect = takeD67LiveAdmittedReplicate(authority);
			if (effect?.replicateIndex !== index)
				throw new TypeError("D67 live qualification replicate admission drifted");
			const execution = startD67LiveReplicateExecution(authority, effect);
			const injected = createD65InjectedReplicateExecutor();
			const measurement = await runD65ReplicateMeasurement({
				executor: injected.executor,
				injectedNoNetwork: true,
				replicateExecution: execution,
			});
			if (measurement.disposition !== "success")
				throw new TypeError("D67 live qualification replicate failed");
			providerCalls += measurement.providerCalls;
			admitD67LiveReplicateResult(
				authority,
				execution,
				measurement.evidence,
				measurement.retryWaitElapsedMs,
			);
		}
		if (takeD67LiveAdmittedReplicate(authority) !== null)
			throw new TypeError("D67 live qualification admitted a sixth replicate");
		const evidence = validateD67LiveCampaignEvidence(snapshotD67LiveCampaignEvidence(authority));
		if (
			!evidence.frozenGatePassed ||
			evidence.efficacyClaim !== "replicated-frozen-task-positive-differential" ||
			evidence.binding.liveClaimDigest !== claim.claimDigest
		)
			throw new TypeError("D67 claim-gated live efficacy projection drifted");
		const bundle = constructD67LiveCampaignBundle({
			claim,
			preclaim,
			currentKeyAdmission,
			pricing,
			zeroByok,
			implementationCommit: claim.implementationCommit,
			implementationManifestDigest: claim.implementationManifestDigest,
			qualificationArtifactDigest: claim.qualificationArtifactDigest,
			qualificationDigest: claim.qualificationDigest,
			providerCalls,
			measurement: { disposition: "success", evidence },
		});
		const persistence = await persistD67LiveCampaignBundle({ privateRoot: root, bundle });
		validateD67LiveCampaignBundle(bundle);

		const partialRoot = join(root, "partial-campaign");
		await prepareD67LivePrivateRoot(partialRoot);
		const partialPreclaim = composeD67LivePreclaim({ credential, pricing, zeroByok });
		const partialClaim = await acquireD67LiveDispatchClaim({
			privateRoot: partialRoot,
			preclaim: partialPreclaim,
			implementationCommit: "b".repeat(40),
			implementationManifestDigest: `sha256:${"7".repeat(64)}`,
			qualificationArtifactDigest: `sha256:${"8".repeat(64)}`,
			qualificationDigest: `sha256:${"9".repeat(64)}`,
		});
		const partialCurrentKey = await createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: async () =>
				new Response(
					JSON.stringify({
						data: {
							limit: 32,
							limit_remaining: 31,
							usage: 1,
							limit_reset: null,
							is_management_key: false,
						},
					}),
					{ status: 200 },
				),
		}).read({
			credential,
			expectedLimitMicrousd: 32_000_000,
			requiredRemainingMicrousd: 6_000_000,
			signal: AbortSignal.timeout(1_000),
		});
		const partialCapability = await consumeD67LiveDispatchClaim({
			claim: partialClaim,
			currentKeyAdmission: partialCurrentKey,
		});
		const partialAuthority = createD67LiveGraphCampaignAuthority({
			liveCampaignCapability: partialCapability,
		});
		const partialEffect = takeD67LiveAdmittedReplicate(partialAuthority);
		if (partialEffect === null)
			throw new TypeError("D67 live partial qualification omitted admission");
		const partialExecution = startD67LiveReplicateExecution(partialAuthority, partialEffect);
		const injectedFailure = createD65InjectedReplicateExecutor();
		const failingExecutor: D44LiveExecutorV1 = Object.freeze({
			revision: injectedFailure.executor.revision,
			async execute() {
				throw new TypeError("D67 injected live executor failure");
			},
			dispose: () => injectedFailure.executor.dispose(),
		});
		const partialMeasurement = await runD65ReplicateMeasurement({
			executor: failingExecutor,
			injectedNoNetwork: false,
			replicateExecution: partialExecution,
		});
		if (partialMeasurement.disposition !== "partial-failure")
			throw new TypeError("D67 live partial qualification did not fail closed");
		admitD67LivePartialReplicateResult(
			partialAuthority,
			partialExecution,
			partialMeasurement.partialEvidence,
			partialMeasurement.retryWaitElapsedMs,
		);
		const partialEvidence = validateD67LivePartialCampaignEvidence(
			snapshotD67LivePartialCampaignEvidence(partialAuthority),
		);
		const partialBundle = constructD67LiveCampaignBundle({
			claim: partialClaim,
			preclaim: partialPreclaim,
			currentKeyAdmission: partialCurrentKey,
			pricing,
			zeroByok,
			implementationCommit: partialClaim.implementationCommit,
			implementationManifestDigest: partialClaim.implementationManifestDigest,
			qualificationArtifactDigest: partialClaim.qualificationArtifactDigest,
			qualificationDigest: partialClaim.qualificationDigest,
			providerCalls: partialMeasurement.providerCalls,
			measurement: { disposition: "partial-failure", partialEvidence },
		});
		await persistD67LiveCampaignBundle({ privateRoot: partialRoot, bundle: partialBundle });
		if (
			partialBundle.disposition !== "partial-failure" ||
			partialBundle.graphEvidence !== null ||
			partialBundle.partialGraphEvidence?.evidenceDigest !== partialEvidence.evidenceDigest ||
			partialBundle.efficacyClaim !== "none"
		)
			throw new TypeError("D67 live partial bundle persistence drifted");
		return Object.freeze({
			schemaVersion: D67_LIVE_QUALIFICATION_SCHEMA,
			d66QualificationDigest: d66Qualification.qualificationDigest,
			currentKeyCalls,
			providerNetworkCalls: 0 as const,
			providerCalls,
			liveCapabilityReplayRejected,
			forgedLiveCapabilityRejected,
			partialCampaignEvidenceQualified: true as const,
			claimDigest: claim.claimDigest,
			campaignEvidenceDigest: evidence.evidenceDigest,
			bundleDigest: bundle.bundleDigest,
			artifactDigest: persistence.artifactDigest,
			receiptDigest: persistence.receiptDigest,
			efficacyClaim: evidence.efficacyClaim,
			qualificationDigest: empiricalStrictJsonDigest({
				claimDigest: claim.claimDigest,
				campaignEvidenceDigest: evidence.evidenceDigest,
				bundleDigest: bundle.bundleDigest,
				artifactDigest: persistence.artifactDigest,
				receiptDigest: persistence.receiptDigest,
			}),
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
