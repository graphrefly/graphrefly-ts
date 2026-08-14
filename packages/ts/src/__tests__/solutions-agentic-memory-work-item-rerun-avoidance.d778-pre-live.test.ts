import { chmod, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { invokeD723OpenRouterGraphTurn } from "../../evals/empirical-memory-rerun-avoidance/d723-openrouter-graph-turn.js";
import {
	admitD778TaskExposureProposal,
	admitD778ToolRejectionProposal,
	createD778GraphTaskEnvelope,
	createD778ModelVisibleConversation,
	createD778TaskExposureProposal,
	createD778ToolRejectionProposal,
	D778_ACCEPTANCE_CRITERIA,
	D778_READABLE_PATHS,
	D778_TASK_STATEMENT,
	validateD778FinalChatBody,
} from "../../evals/empirical-memory-rerun-avoidance/d778-graph-task-tool-authority.js";
import {
	createD778InjectedBaselineForTest,
	createD778PersistenceFaultForTest,
	persistD778AtomicFixtureForTest,
	runD778InjectedNoNetworkQualification,
	validateD778QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d778-pre-live-qualification.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });
const request = () => ({
	kind: "graph-effect-request" as const,
	effectKind: "provider-request" as const,
	runSequence: 0,
	effectSequence: 1,
	attemptOrdinal: 1,
	requestDigest: sha("request"),
	logicalRequestDigest: sha("logical"),
	issuedRequestDigest: sha("issued"),
	workspaceStateDigest: sha("workspace"),
	phaseBefore: "none" as const,
	toolIntent: null,
	retryReason: "none" as const,
	retryAfterMs: null,
});
const binding = () => ({
	requestDigest: sha("request"),
	admissionDigest: sha("admission"),
	resultFactDigest: sha("result"),
	reconciliationDigest: sha("reconciliation"),
});

