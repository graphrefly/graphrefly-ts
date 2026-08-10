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
	D708_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY,
	markPersistedD708DispatchClaimFailedAtPrivateRoot,
	type PersistedD708SingleUseDispatchClaimV1,
	validatePersistedD708DispatchClaimAtPrivateRoot,
	validateD708ExecutionStartedMarker,
} from "./d708-single-use-dispatch-claim.js";
import type { OpenRouterCurrentKeySpendAdmissionV1 } from "./openrouter-current-key-spend-admission.js";
import { syncDirectory, writePrivateFile } from "./private-smoke-persistence.js";

export const D708_LIVE_ATTEMPT_RECEIPT_SCHEMA =
	"graphrefly.private-solution-eval.d708-live-attempt-receipt.v1" as const;
export const D708_LIVE_ATTEMPT_RECEIPT_FILE = "terminal-attempt.v1.json" as const;

export type D708LiveAttemptPhase =
	| "claim-acquired"
	| "current-key-admitted"
	| "provider-block"
	| "generation-persistence";

export interface D708LiveAttemptReceiptV1 {
	readonly schemaVersion: typeof D708_LIVE_ATTEMPT_RECEIPT_SCHEMA;
	readonly decisionRef: "decision.D708";
	readonly decisionRevision: "decision.D708.2026-08-09.v1";
	readonly claimDigest: string;
	readonly terminalStatus: "success" | "failed";
	readonly terminalPhase: D708LiveAttemptPhase;
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

export async function persistD708LiveAttemptReceipt(input: {
	readonly claim: PersistedD708SingleUseDispatchClaimV1;
	readonly terminalStatus: "success" | "failed";
	readonly terminalPhase: D708LiveAttemptPhase;
	readonly currentKeyNetworkCalls: 0 | 1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1 | null;
	readonly providerTransportCalls: number;
}): Promise<D708LiveAttemptReceiptV1> {
	const candidate = record(input, "d708.attemptReceiptInput");
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
		"d708.attemptReceiptInput",
	);
	const claim = record(candidate.claim, "d708.attemptReceipt.claim");
	exactKeys(claim, ["claimDigest", "claimPath"], "d708.attemptReceipt.claim");
	if (
		typeof claim.claimPath !== "string" ||
		claim.claimPath.length === 0 ||
		claim.claimPath !== join(dirname(claim.claimPath), D708_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY)
	) {
		throw new TypeError("D708 attempt receipt claim path is not exact");
	}
	if (typeof claim.claimDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(claim.claimDigest)) {
		throw new TypeError("D708 attempt receipt claim digest is invalid");
	}
	const claimStatus = await lstat(claim.claimPath);
	if (
		!claimStatus.isDirectory() ||
		claimStatus.isSymbolicLink() ||
		(claimStatus.mode & 0o777) !== 0o700 ||
		(await realpath(claim.claimPath)) !== claim.claimPath
	) {
		throw new TypeError("D708 attempt receipt claim ownership is invalid");
	}
	const privateRoot = dirname(claim.claimPath);
	await validatePersistedD708DispatchClaimAtPrivateRoot(
		privateRoot,
		claim as unknown as PersistedD708SingleUseDispatchClaimV1,
	);
	const terminalStatus = oneOf(
		candidate.terminalStatus,
		["success", "failed"] as const,
		"d708.attemptReceipt.status",
	);
	const terminalPhase = oneOf(
		candidate.terminalPhase,
		["claim-acquired", "current-key-admitted", "provider-block", "generation-persistence"] as const,
		"d708.attemptReceipt.phase",
	);
	const currentKeyNetworkCalls = literal(
		candidate.currentKeyNetworkCalls,
		candidate.currentKeyNetworkCalls === 0 ? 0 : 1,
		"d708.attemptReceipt.currentKeyCalls",
	) as 0 | 1;
	const providerTransportCalls = safeInteger(
		candidate.providerTransportCalls,
		"d708.attemptReceipt.providerCalls",
		{ min: 0, max: 576 },
	);
	let currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1 | null = null;
	if (candidate.currentKeyAdmission !== null) {
		const current = record(candidate.currentKeyAdmission, "d708.attemptReceipt.currentKey");
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
			"d708.attemptReceipt.currentKey",
		);
		literal(
			current.schemaVersion,
			"graphrefly.private-solution-eval.openrouter-current-key-spend-admission.v1",
			"d708.attemptReceipt.currentKey.schema",
		);
		const currentMaterial = strictSnapshot({
			schemaVersion:
				"graphrefly.private-solution-eval.openrouter-current-key-spend-admission.v1" as const,
			limitMicrousd: safeInteger(current.limitMicrousd, "d708.attemptReceipt.currentKey.limit", {
				min: 32_000_000,
				max: 32_000_000,
			}),
			remainingMicrousd: safeInteger(
				current.remainingMicrousd,
				"d708.attemptReceipt.currentKey.remaining",
				{ min: 6_000_000, max: 32_000_000 },
			),
			usageMicrousd: safeInteger(current.usageMicrousd, "d708.attemptReceipt.currentKey.usage", {
				min: 0,
				max: 32_000_000,
			}),
			limitReset: literal(current.limitReset, "none", "d708.attemptReceipt.currentKey.reset"),
			isManagementKey: literal(
				current.isManagementKey,
				false,
				"d708.attemptReceipt.currentKey.management",
			),
		});
		literal(
			current.admissionDigest,
			empiricalStrictJsonDigest(currentMaterial),
			"d708.attemptReceipt.currentKey.digest",
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
		throw new TypeError("D708 terminal receipt status/phase evidence is inconsistent");
	}
	if (terminalPhase === "claim-acquired") {
		await markPersistedD708DispatchClaimFailedAtPrivateRoot(
			privateRoot,
			claim as unknown as PersistedD708SingleUseDispatchClaimV1,
		);
	} else {
		await validateD708ExecutionStartedMarker(
			claim.claimPath as string,
			currentKeyAdmission!.admissionDigest,
		);
	}
	const material = strictSnapshot({
		schemaVersion: D708_LIVE_ATTEMPT_RECEIPT_SCHEMA,
		decisionRef: "decision.D708" as const,
		decisionRevision: "decision.D708.2026-08-09.v1" as const,
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
	const receiptPath = join(claim.claimPath, D708_LIVE_ATTEMPT_RECEIPT_FILE);
	await writePrivateFile(receiptPath, strictJsonCodec.encode(receipt));
	await syncDirectory(claim.claimPath);
	await syncDirectory(dirname(claim.claimPath));
	return receipt;
}
