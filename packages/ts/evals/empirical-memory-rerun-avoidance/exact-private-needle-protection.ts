import type { StrictJsonValue } from "../../src/json/codec.js";
import { array, coordinate, exactKeys, fail, record, string } from "./canonical.js";
import type {
	EmpiricalProtectionExecutionInputV1,
	EmpiricalProtectionExecutorV1,
} from "./model-execution.js";

export const EMPIRICAL_EXACT_PRIVATE_NEEDLE_PROTECTION_PROFILE =
	"graphrefly.private-solution-eval.exact-private-needle.v1";
export const MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS = 16;
export const MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS = 4_096;
export const MAX_EMPIRICAL_PRIVATE_NEEDLES = 16;
const constructedExecutors = new WeakSet<object>();

export interface EmpiricalExactPrivateNeedleProtectionConfigV1 {
	readonly policyRef: string;
	readonly policyRevision: string;
	readonly protectedNeedleCapabilityRef: string;
	readonly protectedNeedleCapabilityRevision: string;
	readonly protectedNeedles: readonly string[];
}

export interface EmpiricalExactPrivateNeedleProtectionExecutorV1
	extends EmpiricalProtectionExecutorV1 {
	readonly profile: typeof EMPIRICAL_EXACT_PRIVATE_NEEDLE_PROTECTION_PROFILE;
	readonly policyRef: string;
	readonly policyRevision: string;
	readonly protectedNeedleCapabilityRef: string;
	readonly protectedNeedleCapabilityRevision: string;
}

/**
 * Package-private D656 exact known-needle protection policy.
 *
 * The host supplies protected values explicitly through a private capability;
 * this policy never discovers ambient credentials. It performs only exact,
 * case-sensitive UTF-16 code-unit substring checks over strict-JSON string
 * values and object keys. Invoke it through executeEmpiricalProtection so the
 * D655 wrapper owns canonical bounds, digests, receipts, and fail-closed error
 * conversion. Policy revisioning must bind this profile, its bounds, and the
 * supplied capability revision.
 */
export function createEmpiricalExactPrivateNeedleProtectionExecutor(
	value: unknown,
): EmpiricalExactPrivateNeedleProtectionExecutorV1 {
	try {
		return createValidatedExecutor(value);
	} catch {
		return fail("exactPrivateNeedleProtection", "invalid protected capability configuration");
	}
}

function createValidatedExecutor(value: unknown): EmpiricalExactPrivateNeedleProtectionExecutorV1 {
	const config = record(value, "exactPrivateNeedleProtection");
	exactKeys(
		config,
		[
			"policyRef",
			"policyRevision",
			"protectedNeedleCapabilityRef",
			"protectedNeedleCapabilityRevision",
			"protectedNeedles",
		],
		"exactPrivateNeedleProtection",
	);
	const policyRef = coordinate(config.policyRef, "exactPrivateNeedleProtection.policyRef");
	const policyRevision = coordinate(
		config.policyRevision,
		"exactPrivateNeedleProtection.policyRevision",
	);
	const protectedNeedleCapabilityRef = coordinate(
		config.protectedNeedleCapabilityRef,
		"exactPrivateNeedleProtection.protectedNeedleCapabilityRef",
	);
	const protectedNeedleCapabilityRevision = coordinate(
		config.protectedNeedleCapabilityRevision,
		"exactPrivateNeedleProtection.protectedNeedleCapabilityRevision",
	);
	const protectedNeedles = validateProtectedNeedles(config.protectedNeedles);

	const executor = Object.freeze({
		profile: EMPIRICAL_EXACT_PRIVATE_NEEDLE_PROTECTION_PROFILE,
		policyRef,
		policyRevision,
		protectedNeedleCapabilityRef,
		protectedNeedleCapabilityRevision,
		inspect(input: EmpiricalProtectionExecutionInputV1) {
			if (input.policyRef !== policyRef || input.policyRevision !== policyRevision) {
				fail("exactPrivateNeedleProtection.input", "policy coordinates do not match");
			}
			return {
				disposition: containsProtectedNeedle(input.subject, protectedNeedles)
					? ("blocked" as const)
					: ("allowed" as const),
			};
		},
	});
	constructedExecutors.add(executor);
	return executor;
}

export function isEmpiricalExactPrivateNeedleProtectionExecutor(
	value: unknown,
): value is EmpiricalExactPrivateNeedleProtectionExecutorV1 {
	return typeof value === "object" && value !== null && constructedExecutors.has(value);
}

function validateProtectedNeedles(value: unknown): readonly string[] {
	const entries = array(value, "exactPrivateNeedleProtection.protectedNeedles");
	if (Object.getPrototypeOf(entries) !== Array.prototype) {
		fail("exactPrivateNeedleProtection.protectedNeedles", "expected a plain array");
	}
	if (entries.length === 0 || entries.length > MAX_EMPIRICAL_PRIVATE_NEEDLES) {
		fail(
			"exactPrivateNeedleProtection.protectedNeedles",
			`expected between 1 and ${MAX_EMPIRICAL_PRIVATE_NEEDLES} entries`,
		);
	}
	const validated: string[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
		if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
			fail("exactPrivateNeedleProtection.protectedNeedles", "expected own data entries");
		}
		const needle = string(
			descriptor.value,
			`exactPrivateNeedleProtection.protectedNeedles[${index}]`,
			MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
		);
		if (needle.length < MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS) {
			fail(
				`exactPrivateNeedleProtection.protectedNeedles[${index}]`,
				`expected at least ${MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS} code units`,
			);
		}
		validated.push(needle);
	}
	if (new Set(validated).size !== validated.length) {
		fail("exactPrivateNeedleProtection.protectedNeedles", "expected unique entries");
	}
	return Object.freeze(validated);
}

function containsProtectedNeedle(
	value: StrictJsonValue,
	protectedNeedles: readonly string[],
): boolean {
	if (typeof value === "string") return containsAny(value, protectedNeedles);
	if (value === null || typeof value !== "object") return false;
	if (Array.isArray(value)) {
		for (const entry of value) {
			if (containsProtectedNeedle(entry, protectedNeedles)) return true;
		}
		return false;
	}
	for (const [key, entry] of Object.entries(value)) {
		if (containsAny(key, protectedNeedles) || containsProtectedNeedle(entry, protectedNeedles)) {
			return true;
		}
	}
	return false;
}

function containsAny(value: string, protectedNeedles: readonly string[]): boolean {
	for (const needle of protectedNeedles) {
		if (value.includes(needle)) return true;
	}
	return false;
}
