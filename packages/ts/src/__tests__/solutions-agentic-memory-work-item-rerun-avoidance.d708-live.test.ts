import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { createD708CurrentKeyExecutionAdmission } from "../../evals/empirical-memory-rerun-avoidance/d708-current-key-execution-admission.js";
import {
	createD708PreflightCapability,
	D708_APPROVAL_REF,
	D708_APPROVAL_REVISION,
	D708_CLAIM_BOUNDARY,
	D708_PRICING_REVISION,
} from "../../evals/empirical-memory-rerun-avoidance/d708-fresh-pricing-live.js";
import {
	D708_LIVE_ATTEMPT_RECEIPT_FILE,
	persistD708LiveAttemptReceipt,
} from "../../evals/empirical-memory-rerun-avoidance/d708-live-attempt-receipt.js";
import { runD708OrderedLiveAdmissions } from "../../evals/empirical-memory-rerun-avoidance/d708-live-orchestration.js";
import {
	consumeD708OfficialPricingRead,
	readD708OfficialPricing,
	validateD708OfficialPricingRead,
} from "../../evals/empirical-memory-rerun-avoidance/d708-official-pricing-live.js";
import {
	acquireD708SingleUseDispatchClaimAtPrivateRoot,
	consumeD708SingleUseDispatchClaim,
	consumePersistedD708DispatchClaimForExecutionAtPrivateRoot,
	D708_LIVE_GENERATION_REF,
	D708_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY,
} from "../../evals/empirical-memory-rerun-avoidance/d708-single-use-dispatch-claim.js";
import {
	consumeD708FreshZeroByokQualification,
	createD708ZeroByokChallenge,
	D708_ZERO_BYOK_ATTESTATION_FILE,
	D708_ZERO_BYOK_ATTESTATION_SCHEMA,
	D708_ZERO_BYOK_QUALIFICATION_REVISION,
	D708_ZERO_BYOK_WORKSPACE_REVISION,
	readD708FreshZeroByokQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d708-zero-byok-qualification.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";
import { strictJsonCodec } from "../../src/json/codec.js";

const encoder = new TextEncoder();

function pricingBytes(overrides: Record<string, unknown> = {}): Uint8Array {
	return encoder.encode(
		JSON.stringify({
			data: {
				id: "deepseek/deepseek-v4-flash-0731",
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
		pricingRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		currency: "USD" as const,
		inputMicrousdPerMillionTokens: OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
		outputMicrousdPerMillionTokens: OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
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
	const container = await mkdtemp(join(tmpdir(), "graphrefly-d708-claim-"));
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
	return createD708CurrentKeyExecutionAdmission({ admission, credential: testCredential });
}

describe("D708 fresh-pricing-separated live authority", () => {
	it("freezes the numeric authority while retaining the immutable v3 route revision", () => {
		expect(D708_APPROVAL_REF).toBe("decision.D708");
		expect(D708_APPROVAL_REVISION).toBe("decision.D708.2026-08-09.v1");
		expect(D708_CLAIM_BOUNDARY).toContain("no-efficacy-claim");
		expect(D708_PRICING_REVISION).toBe(OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION);
		expect(D708_LIVE_GENERATION_REF).toContain("d708");
	});

	it("binds one exact official GET to the frozen schedule without exposing response bytes", async () => {
		const fetch = vi.fn(async () => response());
		const read = await readD708OfficialPricing({
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
			frozenScheduleRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
			networkCalls: 1,
			providerCalls: 0,
		});
		expect(validateD708OfficialPricingRead(structuredClone(read))).toEqual(read);
		expect(JSON.stringify(read)).not.toContain("provider_name");
		expect(JSON.stringify(read)).not.toContain("0.00000009");
		expect(consumeD708OfficialPricingRead(read).match.frozenScheduleRevision).toBe(
			OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		);
		expect(() => consumeD708OfficialPricingRead(read)).toThrow(/reused/);
	});

	it("fails pricing drift, redirect/final-url drift, status and oversized bodies before a claim", async () => {
		await expect(
			readD708OfficialPricing({
				fetch: vi.fn(async () => response(pricingBytes({ tag: "deepinfra/fp8" }))) as never,
				monotonicNowMs: () => 1_000,
				routePricing: routePricing(),
				signal: new AbortController().signal,
			}),
		).rejects.toThrow();
		await expect(
			readD708OfficialPricing({
				fetch: vi.fn(async () => response(pricingBytes(), { status: 503 })) as never,
				monotonicNowMs: () => 1_000,
				routePricing: routePricing(),
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/status/);
		await expect(
			readD708OfficialPricing({
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
			readD708OfficialPricing({
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
		await expect(readD708OfficialPricing(accessor as never)).rejects.toThrow(/data property/);
		expect(getterHits).toBe(0);
		expect(fetch).not.toHaveBeenCalled();

		const input = {
			fetch: fetch as typeof globalThis.fetch,
			monotonicNowMs: () => 1_000,
			routePricing: routePricing(),
			signal: new AbortController().signal,
		};
		const pending = readD708OfficialPricing(input);
		input.fetch = vi.fn(async () => {
			throw new Error("substituted");
		}) as typeof globalThis.fetch;
		input.routePricing = { ...routePricing(), pricingRevision: "substituted" as never };
		await expect(pending).resolves.toMatchObject({ status: 200, networkCalls: 1 });
	});

	it("atomically grants only one cross-process-shaped D708 claim", async () => {
		const { container, root } = await privateRoot();
		try {
			const contenders = await Promise.allSettled([
				acquireD708SingleUseDispatchClaimAtPrivateRoot(root),
				acquireD708SingleUseDispatchClaimAtPrivateRoot(root),
			]);
			expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(1);
			const acquired = contenders.find(
				(
					result,
				): result is PromiseFulfilledResult<
					Awaited<ReturnType<typeof acquireD708SingleUseDispatchClaimAtPrivateRoot>>
				> => result.status === "fulfilled",
			)?.value;
			expect(acquired).toBeDefined();
			expect(() => consumeD708SingleUseDispatchClaim(acquired)).toThrow(/single-use/);
			const persisted = await consumePersistedD708DispatchClaimForExecutionAtPrivateRoot(
				root,
				await currentKeyExecutionAdmission(),
			);
			expect(() => consumeD708SingleUseDispatchClaim(persisted)).not.toThrow();
			await expect(
				consumePersistedD708DispatchClaimForExecutionAtPrivateRoot(
					root,
					await currentKeyExecutionAdmission(),
				),
			).rejects.toThrow(/terminal decision/);
			const claimPath = join(root, D708_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
			expect((await stat(claimPath)).mode & 0o777).toBe(0o700);
			expect((await stat(join(claimPath, "dispatch-claim.v1.json"))).mode & 0o777).toBe(0o600);
			expect(
				JSON.parse(await readFile(join(claimPath, "dispatch-claim.v1.json"), "utf8")),
			).toMatchObject({
				decisionRef: D708_APPROVAL_REF,
				maxSpendMicrousd: 6_000_000,
				noResetTotalLimitMicrousd: 32_000_000,
			});
			await persistD708LiveAttemptReceipt({
				claim: acquired!,
				terminalStatus: "failed",
				terminalPhase: "provider-block",
				currentKeyNetworkCalls: 1,
				currentKeyAdmission: persisted.currentKeyExecutionAdmission.admission,
				providerTransportCalls: 0,
			});
			expect((await stat(join(claimPath, D708_LIVE_ATTEMPT_RECEIPT_FILE))).mode & 0o777).toBe(
				0o600,
			);
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});

	it("consumes one fresh 0600 zero-BYOK observation bound to the credential workspace", async () => {
		const { container, root } = await privateRoot();
		const path = join(root, D708_ZERO_BYOK_ATTESTATION_FILE);
		try {
			const challenge = createD708ZeroByokChallenge({
				credentialBindingRef: "credential.ref",
				credentialBindingRevision: "credential.revision",
				workspaceRef: "workspace.ref",
				monotonicNowMs: 1_000,
			});
			const material = {
				schemaVersion: D708_ZERO_BYOK_ATTESTATION_SCHEMA,
				decisionRef: "decision.D708" as const,
				decisionRevision: "decision.D708.2026-08-09.v1" as const,
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
				workspaceRevision: D708_ZERO_BYOK_WORKSPACE_REVISION,
				qualificationRevision: D708_ZERO_BYOK_QUALIFICATION_REVISION,
			};
			await writeFile(
				path,
				strictJsonCodec.encode({
					...material,
					attestationDigest: empiricalStrictJsonDigest(material),
				}),
				{ mode: 0o600 },
			);
			const qualification = await readD708FreshZeroByokQualification({
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
			expect(consumeD708FreshZeroByokQualification(qualification)).toBe(qualification);
			expect(() => consumeD708FreshZeroByokQualification(qualification)).toThrow(/fresh/);
			await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});

	it("locks pricing, credential, zero-BYOK, claim, current-key, then serial provider order", async () => {
		const events: string[] = [];
		const result = await runD708OrderedLiveAdmissions({
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
			runD708OrderedLiveAdmissions({
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

	it("rejects a forged D708 preflight before any live block", () => {
		expect(() =>
			createD708PreflightCapability({
				d690OfflineEvidence: {},
				d703DryRunArtifacts: {},
				d703Preflight: {},
				d704ConsumedDispatchHistory: {},
				d705ConsumedDispatchHistory: {},
				d707PreLiveArtifacts: {},
				executionClass: "live-provider",
				freshPricingRead: {},
				freshZeroByokQualification: {},
			}),
		).toThrow();
	});
});
