/** Pure CSP11 recovery policy; callers own admission, budgets, timers and dispatch. */
export const OPENROUTER_MAX_CAPACITY_RETRIES = 3;
export const OPENROUTER_MAX_AVAILABILITY_RETRIES = 1;
export const OPENROUTER_MAX_RETRY_DELAY_MS = 240_000;
export const OPENROUTER_CONDITIONAL_AVAILABILITY_CODES = Object.freeze([
	"failed_dependency",
	"gateway_timeout",
	"internal_server_error",
	"provider_internal_error",
	"provider_overloaded",
	"request_timeout",
	"resource_locked",
	"server_error",
	"service_unavailable",
	"temporarily_unavailable",
	"upstream_error",
	"upstream_timeout",
]);

export function parseRetryAfterMs(value, nowMs) {
	if (value === null) return Object.freeze({ kind: "absent" });
	const trimmed = value.trim();
	if (/^\d+$/u.test(trimmed)) {
		const seconds = BigInt(trimmed);
		if (seconds < 1n) return Object.freeze({ kind: "invalid" });
		if (seconds * 1_000n > BigInt(OPENROUTER_MAX_RETRY_DELAY_MS))
			return Object.freeze({ kind: "valid-over-limit" });
		return Object.freeze({ kind: "valid", delayMs: Number(seconds) * 1_000 });
	}
	{
		const readyAtMs = Date.parse(trimmed);
		if (!Number.isFinite(readyAtMs)) return Object.freeze({ kind: "invalid" });
		const delayMs = Math.ceil(readyAtMs - nowMs);
		if (!Number.isSafeInteger(delayMs) || delayMs < 1) return Object.freeze({ kind: "invalid" });
		if (delayMs > OPENROUTER_MAX_RETRY_DELAY_MS) return Object.freeze({ kind: "valid-over-limit" });
		return Object.freeze({ kind: "valid", delayMs });
	}
}

export function providerErrorCode(root) {
	const error = root.error;
	if (error === null || typeof error !== "object" || Array.isArray(error)) return null;
	const errorRecord = error;
	const metadata = errorRecord.metadata;
	const metadataRecord =
		metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
			? metadata
			: undefined;
	const raw = metadataRecord?.provider_error_code ?? errorRecord.code;
	return typeof raw === "string" ? raw.toLowerCase() : null;
}

export function isTransientAvailabilityStatus(status, code, hasRetryAfter) {
	if ([408, 425, 502, 503, 504, 520].includes(status)) return true;
	if (![409, 423, 424, 500].includes(status)) return false;
	return (
		hasRetryAfter || (code !== null && OPENROUTER_CONDITIONAL_AVAILABILITY_CODES.includes(code))
	);
}

export function classifyHttpRecovery(status, root, retryAfter) {
	if (status === 429) return "capacity";
	return isTransientAvailabilityStatus(
		status,
		providerErrorCode(root),
		retryAfter.kind === "valid" || retryAfter.kind === "valid-over-limit",
	)
		? "availability"
		: null;
}

/** Ordinals count retries already dispatched, before proposing the next retry. */
export function recoveryDelay({
	recoveryClass,
	capacityRetryOrdinal,
	availabilityRetryOrdinal,
	retryAfterMs,
}) {
	for (const ordinal of [capacityRetryOrdinal, availabilityRetryOrdinal]) {
		if (!Number.isSafeInteger(ordinal) || ordinal < 0)
			throw new TypeError("Invalid recovery ordinal");
	}
	if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)
		throw new TypeError("Invalid retry delay");
	if (recoveryClass !== "capacity" && recoveryClass !== "availability")
		throw new TypeError("Invalid recovery class");
	if (retryAfterMs > OPENROUTER_MAX_RETRY_DELAY_MS) return null;
	if (recoveryClass === "capacity") {
		if (capacityRetryOrdinal >= OPENROUTER_MAX_CAPACITY_RETRIES) return null;
		return Math.max([60_000, 120_000, 240_000][capacityRetryOrdinal], retryAfterMs);
	}
	if (availabilityRetryOrdinal >= OPENROUTER_MAX_AVAILABILITY_RETRIES) return null;
	return Math.max(60_000, retryAfterMs);
}
