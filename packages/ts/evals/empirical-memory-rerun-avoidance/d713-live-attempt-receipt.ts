import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	D713_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY,
	markPersistedD713DispatchClaimFailedAtPrivateRoot,
	type PersistedD713SingleUseDispatchClaimV1,
	validateD713ExecutionStartedMarker,
	validatePersistedD713DispatchClaimAtPrivateRoot,
} from "./d713-single-use-dispatch-claim.js";
import type { OpenRouterCurrentKeySpendAdmissionV1 } from "./openrouter-current-key-spend-admission.js";
import { syncDirectory, writePrivateFile } from "./private-smoke-persistence.js";

export const D713_LIVE_ATTEMPT_RECEIPT_SCHEMA =
	"graphrefly.private-solution-eval.d713-live-attempt-receipt.v1" as const;
export const D713_LIVE_ATTEMPT_RECEIPT_FILE = "terminal-attempt.v1.json" as const;

export type D713LiveAttemptPhase =
	| "claim-acquired"
	| "current-key-admitted"
	| "provider-block"
	| "generation-persistence";

export interface D713LiveAttemptReceiptV1 {
	readonly schemaVersion: typeof D713_LIVE_ATTEMPT_RECEIPT_SCHEMA;
	readonly decisionRef: "decision.D713";
	readonly decisionRevision: "decision.D713.2026-08-10.v1";
	readonly claimDigest: string;
	readonly terminalStatus: "success" | "failed";
	readonly terminalPhase: D713LiveAttemptPhase;
	readonly failureClass: "none" | "bounded-operator-failure";
	readonly officialPricingNetworkCalls: 1;
	readonly currentKeyNetworkCalls: 0 | 1;
	readonly currentKeyAdmissionDigest: string | null;
	readonly currentKeyRemainingMicrousd: number | null;
	readonly currentKeyUsageMicrousd: number | null;
	readonly providerTransportCalls: number;
	readonly providerUsageEvidence: "complete-generation" | "unavailable-after-operator-failure";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly receiptDigest: string;
}

