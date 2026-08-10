import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open as openFile, realpath, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { OpenRouterSharedCapacityQualificationV1 } from "./openrouter-route-qualification.js";
import { assertSafePrivateRoot } from "./private-smoke-persistence.js";

export const D713_ZERO_BYOK_ATTESTATION_SCHEMA =
	"graphrefly.private-solution-eval.d713-zero-byok-attestation.v1" as const;
export const D713_ZERO_BYOK_QUALIFICATION_REVISION =
	"openrouter-local-eval-2-zero-byok.observed-2026-08-10.v49" as const;
export const D713_ZERO_BYOK_WORKSPACE_REVISION =
	"openrouter-workspace.graphrefly.observed-2026-08-10.v49" as const;
export const D713_ZERO_BYOK_MAX_ATTESTATION_BYTES = 16_384 as const;
export const D713_ZERO_BYOK_ATTESTATION_FILE = "d713-fresh-zero-byok-attestation.v1.json" as const;
export const D713_ZERO_BYOK_MAX_CHALLENGE_AGE_MS = 120_000 as const;

export interface D713ZeroByokChallengeV1 {
	readonly challengeRef: "d713-zero-byok-operator-observation-challenge";
	readonly challengeRevision: "decision.D713.2026-08-10.v1";
	readonly nonce: string;
}

export interface D713ZeroByokAttestationV1 {
	readonly schemaVersion: typeof D713_ZERO_BYOK_ATTESTATION_SCHEMA;
	readonly decisionRef: "decision.D713";
	readonly decisionRevision: "decision.D713.2026-08-10.v1";
	readonly observationSource: "openrouter-settings-read-only";
	readonly challengeNonce: string;
	readonly workspaceSlug: "graph-re-fly";
	readonly keyName: "Local Eval 2";
	readonly keyEnabled: true;
	readonly byokProviderCount: number;
	readonly byokConfiguredCredentialCount: 0;
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly workspaceRef: string;
	readonly workspaceRevision: typeof D713_ZERO_BYOK_WORKSPACE_REVISION;
	readonly qualificationRevision: typeof D713_ZERO_BYOK_QUALIFICATION_REVISION;
	readonly attestationDigest: string;
}

export interface D713FreshZeroByokQualificationV1 {
	readonly capabilityRef: "d713-fresh-same-credential-zero-byok";
	readonly capabilityRevision: "decision.D713.2026-08-10.v1";
	readonly attestation: D713ZeroByokAttestationV1;
	readonly sharedCapacityQualification: OpenRouterSharedCapacityQualificationV1;
}

const constructedQualifications = new WeakSet<object>();
const constructedChallenges = new WeakMap<
	object,
	{
		readonly createdMonotonicMs: number;
		readonly credentialBindingRef: string;
		readonly credentialBindingRevision: string;
		readonly workspaceRef: string;
	}
>();

export function createD713ZeroByokChallenge(input: {
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly workspaceRef: string;
	readonly monotonicNowMs: number;
}): D713ZeroByokChallengeV1 {
	const candidate = record(input, "d713.zeroByokChallengeInput");
	exactKeys(
		candidate,
		["credentialBindingRef", "credentialBindingRevision", "monotonicNowMs", "workspaceRef"],
		"d713.zeroByokChallengeInput",
	);
	for (const key of [
		"credentialBindingRef",
		"credentialBindingRevision",
		"workspaceRef",
	] as const) {
		const value = candidate[key];
		if (typeof value !== "string" || value.length < 1 || value.length > 256) {
			throw new TypeError(`d713.zeroByokChallenge.${key} is invalid`);
		}
	}
	if (!Number.isFinite(candidate.monotonicNowMs) || (candidate.monotonicNowMs as number) < 0) {
		throw new TypeError("D713 zero-BYOK challenge clock is invalid");
	}
	const challenge = Object.freeze({
		challengeRef: "d713-zero-byok-operator-observation-challenge" as const,
		challengeRevision: "decision.D713.2026-08-10.v1" as const,
		nonce: randomUUID(),
	});
	constructedChallenges.set(challenge, {
		createdMonotonicMs: candidate.monotonicNowMs as number,
		credentialBindingRef: candidate.credentialBindingRef as string,
		credentialBindingRevision: candidate.credentialBindingRevision as string,
		workspaceRef: candidate.workspaceRef as string,
	});
	return challenge;
}

