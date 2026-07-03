import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolProviderExecutionRecipe } from "../executors/tool-provider.js";
import {
	type HttpToolProviderDriver,
	httpToolProviderCatalog,
	httpToolProviderRuntime,
	localBuiltinToolProviderAdapterPack,
	localBuiltinToolProviderBinding,
	type ProcessToolArguments,
	processToolProviderAdapterPack,
	processToolProviderBinding,
} from "../executors/tool-provider-adapters.js";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	ExecutorRoute,
	ToolCallInput,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderRunAdmissionDecision,
} from "../orchestration/index.js";
import {
	requestToolProviderAdapterRun,
	toolProviderRunAdmissionProjector,
} from "../orchestration/index.js";

describe("tool-provider concrete adapters (D283/D359-D362)", () => {
	it("local builtin binding exposes deterministic pure tools without fallback tools", () => {
		const binding = localBuiltinToolProviderBinding({ now: () => 1_700_000_000_000 });

		expect(
			binding.run(readyInput("local-builtin", "date.now"), { attempt: 1, sourceRefs: [] }),
		).toEqual(
			expect.objectContaining({
				kind: "result",
				result: expect.objectContaining({
					kind: "json",
					value: {
						toolName: "date.now",
						epochMs: 1_700_000_000_000,
						iso: "2023-11-14T22:13:20.000Z",
					},
				}),
			}),
		);
		expect(
			binding.run(readyInput("local-builtin", "json.parse", { text: '{"ok":true}' }), {
				attempt: 1,
				sourceRefs: [],
			}),
		).toEqual(
			expect.objectContaining({
				kind: "result",
				result: expect.objectContaining({
					value: { toolName: "json.parse", value: { ok: true } },
				}),
			}),
		);
		expect(
			binding.run(
				readyInput("local-builtin", "text.concat", { parts: ["a", 2, "c"], separator: "-" }),
				{ attempt: 1, sourceRefs: [] },
			),
		).toEqual(
			expect.objectContaining({
				kind: "result",
				result: expect.objectContaining({
					kind: "text",
					value: { toolName: "text.concat", text: "a-2-c" },
					summary: "a-2-c",
				}),
			}),
		);
		expect(
			binding.run(readyInput("local-builtin", "bash.run"), { attempt: 1, sourceRefs: [] }),
		).toEqual(expect.objectContaining({ kind: "blocked" }));
	});

	it("local builtin adapter pack plugs into the execution recipe", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "agentRequestFacts" });
		const routes = g.node<ExecutorRoute>([], null, { name: "executorRoutes" });
		const pack = localBuiltinToolProviderAdapterPack({ now: () => 123 });
		const profile = pack.catalogs[0]?.profiles[0];
		const recipe = toolProviderExecutionRecipe(g, {
			requestFacts,
			executorRoutes: [routes],
			catalogs: pack.catalogs,
			bindings: pack.bindings,
			now: () => 123,
		});
		const outcomes = collectData(recipe.outcomes);
		const views = collectData(recipe.outcomeViews.views);

		routes.down([["DATA", route("request-1", profile)]]);
		requestFacts.down([["DATA", request("request-1", "date.now")]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "result",
				requestId: "request-1",
				result: expect.objectContaining({
					value: { toolName: "date.now", epochMs: 123, iso: "1970-01-01T00:00:00.123Z" },
				}),
			}),
		]);
		expect(views).toEqual([
			expect.objectContaining({
				kind: "executor-outcome-view",
				audience: "agent-observation",
				requestId: "request-1",
				status: "result",
			}),
		]);
		recipe.dispose();
	});

	it("process binding defaults deny and requires explicit argv allowlist", () => {
		const denied = processToolProviderBinding();
		expect(
			denied.run(processInput({ command: "node", args: ["-e", "console.log('x')"] }), {
				attempt: 1,
				sourceRefs: [],
			}),
		).toEqual(expect.objectContaining({ kind: "blocked" }));

		const allowed = processToolProviderBinding({
			allowedCommands: [
				{
					command: "node",
					executable: process.execPath,
					allowArgs: (args) => args[0] === "-e",
				},
			],
			baseEnv: {},
			allowedEnvKeys: ["GRAPHREFLY_ALLOWED"],
			maxOutputBytes: 1024,
		});
		const result = allowed.run(
			processInput({
				command: "node",
				args: ["-e", "console.log(process.env.GRAPHREFLY_ALLOWED ?? 'missing')"],
				env: { GRAPHREFLY_ALLOWED: "visible" },
			}),
			{ attempt: 1, sourceRefs: [] },
		);

		expect(result).toEqual(
			expect.objectContaining({
				kind: "result",
				result: expect.objectContaining({
					kind: "process-result",
					value: expect.objectContaining({
						command: "node",
						exitCode: 0,
						outputPreview: "visible\n",
					}),
					artifacts: expect.arrayContaining([
						expect.objectContaining({
							kind: "process-stdout",
							dataMode: "inline",
							value: "visible\n",
							byteLength: 8,
							sizeEvidence: [
								expect.objectContaining({
									kind: "size-capacity-evidence",
									unit: "bytes",
									quantity: 8,
								}),
							],
						}),
					]),
				}),
			}),
		);
		expect(
			allowed.run(
				processInput({
					command: "node",
					args: ["-e", "console.log(process.env.SECRET ?? 'missing')"],
					env: { SECRET: "hidden" },
				}),
				{ attempt: 1, sourceRefs: [] },
			),
		).toEqual(expect.objectContaining({ kind: "blocked" }));
	});

	it("process adapter pack publishes pure catalog data and recipe-compatible binding", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "processRequestFacts" });
		const routes = g.node<ExecutorRoute>([], null, { name: "processExecutorRoutes" });
		const pack = processToolProviderAdapterPack({
			providerId: "process-test",
			allowedCommands: [
				{
					command: "node",
					executable: process.execPath,
					allowArgs: (args) => args[0] === "-e",
				},
			],
			baseEnv: {},
			maxOutputBytes: 1024,
		});
		const profile = pack.catalogs[0]?.profiles[0];
		const recipe = toolProviderExecutionRecipe(g, {
			name: "processRecipe",
			requestFacts,
			executorRoutes: [routes],
			catalogs: pack.catalogs,
			bindings: pack.bindings,
		});
		const outcomes = collectData(recipe.outcomes);

		expect(JSON.stringify(pack.catalogs)).not.toContain("execPath");
		routes.down([["DATA", route("process-request", profile)]]);
		requestFacts.down([
			[
				"DATA",
				request("process-request", "process.execFile", {
					command: "node",
					args: ["-e", "console.log('adapter')"],
				}),
			],
		]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "result",
				requestId: "process-request",
				result: expect.objectContaining({
					value: expect.objectContaining({ outputPreview: "adapter\n" }),
				}),
			}),
		]);
		recipe.dispose();
	});

	it("process binding fails closed on output capacity", () => {
		const binding = processToolProviderBinding({
			allowedCommands: [
				{
					command: "node",
					executable: process.execPath,
					allowArgs: (args) => args[0] === "-e",
				},
			],
			baseEnv: {},
			maxOutputBytes: 8,
		});

		expect(
			binding.run(
				processInput({
					command: "node",
					args: ["-e", "process.stdout.write('12345'); process.stderr.write('67890')"],
				}),
				{ attempt: 1, sourceRefs: [] },
			),
		).toEqual(
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({ code: "process-output-limit-exceeded" }),
			}),
		);
	});

	it("process binding resolves relative cwd under workingDirectory", () => {
		const root = mkdtempSync(join(tmpdir(), "graphrefly-process-adapter-"));
		const child = join(root, "child");
		mkdirSync(child);
		try {
			const binding = processToolProviderBinding({
				workingDirectory: root,
				allowedWorkingDirectories: [root],
				allowedCommands: [
					{
						command: "node",
						executable: process.execPath,
						allowArgs: (args) => args[0] === "-e",
					},
				],
				baseEnv: {},
				maxOutputBytes: 1024,
			});

			const result = binding.run(
				processInput({
					command: "node",
					args: ["-e", "console.log(require('node:path').basename(process.cwd()))"],
					cwd: "child",
				}),
				{ attempt: 1, sourceRefs: [] },
			);

			expect(result).toEqual(
				expect.objectContaining({
					kind: "result",
					result: expect.objectContaining({
						value: expect.objectContaining({
							cwd: child,
							outputPreview: `${basename(child)}\n`,
						}),
					}),
				}),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("process binding rejects cwd symlink escapes when followSymlinks is false", () => {
		const root = mkdtempSync(join(tmpdir(), "graphrefly-process-adapter-"));
		const outside = mkdtempSync(join(tmpdir(), "graphrefly-process-outside-"));
		const link = join(root, "link-outside");
		try {
			try {
				symlinkSync(outside, link, "dir");
			} catch {
				return;
			}
			const binding = processToolProviderBinding({
				workingDirectory: root,
				allowedWorkingDirectories: [root],
				allowedCommands: [
					{
						command: "node",
						executable: process.execPath,
						allowArgs: (args) => args[0] === "-e",
					},
				],
				baseEnv: {},
				maxOutputBytes: 1024,
			});

			expect(
				binding.run(
					processInput({
						command: "node",
						args: ["-e", "console.log(process.cwd())"],
						cwd: "link-outside",
					}),
					{ attempt: 1, sourceRefs: [] },
				),
			).toEqual(
				expect.objectContaining({
					kind: "blocked",
					issues: expect.arrayContaining([
						expect.objectContaining({ code: "process-cwd-not-allowed" }),
					]),
				}),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("http runtime executes through visible run requests without async bindings", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "httpInputs" });
		const driver: HttpToolProviderDriver = {
			fetch(request) {
				return Promise.resolve({
					url: request.url,
					status: 200,
					statusText: "OK",
					headers: { "content-type": "application/json", server: "private" },
					bodyText: '{"ok":true}',
				});
			},
		};
		const runtime = httpToolProviderRuntime(g, {
			inputs,
			providerId: "http-test",
			allowedOrigins: ["https://api.example.test"],
			exposedResponseHeaders: ["content-type"],
			driver,
			now: () => 123,
		});
		const outcomes = collectData(runtime.outcomes);
		const statuses = collectData(runtime.runStatus);

		inputs.down([
			[
				"DATA",
				readyInput("http-test", "http.fetch", {
					url: "https://api.example.test/data",
				}),
			],
		]);

		return Promise.resolve().then(() => {
			expect(statuses).toEqual([
				expect.objectContaining({ status: "requested" }),
				expect.objectContaining({ status: "started" }),
				expect.objectContaining({ status: "result" }),
			]);
			expect(outcomes).toEqual([
				expect.objectContaining({
					kind: "result",
					result: expect.objectContaining({
						kind: "http-result",
						value: expect.objectContaining({
							status: 200,
							bodyText: '{"ok":true}',
							headers: { "content-type": "application/json" },
						}),
						artifacts: [
							expect.objectContaining({
								kind: "http-response-body",
								dataMode: "inline",
								value: '{"ok":true}',
								byteLength: 11,
							}),
						],
					}),
				}),
			]);
			runtime.dispose();
		});
	});

	it("http runtime denies non-allowlisted origins and approval-required runs fail closed", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "httpDeniedInputs" });
		const runtime = httpToolProviderRuntime(g, {
			inputs,
			providerId: "http-test",
			allowedOrigins: ["https://api.example.test"],
			approvalMode: "require",
			driver: {
				fetch() {
					throw new Error("should not execute");
				},
			},
		});
		const outcomes = collectData(runtime.outcomes);

		inputs.down([
			[
				"DATA",
				readyInput("http-test", "http.fetch", {
					url: "https://api.example.test/data",
				}),
			],
			[
				"DATA",
				{
					...readyInput("http-test", "http.fetch", {
						url: "https://evil.example.test/data",
					}),
					adapterInputId: "http-test:evil:input",
					requestId: "http-test:evil:request",
					operationId: "http-test:evil:op",
					routeId: "http-test:evil:route",
				},
			],
		]);

		return Promise.resolve().then(() => {
			expect(outcomes).toEqual([
				expect.objectContaining({
					kind: "blocked",
					needs: expect.arrayContaining([
						expect.objectContaining({ kind: "tool-provider-approval" }),
					]),
				}),
				expect.objectContaining({
					kind: "blocked",
					issues: expect.arrayContaining([
						expect.objectContaining({ code: "http-origin-not-allowed" }),
					]),
				}),
			]);
			runtime.dispose();
		});
	});

	it("http runtime consumes D419-admitted run requests instead of auto-running explicit candidates", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "httpAdmissionInputs" });
		const candidateRuns = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "httpAdmissionCandidateRuns",
		});
		const decisions = g.node<ToolProviderRunAdmissionDecision>([], null, {
			name: "httpAdmissionDecisions",
		});
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [candidateRuns],
			decisions: [decisions],
		});
		const calls: string[] = [];
		const runtime = httpToolProviderRuntime(g, {
			inputs,
			runRequests: [admission.approvedRunRequests],
			providerId: "http-test",
			allowedOrigins: ["https://api.example.test"],
			approvalMode: "require",
			driver: {
				fetch(request) {
					calls.push(request.url);
					return Promise.resolve({
						url: request.url,
						status: 200,
						statusText: "OK",
						bodyText: "approved",
					});
				},
			},
		});
		const outcomes = collectData(runtime.outcomes);
		const input = approvalInput(
			readyInput("http-test", "http.fetch", {
				url: "https://api.example.test/admitted",
			}),
			"require",
		);

		inputs.down([["DATA", input]]);

		return Promise.resolve()
			.then(() => {
				expect(calls).toEqual([]);
				candidateRuns.down([
					["DATA", requestToolProviderAdapterRun(input, { runId: "candidate-http-approval" })],
				]);
				return Promise.resolve();
			})
			.then(() => {
				expect(calls).toEqual([]);
				decisions.down([
					[
						"DATA",
						{
							kind: "tool-provider-run-admission-decision",
							decisionId: "http-approval-decision",
							proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [
								"candidate-http-approval",
							]),
							admissionId: "http-approval-admission",
							outcome: "admit",
							approvedRunId: "approved-http-run",
						},
					],
				]);
				return Promise.resolve();
			})
			.then(() => {
				expect(calls).toEqual(["https://api.example.test/admitted"]);
				expect(outcomes).toEqual([
					expect.objectContaining({
						kind: "result",
						result: expect.objectContaining({
							value: expect.objectContaining({ bodyText: "approved" }),
						}),
					}),
				]);
				runtime.dispose();
			});
	});

	it("default http driver disables automatic redirect following", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "httpRedirectInputs" });
		const originalFetch = globalThis.fetch;
		let seenInit: RequestInit | undefined;
		globalThis.fetch = ((_url: URL | RequestInfo, init?: RequestInit) => {
			seenInit = init;
			return Promise.resolve(new Response("ok", { status: 200, statusText: "OK" }));
		}) as typeof fetch;
		const runtime = httpToolProviderRuntime(g, {
			inputs,
			providerId: "http-test",
			allowedOrigins: ["https://api.example.test"],
		});

		inputs.down([
			[
				"DATA",
				readyInput("http-test", "http.fetch", {
					url: "https://api.example.test/redirect",
				}),
			],
		]);

		return Promise.resolve()
			.then(() => Promise.resolve())
			.then(() => {
				expect(seenInit).toEqual(expect.objectContaining({ redirect: "manual" }));
				runtime.dispose();
				globalThis.fetch = originalFetch;
			})
			.catch((error: unknown) => {
				runtime.dispose();
				globalThis.fetch = originalFetch;
				throw error;
			});
	});

	it("http runtime keeps ref-only bodies as ref artifacts instead of empty inline content", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "httpRefInputs" });
		const bodyRef = { kind: "artifact", id: "http-body-ref" };
		const runtime = httpToolProviderRuntime(g, {
			inputs,
			providerId: "http-test",
			allowedOrigins: ["https://api.example.test"],
			driver: {
				fetch(request) {
					return Promise.resolve({
						url: request.url,
						status: 200,
						statusText: "OK",
						bodyRef,
					});
				},
			},
		});
		const outcomes = collectData(runtime.outcomes);

		inputs.down([
			[
				"DATA",
				readyInput("http-test", "http.fetch", {
					url: "https://api.example.test/ref",
				}),
			],
		]);

		return Promise.resolve().then(() => {
			const value = outcomes[0]?.kind === "result" ? outcomes[0].result.value : undefined;
			expect(value).toEqual(
				expect.objectContaining({
					dataMode: "ref",
					bodyRef,
				}),
			);
			expect(Object.hasOwn(value ?? {}, "bodyText")).toBe(false);
			expect(outcomes[0]).toEqual(
				expect.objectContaining({
					result: expect.objectContaining({
						artifacts: [
							expect.objectContaining({
								kind: "http-response-body",
								dataMode: "ref",
								ref: bodyRef,
							}),
						],
					}),
				}),
			);
			expect(
				Object.hasOwn(
					outcomes[0]?.kind === "result" ? (outcomes[0].result.artifacts?.[0] ?? {}) : {},
					"value",
				),
			).toBe(false);
			runtime.dispose();
		});
	});

	it("http catalog is pure policy data for async runtime providers", () => {
		expect(
			httpToolProviderCatalog({
				providerId: "http-test",
				allowedOrigins: ["https://api.example.test"],
				allowedMethods: ["GET", "POST"],
				allowedRequestHeaders: ["authorization"],
				maxResponseBytes: 10,
			}),
		).toEqual(
			expect.objectContaining({
				providerKind: "http",
				status: "ready",
				metadata: expect.objectContaining({ asyncRuntime: true }),
				tools: [
					expect.objectContaining({
						toolName: "http.fetch",
						capabilities: expect.objectContaining({ asyncRuntime: true }),
					}),
				],
			}),
		);
	});

	it("process binding fails closed on malformed argv and invalid allowlist argv", () => {
		const binding = processToolProviderBinding({
			allowedCommands: [
				{
					command: "node",
					executable: process.execPath,
					allowArgs: true,
				},
			],
		});
		const sparseArgs = [] as unknown[];
		sparseArgs[1] = "-v";

		expect(
			binding.run(readyInput("process", "process.execFile", null), {
				attempt: 1,
				sourceRefs: [],
			}),
		).toEqual(expect.objectContaining({ kind: "blocked" }));
		expect(
			binding.run(
				readyInput("process", "process.execFile", { command: "node", args: sparseArgs }),
				{ attempt: 1, sourceRefs: [] },
			),
		).toEqual(expect.objectContaining({ kind: "blocked" }));
		expect(
			processToolProviderBinding({
				allowedCommands: [
					{
						command: "node",
						executable: process.execPath,
						fixedArgs: [undefined as unknown as string],
					},
				],
			}).run(processInput({ command: "node" }), { attempt: 1, sourceRefs: [] }),
		).toEqual(
			expect.objectContaining({
				kind: "blocked",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "process-command-invalid-allowlist" }),
				]),
			}),
		);
	});

	it("process catalog reports positive timeout and invalid allowlist policy", () => {
		const pack = processToolProviderAdapterPack({
			timeoutMs: 0,
			allowedCommands: [
				{
					command: "node",
					executable: process.execPath,
					allowArgs: [undefined as unknown as string],
				},
			],
		});

		expect(pack.catalogs[0]?.policies?.[0]?.timeout).toEqual({ timeoutMs: 10_000 });
		expect(pack.catalogs[0]).toEqual(
			expect.objectContaining({
				status: "misconfigured",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "process-tool-provider-invalid-allowlist" }),
				]),
			}),
		);
	});

	it("process binding freezes allowlist entries and fails closed on duplicates", () => {
		const allowedArgs = ["-e", "console.log('still copied')"];
		const mutableCommand = {
			command: "node",
			executable: process.execPath,
			allowArgs: allowedArgs,
		};
		const binding = processToolProviderBinding({
			allowedCommands: [mutableCommand],
			baseEnv: {},
			maxOutputBytes: 1024,
		});
		allowedArgs[1] = "console.log('mutated')";
		mutableCommand.executable = "definitely-not-node";

		expect(
			binding.run(
				processInput({
					command: "node",
					args: ["-e", "console.log('still copied')"],
				}),
				{ attempt: 1, sourceRefs: [] },
			),
		).toEqual(
			expect.objectContaining({
				kind: "result",
				result: expect.objectContaining({
					value: expect.objectContaining({ outputPreview: "still copied\n" }),
				}),
			}),
		);
		expect(
			binding.run(
				processInput({
					command: "node",
					args: ["-p", "1 + 1"],
				}),
				{ attempt: 1, sourceRefs: [] },
			),
		).toEqual(expect.objectContaining({ kind: "blocked" }));

		const duplicatePack = processToolProviderAdapterPack({
			allowedCommands: [
				{ command: "node", executable: process.execPath },
				{ command: "node", executable: process.execPath, allowArgs: true },
			],
		});
		expect(duplicatePack.catalogs[0]).toEqual(
			expect.objectContaining({
				status: "misconfigured",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "process-tool-provider-duplicate-allowlist" }),
				]),
			}),
		);
		expect(
			duplicatePack.bindings[0]?.run(processInput({ command: "node" }), {
				attempt: 1,
				sourceRefs: [],
			}),
		).toEqual(
			expect.objectContaining({
				kind: "blocked",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "process-command-duplicate-allowlist" }),
				]),
			}),
		);
	});
});

