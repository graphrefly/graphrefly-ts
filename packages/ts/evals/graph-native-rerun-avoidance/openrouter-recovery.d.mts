export const OPENROUTER_MAX_CAPACITY_RETRIES: 3;
export const OPENROUTER_MAX_AVAILABILITY_RETRIES: 1;
export const OPENROUTER_MAX_RETRY_DELAY_MS: 240000;
export const OPENROUTER_CONDITIONAL_AVAILABILITY_CODES: readonly [
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
];
export type ParsedRetryAfter =
	| Readonly<{ kind: "absent" | "invalid" | "valid-over-limit" }>
	| Readonly<{ kind: "valid"; delayMs: number }>;
export function parseRetryAfterMs(value: string | null, nowMs: number): ParsedRetryAfter;
export function providerErrorCode(root: Record<string, unknown>): string | null;
export function isTransientAvailabilityStatus(
	status: number,
	code: string | null,
	hasRetryAfter: boolean,
): boolean;
export function classifyHttpRecovery(
	status: number,
	root: Record<string, unknown>,
	retryAfter: ParsedRetryAfter,
): "capacity" | "availability" | null;
export function recoveryDelay(input: {
	recoveryClass: "capacity" | "availability";
	capacityRetryOrdinal: number;
	availabilityRetryOrdinal: number;
	retryAfterMs: number;
}): number | null;
