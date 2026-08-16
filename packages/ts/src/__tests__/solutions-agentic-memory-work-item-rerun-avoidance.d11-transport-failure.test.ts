import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import type { CurrentGraphProviderAdmittedEffectV1 } from "../../evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.js";
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_TASK,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.js";
import {
	D11_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD11Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d11-current-implementation-manifest.js";
import {
	createD11InjectedBaselineForTest,
	D11_INJECTED_TEST_GENERATION_REF,
	persistD11InjectedQualificationForTest,
	runD11InjectedNoNetworkQualification,
	validateD11QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d11-current-pre-live-qualification.js";
import {
	admitD11ProviderEffectEnvelope,
	createD11TransportFailureAuthority,
	D11_TRANSPORT_CAUSES,
	D11_TRANSPORT_ENVELOPE_SCHEMA,
	executeD11TransportBoundary,
	takeD11ProviderEffect,
} from "../../evals/empirical-memory-rerun-avoidance/d11-current-transport-failure-authority.js";

const RAW_SENTINEL = "D11_RAW_TRANSPORT_MATERIAL_MUST_NOT_PERSIST";

function localResult(effect: CurrentGraphProviderAdmittedEffectV1) {
	const evidenceDigest = empiricalStrictJsonDigest({ request: effect.request.requestDigest });
	if (effect.request.effectKind === "materialization")
		return {
			effectKind: "materialization" as const,
			status: "completed" as const,
			workspaceStateDigest: empiricalStrictJsonDigest({ arm: effect.request.arm }),
			evidenceDigest,
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		};
	if (effect.request.effectKind === "cleanup")
		return {
			effectKind: "cleanup" as const,
			status: "completed" as const,
			workspaceStateDigest: effect.request.workspaceStateDigest,
			evidenceDigest,
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		};
	throw new TypeError(`unexpected local effect ${effect.request.effectKind}`);
}

function authorityAtProvider() {
	const authority = createD11TransportFailureAuthority({
		limits: CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: CURRENT_GRAPH_LIVE_TASK,
	});
	const materialization = takeD11ProviderEffect(authority)!;
	admitD11ProviderEffectEnvelope(authority, materialization.request.requestDigest, {
		schemaVersion: D11_TRANSPORT_ENVELOPE_SCHEMA,
		result: localResult(materialization),
		transportProposal: null,
	});
	return { authority, provider: takeD11ProviderEffect(authority)! };
}

async function connectEnvelope(effect: CurrentGraphProviderAdmittedEffectV1) {
	return executeD11TransportBoundary({
		effect,
		phase: "request",
		invoke: async () => {
			throw Object.freeze({ code: "UND_ERR_CONNECT_TIMEOUT", raw: RAW_SENTINEL });
		},
	});
}

describe("graphrefly-ts:D11 Graph-admitted transport failure", () => {
	it("admits an exact conservative transport fact and keeps raw error material out", async () => {
		const { authority, provider } = authorityAtProvider();
		const envelope = await connectEnvelope(provider);
		const outcome = admitD11ProviderEffectEnvelope(
			authority,
			provider.request.requestDigest,
			envelope,
		);
		expect(outcome.transportFact?.causeCode).toBe("connect-timeout");
		expect(outcome.providerOutcome.providerFact.result.status).toBe("failed");
		expect(JSON.stringify(outcome)).not.toContain(RAW_SENTINEL);
		const cleanup = takeD11ProviderEffect(authority)!;
		expect(cleanup.request.effectKind).toBe("cleanup");
		admitD11ProviderEffectEnvelope(authority, cleanup.request.requestDigest, {
			schemaVersion: D11_TRANSPORT_ENVELOPE_SCHEMA,
			result: localResult(cleanup),
			transportProposal: null,
		});
		const next = takeD11ProviderEffect(authority)!;
		expect(next.request.arm).toBe("relevant-applied");
	});

	it("rejects forged/replayed proposals, accessors, request substitution, caller cancellation and unknown errors", async () => {
		const first = authorityAtProvider();
		const envelope = await connectEnvelope(first.provider);
		admitD11ProviderEffectEnvelope(first.authority, first.provider.request.requestDigest, envelope);

		const second = authorityAtProvider();
		expect(() =>
			admitD11ProviderEffectEnvelope(
				second.authority,
				second.provider.request.requestDigest,
				envelope,
			),
		).toThrow(/forged or replayed/);

		const third = authorityAtProvider();
		const freshEnvelope = await connectEnvelope(third.provider);
		const forged = structuredClone(freshEnvelope);
		expect(() =>
			admitD11ProviderEffectEnvelope(third.authority, third.provider.request.requestDigest, forged),
		).toThrow(/forged or replayed/);

		let getterCalls = 0;
		const accessor = {} as Record<string, unknown>;
		Object.defineProperty(accessor, "schemaVersion", {
			enumerable: true,
			get() {
				getterCalls += 1;
				return D11_TRANSPORT_ENVELOPE_SCHEMA;
			},
		});
		expect(() =>
			admitD11ProviderEffectEnvelope(
				third.authority,
				empiricalStrictJsonDigest({ wrong: true }),
				accessor,
			),
		).toThrow(/does not match/);
		expect(getterCalls).toBe(0);

		const caller = new AbortController();
		caller.abort();
		await expect(
			executeD11TransportBoundary({
				effect: third.provider,
				phase: "request",
				callerSignal: caller.signal,
				invoke: async () => {
					throw new DOMException("cancelled", "AbortError");
				},
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		await expect(
			executeD11TransportBoundary({
				effect: third.provider,
				phase: "request",
				invoke: async () => {
					throw Object.freeze({ code: "UNKNOWN" });
				},
			}),
		).rejects.toMatchObject({ code: "UNKNOWN" });
		await expect(
			executeD11TransportBoundary({
				effect: third.provider,
				phase: "request",
				invoke: async () => {
					throw Object.freeze({ code: "ECONNRESET" });
				},
			}),
		).rejects.toMatchObject({ code: "ECONNRESET" });

		const deadlineEnvelope = await executeD11TransportBoundary({
			effect: third.provider,
			phase: "response-body",
			scheduleTimeout: (callback) => {
				callback();
				return () => undefined;
			},
			invoke: async () => ({
				effectKind: "provider-request",
				status: "completed",
				toolCalls: [{ toolRef: "read-file", path: "package.json" }],
				failureCode: null,
				retryProposal: null,
				usage: {
					requests: 1,
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					costBasis: "reported",
				},
				evidenceDigest: empiricalStrictJsonDigest({ completedAfterDeadline: true }),
			}),
		});
		expect(deadlineEnvelope.transportProposal?.causeCode).toBe("owned-deadline");
	});

	it("qualifies all transport causes, transparent success and unchanged bounded retries", async () => {
		const bundle = await runD11InjectedNoNetworkQualification({
			baseline: createD11InjectedBaselineForTest(),
			implementationManifestDigest: D11_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const validated = validateD11QualificationBundle(bundle);
		expect(validated.transportEvidence.transportFacts.map((fact) => fact.causeCode)).toEqual(
			D11_TRANSPORT_CAUSES,
		);
		expect(validated.qualification.retryWaits).toBe(6);
		expect(validated.qualification.providerNetworkCalls).toBe(0);
		expect(
			validated.transparentEvidence.d9Evidence.providerEvidence.workflowEvidence.runs,
		).toHaveLength(6);

		const factSubstitution = structuredClone(bundle);
		factSubstitution.transportEvidence.transportFacts[0]!.arm = "relevant-applied";
		expect(() => validateD11QualificationBundle(factSubstitution)).toThrow();
		const qualificationSubstitution = structuredClone(bundle);
		qualificationSubstitution.qualification.phaseCauseCoverage[0] = "request:owned-deadline";
		expect(() => validateD11QualificationBundle(qualificationSubstitution)).toThrow();
		const generationSubstitution = structuredClone(bundle);
		generationSubstitution.generation.efficacyClaim = "forged" as never;
		expect(() => validateD11QualificationBundle(generationSubstitution)).toThrow();
	}, 20_000);

	it("persists atomically as private evidence and rejects same-process replay", async () => {
		const bundle = await runD11InjectedNoNetworkQualification({
			baseline: createD11InjectedBaselineForTest(),
			implementationManifestDigest: D11_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const privateRoot = await realpath(
			await mkdtemp(join(tmpdir(), "graphrefly-d11-qualification-")),
		);
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD11InjectedQualificationForTest({ privateRoot, bundle });
			const generationRoot = join(privateRoot, D11_INJECTED_TEST_GENERATION_REF);
			expect((await stat(generationRoot)).mode & 0o777).toBe(0o700);
			for (const file of [
				"artifacts/bundle.v1.json",
				"artifacts/generation.v1.json",
				"artifacts/qualification.v1.json",
				"commit.v1.json",
			])
				expect((await stat(join(generationRoot, file))).mode & 0o777).toBe(0o600);
			const bytes = await readFile(join(generationRoot, "artifacts/bundle.v1.json"));
			expect(
				JSON.stringify(validateD11QualificationBundle(JSON.parse(bytes.toString()))),
			).not.toContain(RAW_SENTINEL);
			expect(receipt.generationRef).toBe(D11_INJECTED_TEST_GENERATION_REF);
			await expect(persistD11InjectedQualificationForTest({ privateRoot, bundle })).rejects.toThrow(
				/same-process/,
			);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 20_000);

	it("binds qualification to the exact current implementation closure", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD11Implementation(repositoryRoot)).toBe(D11_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