function request(requestId: string, toolName: string, args?: unknown): AgentRequestIssued {
	return {
		kind: "issued",
		requestId,
		operationId: `${requestId}:op`,
		effectRunId: `${requestId}:effect`,
		requestKind: "executor",
		required: true,
		input: {
			inputId: `${requestId}:input`,
			inputKind: "tool-call",
			value: {
				kind: "tool-call",
				toolName,
				operation: toolName === "process.execFile" ? "run" : undefined,
				...(args === undefined ? {} : { arguments: args }),
			} satisfies ToolCallInput,
		},
	};
}

function route(
	requestId: string,
	profile:
		| {
				readonly executorId: string;
				readonly profileId: string;
		  }
		| undefined,
): ExecutorRoute {
	if (profile === undefined) throw new Error("missing profile");
	return {
		kind: "executor-route",
		routeId: `${requestId}:route`,
		requestId,
		operationId: `${requestId}:op`,
		executorId: profile.executorId,
		profileId: profile.profileId,
	};
}

function readyInput(
	providerId: string,
	toolName: string,
	args?: unknown,
): ToolProviderAdapterInput {
	return {
		kind: "tool-provider-adapter-input",
		adapterInputId: `${providerId}:${toolName}:input`,
		status: "ready",
		requestId: `${providerId}:${toolName}:request`,
		operationId: `${providerId}:${toolName}:op`,
		routeId: `${providerId}:${toolName}:route`,
		providerId,
		executorId: `${providerId}:tool-executor`,
		profileId: `${providerId}:tool-profile`,
		toolName,
		operation: toolName === "process.execFile" ? "run" : undefined,
		toolCall: {
			kind: "tool-call",
			toolName,
			...(args === undefined ? {} : { arguments: args }),
		},
	};
}

function approvalInput(
	input: ToolProviderAdapterInput,
	mode: "auto" | "require" | "never",
): ToolProviderAdapterInput {
	const policyId = `${input.providerId}:approval-policy:${mode}`;
	return {
		...input,
		policies: [
			{
				kind: "tool-provider-execution-policy",
				policyId,
				providerId: input.providerId ?? "provider",
				approval: { mode },
			},
		],
		policyRefs: [{ kind: "tool-provider-execution-policy", id: policyId }],
	};
}

function processInput(args: ProcessToolArguments): ToolProviderAdapterInput<ProcessToolArguments> {
	return readyInput(
		"process",
		"process.execFile",
		args,
	) as ToolProviderAdapterInput<ProcessToolArguments>;
}

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}
