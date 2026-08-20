import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_TASK,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.js";
import {
	admitD34EffectResult,
	createD34RetainedSpanAuthority,
	snapshotD34RetainedSpanEvidence,
	validateD34RetainedSpanEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d34-retained-span-mutation-authority.js";
import {
	D35_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD35Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d35-retained-span-implementation-manifest.js";
import { createD35RetainedSpanRealProviderExecutor } from "../../evals/empirical-memory-rerun-avoidance/d35-retained-span-real-provider-composition.js";
import {
	createD35InjectedBaselineForTest,
	persistD35Qualification,
	runD35InjectedNoNetworkQualification,
	validateD35QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d35-retained-span-real-provider-qualification.js";

function response(toolName: string, args: unknown, callCount = 1) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						tool_calls: Array.from({ length: callCount }, (_, index) => ({
							id: `call-${toolName}-${index}`,
							type: "function",
							function: { name: toolName, arguments: JSON.stringify(args) },
						})),
					},
				},
			],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

describe("graphrefly-ts:D35 retained-span real-provider composition", () => {
	it("binds the exact D35 decision-bearing implementation closure", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD35Implementation(repositoryRoot)).toBe(D35_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("runs six real-workspace arms through exact newText-only injected Chat wire", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d35-workspaces-"));
		const authority = createD34RetainedSpanAuthority({
			limits: CURRENT_GRAPH_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: CURRENT_GRAPH_LIVE_TASK,
		});
		let coldCardinality = false;
		const providerBodies: string[] = [];
		const executor = createD35RetainedSpanRealProviderExecutor({
			authority,
			repositoryRoot,
			materializationRoot,
			credential: {
				bearerToken: "injected-no-network",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			},
			fetchImpl: async (_url, init) => {
				const body = JSON.parse(Buffer.from(init?.body as Uint8Array).toString("utf8"));
				const serialized = JSON.stringify(body);
				providerBodies.push(serialized);
				const hasReadResult = body.messages.some(
					(message: { role?: string; content?: string }) =>
						message.role === "tool" &&
						typeof message.content === "string" &&
						message.content.includes("managed-cloud-postgresql"),
				);
				const toolName =
					body.tool_choice === "required"
						? hasReadResult
							? "replace_exact"
							: "read_file"
						: (body.tool_choice.function.name as string);
				if (toolName === "read_file")
					return response("read_file", { path: CURRENT_GRAPH_LIVE_WRITABLE_FILE });
				if (toolName === "replace_exact")
					return response("replace_exact", {
						path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
						oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
						newText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
					});
				if (toolName !== "propose_replacement_text")
					throw new TypeError(`unexpected injected D35 tool: ${toolName}`);
				if (!coldCardinality) {
					coldCardinality = true;
					return response(
						"propose_replacement_text",
						{ newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK },
						2,
					);
				}
				return response("propose_replacement_text", {
					newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
				});
			},
			now: (() => {
				let value = 0;
				return () => ++value;
			})(),
			sleep: async () => undefined,
		});
		try {
			for (let guard = 0; guard < 256; guard += 1) {
				const execution = await executor.executeNext();
				if (execution === null) break;
				admitD34EffectResult(authority, execution.admitted, execution.result);
			}
			const rawEvidence = snapshotD34RetainedSpanEvidence(authority);
			if (rawEvidence.facts.length === 0) throw new TypeError("D35 produced no retained facts");
			const evidence = validateD34RetainedSpanEvidence(rawEvidence);
			const runs = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
			expect(runs).toHaveLength(6);
			expect(
				runs.every(
					(run) =>
						run.status === "completed" &&
						run.publicSemanticValidationPassed &&
						run.hiddenVerifierPassed &&
						run.cleanupStatus === "completed",
				),
				JSON.stringify(runs),
			).toBe(true);
			expect(evidence.facts.filter((fact) => fact.kind === "retained-span")).toHaveLength(6);
			expect(
				evidence.facts.filter((fact) => fact.disposition === "cardinality-rejected"),
			).toHaveLength(1);
			expect(providerBodies.some((body) => body.includes("propose_replacement_text"))).toBe(true);
			for (const body of providerBodies.filter((value) =>
				value.includes("propose_replacement_text"),
			)) {
				const parsed = JSON.parse(body);
				expect(parsed.tool_choice.function.name).toBe("propose_replacement_text");
				expect(JSON.stringify(parsed.tools)).not.toContain("oldText");
				expect(JSON.stringify(parsed.tools)).toContain("newText");
				const capsule = parsed.messages.at(-1)?.content;
				expect(capsule).not.toContain(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK);
				expect(capsule).not.toContain("oldText");
			}
			expect(evidence.efficacyClaim).toBe("none");
		} finally {
			await executor.dispose();
			await rm(materializationRoot, { recursive: true, force: true });
		}
	}, 120_000);

	it("qualifies the complete injected real-provider path without a second evidence authority", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d35-qualification-"));
		const materializationRoot = join(root, "workspaces");
		try {
			const constructed = await runD35InjectedNoNetworkQualification({
				baseline: createD35InjectedBaselineForTest(),
				repositoryRoot,
				materializationRoot,
			});
			const bundle = validateD35QualificationBundle(constructed);
			expect(bundle.baselineBasis).toBe("injected-test");
			expect(bundle.qualification.injectedTransportCalls).toBe(26);
			expect(bundle.qualification.retainedSpanTransportCalls).toBe(8);
			expect(bundle.qualification.retryWaitCount).toBe(1);
			expect(bundle.qualification.maxActiveEffects).toBe(1);
			expect(bundle.qualification.maxActiveTransport).toBe(1);
			expect(bundle.qualification.providerNetworkCalls).toBe(0);
			expect(bundle.qualification.efficacyClaim).toBe("none");
			const serialized = JSON.stringify(bundle);
			expect(serialized).not.toContain(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK);
			expect(serialized).not.toContain(CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK);
			await expect(
				persistD35Qualification({ privateRoot: join(root, "private"), bundle: constructed }),
			).rejects.toThrow("requires consumed D34 artifact bytes");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("keeps a wrong retained-span tool zero-side-effect and cleans every arm", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d35-wrong-tool-"));
		const authority = createD34RetainedSpanAuthority({
			limits: CURRENT_GRAPH_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: CURRENT_GRAPH_LIVE_TASK,
		});
		const executor = createD35RetainedSpanRealProviderExecutor({
			authority,
			repositoryRoot,
			materializationRoot,
			credential: {
				bearerToken: "injected-no-network",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			},
			fetchImpl: async (_url, init) => {
				const body = JSON.parse(Buffer.from(init?.body as Uint8Array).toString("utf8"));
				const hasReadResult = body.messages.some(
					(message: { role?: string; content?: string }) =>
						message.role === "tool" &&
						typeof message.content === "string" &&
						message.content.includes("managed-cloud-postgresql"),
				);
				if (body.tool_choice === "required")
					return hasReadResult
						? response("replace_exact", {
								path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
								oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
								newText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
							})
						: response("read_file", { path: CURRENT_GRAPH_LIVE_WRITABLE_FILE });
				return response("read_file", { path: CURRENT_GRAPH_LIVE_WRITABLE_FILE });
			},
			now: (() => {
				let value = 0;
				return () => ++value;
			})(),
			sleep: async () => undefined,
		});
		try {
			for (let guard = 0; guard < 256; guard += 1) {
				const execution = await executor.executeNext();
				if (execution === null) break;
				admitD34EffectResult(authority, execution.admitted, execution.result);
			}
			const evidence = validateD34RetainedSpanEvidence(snapshotD34RetainedSpanEvidence(authority));
			const runs = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
			expect(evidence.facts.filter((fact) => fact.kind === "retained-span")).toHaveLength(6);
			expect(evidence.facts.filter((fact) => fact.disposition === "accepted")).toHaveLength(0);
			expect(
				runs.every((run) => run.status === "incomplete" && run.cleanupStatus === "completed"),
			).toBe(true);
		} finally {
			await executor.dispose();
			await rm(materializationRoot, { recursive: true, force: true });
		}
	}, 120_000);

	it("rejects a replayed D34 baseline capability before executing an effect", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d35-replay-"));
		const baseline = createD35InjectedBaselineForTest();
		try {
			await runD35InjectedNoNetworkQualification({
				baseline,
				repositoryRoot,
				materializationRoot: join(root, "first"),
			});
			await expect(
				runD35InjectedNoNetworkQualification({
					baseline,
					repositoryRoot,
					materializationRoot: join(root, "second"),
				}),
			).rejects.toThrow("forged or replayed");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);
});
