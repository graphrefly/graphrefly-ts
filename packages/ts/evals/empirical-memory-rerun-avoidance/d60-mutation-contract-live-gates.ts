import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import type {
	D44D45CredentialV1,
	D44D45PricingObservationV1,
	D44D45ZeroByokObservationV1,
} from "./d44-d45-live-gates.js";
import {
	type D46CanonicalEvidenceV1,
	type D46PartialCanonicalEvidenceV1,
	validateD46CanonicalEvidence,
	validateD46PartialCanonicalEvidence,
} from "./d46-bounded-inspection-authority.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D60_LIVE_CLAIM_SCHEMA = "graphrefly-ts.d60.dispatch-claim.v1" as const;
export const D60_LIVE_BUNDLE_SCHEMA = "graphrefly-ts.d60.live-bundle.v1" as const;
export const D60_LIVE_GENERATION_REF =
	"current-graph-native-mutation-contract-live-d60-v1" as const;
export const D60_LIVE_CLAIM_REF = "current-graph-native-mutation-contract-claim-d60-v1" as const;
export const D60_LIVE_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d60-live",
);

export interface D60PreclaimV1 {
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly credentialBindingDigest: string;
	readonly preclaimDigest: string;
}

export interface D60DispatchClaimV1 {
	readonly schemaVersion: typeof D60_LIVE_CLAIM_SCHEMA;
	readonly claimRef: typeof D60_LIVE_CLAIM_REF;
	readonly authorityRef: "graphrefly-ts:D60";
	readonly architectureRef: "graphrefly-ts:D55";
	readonly generationRef: typeof D60_LIVE_GENERATION_REF;
	readonly preclaimDigest: string;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface D60ExecutionAuthorityV1 {
	readonly claim: D60DispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly authorityDigest: string;
}

export type D60LiveBundleV1 = Readonly<{
	schemaVersion: typeof D60_LIVE_BUNDLE_SCHEMA;
	generationRef: typeof D60_LIVE_GENERATION_REF;
	disposition: "success" | "partial-failure";
	claimDigest: string;
	currentKeyAdmissionDigest: string;
	pricingObservationDigest: string;
	zeroByokObservationDigest: string;
	implementationCommit: string;
	implementationManifestDigest: string;
	qualificationArtifactDigest: string;
	qualificationDigest: string;
	providerCalls: number;
	graphEvidence: D46CanonicalEvidenceV1 | null;
	partialGraphEvidence: D46PartialCanonicalEvidenceV1 | null;
	causalAttribution: "undetermined";
	efficacyClaim: "frozen-task-block-positive-differential" | "none";
	bundleDigest: string;
}>;

const preclaims = new WeakSet<object>();
const claims = new WeakMap<object, Readonly<{ file: string; bytes: Uint8Array }>>();

export function composeD60Preclaim(input: {
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
	readonly credential: D44D45CredentialV1;
}): D60PreclaimV1 {
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

export async function acquireD60DispatchClaim(input: {
	readonly privateRoot: string;
	readonly preclaim: D60PreclaimV1;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
}): Promise<D60DispatchClaimV1> {
	if (!preclaims.delete(input.preclaim)) throw new TypeError("D60 preclaim is absent or consumed");
	const privateRoot = resolve(input.privateRoot);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D60 private root drifted");
	const claimRoot = join(privateRoot, `.${D60_LIVE_CLAIM_REF}`);
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const material = strictSnapshot({
		schemaVersion: D60_LIVE_CLAIM_SCHEMA,
		claimRef: D60_LIVE_CLAIM_REF,
		authorityRef: "graphrefly-ts:D60" as const,
		architectureRef: "graphrefly-ts:D55" as const,
		generationRef: D60_LIVE_GENERATION_REF,
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
	const writer = await open(
		file,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await writer.writeFile(bytes);
		await writer.sync();
	} finally {
		await writer.close();
	}
	const root = await open(claimRoot, constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await root.sync();
	} finally {
		await root.close();
	}
	claims.set(claim, { file, bytes });
	return claim;
}

export async function consumeD60DispatchClaim(input: {
	readonly claim: D60DispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<D60ExecutionAuthorityV1> {
	const state = claims.get(input.claim);
	if (state === undefined) throw new TypeError("D60 dispatch claim is absent or consumed");
	const reader = await open(state.file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if (!sameBytes(new Uint8Array(await reader.readFile()), state.bytes))
			throw new TypeError("D60 durable dispatch claim drifted");
	} finally {
		await reader.close();
	}
	claims.delete(input.claim);
	const currentKeyAdmission = consumeOpenRouterCurrentKeySpendAdmission(input.currentKeyAdmission);
	const material = strictSnapshot({
		claimDigest: input.claim.claimDigest,
		currentKeyAdmissionDigest: currentKeyAdmission.admissionDigest,
	});
	return Object.freeze({
		claim: input.claim,
		currentKeyAdmission,
		authorityDigest: empiricalStrictJsonDigest(material),
	});
}

export function constructD60LiveBundle(input: {
	readonly authority: D60ExecutionAuthorityV1;
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly providerCalls: number;
	readonly measurement:
		| Readonly<{ disposition: "success"; evidence: D46CanonicalEvidenceV1 }>
		| Readonly<{
				disposition: "partial-failure";
				partialEvidence: D46PartialCanonicalEvidenceV1;
		  }>;
}): D60LiveBundleV1 {
	const graphEvidence =
		input.measurement.disposition === "success"
			? validateD46CanonicalEvidence(input.measurement.evidence)
			: null;
	const partialGraphEvidence =
		input.measurement.disposition === "partial-failure"
			? validateD46PartialCanonicalEvidence(input.measurement.partialEvidence)
			: null;
	const material = strictSnapshot({
		schemaVersion: D60_LIVE_BUNDLE_SCHEMA,
		generationRef: D60_LIVE_GENERATION_REF,
		disposition: input.measurement.disposition,
		claimDigest: input.authority.claim.claimDigest,
		currentKeyAdmissionDigest: input.authority.currentKeyAdmission.admissionDigest,
		pricingObservationDigest: input.pricing.observationDigest,
		zeroByokObservationDigest: input.zeroByok.observationDigest,
		implementationCommit: input.implementationCommit,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
		providerCalls: input.providerCalls,
		graphEvidence,
		partialGraphEvidence,
		causalAttribution: "undetermined" as const,
		efficacyClaim:
			graphEvidence?.frozenGateWouldPass === true
				? ("frozen-task-block-positive-differential" as const)
				: ("none" as const),
	});
	return Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
}

export async function persistD60LiveBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D60LiveBundleV1;
}): Promise<Readonly<{ artifactDigest: string; receiptDigest: string }>> {
	if (!isAbsolute(input.privateRoot)) throw new TypeError("D60 persistence root must be absolute");
	const generationRoot = join(input.privateRoot, D60_LIVE_GENERATION_REF);
	await mkdir(generationRoot, { mode: 0o700 });
	await chmod(generationRoot, 0o700);
	const target = join(generationRoot, "bundle.v1.json");
	const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
	const bytes = strictJsonCodec.encode(input.bundle);
	const writer = await open(
		temporary,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await writer.writeFile(bytes);
		await writer.sync();
	} finally {
		await writer.close();
	}
	try {
		await link(temporary, target);
	} finally {
		await rm(temporary, { force: true });
	}
	const root = await open(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await root.sync();
	} finally {
		await root.close();
	}
	const artifactDigest = empiricalSha256(bytes);
	return Object.freeze({
		artifactDigest,
		receiptDigest: empiricalStrictJsonDigest({
			artifactDigest,
			bundleDigest: input.bundle.bundleDigest,
		}),
	});
}

export async function prepareD60PrivateRoot(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	await chmod(path, 0o700);
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700)
		throw new TypeError("D60 private root identity failed");
}
