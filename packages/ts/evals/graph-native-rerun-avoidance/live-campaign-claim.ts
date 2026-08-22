import { constants } from "node:fs";
import { chmod, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, sameBytes, strictSnapshot } from "./canonical.js";
import type {
	D44D45CredentialV1,
	D44D45PricingObservationV1,
	D44D45ZeroByokObservationV1,
} from "./live-preflight.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const CURRENT_LIVE_CLAIM_SCHEMA = "graphrefly-ts.d71.live-campaign-claim.v1" as const;
export const CURRENT_LIVE_CLAIM_REF = "graph-native-live-claim-2026-08-22-d71-v1" as const;
export const CURRENT_LIVE_GENERATION_REF = "graph-native-live-2026-08-22-d71-v1" as const;
export const CURRENT_LIVE_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/graph-native-rerun-avoidance/current-live-d71",
);

export interface CurrentLivePreclaimV1 {
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly credentialBindingDigest: string;
	readonly preclaimDigest: string;
}

export interface CurrentLiveDispatchClaimV1 {
	readonly schemaVersion: typeof CURRENT_LIVE_CLAIM_SCHEMA;
	readonly claimRef: typeof CURRENT_LIVE_CLAIM_REF;
	readonly decisionRef: "graphrefly-ts:D71";
	readonly generationRef: typeof CURRENT_LIVE_GENERATION_REF;
	readonly preclaimDigest: string;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface CurrentLiveCampaignCapabilityV1 {
	readonly claim: CurrentLiveDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly campaignBindingDigest: string;
}

const preclaims = new WeakSet<object>();
const claims = new WeakMap<object, Readonly<{ file: string; bytes: Uint8Array }>>();
const capabilities = new WeakSet<object>();

export function composeCurrentLivePreclaim(input: {
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
	readonly credential: D44D45CredentialV1;
}): CurrentLivePreclaimV1 {
	const material = strictSnapshot({
		pricingObservationDigest: input.pricing.observationDigest,
		zeroByokObservationDigest: input.zeroByok.observationDigest,
		credentialBindingDigest: empiricalStrictJsonDigest({
			credentialBindingRef: input.credential.credentialBindingRef,
			credentialBindingRevision: input.credential.credentialBindingRevision,
		}),
	});
	const preclaim = Object.freeze({
		...material,
		preclaimDigest: empiricalStrictJsonDigest(material),
	});
	preclaims.add(preclaim);
	return preclaim;
}

export async function prepareCurrentLivePrivateRoot(privateRoot: string): Promise<void> {
	const root = resolve(privateRoot);
	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
	if ((await realpath(root)) !== root) throw new TypeError("Current live private root drifted");
}

export async function acquireCurrentLiveDispatchClaim(input: {
	readonly privateRoot: string;
	readonly preclaim: CurrentLivePreclaimV1;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
}): Promise<CurrentLiveDispatchClaimV1> {
	if (!preclaims.delete(input.preclaim))
		throw new TypeError("Current preclaim must be same-process single-use");
	const privateRoot = resolve(input.privateRoot);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("Current private root drifted");
	const claimRoot = join(privateRoot, `.${CURRENT_LIVE_CLAIM_REF}`);
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const material = strictSnapshot({
		schemaVersion: CURRENT_LIVE_CLAIM_SCHEMA,
		claimRef: CURRENT_LIVE_CLAIM_REF,
		decisionRef: "graphrefly-ts:D71" as const,
		generationRef: CURRENT_LIVE_GENERATION_REF,
		preclaimDigest: input.preclaim.preclaimDigest,
		implementationCommit: input.implementationCommit,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
	const claim = Object.freeze({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
	const bytes = strictJsonCodec.encode(claim);
	const file = join(claimRoot, "dispatch-claim.v1.json");
	const handle = await open(
		file,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	const directory = await open(claimRoot, constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
	claims.set(claim, Object.freeze({ file, bytes }));
	return claim;
}

export async function consumeCurrentLiveDispatchClaim(input: {
	readonly claim: CurrentLiveDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<CurrentLiveCampaignCapabilityV1> {
	const state = claims.get(input.claim);
	if (state === undefined)
		throw new TypeError("Current durable dispatch claim was absent or consumed");
	const reader = await open(state.file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if (!sameBytes(new Uint8Array(await reader.readFile()), state.bytes))
			throw new TypeError("Current durable dispatch claim drifted");
	} finally {
		await reader.close();
	}
	claims.delete(input.claim);
	const currentKeyAdmission = consumeOpenRouterCurrentKeySpendAdmission(input.currentKeyAdmission);
	if (
		currentKeyAdmission.remainingMicrousd < 6_000_000 ||
		currentKeyAdmission.limitMicrousd !== 32_000_000
	)
		throw new TypeError("Current current-key admission lost the frozen USD 6/32 bound");
	const capability = Object.freeze({
		claim: input.claim,
		currentKeyAdmission,
		campaignBindingDigest: empiricalStrictJsonDigest({
			claimDigest: input.claim.claimDigest,
			currentKeyAdmissionDigest: currentKeyAdmission.admissionDigest,
		}),
	});
	capabilities.add(capability);
	return capability;
}

export function consumeCurrentLiveCampaignCapability(
	value: CurrentLiveCampaignCapabilityV1,
): CurrentLiveCampaignCapabilityV1 {
	if (!capabilities.delete(value))
		throw new TypeError("Current live campaign capability must be same-process and single-use");
	return value;
}
