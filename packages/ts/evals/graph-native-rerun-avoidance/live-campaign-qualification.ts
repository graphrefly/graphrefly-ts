import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, open, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D68_RESPONSE_REJECTION_CODES, type D68GraphProgressV1 } from "./graph-tool-authority.js";
import { createD65InjectedReplicateExecutor } from "./injected-replicate-executor.js";
import {
	admitD65LivePartialReplicateResult as admitCurrentLivePartialReplicateResult,
	admitD65LiveReplicateResult as admitCurrentLiveReplicateResult,
	createD65LiveGraphCampaignAuthority as createCurrentLiveGraphCampaignAuthority,
	snapshotD65LiveCampaignEvidence as snapshotCurrentLiveCampaignEvidence,
	snapshotD65LivePartialCampaignEvidence as snapshotCurrentLivePartialCampaignEvidence,
	startD65LiveReplicateExecution as startCurrentLiveReplicateExecution,
	takeD65LiveAdmittedReplicate as takeCurrentLiveAdmittedReplicate,
	validateD65LiveCampaignEvidence as validateCurrentLiveCampaignEvidence,
	validateD65LivePartialCampaignEvidence as validateCurrentLivePartialCampaignEvidence,
} from "./live-campaign-authority.js";
import {
	constructCurrentLiveCampaignBundle,
	persistCurrentLiveCampaignBundle,
	validateCurrentLiveCampaignBundle,
} from "./live-campaign-bundle.js";
import {
	acquireCurrentLiveDispatchClaim,
	composeCurrentLivePreclaim,
	consumeCurrentLiveDispatchClaim,
	prepareCurrentLivePrivateRoot,
} from "./live-campaign-claim.js";
import type { D44LiveExecutorV1 } from "./live-effect-executor.js";
import type {
	D44D45CredentialV1,
	D44D45PricingObservationV1,
	D44D45ZeroByokObservationV1,
} from "./live-preflight.js";
import { parseD45ChatProviderResponse } from "./mechanical-chat-adapter.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";
import { runD65ReplicateMeasurement } from "./replicate-measurement.js";
import { D65_REPLICATE_COUNT } from "./replicated-campaign-authority.js";
import { runD66RetryIdentityQualification } from "./retry-identity-qualification.js";

export const CURRENT_LIVE_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d69.current-live-qualification.v1" as const;

function qualifyCurrentResponseSchemaRejections(): void {
	const pricing = Object.freeze({
		inputMicrousdPerMillionTokens: 80_000,
		outputMicrousdPerMillionTokens: 180_000,
		cacheReadMicrousdPerMillionTokens: 16_000,
	});
	const wireDigest = empiricalStrictJsonDigest("d68-response-schema-wire");
	const parse = (status: number, value: string | Uint8Array) =>
		parseD45ChatProviderResponse({
			status,
			bytes: typeof value === "string" ? new TextEncoder().encode(value) : value,
			elapsedMs: 1,
			wireDigest,
			pricing,
		});
	const results = [
		parse(200, new Uint8Array(2 * 1024 * 1024 + 1)),
		parse(99, "{}"),
		parse(200, new Uint8Array([0xff])),
		parse(200, "{"),
		parse(200, "[]"),
		parse(200, '{"choices":[]}'),
		parse(200, '{"usage":{"prompt_tokens":-1,"completion_tokens":1},"choices":[]}'),
		parse(
			200,
			'{"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":2}},"choices":[]}',
		),
		parse(200, '{"usage":{"prompt_tokens":1,"completion_tokens":1},"choices":[]}'),
	];
	if (
		results.some((item) => item.outcome !== "schema-rejected") ||
		empiricalStrictJsonDigest(results.map((item) => item.responseRejectionCode)) !==
			empiricalStrictJsonDigest(D68_RESPONSE_REJECTION_CODES)
	)
		throw new TypeError("D68 response-schema rejection classification drifted");
}

