import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_TASK,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.js";
import { D9_IMPLEMENTATION_MANIFEST_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d9-current-implementation-manifest.js";
import {
	createD9InjectedBaselineForTest,
	D9_INJECTED_TEST_GENERATION_REF,
	persistD9InjectedQualificationForTest,
	runD9InjectedNoNetworkQualification,
	validateD9QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d9-current-pre-live-qualification.js";
import {
	admitD9ProviderEffectResult,
	createD9ProviderRejectionAuthority,
	D9_PROVIDER_REJECTION_CAUSES,
	snapshotD9ProviderRejectionEvidence,
	takeD9ProviderEffect,
	validateD9ProviderRejectionEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d9-current-provider-rejection-authority.js";

const RAW_SENTINEL = "D9_RAW_PROVIDER_MATERIAL_MUST_NOT_PERSIST";

function usage(overrides: Record<string, unknown> = {}) {
	return {
		requests: 1,
		inputTokens: 11,
		outputTokens: 7,
		cacheReadTokens: 0,
		actualCostMicrousd: 17,
		actualElapsedMs: 19,
		costBasis: "reported",
		...overrides,
	};
}

function baseCompleted(toolCalls: readonly unknown[]) {
	return {
		effectKind: "provider-request",
		status: "completed",
		toolCalls,
		failureCode: null,
		retryProposal: null,
		usage: usage(),
		evidenceDigest: empiricalStrictJsonDigest({ fixture: "D9", toolCalls }),
	};
}

function rejectedResult(
	cause: (typeof D9_PROVIDER_REJECTION_CAUSES)[number],
	request: ReturnType<typeof takeD9ProviderEffect> extends infer T
		? Exclude<T, null>["request"]
		: never,
) {
	const read = { toolRef: "read-file", path: "package.json" };
	if (cause === "provider-result-schema-invalid")
		return { ...baseCompleted([read]), unexpected: RAW_SENTINEL };
	if (cause === "provider-result-cardinality-invalid") return baseCompleted([]);
	if (cause === "provider-tool-count-exceeded")
		return baseCompleted([read, read, read, read, read]);
	if (cause === "provider-tool-argument-invalid")
		return baseCompleted([{ toolRef: "read-file", path: "" }]);
	if (cause === "provider-usage-reservation-exceeded")
		return {
			...baseCompleted([read]),
			usage: usage({ actualCostMicrousd: request.reservation.maxCostMicrousd + 1 }),
		};
	return {
		effectKind: "provider-request",
		status: "failed",
		toolCalls: [],
		failureCode: "retryable-transient",
		retryProposal: {
			retryClass: "retryable-transient",
			retryAfterMs: 7,
			proposalDigest: empiricalStrictJsonDigest({ wrong: true }),
		},
		usage: usage(),
		evidenceDigest: empiricalStrictJsonDigest({ fixture: "D9-retry" }),
	};
}

function localResult(effect: Exclude<ReturnType<typeof takeD9ProviderEffect>, null>) {
	if (effect.request.effectKind === "materialization")
		return {
			effectKind: "materialization",
			status: "completed",
			workspaceStateDigest: empiricalStrictJsonDigest({ arm: effect.request.arm, state: 0 }),
			evidenceDigest: empiricalStrictJsonDigest({ request: effect.request.requestDigest }),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	if (effect.request.effectKind === "cleanup")
		return {
			effectKind: "cleanup",
			status: "completed",
			workspaceStateDigest: effect.request.workspaceStateDigest,
			evidenceDigest: empiricalStrictJsonDigest({ request: effect.request.requestDigest }),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	throw new TypeError(`unexpected local effect ${effect.request.effectKind}`);
}

async function sixArmRejectionEvidence() {
	const authority = createD9ProviderRejectionAuthority({
		limits: CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: CURRENT_GRAPH_LIVE_TASK,
	});
	let armIndex = 0;
	for (let guard = 0; guard < 64; guard += 1) {
		const effect = takeD9ProviderEffect(authority);
		if (effect === null) return snapshotD9ProviderRejectionEvidence(authority);
		const result =
			effect.request.effectKind === "provider-request"
				? rejectedResult(D9_PROVIDER_REJECTION_CAUSES[armIndex++]!, effect.request)
				: localResult(effect);
		admitD9ProviderEffectResult(authority, effect.request.requestDigest, result);
	}
	throw new TypeError("D9 six-arm fixture exceeded its guard");
}

describe("graphrefly-ts:D9 Graph-admitted provider-result rejection", () => {
	it("admits all six rejection causes, conservatively accounts them, cleans each arm and continues", async () => {
		const evidence = await sixArmRejectionEvidence();
		const validated = validateD9ProviderRejectionEvidence(evidence);

		expect(validated.rejectionFacts.map((fact) => fact.causeCode)).toEqual(
			D9_PROVIDER_REJECTION_CAUSES,
		);
		expect(validated.providerEvidence.workflowEvidence.runs).toHaveLength(6);
		expect(
			validated.providerEvidence.workflowEvidence.runs.every(
				(run) => run.status === "incomplete" && run.cleanupStatus === "completed",
			),
		).toBe(true);
		expect(validated.providerEvidence.budget.providerAttempts).toBe(6);
		expect(validated.providerEvidence.budget.confirmedCostMicrousd).toBe(
			6 * CURRENT_GRAPH_LIVE_LIMITS.providerMaxCostMicrousd,
		);
		expect(validated.providerEvidence.budget.confirmedElapsedMs).toBe(
			6 * CURRENT_GRAPH_LIVE_LIMITS.providerMaxElapsedMs + 12,
		);
		expect(JSON.stringify(validated)).not.toContain(RAW_SENTINEL);
	});

	it("rejects canonical substitution and provider-fact replay", async () => {
		const evidence = await sixArmRejectionEvidence();
		const substituted = structuredClone(evidence);
		substituted.rejectionFacts[0]!.causeCode = "provider-result-cardinality-invalid";
		expect(() => validateD9ProviderRejectionEvidence(substituted)).toThrow();

		const replayed = structuredClone(evidence);
		replayed.rejectionFacts[1]!.providerFactDigest = replayed.rejectionFacts[0]!.providerFactDigest;
		expect(() => validateD9ProviderRejectionEvidence(replayed)).toThrow();
	});

	it("does not invoke accessor-owned result material and keeps request mismatch globally fail-closed", () => {
		const authority = createD9ProviderRejectionAuthority({
			limits: CURRENT_GRAPH_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: CURRENT_GRAPH_LIVE_TASK,
		});
		const materialization = takeD9ProviderEffect(authority)!;
		admitD9ProviderEffectResult(
			authority,
			materialization.request.requestDigest,
			localResult(materialization),
		);
		const provider = takeD9ProviderEffect(authority)!;
		let getterCalls = 0;
		const accessorResult = {} as Record<string, unknown>;
		Object.defineProperty(accessorResult, "effectKind", {
			enumerable: true,
			get() {
				getterCalls += 1;
				return "provider-request";
			},
		});
		expect(() =>
			admitD9ProviderEffectResult(
				authority,
				empiricalStrictJsonDigest({ wrong: true }),
				accessorResult,
			),
		).toThrow(/does not match/);
		expect(getterCalls).toBe(0);

		const outcome = admitD9ProviderEffectResult(
			authority,
			provider.request.requestDigest,
			accessorResult,
		);
		expect(outcome.rejectionFact?.causeCode).toBe("provider-result-schema-invalid");
		expect(outcome.rejectionFact?.candidateDigest).toBeNull();
		expect(getterCalls).toBe(0);
	});

	it("qualifies transparent and rejected six-arm paths with atomic private persistence", async () => {
		const bundle = await runD9InjectedNoNetworkQualification({
			baseline: createD9InjectedBaselineForTest(),
			implementationManifestDigest: D9_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const validated = validateD9QualificationBundle(bundle);
		expect(validated.qualification.rejectionCauseCoverage).toEqual(D9_PROVIDER_REJECTION_CAUSES);
		expect(validated.qualification.transparentSixArmPassed).toBe(true);
		expect(validated.qualification.providerNetworkCalls).toBe(0);

		const privateRoot = await realpath(
			await mkdtemp(join(tmpdir(), "graphrefly-d9-qualification-")),
		);
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD9InjectedQualificationForTest({ privateRoot, bundle });
			expect(receipt.generationRef).toBe(D9_INJECTED_TEST_GENERATION_REF);
			const generationRoot = join(privateRoot, D9_INJECTED_TEST_GENERATION_REF);
			expect((await stat(generationRoot)).mode & 0o777).toBe(0o700);
			expect((await stat(join(generationRoot, "artifacts/bundle.v1.json"))).mode & 0o777).toBe(
				0o600,
			);
			expect(
				validateD9QualificationBundle(
					JSON.parse(await readFile(join(generationRoot, "artifacts/bundle.v1.json"), "utf8")),
				).bundleDigest,
			).toBe(validated.bundleDigest);
			await expect(persistD9InjectedQualificationForTest({ privateRoot, bundle })).rejects.toThrow(
				/same-process/,
			);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("rejects accessor-owned, extra-key and replayed qualification material", async () => {
		const baseline = createD9InjectedBaselineForTest();
		let inputGetterCalls = 0;
		const accessorInput = {
			implementationManifestDigest: D9_IMPLEMENTATION_MANIFEST_DIGEST,
		} as Record<string, unknown>;
		Object.defineProperty(accessorInput, "baseline", {
			enumerable: true,
			get() {
				inputGetterCalls += 1;
				return baseline;
			},
		});
		await expect(
			runD9InjectedNoNetworkQualification(
				accessorInput as unknown as Parameters<typeof runD9InjectedNoNetworkQualification>[0],
			),
		).rejects.toThrow(/own data property/);
		expect(inputGetterCalls).toBe(0);

		const bundle = await runD9InjectedNoNetworkQualification({
			baseline,
			implementationManifestDigest: D9_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		let getterCalls = 0;
		const accessorBundle = {} as Record<string, unknown>;
		Object.defineProperty(accessorBundle, "schemaVersion", {
			enumerable: true,
			get() {
				getterCalls += 1;
				return bundle.schemaVersion;
			},
		});
		expect(() => validateD9QualificationBundle(accessorBundle)).toThrow();
		expect(getterCalls).toBe(0);

		const extraKey = structuredClone(bundle) as unknown as Record<string, unknown>;
		extraKey.unexpected = RAW_SENTINEL;
		expect(() => validateD9QualificationBundle(extraKey)).toThrow(/keys/);

		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d9-replay-")));
		const replayRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d9-replay-2-")));
		await chmod(privateRoot, 0o700);
		await chmod(replayRoot, 0o700);
		try {
			await persistD9InjectedQualificationForTest({ privateRoot, bundle });
			await expect(
				persistD9InjectedQualificationForTest({
					privateRoot: replayRoot,
					bundle,
				}),
			).rejects.toThrow(/same-process/);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
			await rm(replayRoot, { recursive: true, force: true });
		}
	});
});
