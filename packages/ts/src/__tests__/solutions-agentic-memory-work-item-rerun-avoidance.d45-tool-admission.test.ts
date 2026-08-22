import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { createD43PolicyCatalog } from "../../evals/empirical-memory-rerun-avoidance/d43-model-harness-policy.js";
import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	readD45ToolArguments,
	snapshotD45PartialCanonicalEvidence,
	takeD45AdmittedEffect,
	validateD45CanonicalEvidence,
	validateD45PartialCanonicalEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d45-graph-tool-authority.js";
import {
	canonicalReplayD45Qualification,
	createD45QualificationPolicy,
	D45_ASSIGNMENT,
	D45_PARTIAL_GENERATION_REF,
	D45_QUALIFICATION_GENERATION_REF,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
	persistD45PartialEvidence,
	persistD45Qualification,
	runD45InjectedNoNetworkQualification,
	validateD45QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d45-graph-tool-qualification.js";
import {
	D45_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD45Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d45-implementation-manifest.js";
import {
	classifyD45ChatTransportFailure,
	lowerD45ProviderEffect,
	parseD45ChatProviderResponse,
} from "../../evals/empirical-memory-rerun-avoidance/d45-mechanical-chat-adapter.js";

function authority() {
	const policy = createD45QualificationPolicy();
	return createD45GraphToolAuthority({
		catalog: createD43PolicyCatalog([policy]),
		assignment: D45_ASSIGNMENT,
		readablePaths: D45_READABLE_PATHS,
		writablePath: D45_WRITABLE_PATH,
		taskMaterial: D45_TASK_MATERIAL,
		routeProfile: { reasoningEffort: "high", requireParameters: true },
		campaign: policy.campaign,
	});
}

function localSuccess(state: string) {
	return {
		effectKind: "local-effect" as const,
		outcome: "success" as const,
		elapsedMs: 1,
		evidenceDigest: empiricalStrictJsonDigest({ state }),
		workspaceStateDigest: state,
		criteria: null,
	};
}

describe("graphrefly-ts:D61 Graph-owned semantic evidence and tool admission", () => {
	it("qualifies six complete six-arm scenarios with material-free canonical evidence", async () => {
		const bundle = validateD45QualificationBundle(await runD45InjectedNoNetworkQualification());
		expect(bundle.qualification.exactSixArmScenarios).toBe(6);
		expect(bundle.qualification.boundedSemanticCorrectionQualified).toBe(true);
		expect(bundle.qualification.independentPublicSemanticEvidenceQualified).toBe(true);
		expect(bundle.qualification.boundedFreshMutationCorrectionQualified).toBe(true);
		expect(bundle.qualification.mutationProposalContractQualified).toBe(true);
		expect(bundle.qualification.mainFrozenGateWouldPass).toBe(true);
		expect(bundle.qualification.proposalToolBijection).toBe(true);
		expect(bundle.qualification.allProposalRejectionCodesObserved).toBe(true);
		expect(bundle.qualification.exactReplacementRejectionsObserved).toBe(true);
		expect(bundle.qualification.exactRetryWireIdentity).toBe(true);
		expect(bundle.qualification.failureSixArmsCompleted).toBe(true);
		expect(bundle.qualification.cleanupCompletedAfterFailure).toBe(true);
		expect(bundle.qualification.conservativeReservationObserved).toBe(true);
		expect(bundle.qualification.partialCanonicalEvidenceValidated).toBe(true);
		expect(bundle.qualification.partialAtomicPersistenceQualified).toBe(true);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(bundle.qualification.credentialReads).toBe(0);
		expect(bundle.qualification.dispatchClaims).toBe(0);
		expect(bundle.qualification.efficacyClaim).toBe("none");
		expect(canonicalReplayD45Qualification(bundle)).toEqual(bundle);
		const persisted = JSON.stringify(bundle);
		expect(persisted).not.toContain("assertProducerOwnedCanonicalProposal");
		expect(persisted).not.toContain("const canonicalProposal = candidate.proposalRef");
	}, 120_000);

	it("requires one-shot Graph material capabilities and exact workspace freshness", () => {
		const graphAuthority = authority();
		const materialization = takeD45AdmittedEffect(graphAuthority)!;
		const state = `sha256:${"1".repeat(64)}`;
		admitD45EffectResult(graphAuthority, materialization, localSuccess(state));
		const inspection = takeD45AdmittedEffect(graphAuthority)!;
		const wire = lowerD45ProviderEffect(graphAuthority, inspection);
		expect(() => lowerD45ProviderEffect(graphAuthority, inspection)).toThrow(/one-shot/);
		admitD45EffectResult(graphAuthority, inspection, {
			effectKind: "provider-proposal",
			outcome: "success",
			elapsedMs: 1,
			costMicrousd: 1,
			usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
			wireDigest: wire.wireDigest,
			retryClass: null,
			proposal: { toolCalls: [{ toolRef: "read-file", path: D45_WRITABLE_PATH }] },
		});
		const freshness = takeD45AdmittedEffect(graphAuthority)!;
		expect(freshness.effectKind).toBe("workspace-freshness");
		admitD45EffectResult(graphAuthority, freshness, {
			effectKind: "workspace-freshness",
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest("freshness"),
			observedWorkspaceStateDigest: state,
		});
		const read = takeD45AdmittedEffect(graphAuthority)!;
		const argumentsValue = readD45ToolArguments(graphAuthority, read);
		expect(argumentsValue).toEqual({ toolRef: "read-file", path: D45_WRITABLE_PATH });
		expect(() => readD45ToolArguments(graphAuthority, read)).toThrow(/one-shot/);
		expect(() =>
			admitD45EffectResult(graphAuthority, read, {
				effectKind: "tool-action",
				status: "success",
				causeCode: null,
				elapsedMs: 1,
				evidenceDigest: empiricalStrictJsonDigest("stale"),
				workspaceStateBeforeDigest: `sha256:${"2".repeat(64)}`,
				workspaceStateAfterDigest: `sha256:${"2".repeat(64)}`,
				content: "bounded",
			}),
		).toThrow(/stale workspace state/);
		admitD45EffectResult(graphAuthority, read, {
			effectKind: "tool-action",
			status: "success",
			causeCode: null,
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest("fresh"),
			workspaceStateBeforeDigest: state,
			workspaceStateAfterDigest: state,
			content: "bounded",
		});
		expect(() => admitD45EffectResult(graphAuthority, read, {} as never)).toThrow(/replayed/);
	});

	it("rejects stale workspace before releasing the exact tool effect", () => {
		const graphAuthority = authority();
		const state = `sha256:${"3".repeat(64)}`;
		const materialization = takeD45AdmittedEffect(graphAuthority)!;
		admitD45EffectResult(graphAuthority, materialization, localSuccess(state));
		const inspection = takeD45AdmittedEffect(graphAuthority)!;
		const wire = lowerD45ProviderEffect(graphAuthority, inspection);
		admitD45EffectResult(graphAuthority, inspection, {
			effectKind: "provider-proposal",
			outcome: "success",
			elapsedMs: 1,
			costMicrousd: 1,
			usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
			wireDigest: wire.wireDigest,
			retryClass: null,
			proposal: { toolCalls: [{ toolRef: "read-file", path: D45_WRITABLE_PATH }] },
		});
		const freshness = takeD45AdmittedEffect(graphAuthority)!;
		admitD45EffectResult(graphAuthority, freshness, {
			effectKind: "workspace-freshness",
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest("stale-freshness"),
			observedWorkspaceStateDigest: `sha256:${"4".repeat(64)}`,
		});
		const next = takeD45AdmittedEffect(graphAuthority)!;
		expect(next.sourceD43EffectKind).not.toBe("inspection");
		expect(next.effectKind).not.toBe("tool-action");
	});

	it("rejects canonical accessor injection even when the attacker recomputes the fact digest", async () => {
		const evidence = (await runD45InjectedNoNetworkQualification()).mainEvidence;
		const forged = structuredClone(evidence) as unknown as Record<string, unknown>;
		const facts = forged.facts as Array<Record<string, unknown>>;
		const first = facts[0]!;
		first.rawContent = "secret";
		const { factDigest: _old, ...material } = first;
		first.factDigest = empiricalStrictJsonDigest(material);
		const { evidenceDigest: _evidence, ...evidenceMaterial } = forged;
		forged.evidenceDigest = empiricalStrictJsonDigest(evidenceMaterial);
		expect(() => validateD45CanonicalEvidence(forged)).toThrow();
	});

	it("mechanically bounds raw Chat tool proposals and classifies only eligible 429 retry", () => {
		const pricing = {
			inputMicrousdPerMillionTokens: 80_000,
			outputMicrousdPerMillionTokens: 180_000,
			cacheReadMicrousdPerMillionTokens: 16_000,
		};
		const bytes = new TextEncoder().encode(
			JSON.stringify({
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							tool_calls: [
								{
									function: {
										name: "read_file",
										arguments: JSON.stringify({ path: D45_WRITABLE_PATH }),
									},
								},
							],
						},
					},
				],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 20,
					prompt_tokens_details: { cached_tokens: 10 },
				},
			}),
		);
		const parsed = parseD45ChatProviderResponse({
			status: 200,
			bytes,
			elapsedMs: 9,
			wireDigest: empiricalStrictJsonDigest("wire"),
			pricing,
		});
		expect(parsed.outcome).toBe("success");
		expect(parsed.proposal?.toolCalls).toEqual([{ toolRef: "read-file", path: D45_WRITABLE_PATH }]);
		expect(parsed.costMicrousd).toBe(11);
		const retry = parseD45ChatProviderResponse({
			status: 429,
			bytes: new TextEncoder().encode(JSON.stringify({ error: { message: "bounded" } })),
			elapsedMs: 3,
			wireDigest: empiricalStrictJsonDigest("429-wire"),
			pricing,
		});
		expect(retry.retryClass).toBe("D710");
		const typed = parseD45ChatProviderResponse({
			status: 429,
			bytes: new TextEncoder().encode(JSON.stringify({ error: { code: "quota" } })),
			elapsedMs: 3,
			wireDigest: empiricalStrictJsonDigest("typed-429-wire"),
			pricing,
		});
		expect(typed.outcome).toBe("provider-rejected");
		expect(typed.retryClass).toBeNull();
		const overloaded = parseD45ChatProviderResponse({
			status: 503,
			bytes: new TextEncoder().encode(JSON.stringify({ error: { type: "provider_overloaded" } })),
			elapsedMs: 3,
			wireDigest: empiricalStrictJsonDigest("overloaded-wire"),
			pricing,
		});
		expect(overloaded.retryClass).toBe("D671");
		const malformedMutation = parseD45ChatProviderResponse({
			status: 200,
			bytes: new TextEncoder().encode(
				JSON.stringify({
					choices: [
						{
							finish_reason: "tool_calls",
							message: {
								tool_calls: [
									{
										function: {
											name: "replace_exact",
											arguments: JSON.stringify({ path: D45_WRITABLE_PATH }),
										},
									},
								],
							},
						},
					],
					usage: { prompt_tokens: 8_795, completion_tokens: 9_252 },
				}),
			),
			elapsedMs: 111_800,
			wireDigest: empiricalStrictJsonDigest("malformed-mutation-wire"),
			pricing,
		});
		expect(malformedMutation).toMatchObject({
			outcome: "schema-rejected",
			proposal: null,
			usage: { inputTokens: 8_795, outputTokens: 9_252, cacheReadTokens: 0 },
		});
		expect(() => JSON.stringify(malformedMutation)).not.toThrow();
		const extraMutation = parseD45ChatProviderResponse({
			status: 200,
			bytes: new TextEncoder().encode(
				JSON.stringify({
					choices: [
						{
							finish_reason: "tool_calls",
							message: {
								tool_calls: [
									{
										function: {
											name: "replace_exact",
											arguments: JSON.stringify({
												path: D45_WRITABLE_PATH,
												oldText: "old",
												newText: "new",
												unexpected: true,
											}),
										},
									},
								],
							},
						},
					],
					usage: { prompt_tokens: 100, completion_tokens: 20 },
				}),
			),
			elapsedMs: 20,
			wireDigest: empiricalStrictJsonDigest("extra-mutation-wire"),
			pricing,
		});
		expect(extraMutation).toMatchObject({ outcome: "schema-rejected", proposal: null });
		const socket = Object.assign(new TypeError("sanitized"), {
			cause: Object.assign(new Error("sanitized"), { code: "UND_ERR_SOCKET" }),
		});
		expect(
			classifyD45ChatTransportFailure({
				error: socket,
				elapsedMs: 3,
				wireDigest: empiricalStrictJsonDigest("socket-wire"),
			}).retryClass,
		).toBe("D675");
	});

	it("derives interrupted-effect causes and conservative active reservations from Graph state", () => {
		const localAuthority = authority();
		const local = takeD45AdmittedEffect(localAuthority)!;
		expect(local.effectKind).toBe("local-effect");
		const localPartial = validateD45PartialCanonicalEvidence(
			snapshotD45PartialCanonicalEvidence(localAuthority),
		);
		expect(localPartial.terminalCauseCode).toBe("local-effect-interrupted");
		expect(localPartial.budget.confirmedElapsedMs).toBe(local.elapsedReservationMs);

		const providerAuthority = authority();
		const materialization = takeD45AdmittedEffect(providerAuthority)!;
		admitD45EffectResult(
			providerAuthority,
			materialization,
			localSuccess(empiricalStrictJsonDigest("provider-partial-workspace")),
		);
		const provider = takeD45AdmittedEffect(providerAuthority)!;
		lowerD45ProviderEffect(providerAuthority, provider);
		const providerPartial = validateD45PartialCanonicalEvidence(
			snapshotD45PartialCanonicalEvidence(providerAuthority),
		);
		expect(providerPartial.terminalCauseCode).toBe("provider-interrupted");
		expect(providerPartial.budget.providerAttempts).toBe(1);
		expect(providerPartial.budget.confirmedCostMicrousd).toBe(provider.providerReservationMicrousd);
	});

	it("persists one qualification atomically and refuses overwrite", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d45-persist-"));
		await chmod(root, 0o700);
		try {
			const bundle = await runD45InjectedNoNetworkQualification();
			const receipt = await persistD45Qualification({ privateRoot: root, bundle });
			expect(receipt.bundleArtifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
			await expect(persistD45Qualification({ privateRoot: root, bundle })).rejects.toThrow();
			const bytes = await readFile(join(root, D45_QUALIFICATION_GENERATION_REF, "bundle.v1.json"));
			expect(bytes.byteLength).toBeGreaterThan(0);
			const partialRoot = await mkdtemp(join(tmpdir(), "graphrefly-d45-partial-persist-"));
			try {
				const partialReceipt = await persistD45PartialEvidence({
					privateRoot: partialRoot,
					evidence: bundle.partialEvidence,
				});
				expect(partialReceipt.evidenceArtifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
				expect(
					await readFile(join(partialRoot, D45_PARTIAL_GENERATION_REF, "commit.v1.json")),
				).not.toHaveLength(0);
			} finally {
				await rm(partialRoot, { recursive: true, force: true });
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("binds every current runtime source and imports no D1-D42 runtime module", async () => {
		expect(await measureD45Implementation()).toBe(D45_IMPLEMENTATION_MANIFEST_DIGEST);
		const root = new URL("../../evals/empirical-memory-rerun-avoidance/", import.meta.url);
		for (const file of [
			"d45-graph-tool-authority.ts",
			"d45-mechanical-chat-adapter.ts",
			"d45-graph-tool-qualification.ts",
			"d45-implementation-manifest.ts",
		]) {
			const source = await readFile(new URL(file, root), "utf8");
			expect(source).not.toMatch(/from "\.\/d(?:[1-9]|[1-3]\d|4[0-2])-/u);
		}
	});
});
