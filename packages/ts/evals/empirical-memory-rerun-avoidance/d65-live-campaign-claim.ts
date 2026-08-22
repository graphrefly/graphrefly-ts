import { constants } from "node:fs";
import { chmod, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, sameBytes, strictSnapshot } from "./canonical.js";
import type {
	D44D45CredentialV1,
	D44D45PricingObservationV1,
	D44D45ZeroByokObservationV1,
} from "./d44-d45-live-gates.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D65_LIVE_CLAIM_SCHEMA = "graphrefly-ts.d65.live-campaign-claim.v1" as const;
export const D65_LIVE_CLAIM_REF = "current-graph-native-live-claim-2026-08-22-d65-v1" as const;
export const D65_LIVE_GENERATION_REF = "current-graph-native-live-2026-08-22-d65-v1" as const;
export const D65_LIVE_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d65-live",
);

export interface D65LivePreclaimV1 {
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly credentialBindingDigest: string;
	readonly preclaimDigest: string;
}

export interface D65LiveDispatchClaimV1 {
	readonly schemaVersion: typeof D65_LIVE_CLAIM_SCHEMA;
	readonly claimRef: typeof D65_LIVE_CLAIM_REF;
	readonly decisionRef: "graphrefly-ts:D65";
	readonly generationRef: typeof D65_LIVE_GENERATION_REF;
	readonly preclaimDigest: string;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface D65LiveCampaignCapabilityV1 {
	readonly claim: D65LiveDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly campaignBindingDigest: string;
}

const preclaims = new WeakSet<object>();
const claims = new WeakMap<object, Readonly<{ file: string; bytes: Uint8Array }>>();
const capabilities = new WeakSet<object>();

export function composeD65LivePreclaim(input: {
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
	readonly credential: D44D45CredentialV1;
}): D65LivePreclaimV1 {
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

export async function prepareD65LivePrivateRoot(privateRoot: string): Promise<void> {
	const root = resolve(privateRoot);
	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
	if ((await realpath(root)) !== root) throw new TypeError("D65 live private root drifted");
}

export async function acquireD65LiveDispatchClaim(input: {
	readonly privateRoot: string;
	readonly preclaim: D65LivePreclaimV1;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
}): Promise<D65LiveDispatchClaimV1> {
	if (!preclaims.delete(input.preclaim))
		throw new TypeError("D65 preclaim must be same-process single-use");
	const privateRoot = resolve(input.privateRoot);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D65 private root drifted");
	const claimRoot = join(privateRoot, `.${D65_LIVE_CLAIM_REF}`);
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const material = strictSnapshot({
		schemaVersion: D65_LIVE_CLAIM_SCHEMA,
		claimRef: D65_LIVE_CLAIM_REF,
		decisionRef: "graphrefly-ts:D65" as const,
		generationRef: D65_LIVE_GENERATION_REF,
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

export async function consumeD65LiveDispatchClaim(input: {
	readonly claim: D65LiveDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<D65LiveCampaignCapabilityV1> {
	const state = claims.get(input.claim);
	if (state === undefined) throw new TypeError("D65 durable dispatch claim was absent or consumed");
	const reader = await open(state.file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if (!sameBytes(new Uint8Array(await reader.readFile()), state.bytes))
			throw new TypeError("D65 durable dispatch claim drifted");
	} finally {
		await reader.close();
	}
	claims.delete(input.claim);
	const currentKeyAdmission = consumeOpenRouterCurrentKeySpendAdmission(input.currentKeyAdmission);
	if (
		currentKeyAdmission.remainingMicrousd < 6_000_000 ||
		currentKeyAdmission.limitMicrousd !== 32_000_000
	)
		throw new TypeError("D65 current-key admission lost the frozen USD 6/32 bound");
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

export function consumeD65LiveCampaignCapability(
	value: D65LiveCampaignCapabilityV1,
): D65LiveCampaignCapabilityV1 {
	if (!capabilities.delete(value))
		throw new TypeError("D65 live campaign capability must be same-process and single-use");
	return value;
}