function fakeLiveCoordinates(): {
	readonly credential: D44D45CredentialV1;
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
} {
	const credential = Object.freeze({
		bearerToken: "sk-or-v1-current-injected-no-network-token",
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

export async function runCurrentLiveInjectedNoNetworkQualification() {
	qualifyCurrentResponseSchemaRejections();
	const d66Qualification = runD66RetryIdentityQualification();
	const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-current-live-")));
	await chmod(root, 0o700);
	try {
		await prepareCurrentLivePrivateRoot(root);
		const { credential, pricing, zeroByok } = fakeLiveCoordinates();
		const preclaim = composeCurrentLivePreclaim({ credential, pricing, zeroByok });
		const claim = await acquireCurrentLiveDispatchClaim({
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
		const liveCapability = await consumeCurrentLiveDispatchClaim({ claim, currentKeyAdmission });
		const authority = createCurrentLiveGraphCampaignAuthority({
			liveCampaignCapability: liveCapability,
		});
		let liveCapabilityReplayRejected = false;
		try {
			createCurrentLiveGraphCampaignAuthority({ liveCampaignCapability: liveCapability });
		} catch {
			liveCapabilityReplayRejected = true;
		}
		if (!liveCapabilityReplayRejected)
			throw new TypeError("Current live qualification replayed a consumed campaign capability");
		let forgedLiveCapabilityRejected = false;
		try {
			createCurrentLiveGraphCampaignAuthority({
				liveCampaignCapability: Object.freeze({ ...liveCapability }),
			});
		} catch {
			forgedLiveCapabilityRejected = true;
		}
		if (!forgedLiveCapabilityRejected)
			throw new TypeError("Current live qualification accepted a structural campaign capability");
		let providerCalls = 0;
		const progress: D68GraphProgressV1[] = [];
		for (let index = 2; index <= D65_REPLICATE_COUNT; index += 1) {
			const effect = takeCurrentLiveAdmittedReplicate(authority);
			if (effect?.replicateIndex !== index)
				throw new TypeError("Current live qualification replicate admission drifted");
			const execution = startCurrentLiveReplicateExecution(authority, effect);
			const injected = createD65InjectedReplicateExecutor();
			const measurement = await runD65ReplicateMeasurement({
				executor: injected.executor,
				injectedNoNetwork: true,
				replicateExecution: execution,
				onProgress(value) {
					progress.push(value);
				},
			});
			if (measurement.disposition !== "success")
				throw new TypeError("Current live qualification replicate failed");
			providerCalls += measurement.providerCalls;
			admitCurrentLiveReplicateResult(
				authority,
				execution,
				measurement.evidence,
				measurement.retryWaitElapsedMs,
			);
		}
		if (takeCurrentLiveAdmittedReplicate(authority) !== null)
			throw new TypeError("Current live qualification admitted a sixth replicate");
		if (
			progress.length === 0 ||
			progress.some(
				(item, index) =>
					index > 0 &&
					item.factSequence < progress[index - 1]!.factSequence &&
					progress[index - 1]!.completedArmCount !== 6,
			) ||
			progress.filter((item) => item.completedArmCount === 6).length !== D65_REPLICATE_COUNT - 1 ||
			progress.some((item) =>
				/(oldText|newText|content|body|header|stack|error)/u.test(JSON.stringify(item)),
			)
		)
			throw new TypeError("D68 material-free Graph progress projection drifted");
		const evidence = validateCurrentLiveCampaignEvidence(
			snapshotCurrentLiveCampaignEvidence(authority),
		);
		if (
			!evidence.frozenGatePassed ||
			evidence.efficacyClaim !== "replicated-frozen-task-positive-differential" ||
			evidence.binding.liveClaimDigest !== claim.claimDigest
		)
			throw new TypeError("Current claim-gated live efficacy projection drifted");
		const bundle = constructCurrentLiveCampaignBundle({
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
		const persistence = await persistCurrentLiveCampaignBundle({ privateRoot: root, bundle });
		validateCurrentLiveCampaignBundle(bundle);

		const partialRoot = join(root, "partial-campaign");
		await prepareCurrentLivePrivateRoot(partialRoot);
		const partialPreclaim = composeCurrentLivePreclaim({ credential, pricing, zeroByok });
		const partialClaim = await acquireCurrentLiveDispatchClaim({
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
		const partialCapability = await consumeCurrentLiveDispatchClaim({
			claim: partialClaim,
			currentKeyAdmission: partialCurrentKey,
		});
		const partialAuthority = createCurrentLiveGraphCampaignAuthority({
			liveCampaignCapability: partialCapability,
		});
		const partialEffect = takeCurrentLiveAdmittedReplicate(partialAuthority);
		if (partialEffect === null)
			throw new TypeError("Current live partial qualification omitted admission");
		const partialExecution = startCurrentLiveReplicateExecution(partialAuthority, partialEffect);
		const injectedFailure = createD65InjectedReplicateExecutor();
		const failingExecutor: D44LiveExecutorV1 = Object.freeze({
			revision: injectedFailure.executor.revision,
			async execute() {
				throw new TypeError("Current injected live executor failure");
			},
			dispose: () => injectedFailure.executor.dispose(),
		});
		const partialMeasurement = await runD65ReplicateMeasurement({
			executor: failingExecutor,
			injectedNoNetwork: false,
			replicateExecution: partialExecution,
		});
		if (partialMeasurement.disposition !== "partial-failure")
			throw new TypeError("Current live partial qualification did not fail closed");
		admitCurrentLivePartialReplicateResult(
			partialAuthority,
			partialExecution,
			partialMeasurement.partialEvidence,
			partialMeasurement.retryWaitElapsedMs,
		);
		const partialEvidence = validateCurrentLivePartialCampaignEvidence(
			snapshotCurrentLivePartialCampaignEvidence(partialAuthority),
		);
		const partialBundle = constructCurrentLiveCampaignBundle({
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
		await persistCurrentLiveCampaignBundle({ privateRoot: partialRoot, bundle: partialBundle });
		if (
			partialBundle.disposition !== "partial-failure" ||
			partialBundle.graphEvidence !== null ||
			partialBundle.partialGraphEvidence?.evidenceDigest !== partialEvidence.evidenceDigest ||
			partialBundle.efficacyClaim !== "none"
		)
			throw new TypeError("Current live partial bundle persistence drifted");
		return Object.freeze({
			schemaVersion: CURRENT_LIVE_QUALIFICATION_SCHEMA,
			responseSchemaRejectionsQualified: true as const,
			materialFreeProgressQualified: true as const,
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

export async function persistCurrentQualificationArtifact(input: {
	readonly privateRoot: string;
	readonly qualification: Awaited<ReturnType<typeof runCurrentLiveInjectedNoNetworkQualification>>;
}): Promise<Readonly<{ artifactPath: string; artifactDigest: string }>> {
	const root = join(input.privateRoot, "current-qualification-v1");
	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
	const artifactDigest = empiricalStrictJsonDigest(input.qualification);
	const artifactPath = join(root, "qualification.v1.json");
	const temporaryPath = join(root, `.qualification-${process.pid}.tmp`);
	const handle = await open(
		temporaryPath,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(strictJsonCodec.encode(input.qualification));
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporaryPath, artifactPath);
	const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
	return Object.freeze({ artifactPath, artifactDigest });
}
