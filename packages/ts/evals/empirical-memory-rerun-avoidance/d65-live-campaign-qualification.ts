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
import {
	admitD65LivePartialReplicateResult,
	admitD65LiveReplicateResult,
	createD65LiveGraphCampaignAuthority,
	snapshotD65LiveCampaignEvidence,
	snapshotD65LivePartialCampaignEvidence,
	startD65LiveReplicateExecution,
	takeD65LiveAdmittedReplicate,
	validateD65LiveCampaignEvidence,
	validateD65LivePartialCampaignEvidence,
} from "./d65-live-campaign-authority.js";
import {
	constructD65LiveCampaignBundle,
	persistD65LiveCampaignBundle,
	validateD65LiveCampaignBundle,
} from "./d65-live-campaign-bundle.js";
import {
	acquireD65LiveDispatchClaim,
	composeD65LivePreclaim,
	consumeD65LiveDispatchClaim,
	prepareD65LivePrivateRoot,
} from "./d65-live-campaign-claim.js";
import { runD65ReplicateMeasurement } from "./d65-replicate-measurement.js";
import { D65_REPLICATE_COUNT } from "./d65-replicated-campaign-authority.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

export const D65_LIVE_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d65.live-campaign-qualification.v1" as const;

function fakeLiveCoordinates(): {
	readonly credential: D44D45CredentialV1;
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
} {
	const credential = Object.freeze({
		bearerToken: "sk-or-v1-d65-injected-no-network-token",
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

export async function runD65LiveInjectedNoNetworkQualification() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d65-live-")));
	await chmod(root, 0o700);
	try {
		await prepareD65LivePrivateRoot(root);
		const { credential, pricing, zeroByok } = fakeLiveCoordinates();
		const preclaim = composeD65LivePreclaim({ credential, pricing, zeroByok });
		const claim = await acquireD65LiveDispatchClaim({
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
		const liveCapability = await consumeD65LiveDispatchClaim({ claim, currentKeyAdmission });
		const authority = createD65LiveGraphCampaignAuthority({
			liveCampaignCapability: liveCapability,
		});
		let liveCapabilityReplayRejected = false;
		try {
			createD65LiveGraphCampaignAuthority({ liveCampaignCapability: liveCapability });
		} catch {
			liveCapabilityReplayRejected = true;
		}
		if (!liveCapabilityReplayRejected)
			throw new TypeError("D65 live qualification replayed a consumed campaign capability");
		let forgedLiveCapabilityRejected = false;
		try {
			createD65LiveGraphCampaignAuthority({
				liveCampaignCapability: Object.freeze({ ...liveCapability }),
			});
		} catch {
			forgedLiveCapabilityRejected = true;
		}
		if (!forgedLiveCapabilityRejected)
			throw new TypeError("D65 live qualification accepted a structural campaign capability");
		let providerCalls = 0;
		for (let index = 2; index <= D65_REPLICATE_COUNT; index += 1) {
			const effect = takeD65LiveAdmittedReplicate(authority);
			if (effect?.replicateIndex !== index)
				throw new TypeError("D65 live qualification replicate admission drifted");
			const execution = startD65LiveReplicateExecution(authority, effect);
			const injected = createD65InjectedReplicateExecutor();
			const measurement = await runD65ReplicateMeasurement({
				executor: injected.executor,
				injectedNoNetwork: true,
				replicateExecution: execution,
			});
			if (measurement.disposition !== "success")
				throw new TypeError("D65 live qualification replicate failed");
			providerCalls += measurement.providerCalls;
			admitD65LiveReplicateResult(
				authority,
				execution,
				measurement.evidence,
				measurement.retryWaitElapsedMs,
			);
		}
		if (takeD65LiveAdmittedReplicate(authority) !== null)
			throw new TypeError("D65 live qualification admitted a sixth replicate");
		const evidence = validateD65LiveCampaignEvidence(snapshotD65LiveCampaignEvidence(authority));
		if (
			!evidence.frozenGatePassed ||
			evidence.efficacyClaim !== "replicated-frozen-task-positive-differential" ||
			evidence.binding.liveClaimDigest !== claim.claimDigest
		)
			throw new TypeError("D65 claim-gated live efficacy projection drifted");
		const bundle = constructD65LiveCampaignBundle({
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
		const persistence = await persistD65LiveCampaignBundle({ privateRoot: root, bundle });
		validateD65LiveCampaignBundle(bundle);

		const partialRoot = join(root, "partial-campaign");
		await prepareD65LivePrivateRoot(partialRoot);
		const partialPreclaim = composeD65LivePreclaim({ credential, pricing, zeroByok });
		const partialClaim = await acquireD65LiveDispatchClaim({
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
		const partialCapability = await consumeD65LiveDispatchClaim({
			claim: partialClaim,
			currentKeyAdmission: partialCurrentKey,
		});
		const partialAuthority = createD65LiveGraphCampaignAuthority({
			liveCampaignCapability: partialCapability,
		});
		const partialEffect = takeD65LiveAdmittedReplicate(partialAuthority);
		if (partialEffect === null)
			throw new TypeError("D65 live partial qualification omitted admission");
		const partialExecution = startD65LiveReplicateExecution(partialAuthority, partialEffect);
		const injectedFailure = createD65InjectedReplicateExecutor();
		const failingExecutor: D44LiveExecutorV1 = Object.freeze({
			revision: injectedFailure.executor.revision,
			async execute() {
				throw new TypeError("D65 injected live executor failure");
			},
			dispose: () => injectedFailure.executor.dispose(),
		});
		const partialMeasurement = await runD65ReplicateMeasurement({
			executor: failingExecutor,
			injectedNoNetwork: false,
			replicateExecution: partialExecution,
		});
		if (partialMeasurement.disposition !== "partial-failure")
			throw new TypeError("D65 live partial qualification did not fail closed");
		admitD65LivePartialReplicateResult(
			partialAuthority,
			partialExecution,
			partialMeasurement.partialEvidence,
			partialMeasurement.retryWaitElapsedMs,
		);
		const partialEvidence = validateD65LivePartialCampaignEvidence(
			snapshotD65LivePartialCampaignEvidence(partialAuthority),
		);
		const partialBundle = constructD65LiveCampaignBundle({
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
		await persistD65LiveCampaignBundle({ privateRoot: partialRoot, bundle: partialBundle });
		if (
			partialBundle.disposition !== "partial-failure" ||
			partialBundle.graphEvidence !== null ||
			partialBundle.partialGraphEvidence?.evidenceDigest !== partialEvidence.evidenceDigest ||
			partialBundle.efficacyClaim !== "none"
		)
			throw new TypeError("D65 live partial bundle persistence drifted");
		return Object.freeze({
			schemaVersion: D65_LIVE_QUALIFICATION_SCHEMA,
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