describe("D778 Graph-authored task exposure and tool rejection", () => {
	it("puts the complete public task and criteria on the actual Chat wire", async () => {
		const effectRequest = request();
		const envelope = createD778GraphTaskEnvelope({
			arm: "cold",
			effectRequest: effectRequest as never,
		});
		let calls = 0;
		const turn = await invokeD723OpenRouterGraphTurn({
			effectRequest: effectRequest as never,
			credential: {
				bearerToken: "not-live",
				credentialBindingRef: "d778.injected",
				credentialBindingRevision: "v1",
			},
			taskStatement: D778_TASK_STATEMENT,
			conversation: createD778ModelVisibleConversation(envelope),
			signal: new AbortController().signal,
			monotonicNowMs: () => calls,
			transport: {
				async request(input) {
					calls += 1;
					const receipt = validateD778FinalChatBody({
						body: input.body,
						envelope,
						requestDigest: effectRequest.requestDigest,
					});
					expect(receipt).toBeTypeOf("object");
					const decoded = JSON.parse(new TextDecoder().decode(input.body));
					const visible = JSON.stringify(decoded.messages);
					expect(visible).toContain(D778_TASK_STATEMENT);
					expect(visible).toContain(D778_ACCEPTANCE_CRITERIA[0]);
					expect(visible).toContain(D778_READABLE_PATHS[0]);
					return {
						status: 200,
						retryAfterMs: null,
						body: new TextEncoder().encode(
							JSON.stringify({
								id: "d778-test-response",
								usage: { prompt_tokens: 1, completion_tokens: 1 },
								choices: [
									{
										finish_reason: "tool_calls",
										message: {
											content: null,
											tool_calls: [
												{
													id: "d778-read",
													type: "function",
													function: {
														name: "read_file",
														arguments: JSON.stringify({ path: D778_READABLE_PATHS[0] }),
													},
												},
											],
										},
									},
								],
								openrouter_metadata: {
									endpoints: {
										available: [
											{
												provider: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
												model: OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
												selected: true,
											},
										],
									},
								},
							}),
						),
					};
				},
			},
		});
		expect(calls).toBe(1);
		expect(turn.rawToolIntents[0]?.arguments).toEqual({ path: D778_READABLE_PATHS[0] });
	});

	it("rejects task wire substitution before transport admission", () => {
		const envelope = createD778GraphTaskEnvelope({
			arm: "cold",
			effectRequest: request() as never,
		});
		const body = new TextEncoder().encode(
			JSON.stringify({ messages: [{ role: "user", content: "coordinate-only" }] }),
		);
		expect(() =>
			validateD778FinalChatBody({ body, envelope, requestDigest: request().requestDigest }),
		).toThrow(/messages drifted/);
	});

	it("admits task exposure and sanitized tool rejection exactly once", () => {
		const envelope = createD778GraphTaskEnvelope({
			arm: "cold",
			effectRequest: request() as never,
		});
		const body = new TextEncoder().encode(
			JSON.stringify({ messages: createD778ModelVisibleConversation(envelope).messages }),
		);
		const wireReceipt = validateD778FinalChatBody({
			body,
			envelope,
			requestDigest: request().requestDigest,
		});
		const exposure = createD778TaskExposureProposal({
			envelope,
			wireReceipt,
			binding: binding(),
		});
		expect(admitD778TaskExposureProposal(exposure).arm).toBe("cold");
		expect(() => admitD778TaskExposureProposal(exposure)).toThrow(/forged or replayed/);
		expect(() =>
			createD778TaskExposureProposal({ envelope, wireReceipt, binding: binding() }),
		).toThrow(/wire receipt is forged or replayed/);

		const rejection = createD778ToolRejectionProposal({
			runSequence: 0,
			toolRef: "read-file",
			causeCode: "path-not-allowed",
			workspaceStateBeforeDigest: sha("workspace"),
			workspaceStateAfterDigest: sha("workspace"),
			binding: binding(),
		});
		expect(admitD778ToolRejectionProposal(rejection).causeCode).toBe("path-not-allowed");
		expect(() => admitD778ToolRejectionProposal(rejection)).toThrow(/forged or replayed/);
	});

	it("rejects accessors, stale workspace and raw diagnostic expansion", () => {
		const accessor = Object.defineProperty({}, "arm", { enumerable: true, get: () => "cold" });
		expect(() => createD778GraphTaskEnvelope(accessor as never)).toThrow(/own data property/);
		expect(() =>
			createD778ToolRejectionProposal({
				runSequence: 0,
				toolRef: "read-file",
				causeCode: "path-not-allowed",
				workspaceStateBeforeDigest: sha("before"),
				workspaceStateAfterDigest: sha("after"),
				binding: binding(),
			}),
		).toThrow(/changed workspace state/);
		expect(() =>
			createD778ToolRejectionProposal({
				runSequence: 0,
				toolRef: "read-file",
				causeCode: "raw-message" as never,
				workspaceStateBeforeDigest: sha("workspace"),
				workspaceStateAfterDigest: sha("workspace"),
				binding: binding(),
			}),
		).toThrow(/expected one of/);
	});

	it("publishes one exclusive 0700/0600 atomic fixture through the production persistence core", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d778-persist-")));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD778AtomicFixtureForTest({ privateRoot });
			expect(receipt.generationRef).toBe("d778-owned-persistence-test-v1");
			const finalRoot = join(privateRoot, "d778-owned-persistence-test-v1");
			expect((await lstat(finalRoot)).mode & 0o777).toBe(0o700);
			expect((await lstat(join(finalRoot, "artifacts"))).mode & 0o777).toBe(0o700);
			expect((await lstat(join(finalRoot, "artifacts", "bundle.v1.json"))).mode & 0o777).toBe(
				0o600,
			);
			expect((await lstat(join(finalRoot, "commit.v1.json"))).mode & 0o777).toBe(0o600);
			await expect(persistD778AtomicFixtureForTest({ privateRoot })).rejects.toThrow(
				/already exists/,
			);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("removes only its exact claimed generation after every injected precommit fault", async () => {
		for (const stage of ["after-claim", "after-artifacts-rename"] as const) {
			const privateRoot = await realpath(
				await mkdtemp(join(tmpdir(), `graphrefly-d778-${stage}-`)),
			);
			await chmod(privateRoot, 0o700);
			try {
				await expect(
					persistD778AtomicFixtureForTest({
						privateRoot,
						fault: createD778PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow(/injected/);
				expect(await readdir(privateRoot)).toEqual([]);
			} finally {
				await rm(privateRoot, { recursive: true, force: true });
			}
		}
	});

	it("qualifies the full six-arm Graph lifecycle with exact task-wire and diagnostic coverage", async () => {
		const baseline = createD778InjectedBaselineForTest();
		const bundle = await runD778InjectedNoNetworkQualification(baseline);
		const validated = validateD778QualificationBundle(bundle);
		expect(validated.qualification.completedArms).toBe(6);
		expect(validated.taskExposureFacts.length).toBeGreaterThan(6);
		expect(validated.toolRejectionFacts.map((fact) => fact.causeCode).sort()).toEqual([
			"exact-replacement-not-applicable",
			"focused-validation-failed",
			"malformed-arguments",
			"path-not-allowed",
			"unexpected-arguments",
		]);
		await expect(runD778InjectedNoNetworkQualification(baseline)).rejects.toThrow(
			/forged or replayed/,
		);
		const forged = structuredClone(bundle) as any;
		forged.taskExposureFacts[0].modelVisibleMessagesDigest = sha("forged-messages");
		const { factDigest: _factDigest, ...factMaterial } = forged.taskExposureFacts[0];
		forged.taskExposureFacts[0].factDigest = empiricalStrictJsonDigest(factMaterial);
		const { bundleDigest: _bundleDigest, ...bundleMaterial } = forged;
		forged.bundleDigest = empiricalStrictJsonDigest(bundleMaterial);
		expect(() => validateD778QualificationBundle(forged)).toThrow(/Graph bijection drifted/);
	}, 60_000);
});