export async function persistD713LiveAttemptReceipt(input: {
	readonly claim: PersistedD713SingleUseDispatchClaimV1;
	readonly terminalStatus: "success" | "failed";
	readonly terminalPhase: D713LiveAttemptPhase;
	readonly currentKeyNetworkCalls: 0 | 1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1 | null;
	readonly providerTransportCalls: number;
}): Promise<D713LiveAttemptReceiptV1> {
	const candidate = record(input, "d713.attemptReceiptInput");
	exactKeys(
		candidate,
		[
			"claim",
			"currentKeyAdmission",
			"currentKeyNetworkCalls",
			"providerTransportCalls",
			"terminalPhase",
			"terminalStatus",
		],
		"d713.attemptReceiptInput",
	);
	const claim = record(candidate.claim, "d713.attemptReceipt.claim");
	exactKeys(claim, ["claimDigest", "claimPath"], "d713.attemptReceipt.claim");
	if (
		typeof claim.claimPath !== "string" ||
		claim.claimPath.length === 0 ||
		claim.claimPath !== join(dirname(claim.claimPath), D713_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY)
	) {
		throw new TypeError("D713 attempt receipt claim path is not exact");
	}
	if (typeof claim.claimDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(claim.claimDigest)) {
		throw new TypeError("D713 attempt receipt claim digest is invalid");
	}
	const claimStatus = await lstat(claim.claimPath);
	if (
		!claimStatus.isDirectory() ||
		claimStatus.isSymbolicLink() ||
		(claimStatus.mode & 0o777) !== 0o700 ||
		(await realpath(claim.claimPath)) !== claim.claimPath
	) {
		throw new TypeError("D713 attempt receipt claim ownership is invalid");
	}
	const privateRoot = dirname(claim.claimPath);
	await validatePersistedD713DispatchClaimAtPrivateRoot(
		privateRoot,
		claim as unknown as PersistedD713SingleUseDispatchClaimV1,
	);
	const terminalStatus = oneOf(
		candidate.terminalStatus,
		["success", "failed"] as const,
		"d713.attemptReceipt.status",
	);
	const terminalPhase = oneOf(
		candidate.terminalPhase,
		["claim-acquired", "current-key-admitted", "provider-block", "generation-persistence"] as const,
		"d713.attemptReceipt.phase",
	);
	const currentKeyNetworkCalls = literal(
		candidate.currentKeyNetworkCalls,
		candidate.currentKeyNetworkCalls === 0 ? 0 : 1,
		"d713.attemptReceipt.currentKeyCalls",
	) as 0 | 1;
	const providerTransportCalls = safeInteger(
		candidate.providerTransportCalls,
		"d713.attemptReceipt.providerCalls",
		{ min: 0, max: 576 },
	);
	let currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1 | null = null;
	if (candidate.currentKeyAdmission !== null) {
		const current = record(candidate.currentKeyAdmission, "d713.attemptReceipt.currentKey");
		exactKeys(
			current,
			[
				"admissionDigest",
				"isManagementKey",
				"limitMicrousd",
				"limitReset",
				"remainingMicrousd",
				"schemaVersion",
				"usageMicrousd",
			],
			"d713.attemptReceipt.currentKey",
		);
		literal(
			current.schemaVersion,
			"graphrefly.private-solution-eval.openrouter-current-key-spend-admission.v1",
			"d713.attemptReceipt.currentKey.schema",
		);
		const currentMaterial = strictSnapshot({
			schemaVersion:
				"graphrefly.private-solution-eval.openrouter-current-key-spend-admission.v1" as const,
			limitMicrousd: safeInteger(current.limitMicrousd, "d713.attemptReceipt.currentKey.limit", {
				min: 32_000_000,
				max: 32_000_000,
			}),
			remainingMicrousd: safeInteger(
				current.remainingMicrousd,
				"d713.attemptReceipt.currentKey.remaining",
				{ min: 6_000_000, max: 32_000_000 },
			),
			usageMicrousd: safeInteger(current.usageMicrousd, "d713.attemptReceipt.currentKey.usage", {
				min: 0,
				max: 32_000_000,
			}),
			limitReset: literal(current.limitReset, "none", "d713.attemptReceipt.currentKey.reset"),
			isManagementKey: literal(
				current.isManagementKey,
				false,
				"d713.attemptReceipt.currentKey.management",
			),
		});
		literal(
			current.admissionDigest,
			empiricalStrictJsonDigest(currentMaterial),
			"d713.attemptReceipt.currentKey.digest",
		);
		currentKeyAdmission = strictSnapshot({
			...currentMaterial,
			admissionDigest: current.admissionDigest,
		}) as OpenRouterCurrentKeySpendAdmissionV1;
	}
	if (
		(terminalStatus === "success" && terminalPhase !== "generation-persistence") ||
		(terminalPhase === "claim-acquired" && providerTransportCalls !== 0) ||
		(terminalPhase === "claim-acquired" && currentKeyAdmission !== null) ||
		(terminalPhase !== "claim-acquired" && currentKeyAdmission === null) ||
		(terminalPhase !== "claim-acquired" && currentKeyNetworkCalls !== 1)
	) {
		throw new TypeError("D713 terminal receipt status/phase evidence is inconsistent");
	}
	if (terminalPhase === "claim-acquired") {
		await markPersistedD713DispatchClaimFailedAtPrivateRoot(
			privateRoot,
			claim as unknown as PersistedD713SingleUseDispatchClaimV1,
		);
	} else {
		await validateD713ExecutionStartedMarker(
			claim.claimPath as string,
			currentKeyAdmission!.admissionDigest,
		);
	}
	const material = strictSnapshot({
		schemaVersion: D713_LIVE_ATTEMPT_RECEIPT_SCHEMA,
		decisionRef: "decision.D713" as const,
		decisionRevision: "decision.D713.2026-08-10.v1" as const,
		claimDigest: claim.claimDigest,
		terminalStatus,
		terminalPhase,
		failureClass:
			terminalStatus === "success" ? ("none" as const) : ("bounded-operator-failure" as const),
		officialPricingNetworkCalls: 1 as const,
		currentKeyNetworkCalls,
		currentKeyAdmissionDigest: currentKeyAdmission?.admissionDigest ?? null,
		currentKeyRemainingMicrousd: currentKeyAdmission?.remainingMicrousd ?? null,
		currentKeyUsageMicrousd: currentKeyAdmission?.usageMicrousd ?? null,
		providerTransportCalls,
		providerUsageEvidence:
			terminalStatus === "success"
				? ("complete-generation" as const)
				: ("unavailable-after-operator-failure" as const),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const receipt = strictSnapshot({
		...material,
		receiptDigest: empiricalStrictJsonDigest(material),
	});
	const receiptPath = join(claim.claimPath, D713_LIVE_ATTEMPT_RECEIPT_FILE);
	await writePrivateFile(receiptPath, strictJsonCodec.encode(receipt));
	await syncDirectory(claim.claimPath);
	await syncDirectory(dirname(claim.claimPath));
	return receipt;
}