export function validateD713ZeroByokAttestation(value: unknown): D713ZeroByokAttestationV1 {
	const candidate = record(value, "d713.zeroByokAttestation");
	exactKeys(
		candidate,
		[
			"attestationDigest",
			"byokConfiguredCredentialCount",
			"byokProviderCount",
			"challengeNonce",
			"credentialBindingRef",
			"credentialBindingRevision",
			"decisionRef",
			"decisionRevision",
			"keyEnabled",
			"keyName",
			"observationSource",
			"qualificationRevision",
			"schemaVersion",
			"workspaceRef",
			"workspaceRevision",
			"workspaceSlug",
		],
		"d713.zeroByokAttestation",
	);
	literal(candidate.schemaVersion, D713_ZERO_BYOK_ATTESTATION_SCHEMA, "d713.zeroByok.schema");
	literal(candidate.decisionRef, "decision.D713", "d713.zeroByok.decisionRef");
	literal(
		candidate.decisionRevision,
		"decision.D713.2026-08-10.v1",
		"d713.zeroByok.decisionRevision",
	);
	literal(candidate.observationSource, "openrouter-settings-read-only", "d713.zeroByok.source");
	if (
		typeof candidate.challengeNonce !== "string" ||
		!/^[0-9a-f-]{36}$/.test(candidate.challengeNonce)
	) {
		throw new TypeError("D713 zero-BYOK challenge nonce is invalid");
	}
	literal(candidate.workspaceSlug, "graph-re-fly", "d713.zeroByok.workspaceSlug");
	literal(candidate.keyName, "Local Eval 2", "d713.zeroByok.keyName");
	literal(candidate.keyEnabled, true, "d713.zeroByok.keyEnabled");
	safeInteger(candidate.byokProviderCount, "d713.zeroByok.providerCount", { min: 1, max: 256 });
	literal(candidate.byokConfiguredCredentialCount, 0, "d713.zeroByok.configuredCount");
	for (const key of [
		"credentialBindingRef",
		"credentialBindingRevision",
		"workspaceRef",
	] as const) {
		const field = candidate[key];
		if (typeof field !== "string" || field.length < 1 || field.length > 256) {
			throw new TypeError(`d713.zeroByok.${key} must be one bounded string`);
		}
	}
	literal(
		candidate.workspaceRevision,
		D713_ZERO_BYOK_WORKSPACE_REVISION,
		"d713.zeroByok.workspaceRevision",
	);
	literal(
		candidate.qualificationRevision,
		D713_ZERO_BYOK_QUALIFICATION_REVISION,
		"d713.zeroByok.qualificationRevision",
	);
	const attestationDigest = digest(candidate.attestationDigest, "d713.zeroByok.attestationDigest");
	const { attestationDigest: _ignored, ...material } = candidate;
	literal(
		attestationDigest,
		empiricalStrictJsonDigest(material),
		"d713.zeroByok.attestationDigest",
	);
	return strictSnapshot(candidate) as unknown as D713ZeroByokAttestationV1;
}

