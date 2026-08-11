import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
} from "../../evals/empirical-memory-rerun-avoidance/d712-pricing-schedule.js";
import { createD713CurrentKeyExecutionAdmission } from "../../evals/empirical-memory-rerun-avoidance/d713-current-key-execution-admission.js";
import {
	createD713PreflightCapability,
	D713_APPROVAL_REF,
	D713_APPROVAL_REVISION,
	D713_CLAIM_BOUNDARY,
	D713_PRICING_REVISION,
} from "../../evals/empirical-memory-rerun-avoidance/d713-fresh-pricing-live.js";
import {
	D713_LIVE_ATTEMPT_RECEIPT_FILE,
	persistD713LiveAttemptReceipt,
} from "../../evals/empirical-memory-rerun-avoidance/d713-live-attempt-receipt.js";
import { runD713OrderedLiveAdmissions } from "../../evals/empirical-memory-rerun-avoidance/d713-live-orchestration.js";
import {
	consumeD713OfficialPricingRead,
	readD713OfficialPricing,
	validateD713OfficialPricingRead,
} from "../../evals/empirical-memory-rerun-avoidance/d713-official-pricing-live.js";
import {
	assertD713QualifiedLiveImplementation,
	D713_QUALIFIED_NODE_VERSION,
} from "../../evals/empirical-memory-rerun-avoidance/d713-qualified-live-entrypoint.js";
import {
	acquireD713SingleUseDispatchClaimAtPrivateRoot,
	consumeD713SingleUseDispatchClaim,
	consumePersistedD713DispatchClaimForExecutionAtPrivateRoot,
	D713_LIVE_GENERATION_REF,
	D713_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY,
} from "../../evals/empirical-memory-rerun-avoidance/d713-single-use-dispatch-claim.js";
import {
	consumeD713FreshZeroByokQualification,
	createD713ZeroByokChallenge,
	D713_ZERO_BYOK_ATTESTATION_FILE,
	D713_ZERO_BYOK_ATTESTATION_SCHEMA,
	D713_ZERO_BYOK_QUALIFICATION_REVISION,
	D713_ZERO_BYOK_WORKSPACE_REVISION,
	readD713FreshZeroByokQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d713-zero-byok-qualification.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";
import { OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE } from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";
import { strictJsonCodec } from "../../src/json/codec.js";

const encoder = new TextEncoder();

function pricingBytes(overrides: Record<string, unknown> = {}): Uint8Array {
	return encoder.encode(
		JSON.stringify({
			data: {
				id: "deepseek/deepseek-v4-flash",
				endpoints: [
					{
						provider_name: "DeepInfra",
						tag: "deepinfra/fp4",
						quantization: "fp4",
						pricing: {
							prompt: "0.00000009",
							completion: "0.00000018",
							input_cache_read: "0.000000018",
						},
						...overrides,
					},
				],
			},
		}),
	);
}

function routePricing() {
	return {
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		pricingRevision: D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		currency: "USD" as const,
		inputMicrousdPerMillionTokens: D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
		outputMicrousdPerMillionTokens: D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	};
}

function response(
	body = pricingBytes(),
	overrides: { status?: number; url?: string } = {},
): Response {
	const value = new Response(body, {
		status: overrides.status ?? 200,
		headers: { "content-type": "application/json", "content-length": String(body.byteLength) },
	});
	Object.defineProperty(value, "url", {
		value: overrides.url ?? OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	});
	return value;
}

async function privateRoot() {
	const container = await mkdtemp(join(tmpdir(), "graphrefly-d713-claim-"));
	const root = join(container, ".private", "empirical-memory-rerun-avoidance");
	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
	return { container, root };
}

const testCredential = Object.freeze({
	bearerToken: "test-bearer-token-long-enough",
	credentialBindingRef: "credential.ref",
	credentialBindingRevision: "credential.revision",
});

async function currentKeyExecutionAdmission() {
	const admission = await createOpenRouterCurrentKeySpendAdmissionCapability({
		fetch: async () =>
			new Response(
				JSON.stringify({
					data: {
						limit: 32,
						limit_remaining: 31,
						usage: 1,
						limit_reset: null,
						is_management_key: false,
					},
				}),
				{ status: 200 },
			),
	}).read({
		credential: testCredential,
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: new AbortController().signal,
	});
	return createD713CurrentKeyExecutionAdmission({ admission, credential: testCredential });
}

describe("D713 fresh-pricing-separated live authority", () => {
	it("freezes the numeric authority under the distinct v4 route revision", () => {
		expect(D713_APPROVAL_REF).toBe("decision.D713");
		expect(D713_APPROVAL_REVISION).toBe("decision.D713.2026-08-10.v1");
		expect(D713_CLAIM_BOUNDARY).toContain("no-efficacy-claim");
		expect(D713_PRICING_REVISION).toBe(D712_DEEPSEEK_V4_FLASH_PRICING_REVISION);
		expect(D713_LIVE_GENERATION_REF).toContain("d713");
	});

	it("keeps the consumed D713 implementation gate closed after later source-tree work", async () => {
		const repositoryRoot = join(import.meta.dirname, "../../../..");
		const privateOperatorRoot = join(
			import.meta.dirname,
			"../../evals/.private/empirical-memory-rerun-avoidance",
		);
		await expect(
			assertD713QualifiedLiveImplementation({
				repositoryRoot,
				privateOperatorRoot,
				nodeVersion: D713_QUALIFIED_NODE_VERSION,
			}),
		).rejects.toThrow(/source tree drifted/);
		await expect(
			assertD713QualifiedLiveImplementation({
				repositoryRoot,
				privateOperatorRoot,
				nodeVersion: "v0.0.0",
			}),
		).rejects.toThrow(/Node toolchain/);
	});

	it("binds one exact official GET to the frozen schedule without exposing response bytes", async () => {
		const fetch = vi.fn(async () => response());
		const read = await readD713OfficialPricing({
			fetch: fetch as typeof globalThis.fetch,
			monotonicNowMs: () => 1_000,
			routePricing: routePricing(),
			signal: new AbortController().signal,
		});
		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({
			method: "GET",
			redirect: "error",
			cache: "no-store",
			credentials: "omit",
			referrerPolicy: "no-referrer",
		});
		expect(read).toMatchObject({
			executionClass: "live-control-plane",
			status: 200,
			redirected: false,
			frozenScheduleRevision: D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
			networkCalls: 1,
			providerCalls: 0,
		});
		expect(validateD713OfficialPricingRead(structuredClone(read))).toEqual(read);
		expect(JSON.stringify(read)).not.toContain("provider_name");
		expect(JSON.stringify(read)).not.toContain("0.00000009");
		expect(consumeD713OfficialPricingRead(read).match.frozenScheduleRevision).toBe(
			D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		);
		expect(() => consumeD713OfficialPricingRead(read)).toThrow(/reused/);
	});

	it("fails pricing drift, redirect/final-url drift, status and oversized bodies before a claim", async () => {
		await expect(
			readD713OfficialPricing({
				fetch: vi.fn(async () => response(pricingBytes({ tag: "deepinfra/fp8" }))) as never,
				monotonicNowMs: () => 1_000,
				routePricing: routePricing(),
				signal: new AbortController().signal,
			}),
		).rejects.toThrow();
		await expect(
			readD713OfficialPricing({
				fetch: vi.fn(async () => response(pricingBytes(), { status: 503 })) as never,
				monotonicNowMs: () => 1_000,
				routePricing: routePricing(),
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/status/);
		await expect(
			readD713OfficialPricing({
				fetch: vi.fn(async () =>
					response(pricingBytes(), { url: "https://example.com/" }),
				) as never,
				monotonicNowMs: () => 1_000,
				routePricing: routePricing(),
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/url/);
		const oversized = new Uint8Array(1_048_577);
		await expect(
			readD713OfficialPricing({
				fetch: vi.fn(async () => response(oversized)) as never,
				monotonicNowMs: () => 1_000,
				routePricing: routePricing(),
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/content length|byte bound/);
	});

	it("rejects accessor and caller-input substitution without invoking the pricing transport", async () => {
		let getterHits = 0;
		const fetch = vi.fn(async () => response());
		const accessor = Object.defineProperty(
			{
				monotonicNowMs: () => 1_000,
				routePricing: routePricing(),
				signal: new AbortController().signal,
			},
			"fetch",
			{
				enumerable: true,
				get() {
					getterHits += 1;
					return fetch;
				},
			},
		);
		await expect(readD713OfficialPricing(accessor as never)).rejects.toThrow(/data property/);
		expect(getterHits).toBe(0);
		expect(fetch).not.toHaveBeenCalled();

		const input = {
			fetch: fetch as typeof globalThis.fetch,
			monotonicNowMs: () => 1_000,
			routePricing: routePricing(),
			signal: new AbortController().signal,
		};
		const pending = readD713OfficialPricing(input);
		input.fetch = vi.fn(async () => {
			throw new Error("substituted");
		}) as typeof globalThis.fetch;
		input.routePricing = { ...routePricing(), pricingRevision: "substituted" as never };
		await expect(pending).resolves.toMatchObject({ status: 200, networkCalls: 1 });
	});

	it("atomically grants only one cross-process-shaped D713 claim", async () => {
		const { container, root } = await privateRoot();
		try {
			const contenders = await Promise.allSettled([
				acquireD713SingleUseDispatchClaimAtPrivateRoot(root),
				acquireD713SingleUseDispatchClaimAtPrivateRoot(root),
			]);
			expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(1);
			const acquired = contenders.find(
				(
					result,
				): result is PromiseFulfilledResult<
					Awaited<ReturnType<typeof acquireD713SingleUseDispatchClaimAtPrivateRoot>>
				> => result.status === "fulfilled",
			)?.value;
			expect(acquired).toBeDefined();
			expect(() => consumeD713SingleUseDispatchClaim(acquired)).toThrow(/single-use/);
			const persisted = await consumePersistedD713DispatchClaimForExecutionAtPrivateRoot(
				root,
				await currentKeyExecutionAdmission(),
			);
			expect(() => consumeD713SingleUseDispatchClaim(persisted)).not.toThrow();
			await expect(
				consumePersistedD713DispatchClaimForExecutionAtPrivateRoot(
					root,
					await currentKeyExecutionAdmission(),
				),
			).rejects.toThrow(/terminal decision/);
			const claimPath = join(root, D713_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
			expect((await stat(claimPath)).mode & 0o777).toBe(0o700);
			expect((await stat(join(claimPath, "dispatch-claim.v1.json"))).mode & 0o777).toBe(0o600);
			expect(
				JSON.parse(await readFile(join(claimPath, "dispatch-claim.v1.json"), "utf8")),
			).toMatchObject({
				decisionRef: D713_APPROVAL_REF,
				maxSpendMicrousd: 6_000_000,
				noResetTotalLimitMicrousd: 32_000_000,
			});
			await persistD713LiveAttemptReceipt({
				claim: acquired!,
				terminalStatus: "failed",
				terminalPhase: "provider-block",
				currentKeyNetworkCalls: 1,
				currentKeyAdmission: persisted.currentKeyExecutionAdmission.admission,
				providerTransportCalls: 0,
			});
			expect((await stat(join(claimPath, D713_LIVE_ATTEMPT_RECEIPT_FILE))).mode & 0o777).toBe(
				0o600,
			);
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});

	it("consumes one fresh 0600 zero-BYOK observation bound to the credential workspace", async () => {
		const { container, root } = await privateRoot();
		const path = join(root, D713_ZERO_BYOK_ATTESTATION_FILE);
		try {
			const challenge = createD713ZeroByokChallenge({
				credentialBindingRef: "credential.ref",
				credentialBindingRevision: "credential.revision",
				workspaceRef: "workspace.ref",
				monotonicNowMs: 1_000,
			});
			const material = {
				schemaVersion: D713_ZERO_BYOK_ATTESTATION_SCHEMA,
				decisionRef: "decision.D713" as const,
				decisionRevision: "decision.D713.2026-08-10.v1" as const,
				observationSource: "openrouter-settings-read-only" as const,
				challengeNonce: challenge.nonce,
				workspaceSlug: "graph-re-fly" as const,
				keyName: "Local Eval 2" as const,
				keyEnabled: true as const,
				byokProviderCount: 65,
				byokConfiguredCredentialCount: 0 as const,
				credentialBindingRef: "credential.ref",
				credentialBindingRevision: "credential.revision",
				workspaceRef: "workspace.ref",
				workspaceRevision: D713_ZERO_BYOK_WORKSPACE_REVISION,
				qualificationRevision: D713_ZERO_BYOK_QUALIFICATION_REVISION,
			};
			await writeFile(
				path,
				strictJsonCodec.encode({
					...material,
					attestationDigest: empiricalStrictJsonDigest(material),
				}),
				{ mode: 0o600 },
			);
			const qualification = await readD713FreshZeroByokQualification({
				attestationPath: path,
				challenge,
				credentialBindingRef: material.credentialBindingRef,
				credentialBindingRevision: material.credentialBindingRevision,
				workspaceRef: material.workspaceRef,
				signal: new AbortController().signal,
				monotonicNowMs: 1_001,
			});
			expect(qualification.attestation).toMatchObject({
				byokProviderCount: 65,
				byokConfiguredCredentialCount: 0,
			});
			expect(qualification.sharedCapacityQualification.byokCredentialCount).toBe(0);
			expect(consumeD713FreshZeroByokQualification(qualification)).toBe(qualification);
			expect(() => consumeD713FreshZeroByokQualification(qualification)).toThrow(/fresh/);
			await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});

	it("locks pricing, credential, zero-BYOK, claim, current-key, then serial provider order", async () => {
		const events: string[] = [];
		const result = await runD713OrderedLiveAdmissions({
			readFreshPricing() {
				events.push("pricing");
				return "pricing";
			},
			loadCredential() {
				events.push("credential");
				return "credential";
			},
			readFreshZeroByok() {
				events.push("zero-byok");
				return "zero-byok";
			},
			acquireDispatchClaim() {
				events.push("claim");
				return "claim";
			},
			readCurrentKey() {
				events.push("current-key");
				return "current-key";
			},
			runSerialProvider() {
				events.push("provider");
				return "result";
			},
			async onPostClaimFailure() {
				events.push("failure-receipt");
			},
		});
		expect(events).toEqual([
			"pricing",
			"credential",
			"zero-byok",
			"claim",
			"current-key",
			"provider",
		]);
		expect(result.providerResult).toBe("result");

		events.length = 0;
		await expect(
			runD713OrderedLiveAdmissions({
				readFreshPricing() {
					events.push("pricing");
					throw new Error("pricing failed");
				},
				loadCredential() {
					events.push("credential");
				},
				readFreshZeroByok() {
					events.push("zero-byok");
				},
				acquireDispatchClaim() {
					events.push("claim");
				},
				readCurrentKey() {
					events.push("current-key");
				},
				runSerialProvider() {
					events.push("provider");
				},
				async onPostClaimFailure() {
					events.push("failure-receipt");
				},
			}),
		).rejects.toThrow(/pricing failed/);
		expect(events).toEqual(["pricing"]);
	});

	it("rejects a forged D713 preflight before any live block", () => {
		expect(() =>
			createD713PreflightCapability({
				d712QualifiedArtifacts: {},
				d708HistoricalArtifacts: {},
				d709ForensicArtifacts: {},
				d690OfflineEvidence: {},
				d710QualificationArtifacts: {},
				d703DryRunArtifacts: {},
				d703Preflight: {},
				d704ConsumedDispatchHistory: {},
				d705ConsumedDispatchHistory: {},
				executionClass: "live-provider",
				freshPricingRead: {},
				freshZeroByokQualification: {},
			}),
		).toThrow();
	});
});
