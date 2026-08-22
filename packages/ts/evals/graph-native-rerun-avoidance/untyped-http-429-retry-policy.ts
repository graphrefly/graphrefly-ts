import {
	coordinate,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { EmpiricalModelTurnOutcomeV1 } from "./model-execution.js";
import {
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";

export const D710_UNTYPED_HTTP_429_RETRY_POLICY_SCHEMA =
	"graphrefly.private-solution-eval.untyped-http-429-single-retry-policy.v1" as const;
export const D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS = 60_000;
export const D710_UNTYPED_HTTP_429_RETRY_AFTER_MAX_MS = 600_000;

export interface D710UntypedHttp429RetryPolicyV1 {
	readonly schemaVersion: typeof D710_UNTYPED_HTTP_429_RETRY_POLICY_SCHEMA;
	readonly policyRef: "untyped-http-429-retry.d710.single-same-route";
	readonly policyRevision: "decision.D710.2026-08-09.v1";
	readonly requestModel: typeof OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL;
	readonly endpoint: typeof OPENROUTER_CHAT_COMPLETIONS_ENDPOINT;
	readonly downstreamProviderSlug: typeof OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG;
	readonly downstreamProviderName: typeof OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME;
	readonly maxUntypedRetriesPerTurn: 1;
	readonly fallbackDelayMs: typeof D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS;
	readonly maxRetryAfterMs: typeof D710_UNTYPED_HTTP_429_RETRY_AFTER_MAX_MS;
}

export const D710_UNTYPED_HTTP_429_RETRY_POLICY = strictSnapshot({
	schemaVersion: D710_UNTYPED_HTTP_429_RETRY_POLICY_SCHEMA,
	policyRef: "untyped-http-429-retry.d710.single-same-route" as const,
	policyRevision: "decision.D710.2026-08-09.v1" as const,
	requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
	endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	downstreamProviderSlug: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	maxUntypedRetriesPerTurn: 1 as const,
	fallbackDelayMs: D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS,
	maxRetryAfterMs: D710_UNTYPED_HTTP_429_RETRY_AFTER_MAX_MS,
}) satisfies D710UntypedHttp429RetryPolicyV1;

export const D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST = empiricalStrictJsonDigest(
	D710_UNTYPED_HTTP_429_RETRY_POLICY,
);

const BODY_SHAPES = Object.freeze([
	"empty",
	"json-object",
	"json-non-object",
	"non-json-text",
	"invalid-utf8",
] as const);
const MEDIA_CLASSES = Object.freeze(["empty", "json", "text", "binary"] as const);
const RETRY_PRESENCE = Object.freeze(["present", "absent", "unavailable"] as const);
const RETRY_PARSE = Object.freeze(["parsed", "invalid", "absent", "unavailable"] as const);

function exactSuffix(
	issueCodes: readonly string[],
	prefix: string,
	allowed: readonly string[],
): string | null {
	const matches = issueCodes.filter((issueCode) => issueCode.startsWith(prefix));
	if (matches.length !== 1) return null;
	const suffix = (matches[0] as string).slice(prefix.length);
	return allowed.includes(suffix) ? suffix : null;
}

function parsedRetryAfterMs(issueCodes: readonly string[]): number | null {
	const prefix = "openrouter-retry-after-ms:";
	const values = issueCodes.filter((issueCode) => issueCode.startsWith(prefix));
	if (values.length !== 1) return null;
	const value = Number((values[0] as string).slice(prefix.length));
	return Number.isSafeInteger(value) &&
		value >= 1 &&
		value <= D710_UNTYPED_HTTP_429_RETRY_AFTER_MAX_MS
		? value
		: null;
}

function hasRecognizedClosedProviderClassification(issueCodes: readonly string[]): boolean {
	return issueCodes.some(
		(issueCode) =>
			(issueCode.startsWith("openrouter-error-type:") &&
				issueCode !== "openrouter-error-type:unrecognized") ||
			(issueCode.startsWith("openrouter-error-code:") &&
				issueCode !== "openrouter-error-code:unrecognized"),
	);
}

/** Package-private D710 discriminator. A non-null result is the exact scheduled retry floor. */
export function d710UntypedHttp429RetryDelayMs(
	outcome: Pick<EmpiricalModelTurnOutcomeV1, "issueCodes" | "status">,
	attemptOrdinal: number,
): number | null {
	if (outcome.status !== "non-evaluable" || attemptOrdinal !== 1) return null;
	const issueCodes = outcome.issueCodes;
	if (
		!issueCodes.includes("openrouter-http-status:429") ||
		!issueCodes.includes("openrouter-quota-rate-limit") ||
		!issueCodes.includes("openrouter-error-recognized-type:absent") ||
		!issueCodes.includes("openrouter-error-recognized-code:absent") ||
		hasRecognizedClosedProviderClassification(issueCodes)
	) {
		return null;
	}
	if (
		exactSuffix(issueCodes, "openrouter-error-body-shape:", BODY_SHAPES) === null ||
		exactSuffix(issueCodes, "openrouter-error-media-class:", MEDIA_CLASSES) === null
	) {
		return null;
	}
	const presence = exactSuffix(issueCodes, "openrouter-retry-after-presence:", RETRY_PRESENCE);
	const parse = exactSuffix(issueCodes, "openrouter-retry-after-parse:", RETRY_PARSE);
	if (presence === null || parse === null) return null;
	const retryAfterMs = parsedRetryAfterMs(issueCodes);
	if (parse === "parsed") {
		return presence === "present" && retryAfterMs !== null ? retryAfterMs : null;
	}
	if (retryAfterMs !== null) return null;
	if (
		(parse === "absent" && presence !== "absent") ||
		(parse === "invalid" && presence !== "present") ||
		(parse === "unavailable" && presence !== "unavailable")
	) {
		return null;
	}
	return D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS;
}

export function validateD710UntypedHttp429RetryPolicy(
	value: unknown,
): D710UntypedHttp429RetryPolicyV1 {
	const policy = record(value, "d710.policy");
	exactKeys(
		policy,
		[
			"downstreamProviderName",
			"downstreamProviderSlug",
			"endpoint",
			"fallbackDelayMs",
			"maxRetryAfterMs",
			"maxUntypedRetriesPerTurn",
			"policyRef",
			"policyRevision",
			"requestModel",
			"schemaVersion",
		],
		"d710.policy",
	);
	literal(
		policy.schemaVersion,
		D710_UNTYPED_HTTP_429_RETRY_POLICY_SCHEMA,
		"d710.policy.schemaVersion",
	);
	literal(policy.policyRef, D710_UNTYPED_HTTP_429_RETRY_POLICY.policyRef, "d710.policy.policyRef");
	literal(
		policy.policyRevision,
		D710_UNTYPED_HTTP_429_RETRY_POLICY.policyRevision,
		"d710.policy.policyRevision",
	);
	literal(
		coordinate(policy.requestModel, "d710.policy.requestModel"),
		D710_UNTYPED_HTTP_429_RETRY_POLICY.requestModel,
		"d710.policy.requestModel",
	);
	literal(policy.endpoint, D710_UNTYPED_HTTP_429_RETRY_POLICY.endpoint, "d710.policy.endpoint");
	literal(
		coordinate(policy.downstreamProviderSlug, "d710.policy.downstreamProviderSlug"),
		D710_UNTYPED_HTTP_429_RETRY_POLICY.downstreamProviderSlug,
		"d710.policy.downstreamProviderSlug",
	);
	literal(
		coordinate(policy.downstreamProviderName, "d710.policy.downstreamProviderName"),
		D710_UNTYPED_HTTP_429_RETRY_POLICY.downstreamProviderName,
		"d710.policy.downstreamProviderName",
	);
	literal(
		safeInteger(policy.maxUntypedRetriesPerTurn, "d710.policy.maxUntypedRetriesPerTurn", {
			min: 1,
			max: 1,
		}),
		1,
		"d710.policy.maxUntypedRetriesPerTurn",
	);
	literal(
		safeInteger(policy.fallbackDelayMs, "d710.policy.fallbackDelayMs", {
			min: D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS,
			max: D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS,
		}),
		D710_UNTYPED_HTTP_429_RETRY_FALLBACK_MS,
		"d710.policy.fallbackDelayMs",
	);
	literal(
		safeInteger(policy.maxRetryAfterMs, "d710.policy.maxRetryAfterMs", {
			min: D710_UNTYPED_HTTP_429_RETRY_AFTER_MAX_MS,
			max: D710_UNTYPED_HTTP_429_RETRY_AFTER_MAX_MS,
		}),
		D710_UNTYPED_HTTP_429_RETRY_AFTER_MAX_MS,
		"d710.policy.maxRetryAfterMs",
	);
	if (empiricalStrictJsonDigest(policy) !== D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST) {
		throw new TypeError("D710 policy is non-canonical or substituted");
	}
	return D710_UNTYPED_HTTP_429_RETRY_POLICY;
}

export function assertD710UntypedHttp429RetryRoute(
	policy: D710UntypedHttp429RetryPolicyV1,
	route: OpenRouterRouteQualificationV1,
): void {
	validateD710UntypedHttp429RetryPolicy(policy);
	if (
		route.requestModel !== policy.requestModel ||
		route.endpoint !== policy.endpoint ||
		route.downstreamProviderSlug !== policy.downstreamProviderSlug ||
		route.downstreamProviderName !== policy.downstreamProviderName
	) {
		throw new TypeError("D710 retry policy requires the exact DeepSeek/DeepInfra route");
	}
}