export async function readD713FreshZeroByokQualification(input: {
	readonly attestationPath: string;
	readonly challenge: D713ZeroByokChallengeV1;
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly workspaceRef: string;
	readonly signal: AbortSignal;
	readonly monotonicNowMs: number;
}): Promise<D713FreshZeroByokQualificationV1> {
	const candidate = record(input, "d713.zeroByokInput");
	exactKeys(
		candidate,
		[
			"attestationPath",
			"challenge",
			"credentialBindingRef",
			"credentialBindingRevision",
			"signal",
			"monotonicNowMs",
			"workspaceRef",
		],
		"d713.zeroByokInput",
	);
	if (!(candidate.signal instanceof AbortSignal)) {
		throw new TypeError("D713 zero-BYOK qualification requires AbortSignal");
	}
	const signal = candidate.signal;
	signal.throwIfAborted();
	const challengeState = constructedChallenges.get(candidate.challenge as object);
	if (
		challengeState === undefined ||
		!constructedChallenges.delete(candidate.challenge as object)
	) {
		throw new TypeError("D713 zero-BYOK qualification requires one same-process fresh challenge");
	}
	const monotonicNowMs = candidate.monotonicNowMs;
	if (
		typeof monotonicNowMs !== "number" ||
		!Number.isFinite(monotonicNowMs) ||
		monotonicNowMs < challengeState.createdMonotonicMs ||
		monotonicNowMs - challengeState.createdMonotonicMs > D713_ZERO_BYOK_MAX_CHALLENGE_AGE_MS
	) {
		throw new TypeError("D713 zero-BYOK operator observation challenge expired");
	}
	if (typeof candidate.attestationPath !== "string" || candidate.attestationPath.length === 0) {
		throw new TypeError("D713 zero-BYOK attestation path is invalid");
	}
	if (basename(candidate.attestationPath) !== D713_ZERO_BYOK_ATTESTATION_FILE) {
		throw new TypeError("D713 zero-BYOK attestation filename is not exact");
	}
	const privateRoot = await assertSafePrivateRoot(dirname(candidate.attestationPath));
	if ((await realpath(dirname(candidate.attestationPath))) !== privateRoot) {
		throw new TypeError("D713 zero-BYOK attestation escaped operator-private ownership");
	}
	let handle: Awaited<ReturnType<typeof openFile>> | undefined;
	let bytes: Uint8Array;
	try {
		handle = await openFile(
			candidate.attestationPath,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
		);
		const status = await handle.stat();
		if (
			!status.isFile() ||
			(status.mode & 0o777) !== 0o600 ||
			status.size < 1 ||
			status.size > D713_ZERO_BYOK_MAX_ATTESTATION_BYTES
		) {
			throw new TypeError("D713 zero-BYOK attestation must be one bounded 0600 file");
		}
		const buffer = Buffer.alloc(D713_ZERO_BYOK_MAX_ATTESTATION_BYTES + 1);
		const read = await handle.read(buffer, 0, buffer.byteLength, 0);
		if (read.bytesRead !== status.size) {
			throw new TypeError("D713 zero-BYOK attestation changed during its read");
		}
		bytes = new Uint8Array(buffer.subarray(0, read.bytesRead));
	} finally {
		await handle?.close();
		await rm(candidate.attestationPath, { force: true });
	}
	signal.throwIfAborted();
	const attestation = validateD713ZeroByokAttestation(strictJsonCodec.decode(bytes));
	if (
		attestation.challengeNonce !== (candidate.challenge as D713ZeroByokChallengeV1).nonce ||
		attestation.credentialBindingRef !== challengeState.credentialBindingRef ||
		attestation.credentialBindingRevision !== challengeState.credentialBindingRevision ||
		attestation.workspaceRef !== challengeState.workspaceRef
	) {
		throw new TypeError("D713 zero-BYOK attestation did not answer the fresh challenge");
	}
	for (const [actual, expected, path] of [
		[attestation.credentialBindingRef, candidate.credentialBindingRef, "credentialRef"],
		[
			attestation.credentialBindingRevision,
			candidate.credentialBindingRevision,
			"credentialRevision",
		],
		[attestation.workspaceRef, candidate.workspaceRef, "workspaceRef"],
	] as const) {
		if (typeof expected !== "string" || actual !== expected) {
			throw new TypeError(`d713.zeroByok.${path} does not match the credential workspace`);
		}
	}
	const sharedCapacityQualification = strictSnapshot({
		schemaVersion:
			"graphrefly.private-solution-eval.openrouter-shared-capacity-qualification.v1" as const,
		qualificationRef: "openrouter-local-eval-2-zero-byok",
		qualificationRevision: attestation.qualificationRevision,
		credentialBindingRef: attestation.credentialBindingRef,
		credentialBindingRevision: attestation.credentialBindingRevision,
		workspaceRef: attestation.workspaceRef,
		workspaceRevision: attestation.workspaceRevision,
		capacityMode: "openrouter-shared-only" as const,
		qualified: true as const,
		byokCredentialCount: 0 as const,
	});
	const qualification = Object.freeze({
		capabilityRef: "d713-fresh-same-credential-zero-byok" as const,
		capabilityRevision: "decision.D713.2026-08-10.v1" as const,
		attestation,
		sharedCapacityQualification,
	});
	constructedQualifications.add(qualification);
	return qualification;
}

export function consumeD713FreshZeroByokQualification(
	value: unknown,
): D713FreshZeroByokQualificationV1 {
	if (value === null || typeof value !== "object" || !constructedQualifications.delete(value)) {
		throw new TypeError("D713 requires one fresh same-process zero-BYOK qualification");
	}
	return value as D713FreshZeroByokQualificationV1;
}
