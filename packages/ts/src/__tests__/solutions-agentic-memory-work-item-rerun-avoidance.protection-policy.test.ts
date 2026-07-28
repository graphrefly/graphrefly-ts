import { describe, expect, it, vi } from "vitest";
import {
	createEmpiricalExactPrivateNeedleProtectionExecutor,
	EMPIRICAL_EXACT_PRIVATE_NEEDLE_PROTECTION_PROFILE,
	MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
	MAX_EMPIRICAL_PRIVATE_NEEDLES,
	MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
} from "../../evals/empirical-memory-rerun-avoidance/exact-private-needle-protection.js";
import {
	executeEmpiricalProtection,
	MAX_EMPIRICAL_PROTECTION_SUBJECT_BYTES,
} from "../../evals/empirical-memory-rerun-avoidance/model-execution.js";

const protectedNeedle = "private-needle-placeholder-0123456789";
const policyRef = "protection-policy-placeholder";
const policyRevision = "protection-policy-revision-placeholder";

function executor(needles: readonly string[] = [protectedNeedle]) {
	return createEmpiricalExactPrivateNeedleProtectionExecutor({
		policyRef,
		policyRevision,
		protectedNeedleCapabilityRef: "private-capability-placeholder",
		protectedNeedleCapabilityRevision: "private-capability-revision-placeholder",
		protectedNeedles: needles,
	});
}

function inspect(subject: Parameters<typeof executeEmpiricalProtection>[1]["subject"]) {
	return executeEmpiricalProtection(executor(), {
		policyRef,
		policyRevision,
		stage: "model-egress",
		subject,
	});
}

describe("B112 D656 package-private exact-private-needle-v1 protection", () => {
	it("blocks exact case-sensitive substrings in every string value and object key", () => {
		expect(
			inspect({ nested: [{ value: `prefix-${protectedNeedle}-suffix` }] }).receipt.disposition,
		).toBe("blocked");
		expect(inspect({ [`key-${protectedNeedle}`]: "bounded-placeholder" }).receipt.disposition).toBe(
			"blocked",
		);
		expect(inspect({ value: protectedNeedle.toUpperCase() }).receipt.disposition).toBe("allowed");
		const composedNeedle = "private-needle-caf\u00e9-placeholder";
		const decomposedValue = "private-needle-cafe\u0301-placeholder";
		expect(
			executeEmpiricalProtection(executor([composedNeedle]), {
				policyRef,
				policyRevision,
				stage: "model-egress",
				subject: { value: decomposedValue },
			}).receipt.disposition,
		).toBe("allowed");
		expect(
			inspect({ password: "token-shaped-but-not-an-explicit-needle" }).receipt.disposition,
		).toBe("allowed");
	});

	it("uses the same synchronous policy for source, tool, and model stages", () => {
		for (const stage of ["source-ingress", "tool-ingress", "model-egress"] as const) {
			const result = executeEmpiricalProtection(executor(), {
				policyRef,
				policyRevision,
				stage,
				subject: { value: protectedNeedle },
			});
			expect(result.receipt).toMatchObject({ stage, disposition: "blocked" });
			expect(result.issueCode).toBeNull();
		}
	});

	it("exposes only material-free coordinates and never emits match material", () => {
		const policy = executor();
		expect(policy).toMatchObject({
			profile: EMPIRICAL_EXACT_PRIVATE_NEEDLE_PROTECTION_PROFILE,
			policyRef,
			policyRevision,
			protectedNeedleCapabilityRef: "private-capability-placeholder",
			protectedNeedleCapabilityRevision: "private-capability-revision-placeholder",
		});
		expect(JSON.stringify(policy)).not.toContain(protectedNeedle);
		const serialized = JSON.stringify(inspect({ value: protectedNeedle }));
		expect(serialized).not.toContain(protectedNeedle);
		expect(serialized).not.toContain("value");
		expect(
			Object.keys(
				policy.inspect({ policyRef, policyRevision, stage: "model-egress", subject: null }),
			),
		).toEqual(["disposition"]);
	});

	it("rejects empty, duplicate, undersized, oversized, over-count, and malformed capabilities", () => {
		expect(() => executor([])).toThrow(/invalid protected capability configuration/);
		expect(() => executor([protectedNeedle, protectedNeedle])).toThrow(
			/invalid protected capability configuration/,
		);
		expect(() => executor(["x".repeat(MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS - 1)])).toThrow(
			/invalid protected capability configuration/,
		);
		expect(() => executor(["x".repeat(MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS + 1)])).toThrow(
			/invalid protected capability configuration/,
		);
		expect(() =>
			executor(
				Array.from(
					{ length: MAX_EMPIRICAL_PRIVATE_NEEDLES + 1 },
					(_, index) => `private-needle-${String(index).padStart(4, "0")}`,
				),
			),
		).toThrow(/invalid protected capability configuration/);

		const getter = vi.fn(() => [protectedNeedle]);
		const malformed = Object.defineProperty(
			{
				policyRef,
				policyRevision,
				protectedNeedleCapabilityRef: "private-capability-placeholder",
				protectedNeedleCapabilityRevision: "private-capability-revision-placeholder",
			},
			"protectedNeedles",
			{ enumerable: true, get: getter },
		);
		expect(() => createEmpiricalExactPrivateNeedleProtectionExecutor(malformed)).toThrow(
			/invalid protected capability configuration/,
		);
		expect(getter).not.toHaveBeenCalled();

		const mapHook = vi.fn(function (this: readonly string[]) {
			return [this[0]];
		});
		const customPrototype = Object.create(Array.prototype, {
			map: { configurable: true, value: mapHook },
		});
		const customPrototypeNeedles = [protectedNeedle];
		Object.setPrototypeOf(customPrototypeNeedles, customPrototype);
		expect(() => executor(customPrototypeNeedles)).toThrow(
			/invalid protected capability configuration/,
		);
		expect(mapHook).not.toHaveBeenCalled();
	});

	it("fails closed on mismatched policy coordinates without leaking needles", () => {
		const result = executeEmpiricalProtection(executor(), {
			policyRef,
			policyRevision: "different-policy-revision-placeholder",
			stage: "model-egress",
			subject: { value: protectedNeedle },
		});
		expect(result.receipt.disposition).toBe("blocked");
		expect(result.issueCode).toBe("model-egress-protection-failed");
		expect(JSON.stringify(result)).not.toContain(protectedNeedle);
	});

	it("rejects an oversized canonical subject before invoking the policy", () => {
		const inspectSpy = vi.fn(() => ({ disposition: "allowed" as const }));
		const policy = { inspect: inspectSpy };
		const subject = Array.from({ length: 9 }, () => "x".repeat(32_768));
		expect(JSON.stringify(subject).length).toBeGreaterThan(MAX_EMPIRICAL_PROTECTION_SUBJECT_BYTES);
		expect(() =>
			executeEmpiricalProtection(policy, {
				policyRef,
				policyRevision,
				stage: "model-egress",
				subject,
			}),
		).toThrow(/exceeds 262144 canonical bytes/);
		expect(inspectSpy).not.toHaveBeenCalled();
	});
});
