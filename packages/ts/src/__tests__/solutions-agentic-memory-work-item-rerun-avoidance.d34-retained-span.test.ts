import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
	CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
	CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
} from "../../evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.js";
import {
	lowerD34RetainedSpanChatBody,
	projectD34RetainedSpanChatResponse,
} from "../../evals/empirical-memory-rerun-avoidance/d34-retained-span-chat-wire.js";
import {
	D34_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD34Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d34-retained-span-implementation-manifest.js";
import {
	admitD34EffectResult,
	createD34RetainedSpanAuthority,
	snapshotD34RetainedSpanEvidence,
	takeD34AdmittedEffect,
	validateD34RetainedSpanEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d34-retained-span-mutation-authority.js";
import {
	createD34InjectedBaselineForTest,
	persistD34Qualification,
	runD34InjectedNoNetworkQualification,
	validateD34QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d34-retained-span-qualification.js";

const digest = (value: unknown) => empiricalStrictJsonDigest(value);

function usage(label: string) {
	return {
		requests: 1 as const,
		inputTokens: 10,
		outputTokens: 2,
		cacheReadTokens: 0,
		actualCostMicrousd: 1,
		actualElapsedMs: 1,
		costBasis: "reported" as const,
		evidenceDigest: digest(label),
	};
}

function providerResult(label: string, toolCalls: readonly unknown[]) {
	const measured = usage(label);
	return {
		effectKind: "provider-request" as const,
		status: "completed" as const,
		toolCalls,
		failureCode: null,
		retryProposal: null,
		usage: {
			requests: measured.requests,
			inputTokens: measured.inputTokens,
			outputTokens: measured.outputTokens,
			cacheReadTokens: measured.cacheReadTokens,
			actualCostMicrousd: measured.actualCostMicrousd,
			actualElapsedMs: measured.actualElapsedMs,
			costBasis: measured.costBasis,
		},
		evidenceDigest: measured.evidenceDigest,
	};
}

async function runSixArms(
	mode: "qualified" | "second-cardinality" | "content-rejected" | "headroom-denied" = "qualified",
) {
	const authority = createD34RetainedSpanAuthority({
		limits:
			mode === "headroom-denied"
				? { ...CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS, maxElapsedMs: 339_999 }
				: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
		routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
		taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
	});
	const workspaceByArm = new Map<string, string>();
	const cardinalityAttempts = new Map<string, number>();
	const readAttempts = new Map<string, number>();
	for (let guard = 0; guard < 256; guard += 1) {
		const admitted = takeD34AdmittedEffect(authority);
		if (admitted === null) return snapshotD34RetainedSpanEvidence(authority);
		const effect = admitted.effect.effect;
		const request = effect.request;
		const key = `${request.arm}-${request.runSequence}`;
		const current = workspaceByArm.get(key) ?? digest({ key, state: "initial" });
		workspaceByArm.set(key, current);
		if (request.effectKind === "materialization") {
			admitD34EffectResult(authority, admitted, {
				effectKind: "materialization",
				status: "completed",
				workspaceStateDigest: current,
				evidenceDigest: digest({ key, materialized: true }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
			continue;
		}
		if (request.effectKind === "provider-request") {
			if (admitted.retainedSpanDirective !== null) {
				const priorCardinality = cardinalityAttempts.get(key) ?? 0;
				const useCardinality =
					request.arm === "cold" &&
					(mode === "second-cardinality" ? priorCardinality < 2 : priorCardinality < 1);
				if (useCardinality) cardinalityAttempts.set(key, priorCardinality + 1);
				const measured = usage({ key, proposal: useCardinality ? "cardinality" : "accepted" });
				admitD34EffectResult(authority, admitted, {
					effectKind: "provider-request",
					status: "completed",
					newTextProposals: useCardinality
						? ["const fixed = true;", "const duplicate = true;"]
						: mode === "content-rejected" && request.arm === "cold"
							? ["const stale = true;"]
							: [`const fixed_${request.arm.replaceAll("-", "_")} = true;`],
					usage: {
						requests: measured.requests,
						inputTokens: measured.inputTokens,
						outputTokens: measured.outputTokens,
						cacheReadTokens: measured.cacheReadTokens,
						actualCostMicrousd: measured.actualCostMicrousd,
						actualElapsedMs: measured.actualElapsedMs,
						costBasis: measured.costBasis,
					},
					evidenceDigest: measured.evidenceDigest,
				});
				continue;
			}
			const named = admitted.effect.phaseDirective?.namedToolRef;
			const result =
				named === "read-file"
					? providerResult(`${key}-read`, [{ toolRef: "read-file", path: "src/current.ts" }])
					: providerResult(`${key}-unchanged`, [
							{
								toolRef: "replace-exact",
								path: "src/current.ts",
								oldText: "const stale = true;",
								newText: "const stale = true;",
							},
						]);
			admitD34EffectResult(authority, admitted, result);
			continue;
		}
		if (request.effectKind === "tool-action") {
			const args = effect.runtime.toolArguments;
			if (args === null) throw new TypeError("D34 injected tool arguments are missing");
			if (args.toolRef === "read-file") {
				const readAttempt = (readAttempts.get(key) ?? 0) + 1;
				readAttempts.set(key, readAttempt);
				admitD34EffectResult(authority, admitted, {
					effectKind: "tool-action",
					toolRef: "read-file",
					status: "succeeded",
					causeCode: null,
					workspaceStateBeforeDigest: current,
					workspaceStateAfterDigest: current,
					nonEmptyDiff: false,
					evidenceDigest: digest({ key, read: true }),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			} else if (args.toolRef === "replace-exact") {
				const unchanged = args.oldText === args.newText;
				const after = unchanged ? current : digest({ current, newText: args.newText });
				workspaceByArm.set(key, after);
				admitD34EffectResult(authority, admitted, {
					effectKind: "tool-action",
					toolRef: "replace-exact",
					status: unchanged ? "failed" : "succeeded",
					causeCode: unchanged ? "exact-replacement-unchanged" : null,
					workspaceStateBeforeDigest: current,
					workspaceStateAfterDigest: after,
					nonEmptyDiff: !unchanged,
					evidenceDigest: digest({ key, unchanged, after }),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			} else {
				admitD34EffectResult(authority, admitted, {
					effectKind: "tool-action",
					toolRef: args.toolRef,
					status: "succeeded",
					causeCode: null,
					workspaceStateBeforeDigest: current,
					workspaceStateAfterDigest: current,
					nonEmptyDiff: args.toolRef === "workspace-diff",
					evidenceDigest: digest({ key, toolRef: args.toolRef }),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			}
			continue;
		}
		if (request.effectKind === "public-semantic-validation") {
			admitD34EffectResult(authority, admitted, {
				effectKind: "public-semantic-validation",
				status: "passed",
				criterionFailures: [],
				workspaceStateDigest: current,
				evidenceDigest: digest({ key, semantic: "passed" }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
			continue;
		}
		if (request.effectKind === "hidden-verifier") {
			admitD34EffectResult(authority, admitted, {
				effectKind: "hidden-verifier",
				status: "passed",
				workspaceStateDigest: current,
				evidenceDigest: digest({ key, hidden: "passed" }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
			continue;
		}
		admitD34EffectResult(authority, admitted, {
			effectKind: "cleanup",
			status: "completed",
			workspaceStateDigest: null,
			evidenceDigest: digest({ key, cleanup: true }),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
	}
	throw new TypeError("D34 injected six-arm run exceeded its bound");
}

describe("graphrefly-ts:D34 retained-span mutation recovery", () => {
	it("binds the exact D34 decision-bearing implementation closure", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD34Implementation(repositoryRoot)).toBe(D34_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("constructs an exact six-arm no-network qualification without production persistence authority", async () => {
		const bundle = await runD34InjectedNoNetworkQualification({
			baseline: createD34InjectedBaselineForTest(),
		});
		const validated = validateD34QualificationBundle(bundle);
		const durableBytes = JSON.stringify(validated);
		expect(durableBytes).not.toContain("const stale = true;");
		expect(durableBytes).not.toContain("const fixed_");
		expect(durableBytes).not.toContain("OPENROUTER_API_KEY");
		expect(validated.qualification).toMatchObject({
			exactSixArmsCompleted: true,
			retainedSpanCount: 6,
			acceptedNewTextCount: 6,
			cardinalityRejectionCount: 1,
			cardinalityCorrectionCount: 1,
			allPublicSemanticPassed: true,
			allHiddenVerifierPassed: true,
			allCleanupCompleted: true,
			providerNetworkCalls: 0,
			maxActiveEffects: 1,
			exactNewTextOnlyWirePassed: true,
			retryWireIdentityPassed: true,
			persistedRawSourceOrPatch: false,
			efficacyClaim: "none",
			qualified: true,
		});
		const privateRoot = await mkdtemp(join(tmpdir(), "graphrefly-d34-qualification-"));
		await chmod(privateRoot, 0o700);
		try {
			await expect(persistD34Qualification({ privateRoot, bundle })).rejects.toThrow(
				"requires consumed D33 artifact bytes",
			);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("mechanically lowers one exact newText-only Chat tool with stable retry bytes", () => {
		const base = {
			schemaVersion: "graphrefly-ts.d34.retained-span-mutation-directive.v1" as const,
			requestDigest: digest("request"),
			admissionDigest: digest("admission"),
			arm: "cold",
			runSequence: 0,
			workspaceStateDigest: digest("workspace"),
			spanFactDigest: digest("span-fact"),
			spanDigest: digest("span"),
			spanBytes: 19,
			namedToolName: "propose_replacement_text" as const,
			maxProposalCount: 1 as const,
			maxNewTextBytes: 131_072 as const,
		};
		const directive = { ...base, directiveDigest: digest(base) };
		const bodyBytes = Buffer.from(
			JSON.stringify({
				model: "injected",
				messages: [{ role: "user", content: "repair" }],
				tools: [
					{
						type: "function",
						function: {
							name: "replace_exact",
							description: "legacy",
							parameters: { type: "object" },
						},
					},
				],
				tool_choice: { type: "function", function: { name: "replace_exact" } },
			}),
		);
		const first = lowerD34RetainedSpanChatBody({ bodyBytes, directive });
		const retry = lowerD34RetainedSpanChatBody({ bodyBytes, directive });
		expect(Buffer.from(first.bytes).equals(Buffer.from(retry.bytes))).toBe(true);
		const lowered = JSON.parse(Buffer.from(first.bytes).toString("utf8"));
		expect(lowered.tool_choice.function.name).toBe("propose_replacement_text");
		expect(lowered.tools).toHaveLength(1);
		expect(JSON.stringify(lowered)).not.toContain("oldText");

		const projected = projectD34RetainedSpanChatResponse({
			directive,
			responseBytes: Buffer.from(
				JSON.stringify({
					choices: [
						{
							message: {
								tool_calls: [
									{
										function: {
											name: "propose_replacement_text",
											arguments: JSON.stringify({ newText: "const fixed = true;" }),
										},
									},
								],
							},
						},
					],
				}),
			),
		});
		expect(projected).toMatchObject({
			proposalCount: 1,
			newTextProposals: ["const fixed = true;"],
		});
	});

	it("completes six Graph-controlled arms with one bounded cardinality correction", async () => {
		const evidence = validateD34RetainedSpanEvidence(await runSixArms());
		expect(
			evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs,
		).toHaveLength(6);
		const runs = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
		expect(
			runs.every((run) => run.status === "completed" && run.cleanupStatus === "completed"),
			JSON.stringify(runs),
		).toBe(true);
		expect(evidence.facts.filter((fact) => fact.kind === "retained-span")).toHaveLength(6);
		expect(
			evidence.facts.filter((fact) => fact.disposition === "cardinality-rejected"),
		).toHaveLength(1);
		expect(evidence.efficacyClaim).toBe("none");
	});

	it("rejects replay and canonical retained-span substitution", async () => {
		const authority = createD34RetainedSpanAuthority({
			limits: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
			routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
			taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
		});
		const admitted = takeD34AdmittedEffect(authority)!;
		const state = digest("initial");
		const result = {
			effectKind: "materialization" as const,
			status: "completed" as const,
			workspaceStateDigest: state,
			evidenceDigest: digest("materialization"),
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		};
		admitD34EffectResult(authority, admitted, result);
		expect(() => admitD34EffectResult(authority, admitted, result)).toThrow("forged or replayed");

		const evidence = await runSixArms();
		const changed = structuredClone(evidence) as unknown as Record<string, unknown>;
		const facts = changed.facts as Array<Record<string, unknown>>;
		facts[1] = { ...facts[1], spanDigest: digest("substituted") };
		const { evidenceDigest: _old, ...material } = changed;
		changed.evidenceDigest = digest(material);
		expect(() => validateD34RetainedSpanEvidence(changed)).toThrow();
	});

	it("fails the arm locally on a second cardinality or unchanged newText proposal", async () => {
		for (const mode of ["second-cardinality", "content-rejected"] as const) {
			const evidence = validateD34RetainedSpanEvidence(await runSixArms(mode));
			const runs = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
			expect(runs[0]).toMatchObject({
				arm: "cold",
				status: "incomplete",
				cleanupStatus: "completed",
			});
			expect(runs.slice(1).every((run) => run.status === "completed")).toBe(true);
			if (mode === "second-cardinality")
				expect(
					evidence.facts.filter((fact) => fact.disposition === "cardinality-rejected"),
				).toHaveLength(2);
			else
				expect(evidence.facts.some((fact) => fact.disposition === "content-rejected")).toBe(true);
		}
	});

	it("denies retained-span recovery before changing the model information set without headroom", async () => {
		const raw = await runSixArms("headroom-denied");
		expect(raw.phaseEvidence.phaseFactCount).toBeGreaterThan(0);
		expect(raw.phaseEvidence.phaseFactCount).toBeLessThanOrEqual(128);
		const evidence = validateD34RetainedSpanEvidence(raw);
		const cold = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs[0];
		expect(cold).toMatchObject({ status: "incomplete", cleanupStatus: "completed" });
		expect(evidence.facts.filter((fact) => fact.kind === "retained-span").length).toBeGreaterThan(
			0,
		);
		expect(evidence.facts.filter((fact) => fact.kind === "new-text-proposal")).toHaveLength(0);
		expect(
			evidence.facts.some((fact) => fact.disposition === "accepted" && fact.arm === "cold"),
		).toBe(false);
	});
});
