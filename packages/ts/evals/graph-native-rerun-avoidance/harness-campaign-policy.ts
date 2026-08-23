import {
	array,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";

export const HARNESS_ARMS = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export type HarnessArm = (typeof HARNESS_ARMS)[number];

export interface HarnessCampaignPolicy {
	readonly campaignRef: string;
	readonly arms: typeof HARNESS_ARMS;
	readonly maxProviderAttempts: number;
	readonly maxCostMicrousd: number;
	readonly maxElapsedMs: number;
	readonly localEffectReservationMs: number;
	readonly providerReservationMicrousd: number;
	readonly providerDeadlineMs: number;
	readonly publicSemanticScenarioSetDigest: string;
	readonly taskEnvelopeDigest: string;
	readonly maxSameLogicalRequestRetries: 1;
	readonly retryClasses: readonly ["D671", "D675", "D710"];
	readonly allowFallback: false;
	readonly allowProviderSwitch: false;
	readonly allowParallelEffects: false;
	readonly campaignDigest: string;
}

export function validateHarnessCampaignPolicy(value: unknown): HarnessCampaignPolicy {
	const candidate = record(value, "harness campaign policy");
	exactCampaignKeys(candidate);
	const arms = array(candidate.arms, "harness campaign policy.arms");
	const retryClasses = array(candidate.retryClasses, "harness campaign policy.retryClasses");
	literal(
		empiricalStrictJsonDigest(arms),
		empiricalStrictJsonDigest(HARNESS_ARMS),
		"harness campaign policy.arms",
	);
	literal(
		empiricalStrictJsonDigest(retryClasses),
		empiricalStrictJsonDigest(["D671", "D675", "D710"]),
		"harness campaign policy.retryClasses",
	);
	const material = strictSnapshot({
		campaignRef: coordinate(candidate.campaignRef, "harness campaign policy.campaignRef"),
		arms: HARNESS_ARMS,
		maxProviderAttempts: safeInteger(
			candidate.maxProviderAttempts,
			"harness campaign policy.maxProviderAttempts",
			{ min: 6, max: 192 },
		),
		maxCostMicrousd: safeInteger(
			candidate.maxCostMicrousd,
			"harness campaign policy.maxCostMicrousd",
			{ min: 1, max: 100_000_000 },
		),
		maxElapsedMs: safeInteger(candidate.maxElapsedMs, "harness campaign policy.maxElapsedMs", {
			min: 1_000,
			max: 86_400_000,
		}),
		localEffectReservationMs: safeInteger(
			candidate.localEffectReservationMs,
			"harness campaign policy.localEffectReservationMs",
			{ min: 1, max: 600_000 },
		),
		providerReservationMicrousd: safeInteger(
			candidate.providerReservationMicrousd,
			"harness campaign policy.providerReservationMicrousd",
			{ min: 1, max: 10_000_000 },
		),
		providerDeadlineMs: safeInteger(
			candidate.providerDeadlineMs,
			"harness campaign policy.providerDeadlineMs",
			{ min: 1_000, max: 600_000 },
		),
		publicSemanticScenarioSetDigest: digest(
			candidate.publicSemanticScenarioSetDigest,
			"harness campaign policy.publicSemanticScenarioSetDigest",
		),
		taskEnvelopeDigest: digest(
			candidate.taskEnvelopeDigest,
			"harness campaign policy.taskEnvelopeDigest",
		),
		maxSameLogicalRequestRetries: literal(
			candidate.maxSameLogicalRequestRetries,
			1,
			"harness campaign policy.maxSameLogicalRequestRetries",
		),
		retryClasses: ["D671", "D675", "D710"] as const,
		allowFallback: literal(candidate.allowFallback, false, "harness campaign policy.allowFallback"),
		allowProviderSwitch: literal(
			candidate.allowProviderSwitch,
			false,
			"harness campaign policy.allowProviderSwitch",
		),
		allowParallelEffects: literal(
			candidate.allowParallelEffects,
			false,
			"harness campaign policy.allowParallelEffects",
		),
	});
	const campaignDigest = digest(candidate.campaignDigest, "harness campaign policy.campaignDigest");
	literal(
		campaignDigest,
		empiricalStrictJsonDigest(material),
		"harness campaign policy.campaignDigest",
	);
	return Object.freeze({ ...material, campaignDigest });
}

function exactCampaignKeys(candidate: Record<string, unknown>): void {
	const expected = [
		"allowFallback",
		"allowParallelEffects",
		"allowProviderSwitch",
		"arms",
		"campaignDigest",
		"campaignRef",
		"localEffectReservationMs",
		"maxCostMicrousd",
		"maxElapsedMs",
		"maxProviderAttempts",
		"maxSameLogicalRequestRetries",
		"providerDeadlineMs",
		"providerReservationMicrousd",
		"publicSemanticScenarioSetDigest",
		"retryClasses",
		"taskEnvelopeDigest",
	];
	const actual = Object.keys(candidate).sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError("harness campaign policy has unexpected keys");
	}
}

export function createHarnessCampaignPolicy(
	input: Omit<HarnessCampaignPolicy, "campaignDigest">,
): HarnessCampaignPolicy {
	const material = strictSnapshot(input);
	return validateHarnessCampaignPolicy({
		...material,
		campaignDigest: empiricalStrictJsonDigest(material),
	});
}
