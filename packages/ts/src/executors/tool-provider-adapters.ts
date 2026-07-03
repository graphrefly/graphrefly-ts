/**
 * Concrete Layer C tool-provider adapter pack v0 (D283/D359-D362).
 *
 * Adapter factories return graph-visible catalog DATA plus runtime-private
 * bindings. Permission checks are enforced by the binding closure; catalog
 * policy remains descriptive admission/routing/audit material, not a security
 * boundary.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	type AgentRequestStatusChanged,
	type AgentRuntimeAuditRecord,
	buildToolProviderExecutorOutcome,
	type ExecutorArtifactMaterial,
	type ExecutorOutcome,
	localBuiltinToolProviderCatalog,
	type SizeCapacityEvidence,
	type SourceRef,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderAdapterRunStatus,
	type ToolProviderCatalog,
	type ToolProviderCatalogEntry,
	type ToolProviderExecutionPolicy,
	type ToolProviderPublicTextPolicy,
	type ToolProviderSizeLimit,
	toolProviderAdapterRunProjector,
} from "../orchestration/index.js";
import type {
	ToolProviderAdapterBinding,
	ToolProviderAdapterRunContext,
	ToolProviderAdapterRunResult,
} from "./tool-provider-runtime.js";

export interface ToolProviderAdapterPack<TArguments = unknown, TResult = unknown> {
	readonly catalogs: readonly ToolProviderCatalog[];
	readonly bindings: readonly ToolProviderAdapterBinding<TArguments, TResult>[];
}

export type LocalBuiltinToolName = "date.now" | "json.parse" | "text.concat";

export interface LocalBuiltinToolArguments {
	readonly text?: string;
	readonly parts?: readonly unknown[];
	readonly separator?: string;
}

export type LocalBuiltinToolResult =
	| { readonly toolName: "date.now"; readonly epochMs: number; readonly iso: string }
	| { readonly toolName: "json.parse"; readonly value: unknown }
	| { readonly toolName: "text.concat"; readonly text: string };

export interface LocalBuiltinToolProviderBindingOptions {
	readonly providerId?: string;
	readonly now?: () => number;
	readonly maxTextChars?: number;
}

export interface LocalBuiltinToolProviderAdapterPackOptions
	extends LocalBuiltinToolProviderBindingOptions {
	readonly executorId?: string;
	readonly profileId?: string;
	readonly publicText?: ToolProviderPublicTextPolicy;
}

export interface ProcessToolArguments {
	readonly command?: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string | number | boolean | undefined>>;
	readonly input?: string;
}

export interface ProcessToolResult {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly exitCode: number | null;
	readonly signal?: string;
	readonly outputPreview?: string;
	readonly errorPreview?: string;
	readonly outputBytes: number;
	readonly errorOutputBytes: number;
	readonly truncated: boolean;
}

export interface ProcessToolAllowedCommand {
	/** Public command key accepted in tool arguments. */
	readonly command: string;
	/** Runtime executable. Defaults to `command`. This stays binding-private. */
	readonly executable?: string;
	readonly fixedArgs?: readonly string[];
	/** Explicit argv policy. `true` allows any argv array; omitted means no extra args. */
	readonly allowArgs?: true | readonly string[] | ((args: readonly string[]) => boolean);
	readonly cwd?: string;
}

export interface ProcessToolProviderBindingOptions {
	readonly providerId?: string;
	readonly allowedCommands?: readonly ProcessToolAllowedCommand[];
	readonly workingDirectory?: string;
	readonly allowedWorkingDirectories?: readonly string[];
	readonly baseEnv?: Readonly<Record<string, string>>;
	readonly allowedEnvKeys?: readonly string[];
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly maxSummaryChars?: number;
}

export interface ProcessToolProviderAdapterPackOptions extends ProcessToolProviderBindingOptions {
	readonly executorId?: string;
	readonly profileId?: string;
}

export interface HttpToolArguments {
	readonly url?: string;
	readonly method?: string;
	readonly headers?: Readonly<Record<string, string | number | boolean | undefined>>;
	readonly body?: string;
}

export interface HttpToolResult {
	readonly url: string;
	readonly method: string;
	readonly status: number;
	readonly statusText: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly bodyPreview?: string;
	readonly bodyText?: string;
	readonly bodyBytes: number;
	readonly bodyTruncated: boolean;
	readonly dataMode: "inline" | "summary" | "ref";
	readonly bodyRef?: SourceRef;
}

export interface HttpToolProviderDriverRequest {
	readonly url: string;
	readonly method: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly signal?: AbortSignal;
}

export interface HttpToolProviderDriverResponse {
	readonly url?: string;
	readonly status: number;
	readonly statusText?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly bodyText?: string;
	readonly bodyBytes?: number;
	readonly bodyRef?: SourceRef;
}

export interface HttpToolProviderDriver {
	fetch(
		request: HttpToolProviderDriverRequest,
	): HttpToolProviderDriverResponse | PromiseLike<HttpToolProviderDriverResponse>;
}

export interface HttpToolProviderRuntimeOptions {
	readonly name?: string;
	readonly providerId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly inputs: Node<ToolProviderAdapterInput<HttpToolArguments>>;
	readonly runRequests?: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly autoRunReadyInputs?: boolean;
	readonly allowedOrigins?: readonly string[];
	readonly allowedMethods?: readonly string[];
	readonly allowedRequestHeaders?: readonly string[];
	readonly exposedResponseHeaders?: readonly string[];
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
	readonly maxInlineBodyChars?: number;
	readonly approvalMode?: "auto" | "require" | "never";
	readonly driver?: HttpToolProviderDriver;
	readonly now?: () => number;
	readonly publicText?: ToolProviderPublicTextPolicy;
}

export interface HttpToolProviderRuntimeBundle {
	readonly catalogs: readonly ToolProviderCatalog[];
	readonly runRequests: Node<ToolProviderAdapterRunRequested>;
	readonly runStatus: Node<ToolProviderAdapterRunStatus>;
	readonly outcomes: Node<ExecutorOutcome<HttpToolResult>>;
	readonly status: Node<AgentRequestStatusChanged>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	dispose(): void;
}

const LOCAL_BUILTIN_TOOLS = Object.freeze([
	Object.freeze({
		toolName: "date.now",
		operation: "read",
		resultKinds: Object.freeze(["json"]),
		capabilities: Object.freeze({ deterministicWithInjectedClock: true }),
	}),
	Object.freeze({
		toolName: "json.parse",
		operation: "parse",
		resultKinds: Object.freeze(["json"]),
		capabilities: Object.freeze({ externalSideEffects: false }),
	}),
	Object.freeze({
		toolName: "text.concat",
		operation: "transform",
		resultKinds: Object.freeze(["text"]),
		capabilities: Object.freeze({ externalSideEffects: false }),
	}),
] satisfies readonly Omit<
	ToolProviderCatalogEntry,
	"kind" | "providerId" | "inputKind" | "profileId" | "executorId"
>[]);

export function localBuiltinToolProviderBinding(
	opts: LocalBuiltinToolProviderBindingOptions = {},
): ToolProviderAdapterBinding<LocalBuiltinToolArguments, LocalBuiltinToolResult> {
	const providerId = opts.providerId ?? "local-builtin";
	const maxTextChars = nonNegativeFinite(opts.maxTextChars, 16_384);
	return Object.freeze({
		providerId,
		run(input, ctx) {
			const toolName = input.toolName as LocalBuiltinToolName | undefined;
			switch (toolName) {
				case "date.now":
					return localDateNow(input, ctx, opts.now);
				case "json.parse":
					return localJsonParse(input, maxTextChars);
				case "text.concat":
					return localTextConcat(input, maxTextChars);
				default:
					return blocked(
						input,
						"local-builtin-unsupported-tool",
						"Local builtin tool is not supported.",
					);
			}
		},
	} satisfies ToolProviderAdapterBinding<LocalBuiltinToolArguments, LocalBuiltinToolResult>);
}

export function localBuiltinToolProviderAdapterPack(
	opts: LocalBuiltinToolProviderAdapterPackOptions = {},
): ToolProviderAdapterPack<LocalBuiltinToolArguments, LocalBuiltinToolResult> {
	const providerId = opts.providerId ?? "local-builtin";
	const catalog = localBuiltinToolProviderCatalog({
		providerId,
		executorId: opts.executorId ?? `${providerId}:tool-executor`,
		profileId: opts.profileId ?? `${providerId}:tool-profile`,
		tools: LOCAL_BUILTIN_TOOLS,
		policyOverrides: {
			operations: Object.freeze(["read", "parse", "transform"]),
			redaction: Object.freeze({
				mode: "summary",
				summaryMaxChars: opts.publicText?.maxSummaryChars ?? 512,
			}),
		},
		metadata: Object.freeze({ adapterPack: "local-builtin-v0" }),
	});
	return Object.freeze({
		catalogs: Object.freeze([catalog]),
		bindings: Object.freeze([
			localBuiltinToolProviderBinding({
				providerId,
				now: opts.now,
				maxTextChars: opts.maxTextChars ?? opts.publicText?.maxSummaryChars,
			}),
		]),
	});
}

export function processToolProviderBinding(
	opts: ProcessToolProviderBindingOptions = {},
): ToolProviderAdapterBinding<ProcessToolArguments, ProcessToolResult> {
	const providerId = opts.providerId ?? "process";
	const config = processConfig(opts);
	return Object.freeze({
		providerId,
		run(input) {
			const args = processArguments(input);
			if (args === undefined) {
				return blocked(input, "process-invalid-arguments", "Process tool requires argv arguments.");
			}
			const allowed = config.allowedCommands.get(args.command);
			if (allowed === undefined) {
				if (config.duplicateCommands.has(args.command)) {
					return blocked(
						input,
						"process-command-duplicate-allowlist",
						"Process command has duplicate allowlist entries.",
					);
				}
				if (config.invalidCommands.has(args.command)) {
					return blocked(
						input,
						"process-command-invalid-allowlist",
						"Process command has an invalid allowlist entry.",
					);
				}
				return blocked(input, "process-command-not-allowed", "Process command is not allowlisted.");
			}
			if (!argsAllowed(allowed, args.args)) {
				return blocked(input, "process-argv-not-allowed", "Process argv is not allowlisted.");
			}
			const cwd = resolveProcessCwd(args.cwd, allowed, config);
			if (cwd === undefined) {
				return blocked(
					input,
					"process-cwd-not-allowed",
					"Process cwd is outside the allowed policy.",
				);
			}
			const env = processEnv(args.env, config);
			if (env === undefined) {
				return blocked(
					input,
					"process-env-not-allowed",
					"Process env contains non-allowlisted keys.",
				);
			}
			return runProcessTool(input, allowed, args, cwd, env, config);
		},
	} satisfies ToolProviderAdapterBinding<ProcessToolArguments, ProcessToolResult>);
}

export function processToolProviderAdapterPack(
	opts: ProcessToolProviderAdapterPackOptions = {},
): ToolProviderAdapterPack<ProcessToolArguments, ProcessToolResult> {
	const providerId = opts.providerId ?? "process";
	const executorId = opts.executorId ?? `${providerId}:tool-executor`;
	const profileId = opts.profileId ?? `${providerId}:tool-profile`;
	return Object.freeze({
		catalogs: Object.freeze([
			processToolProviderCatalog({ ...opts, providerId, executorId, profileId }),
		]),
		bindings: Object.freeze([processToolProviderBinding({ ...opts, providerId })]),
	});
}

export function processToolProviderCatalog(
	opts: ProcessToolProviderAdapterPackOptions = {},
): ToolProviderCatalog {
	const providerId = opts.providerId ?? "process";
	const executorId = opts.executorId ?? `${providerId}:tool-executor`;
	const profileId = opts.profileId ?? `${providerId}:tool-profile`;
	const normalized = normalizeAllowedCommands(opts.allowedCommands ?? []);
	const allowedCommands = Object.freeze([...normalized.commands.values()]);
	const issueList = [
		...(allowedCommands.length === 0
			? [
					issue(
						"process-tool-provider-empty-allowlist",
						"Process tool provider has no allowlisted commands and will deny execution.",
						"warning",
					),
				]
			: []),
		...[...normalized.duplicates].map((command) =>
			issue(
				"process-tool-provider-duplicate-allowlist",
				"Process tool provider has duplicate command allowlist entries.",
				"error",
				{ command },
			),
		),
		...[...normalized.invalids].map((command) =>
			issue(
				"process-tool-provider-invalid-allowlist",
				"Process tool provider has invalid command allowlist entries.",
				"error",
				{ command },
			),
		),
	];
	const issues = issueList.length === 0 ? undefined : Object.freeze(issueList);
	const policy = processToolProviderExecutionPolicy(providerId, profileId, opts);
	const tool = Object.freeze({
		kind: "tool-catalog-entry",
		providerId,
		toolName: "process.execFile",
		operation: "run",
		inputKind: "tool-call",
		profileId,
		executorId,
		resultKinds: Object.freeze(["process-result"]),
		capabilities: Object.freeze({
			argv: true,
			shell: false,
			commands: Object.freeze(allowedCommands.map((cmd) => cmd.command)),
			env: Object.freeze({ allowedKeys: Object.freeze([...(opts.allowedEnvKeys ?? [])]) }),
		}),
		policyRefs: Object.freeze([{ kind: "tool-provider-execution-policy", id: policy.policyId }]),
	} satisfies ToolProviderCatalogEntry);
	return Object.freeze({
		kind: "tool-provider-catalog",
		providerId,
		providerKind: "process",
		status: issues === undefined ? "ready" : "misconfigured",
		profiles: Object.freeze([
			Object.freeze({
				profileId,
				executorId,
				kind: "tool",
				acceptedInputKinds: Object.freeze(["tool-call"]),
				acceptedResultKinds: Object.freeze(["process-result"]),
				capabilities: Object.freeze({
					toolNames: Object.freeze([tool.toolName]),
					argv: true,
					shell: false,
				}),
				policyRefs: Object.freeze([
					{ kind: "tool-provider-execution-policy", id: policy.policyId },
				]),
			}),
		]),
		tools: Object.freeze([tool]),
		policies: Object.freeze([policy]),
		policyRefs: Object.freeze([{ kind: "tool-provider-execution-policy", id: policy.policyId }]),
		issues,
		metadata: Object.freeze({ adapterPack: "process-v0" }),
	} satisfies ToolProviderCatalog);
}

export function httpToolProviderCatalog(
	opts: Omit<HttpToolProviderRuntimeOptions, "inputs" | "runRequests" | "driver"> = {},
): ToolProviderCatalog {
	const providerId = opts.providerId ?? "http";
	const executorId = opts.executorId ?? `${providerId}:tool-executor`;
	const profileId = opts.profileId ?? `${providerId}:tool-profile`;
	const allowedOrigins = Object.freeze([...(opts.allowedOrigins ?? [])]);
	const allowedMethods = Object.freeze(normalizeMethods(opts.allowedMethods ?? ["GET"]));
	const maxResponseBytes = Math.max(1, nonNegativeFinite(opts.maxResponseBytes, 64 * 1024));
	const policy = httpToolProviderExecutionPolicy(providerId, profileId, opts);
	const issues = Object.freeze([
		...(allowedOrigins.length === 0
			? [
					issue(
						"http-tool-provider-empty-origin-allowlist",
						"HTTP tool provider has no allowlisted origins and will deny execution.",
						"warning",
					),
				]
			: []),
		...(allowedMethods.length === 0
			? [
					issue(
						"http-tool-provider-empty-method-allowlist",
						"HTTP tool provider has no allowlisted methods and will deny execution.",
					),
				]
			: []),
	]);
	const tool = Object.freeze({
		kind: "tool-catalog-entry",
		providerId,
		toolName: "http.fetch",
		operation: "fetch",
		inputKind: "tool-call",
		profileId,
		executorId,
		resultKinds: Object.freeze(["http-result"]),
		capabilities: Object.freeze({
			origins: allowedOrigins,
			methods: allowedMethods,
			maxResponseBytes,
			asyncRuntime: true,
		}),
		policyRefs: Object.freeze([{ kind: "tool-provider-execution-policy", id: policy.policyId }]),
	} satisfies ToolProviderCatalogEntry);
	return Object.freeze({
		kind: "tool-provider-catalog",
		providerId,
		providerKind: "http",
		status: issues.length === 0 ? "ready" : "misconfigured",
		profiles: Object.freeze([
			Object.freeze({
				profileId,
				executorId,
				kind: "tool",
				acceptedInputKinds: Object.freeze(["tool-call"]),
				acceptedResultKinds: Object.freeze(["http-result"]),
				capabilities: Object.freeze({
					toolNames: Object.freeze([tool.toolName]),
					asyncRuntime: true,
				}),
				policyRefs: Object.freeze([
					{ kind: "tool-provider-execution-policy", id: policy.policyId },
				]),
			}),
		]),
		tools: Object.freeze([tool]),
		policies: Object.freeze([policy]),
		policyRefs: Object.freeze([{ kind: "tool-provider-execution-policy", id: policy.policyId }]),
		issues: issues.length === 0 ? undefined : issues,
		metadata: Object.freeze({ adapterPack: "http-v0", asyncRuntime: true }),
	} satisfies ToolProviderCatalog);
}

export function httpToolProviderRuntime(
	graph: Graph,
	opts: HttpToolProviderRuntimeOptions,
): HttpToolProviderRuntimeBundle {
	const name = opts.name ?? "httpToolProviderRuntime";
	const providerId = opts.providerId ?? "http";
	const catalog = httpToolProviderCatalog(opts);
	const outcomes = graph.node<ExecutorOutcome<HttpToolResult>>([], null, {
		name: `${name}/outcomes`,
	});
	const runStatus = graph.node<ToolProviderAdapterRunStatus>([], null, {
		name: `${name}/runStatus`,
	});
	const status = graph.node<AgentRequestStatusChanged>([], null, { name: `${name}/status` });
	const issues = graph.node<DataIssue>([], null, { name: `${name}/issues` });
	const audit = graph.node<AgentRuntimeAuditRecord>([], null, { name: `${name}/audit` });
	const inputs = new Map<string, ToolProviderAdapterInput<HttpToolArguments>>();
	const executions = new Set<string>();
	const active = new Set<AbortController>();
	const config = httpRuntimeConfig(opts);
	const driver = opts.driver ?? defaultHttpToolProviderDriver(config.maxResponseBytes);
	const forwardedRunStatusKeys = new Set<string>();
	let auditSeq = 0;
	let disposed = false;

	function nowMs(): number | undefined {
		return opts.now?.();
	}

	function publishIssue(nextIssue: DataIssue): void {
		issues.down([["DATA", nextIssue]]);
	}

	function publishAudit(
		kind: string,
		subjectId: string,
		metadata?: Record<string, unknown>,
		issueCode?: string,
	): void {
		auditSeq += 1;
		audit.down([
			[
				"DATA",
				{
					id: compoundTupleKey("tool-provider-adapter-audit", [name, String(auditSeq)]),
					kind,
					subjectId,
					...(issueCode === undefined ? {} : { issueCode }),
					...(metadata === undefined ? {} : { metadata }),
				} satisfies AgentRuntimeAuditRecord,
			],
		]);
	}

	function publishRunStatus(
		request: ToolProviderAdapterRunRequested,
		nextStatus: ToolProviderAdapterRunStatus["status"],
		statusIssues?: readonly DataIssue[],
		outcomeId?: string,
	): void {
		forwardedRunStatusKeys.add(canonicalTupleKey([request.runId, nextStatus]));
		runStatus.down([
			[
				"DATA",
				{
					kind: "tool-provider-adapter-run-status",
					runId: request.runId,
					adapterInputId: request.adapterInputId,
					requestId: request.requestId,
					operationId: request.operationId,
					status: nextStatus,
					attempt: request.attempt,
					...(outcomeId === undefined ? {} : { outcomeId }),
					...(statusIssues === undefined ? {} : { issues: statusIssues }),
					sourceRefs: request.sourceRefs,
					metadata: Object.freeze({ providerId, reason: request.reason }),
				} satisfies ToolProviderAdapterRunStatus,
			],
		]);
	}

	function publishRequestStatus(
		input: ToolProviderAdapterInput<HttpToolArguments>,
		nextStatus: AgentRequestStatusChanged["status"],
		statusIssues?: readonly DataIssue[],
	): void {
		if (input.effectRunId === undefined) return;
		status.down([
			[
				"DATA",
				{
					kind: "status",
					requestId: input.requestId,
					operationId: input.operationId,
					effectRunId: input.effectRunId,
					status: nextStatus,
					sourceRefs: defaultEvidenceRefs(input),
					...(statusIssues === undefined ? {} : { issues: statusIssues }),
					metadata: Object.freeze({
						adapterInputId: input.adapterInputId,
						providerId: input.providerId,
						toolName: input.toolName,
					}),
				} satisfies AgentRequestStatusChanged,
			],
		]);
	}

	function publishOutcome(
		input: ToolProviderAdapterInput<HttpToolArguments>,
		request: ToolProviderAdapterRunRequested,
		result: ToolProviderAdapterRunResult<HttpToolResult>,
	): void {
		const outcome = buildToolProviderExecutorOutcome(input, result, {
			runId: request.runId,
			attempt: request.attempt,
			occurredAtMs: nowMs(),
			publicText: opts.publicText,
		});
		outcomes.down([["DATA", outcome]]);
		const statusIssues = outcomeIssues(outcome);
		for (const statusIssue of statusIssues) publishIssue(statusIssue);
		publishRequestStatus(input, agentStatusForOutcome(outcome), statusIssues);
		publishRunStatus(request, outcome.kind, statusIssues, outcome.outcomeId);
		publishAudit("http-tool-provider-runtime-finished", input.requestId, {
			runId: request.runId,
			attempt: request.attempt,
			status: outcome.kind,
			outcomeId: outcome.outcomeId,
		});
	}

	function execute(request: ToolProviderAdapterRunRequested): void {
		if (disposed || (request.providerId !== undefined && request.providerId !== providerId)) return;
		const input = inputs.get(request.adapterInputId);
		if (input === undefined || input.providerId !== providerId) return;
		const coordinate = canonicalTupleKey([
			request.runId,
			request.adapterInputId,
			String(request.attempt),
		]);
		if (executions.has(coordinate)) return;
		executions.add(coordinate);
		publishRunStatus(request, "requested");
		if (input.status !== "ready") {
			const inputIssue = issue(
				"http-tool-provider-input-not-ready",
				"HTTP tool provider runtime requires a ready adapter input.",
			);
			publishIssue(inputIssue);
			publishRunStatus(request, "stale-request", [inputIssue]);
			publishRequestStatus(input, "blocked", [inputIssue]);
			return;
		}
		if (!requestMatchesInput(request, input)) {
			const mismatch = issue(
				"http-tool-provider-run-request-mismatched-input",
				"HTTP tool provider run request does not match its adapter input.",
			);
			publishIssue(mismatch);
			publishRunStatus(request, "mismatched-request", [mismatch]);
			publishRequestStatus(input, "blocked", [mismatch]);
			return;
		}
		const prepared = prepareHttpRequest(input, config);
		if (prepared.kind === "blocked") {
			publishOutcome(input, request, {
				kind: "blocked",
				needs: Object.freeze([
					Object.freeze({
						kind: prepared.issue.code,
						message: prepared.issue.message,
					}),
				]),
				issues: Object.freeze([prepared.issue]),
				evidenceRefs: defaultEvidenceRefs(input),
			});
			return;
		}
		if (config.approvalMode === "never") {
			publishOutcome(input, request, {
				kind: "blocked",
				needs: Object.freeze([
					Object.freeze({
						kind: "tool-provider-approval-disabled",
						message: "HTTP tool provider policy disallows execution.",
					}),
				]),
				issues: Object.freeze([
					issue("http-tool-provider-approval-never", "HTTP tool provider execution is disabled."),
				]),
				evidenceRefs: defaultEvidenceRefs(input),
			});
			return;
		}
		if (config.approvalMode === "require" && !requestApproved(request)) {
			publishOutcome(input, request, {
				kind: "blocked",
				needs: Object.freeze([
					Object.freeze({
						kind: "tool-provider-approval",
						message: "HTTP tool provider execution requires a visible approval run request.",
					}),
				]),
				issues: Object.freeze([
					issue(
						"http-tool-provider-approval-required",
						"HTTP tool provider execution requires approval.",
					),
				]),
				evidenceRefs: defaultEvidenceRefs(input),
			});
			return;
		}
		const controller = new AbortController();
		active.add(controller);
		publishRunStatus(request, "started");
		publishRequestStatus(input, "in-flight");
		publishAudit("http-tool-provider-runtime-started", input.requestId, {
			runId: request.runId,
			attempt: request.attempt,
			method: prepared.request.method,
			origin: new URL(prepared.request.url).origin,
		});
		const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
		Promise.resolve(driver.fetch({ ...prepared.request, signal: controller.signal })).then(
			(response) => {
				clearTimeout(timeout);
				active.delete(controller);
				if (disposed) return;
				publishOutcome(input, request, httpResponseResult(prepared.request, response, config));
			},
			(error: unknown) => {
				clearTimeout(timeout);
				active.delete(controller);
				if (disposed) return;
				publishOutcome(input, request, httpErrorResult(error, config));
			},
		);
	}

	const unsubscribeInputs = opts.inputs.subscribe((msg) => {
		if (msg[0] !== "DATA") return;
		const input = msg[1] as ToolProviderAdapterInput<HttpToolArguments>;
		if (input.providerId === providerId) inputs.set(input.adapterInputId, input);
	});
	const autoRunReadyInputs =
		opts.autoRunReadyInputs ?? (opts.runRequests === undefined || opts.runRequests.length === 0);
	const runProjector = toolProviderAdapterRunProjector(graph, {
		name: `${name}/runs`,
		inputs: opts.inputs,
		runRequests: opts.runRequests,
		autoRunReadyInputs,
		now: opts.now,
	});
	const unsubscribeRunStatus = runProjector.status.subscribe((msg) => {
		if (msg[0] !== "DATA") return;
		const nextStatus = msg[1] as ToolProviderAdapterRunStatus;
		const statusKey = canonicalTupleKey([nextStatus.runId, nextStatus.status]);
		if (forwardedRunStatusKeys.has(statusKey)) return;
		forwardedRunStatusKeys.add(statusKey);
		runStatus.down([["DATA", nextStatus]]);
	});
	const unsubscribeRunIssues = runProjector.issues.subscribe((msg) => {
		if (msg[0] === "DATA") publishIssue(msg[1] as DataIssue);
	});
	const unsubscribeRunAudit = runProjector.audit.subscribe((msg) => {
		if (msg[0] === "DATA") audit.down([["DATA", msg[1] as AgentRuntimeAuditRecord]]);
	});
	const unsubscribeRunRequests = runProjector.requests.subscribe((msg) => {
		if (msg[0] === "DATA") execute(msg[1] as ToolProviderAdapterRunRequested);
	});
	return Object.freeze({
		catalogs: Object.freeze([catalog]),
		runRequests: runProjector.requests,
		runStatus,
		outcomes,
		status,
		issues,
		audit,
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribeInputs();
			unsubscribeRunStatus();
			unsubscribeRunIssues();
			unsubscribeRunAudit();
			unsubscribeRunRequests();
			for (const controller of active) controller.abort();
			active.clear();
		},
	} satisfies HttpToolProviderRuntimeBundle);
}

function localDateNow(
	input: ToolProviderAdapterInput<LocalBuiltinToolArguments>,
	ctx: ToolProviderAdapterRunContext,
	now: (() => number) | undefined,
): ToolProviderAdapterRunResult<LocalBuiltinToolResult> {
	const epochMs = now?.() ?? ctx.now?.() ?? Date.now();
	return Object.freeze({
		kind: "result",
		result: Object.freeze({
			kind: "json",
			value: Object.freeze({
				toolName: "date.now" as const,
				epochMs,
				iso: new Date(epochMs).toISOString(),
			}),
			summary: String(epochMs),
		}),
		occurredAtMs: epochMs,
		evidenceRefs: input.sourceRefs,
	} satisfies ToolProviderAdapterRunResult<LocalBuiltinToolResult>);
}

function localJsonParse(
	input: ToolProviderAdapterInput<LocalBuiltinToolArguments>,
	maxTextChars: number,
): ToolProviderAdapterRunResult<LocalBuiltinToolResult> {
	const text = input.toolCall?.arguments?.text;
	if (typeof text !== "string") {
		return failure(
			input,
			"local-json-parse-missing-text",
			"json.parse requires a string text argument.",
		);
	}
	if (text.length > maxTextChars) {
		return failure(
			input,
			"local-json-parse-text-too-large",
			"json.parse text exceeds maxTextChars.",
		);
	}
	try {
		const value = JSON.parse(text) as unknown;
		return Object.freeze({
			kind: "result",
			result: Object.freeze({
				kind: "json",
				value: Object.freeze({ toolName: "json.parse" as const, value }),
				summary: "parsed JSON",
			}),
			evidenceRefs: input.sourceRefs,
		} satisfies ToolProviderAdapterRunResult<LocalBuiltinToolResult>);
	} catch {
		return failure(input, "local-json-parse-invalid-json", "json.parse received invalid JSON.");
	}
}

function localTextConcat(
	input: ToolProviderAdapterInput<LocalBuiltinToolArguments>,
	maxTextChars: number,
): ToolProviderAdapterRunResult<LocalBuiltinToolResult> {
	const parts = input.toolCall?.arguments?.parts;
	if (!Array.isArray(parts)) {
		return failure(input, "local-text-concat-missing-parts", "text.concat requires a parts array.");
	}
	const separator = input.toolCall?.arguments?.separator ?? "";
	if (typeof separator !== "string") {
		return failure(
			input,
			"local-text-concat-invalid-separator",
			"text.concat separator must be a string.",
		);
	}
	const text = parts.map((part) => String(part)).join(separator);
	if (text.length > maxTextChars) {
		return failure(
			input,
			"local-text-concat-too-large",
			"text.concat result exceeds maxTextChars.",
		);
	}
	return Object.freeze({
		kind: "result",
		result: Object.freeze({
			kind: "text",
			value: Object.freeze({ toolName: "text.concat" as const, text }),
			summary: text,
		}),
		evidenceRefs: input.sourceRefs,
	} satisfies ToolProviderAdapterRunResult<LocalBuiltinToolResult>);
}

interface ProcessConfig {
	readonly allowedCommands: ReadonlyMap<string, ProcessToolAllowedCommand>;
	readonly duplicateCommands: ReadonlySet<string>;
	readonly invalidCommands: ReadonlySet<string>;
	readonly workingDirectory: string;
	readonly allowedWorkingDirectories: readonly string[];
	readonly baseEnv: Readonly<Record<string, string>>;
	readonly allowedEnvKeys: ReadonlySet<string>;
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
	readonly maxSummaryChars: number;
}

function processConfig(opts: ProcessToolProviderBindingOptions): ProcessConfig {
	const workingDirectory = resolve(opts.workingDirectory ?? ".");
	const allowedWorkingDirectories = Object.freeze(
		(opts.allowedWorkingDirectories ?? [workingDirectory]).map((dir) => resolve(dir)),
	);
	const allowed = normalizeAllowedCommands(opts.allowedCommands ?? []);
	return {
		allowedCommands: allowed.commands,
		duplicateCommands: allowed.duplicates,
		invalidCommands: allowed.invalids,
		workingDirectory,
		allowedWorkingDirectories,
		baseEnv: Object.freeze({ ...(opts.baseEnv ?? {}) }),
		allowedEnvKeys: new Set(opts.allowedEnvKeys ?? []),
		timeoutMs: positiveFinite(opts.timeoutMs, 10_000),
		maxOutputBytes: Math.max(1, nonNegativeFinite(opts.maxOutputBytes, 64 * 1024)),
		maxSummaryChars: Math.max(1, nonNegativeFinite(opts.maxSummaryChars, 512)),
	};
}

function processArguments(
	input: ToolProviderAdapterInput<ProcessToolArguments>,
):
	| (Required<Pick<ProcessToolArguments, "command" | "args">> &
			Pick<ProcessToolArguments, "cwd" | "env" | "input">)
	| undefined {
	const raw = input.toolCall?.arguments;
	if (!isRecord(raw) || typeof raw.command !== "string" || raw.command.length === 0) {
		return undefined;
	}
	const rawArgs = raw.args === undefined ? Object.freeze([]) : stringArray(raw.args);
	if (rawArgs === undefined) return undefined;
	if (raw.cwd !== undefined && typeof raw.cwd !== "string") return undefined;
	if (raw.input !== undefined && typeof raw.input !== "string") return undefined;
	const rawEnv = raw.env === undefined ? undefined : processArgumentEnv(raw.env);
	if (raw.env !== undefined && rawEnv === undefined) return undefined;
	return {
		command: raw.command,
		args: rawArgs,
		...(raw.cwd === undefined ? {} : { cwd: raw.cwd }),
		...(rawEnv === undefined ? {} : { env: rawEnv }),
		...(raw.input === undefined ? {} : { input: raw.input }),
	};
}

function argsAllowed(command: ProcessToolAllowedCommand, args: readonly string[]): boolean {
	if (command.allowArgs === true) return true;
	if (typeof command.allowArgs === "function") return command.allowArgs(args);
	if (command.allowArgs === undefined) return args.length === 0;
	return arraysEqual(command.allowArgs, args);
}

function resolveProcessCwd(
	requestedCwd: string | undefined,
	command: ProcessToolAllowedCommand,
	config: ProcessConfig,
): string | undefined {
	const rawCwd = command.cwd ?? requestedCwd;
	const cwd =
		rawCwd === undefined
			? config.workingDirectory
			: isAbsolute(rawCwd)
				? resolve(rawCwd)
				: resolve(config.workingDirectory, rawCwd);
	const realCwd = realpath(cwd);
	if (realCwd === undefined) return undefined;
	return config.allowedWorkingDirectories.some((allowed) => {
		const realAllowed = realpath(allowed);
		return realAllowed !== undefined && isPathInside(realCwd, realAllowed);
	})
		? cwd
		: undefined;
}

function processEnv(
	inputEnv: ProcessToolArguments["env"],
	config: ProcessConfig,
): Readonly<Record<string, string>> | undefined {
	const env: Record<string, string> = { ...config.baseEnv };
	for (const [key, value] of Object.entries(inputEnv ?? {})) {
		if (!config.allowedEnvKeys.has(key)) return undefined;
		if (value !== undefined) env[key] = String(value);
	}
	return Object.freeze(env);
}

function processArgumentEnv(value: unknown): ProcessToolArguments["env"] | undefined {
	if (!isRecord(value)) return undefined;
	const env: Record<string, string | number | boolean | undefined> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (
			entry !== undefined &&
			typeof entry !== "string" &&
			typeof entry !== "number" &&
			typeof entry !== "boolean"
		) {
			return undefined;
		}
		env[key] = entry;
	}
	return Object.freeze(env);
}

function runProcessTool(
	input: ToolProviderAdapterInput<ProcessToolArguments>,
	allowed: ProcessToolAllowedCommand,
	args: Required<Pick<ProcessToolArguments, "command" | "args">> &
		Pick<ProcessToolArguments, "input">,
	cwd: string,
	env: Readonly<Record<string, string>>,
	config: ProcessConfig,
): ToolProviderAdapterRunResult<ProcessToolResult> {
	const executable = allowed.executable ?? args.command;
	const argv = Object.freeze([...(allowed.fixedArgs ?? []), ...args.args]);
	const result = spawnSync(executable, argv, {
		cwd,
		env,
		input: args.input,
		encoding: "buffer",
		shell: false,
		timeout: config.timeoutMs,
		maxBuffer: config.maxOutputBytes + 1,
	});
	const stdout = result.stdout ?? Buffer.alloc(0);
	const stderr = result.stderr ?? Buffer.alloc(0);
	const truncated = stdout.length + stderr.length > config.maxOutputBytes;
	if (result.error !== undefined && isTimeoutError(result.error)) {
		return Object.freeze({
			kind: "timeout",
			timeoutMs: config.timeoutMs,
			retryable: true,
			evidenceRefs: input.sourceRefs,
		} satisfies ToolProviderAdapterRunResult<ProcessToolResult>);
	}
	if (result.error !== undefined || truncated) {
		return failure(
			input,
			truncated || isOutputLimitError(result.error)
				? "process-output-limit-exceeded"
				: "process-spawn-failed",
			truncated || isOutputLimitError(result.error)
				? "Process output exceeded maxOutputBytes."
				: "Process execution failed before producing an exit result.",
		);
	}
	const value = processResult(
		args.command,
		argv,
		cwd,
		result.status,
		result.signal,
		stdout,
		stderr,
		config,
	);
	if ((result.status ?? 1) !== 0) {
		return Object.freeze({
			kind: "failure",
			error: issue("process-exit-nonzero", "Process exited with a non-zero status.", "error", {
				exitCode: result.status,
				signal: result.signal ?? undefined,
			}),
			retryable: false,
			evidenceRefs: input.sourceRefs,
			metadata: Object.freeze({
				command: args.command,
				exitCode: result.status,
				signal: result.signal ?? undefined,
				outputBytes: value.outputBytes,
				errorOutputBytes: value.errorOutputBytes,
			}),
		} satisfies ToolProviderAdapterRunResult<ProcessToolResult>);
	}
	return Object.freeze({
		kind: "result",
		result: Object.freeze({
			kind: "process-result",
			value,
			summary: value.outputPreview ?? `process exited ${value.exitCode ?? 0}`,
			artifacts: processArtifacts(stdout, stderr, config, input.sourceRefs),
		}),
		evidenceRefs: input.sourceRefs,
	} satisfies ToolProviderAdapterRunResult<ProcessToolResult>);
}

function processResult(
	command: string,
	args: readonly string[],
	cwd: string,
	exitCode: number | null,
	signal: NodeJS.Signals | null,
	stdout: Buffer,
	stderr: Buffer,
	config: ProcessConfig,
): ProcessToolResult {
	return Object.freeze({
		command,
		args,
		cwd,
		exitCode,
		...(signal === null ? {} : { signal }),
		outputPreview: preview(stdout, config.maxSummaryChars),
		errorPreview: preview(stderr, config.maxSummaryChars),
		outputBytes: stdout.length,
		errorOutputBytes: stderr.length,
		truncated: false,
	});
}

function processArtifacts(
	stdout: Buffer,
	stderr: Buffer,
	config: ProcessConfig,
	sourceRefs: readonly SourceRef[] | undefined,
): readonly ExecutorArtifactMaterial<string>[] | undefined {
	const artifacts = [
		processTextArtifact("process-stdout", stdout, config, sourceRefs),
		processTextArtifact("process-stderr", stderr, config, sourceRefs),
	].filter((artifact): artifact is ExecutorArtifactMaterial<string> => artifact !== undefined);
	return artifacts.length === 0 ? undefined : Object.freeze(artifacts);
}

function processTextArtifact(
	kind: "process-stdout" | "process-stderr",
	bytes: Buffer,
	config: ProcessConfig,
	sourceRefs: readonly SourceRef[] | undefined,
): ExecutorArtifactMaterial<string> | undefined {
	if (bytes.length === 0) return undefined;
	const text = bytes.toString("utf8");
	const inline = text.length <= config.maxSummaryChars;
	return Object.freeze({
		kind,
		format: "text",
		mediaType: "text/plain",
		encoding: "utf8",
		byteLength: bytes.length,
		dataMode: inline ? "inline" : "summary",
		summary: preview(bytes, config.maxSummaryChars),
		...(inline ? { value: text } : {}),
		...(sourceRefs === undefined ? {} : { sourceRefs }),
		sizeEvidence: Object.freeze([
			sizeEvidence(bytes.length, "adapter-measured-process-output", sourceRefs),
		]),
	} satisfies ExecutorArtifactMaterial<string>);
}

function processToolProviderExecutionPolicy(
	providerId: string,
	profileId: string,
	opts: ProcessToolProviderBindingOptions,
): ToolProviderExecutionPolicy {
	const maxOutputBytes = Math.max(1, nonNegativeFinite(opts.maxOutputBytes, 64 * 1024));
	return Object.freeze({
		kind: "tool-provider-execution-policy",
		policyId: `${providerId}:policy:process-v0`,
		providerId,
		profileIds: Object.freeze([profileId]),
		toolNames: Object.freeze(["process.execFile"]),
		operations: Object.freeze(["run"]),
		sizeCapacity: Object.freeze({
			limits: Object.freeze([
				Object.freeze({
					unit: "bytes",
					hardLimit: maxOutputBytes,
					perRequest: true,
					measurementSource: "adapter-measured",
				} satisfies ToolProviderSizeLimit),
			]),
		}),
		timeout: Object.freeze({ timeoutMs: positiveFinite(opts.timeoutMs, 10_000) }),
		redaction: Object.freeze({
			mode: "summary",
			summaryMaxChars: nonNegativeFinite(opts.maxSummaryChars, 512),
		}),
		filesystem: Object.freeze({
			cwd: opts.workingDirectory ?? ".",
			allowRead: false,
			allowWrite: false,
			followSymlinks: false,
			pathRules: Object.freeze(
				(opts.allowedWorkingDirectories ?? [opts.workingDirectory ?? "."]).map((path) =>
					Object.freeze({
						effect: "allow",
						path,
						operation: "run",
						reason: "Process adapter cwd allowlist.",
					}),
				),
			),
		}),
		approval: Object.freeze({ mode: "auto" }),
		metadata: Object.freeze({
			argv: true,
			shell: false,
			allowedEnvKeys: Object.freeze([...(opts.allowedEnvKeys ?? [])]),
		}),
	} satisfies ToolProviderExecutionPolicy);
}

interface HttpRuntimeConfig {
	readonly allowedOrigins: ReadonlySet<string>;
	readonly allowedMethods: ReadonlySet<string>;
	readonly allowedRequestHeaders: ReadonlySet<string>;
	readonly exposedResponseHeaders: ReadonlySet<string>;
	readonly timeoutMs: number;
	readonly maxResponseBytes: number;
	readonly maxInlineBodyChars: number;
	readonly approvalMode: "auto" | "require" | "never";
}

function httpRuntimeConfig(opts: HttpToolProviderRuntimeOptions): HttpRuntimeConfig {
	return {
		allowedOrigins: new Set(opts.allowedOrigins ?? []),
		allowedMethods: new Set(normalizeMethods(opts.allowedMethods ?? ["GET"])),
		allowedRequestHeaders: new Set(normalizeHeaderNames(opts.allowedRequestHeaders ?? [])),
		exposedResponseHeaders: new Set(normalizeHeaderNames(opts.exposedResponseHeaders ?? [])),
		timeoutMs: positiveFinite(opts.timeoutMs, 10_000),
		maxResponseBytes: Math.max(1, nonNegativeFinite(opts.maxResponseBytes, 64 * 1024)),
		maxInlineBodyChars: Math.max(1, nonNegativeFinite(opts.maxInlineBodyChars, 4_096)),
		approvalMode: opts.approvalMode ?? "auto",
	};
}

function httpToolProviderExecutionPolicy(
	providerId: string,
	profileId: string,
	opts: Omit<HttpToolProviderRuntimeOptions, "inputs" | "runRequests" | "driver">,
): ToolProviderExecutionPolicy {
	const allowedOrigins = Object.freeze([...(opts.allowedOrigins ?? [])]);
	const allowedMethods = Object.freeze(normalizeMethods(opts.allowedMethods ?? ["GET"]));
	const maxResponseBytes = Math.max(1, nonNegativeFinite(opts.maxResponseBytes, 64 * 1024));
	return Object.freeze({
		kind: "tool-provider-execution-policy",
		policyId: `${providerId}:policy:http-v0`,
		providerId,
		profileIds: Object.freeze([profileId]),
		toolNames: Object.freeze(["http.fetch"]),
		operations: Object.freeze(["fetch"]),
		sizeCapacity: Object.freeze({
			limits: Object.freeze([
				Object.freeze({
					unit: "bytes",
					hardLimit: maxResponseBytes,
					perRequest: true,
					measurementSource: "adapter-measured-response-body",
				} satisfies ToolProviderSizeLimit),
			]),
		}),
		timeout: Object.freeze({ timeoutMs: positiveFinite(opts.timeoutMs, 10_000) }),
		redaction: Object.freeze({
			mode: "summary",
			summaryMaxChars: nonNegativeFinite(opts.maxInlineBodyChars, 4_096),
		}),
		network: Object.freeze({
			mode: "allowlist",
			protocols: Object.freeze(["http:", "https:"]),
			allowedHosts: allowedOrigins,
			metadata: Object.freeze({ allowlistKind: "origin" }),
		}),
		approval: Object.freeze({ mode: opts.approvalMode ?? "auto" }),
		artifacts: Object.freeze({
			defaultDataMode: "summary",
			inlineLimits: Object.freeze([
				Object.freeze({
					unit: "chars",
					hardLimit: Math.max(1, nonNegativeFinite(opts.maxInlineBodyChars, 4_096)),
					perArtifact: true,
					measurementSource: "js-string-length",
				} satisfies ToolProviderSizeLimit),
			]),
			artifactKinds: Object.freeze(["http-response-body"]),
		}),
		metadata: Object.freeze({
			allowedOrigins,
			allowedMethods,
			allowedRequestHeaders: Object.freeze([...(opts.allowedRequestHeaders ?? [])]),
			exposedResponseHeaders: Object.freeze([...(opts.exposedResponseHeaders ?? [])]),
			asyncRuntime: true,
		}),
	} satisfies ToolProviderExecutionPolicy);
}

function prepareHttpRequest(
	input: ToolProviderAdapterInput<HttpToolArguments>,
	config: HttpRuntimeConfig,
):
	| { readonly kind: "ready"; readonly request: HttpToolProviderDriverRequest }
	| { readonly kind: "blocked"; readonly issue: DataIssue } {
	const raw = input.toolCall?.arguments;
	if (!isRecord(raw) || typeof raw.url !== "string") {
		return {
			kind: "blocked",
			issue: issue("http-invalid-arguments", "http.fetch requires a string url argument."),
		};
	}
	let url: URL;
	try {
		url = new URL(raw.url);
	} catch {
		return { kind: "blocked", issue: issue("http-invalid-url", "http.fetch url is invalid.") };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			kind: "blocked",
			issue: issue("http-protocol-not-allowed", "http.fetch only allows http and https URLs."),
		};
	}
	if (!config.allowedOrigins.has(url.origin)) {
		return {
			kind: "blocked",
			issue: issue("http-origin-not-allowed", "http.fetch origin is not allowlisted."),
		};
	}
	const method = normalizeMethod(raw.method ?? "GET");
	if (method === undefined || !config.allowedMethods.has(method)) {
		return {
			kind: "blocked",
			issue: issue("http-method-not-allowed", "http.fetch method is not allowlisted."),
		};
	}
	if (raw.body !== undefined && typeof raw.body !== "string") {
		return {
			kind: "blocked",
			issue: issue("http-invalid-body", "http.fetch body must be a string when provided."),
		};
	}
	const headers = httpArgumentHeaders(raw.headers, config);
	if (headers === undefined) {
		return {
			kind: "blocked",
			issue: issue("http-request-header-not-allowed", "http.fetch header is not allowlisted."),
		};
	}
	return {
		kind: "ready",
		request: Object.freeze({
			url: url.toString(),
			method,
			headers,
			...(raw.body === undefined ? {} : { body: raw.body }),
		}),
	};
}

function httpArgumentHeaders(
	value: unknown,
	config: HttpRuntimeConfig,
): Readonly<Record<string, string>> | undefined {
	if (value === undefined) return Object.freeze({});
	if (!isRecord(value)) return undefined;
	const headers: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		const normalized = key.toLowerCase();
		if (!config.allowedRequestHeaders.has(normalized)) return undefined;
		if (
			entry !== undefined &&
			typeof entry !== "string" &&
			typeof entry !== "number" &&
			typeof entry !== "boolean"
		) {
			return undefined;
		}
		if (entry !== undefined) headers[key] = String(entry);
	}
	return Object.freeze(headers);
}

function httpResponseResult(
	request: HttpToolProviderDriverRequest,
	response: HttpToolProviderDriverResponse,
	config: HttpRuntimeConfig,
): ToolProviderAdapterRunResult<HttpToolResult> {
	const hasInlineBody = response.bodyText !== undefined;
	const bodyText = response.bodyText ?? "";
	const bodyBytes = response.bodyBytes ?? textBytes(bodyText);
	const hasBodyRef = response.bodyRef !== undefined;
	if (bodyBytes > config.maxResponseBytes && !hasBodyRef) {
		return {
			kind: "failure",
			error: issue("http-response-too-large", "HTTP response body exceeded maxResponseBytes."),
			retryable: false,
			metadata: Object.freeze({ bodyBytes, maxResponseBytes: config.maxResponseBytes }),
		};
	}
	const inline =
		hasInlineBody &&
		bodyBytes <= config.maxResponseBytes &&
		bodyText.length <= config.maxInlineBodyChars;
	const result: HttpToolResult = Object.freeze({
		url: response.url ?? request.url,
		method: request.method,
		status: response.status,
		statusText: response.statusText ?? "",
		headers: filterResponseHeaders(response.headers, config.exposedResponseHeaders),
		bodyPreview: hasInlineBody ? previewText(bodyText, config.maxInlineBodyChars) : undefined,
		...(inline ? { bodyText } : {}),
		bodyBytes,
		bodyTruncated:
			bodyBytes > config.maxResponseBytes || bodyText.length > config.maxInlineBodyChars,
		dataMode: inline ? "inline" : hasBodyRef ? "ref" : "summary",
		...(response.bodyRef === undefined ? {} : { bodyRef: response.bodyRef }),
	});
	return {
		kind: "result",
		result: Object.freeze({
			kind: "http-result",
			value: result,
			summary: `${request.method} ${response.status} ${response.url ?? request.url}`,
			refs: response.bodyRef === undefined ? undefined : Object.freeze([response.bodyRef]),
			artifacts: Object.freeze([httpBodyArtifact(result, response.bodyRef)]),
		}),
		issues:
			!inline && !hasBodyRef
				? Object.freeze([
						issue(
							"http-response-body-summary-only",
							"HTTP response body was summarized without a durable body ref.",
							"warning",
						),
					])
				: undefined,
		metadata: Object.freeze({ status: response.status, bodyBytes }),
	};
}

function httpBodyArtifact(
	result: HttpToolResult,
	bodyRef: SourceRef | undefined,
): ExecutorArtifactMaterial<string> {
	return Object.freeze({
		kind: "http-response-body",
		format: "text",
		byteLength: result.bodyBytes,
		dataMode: result.dataMode,
		...(result.bodyPreview === undefined ? {} : { summary: result.bodyPreview }),
		...(result.dataMode === "inline" && result.bodyText !== undefined
			? { value: result.bodyText }
			: {}),
		...(bodyRef === undefined ? {} : { ref: bodyRef, refs: Object.freeze([bodyRef]) }),
		sizeEvidence: Object.freeze([
			sizeEvidence(result.bodyBytes, "adapter-measured-http-response-body", undefined),
		]),
	} satisfies ExecutorArtifactMaterial<string>);
}

function httpErrorResult(
	error: unknown,
	config: HttpRuntimeConfig,
): ToolProviderAdapterRunResult<HttpToolResult> {
	const aborted = error instanceof Error && error.name === "AbortError";
	if (aborted) {
		return { kind: "timeout", timeoutMs: config.timeoutMs, retryable: true };
	}
	return {
		kind: "failure",
		error: issue("http-fetch-failed", "HTTP fetch failed before producing a response."),
		retryable: true,
		metadata: Object.freeze({ errorType: error instanceof Error ? error.name : typeof error }),
	};
}

function defaultHttpToolProviderDriver(maxResponseBytes: number): HttpToolProviderDriver {
	return Object.freeze({
		fetch(request: HttpToolProviderDriverRequest) {
			const fetchImpl = globalThis.fetch;
			if (typeof fetchImpl !== "function") {
				throw new Error("global fetch is unavailable");
			}
			return fetchImpl(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
				redirect: "manual",
				signal: request.signal,
			}).then((response) =>
				readResponseBody(response, maxResponseBytes).then((body) =>
					Object.freeze({
						url: response.url,
						status: response.status,
						statusText: response.statusText,
						headers: responseHeaders(response.headers),
						bodyText: body.text,
						bodyBytes: body.bytes,
					} satisfies HttpToolProviderDriverResponse),
				),
			);
		},
	});
}

function readResponseBody(
	response: Response,
	maxBytes: number,
): Promise<{ readonly text: string; readonly bytes: number }> {
	const body = response.body;
	if (body === null) return Promise.resolve({ text: "", bytes: 0 });
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let bytes = 0;
	function pump(): Promise<{ readonly text: string; readonly bytes: number }> {
		return reader.read().then((next) => {
			if (next.done) {
				chunks.push(decoder.decode());
				return { text: chunks.join(""), bytes };
			}
			bytes += next.value.byteLength;
			if (bytes > maxBytes) {
				reader.cancel().catch(() => {});
				return { text: chunks.join(""), bytes };
			}
			chunks.push(decoder.decode(next.value, { stream: true }));
			return pump();
		});
	}
	return pump();
}

function responseHeaders(headers: Headers): Readonly<Record<string, string>> {
	const out: Record<string, string> = {};
	headers.forEach((value, key) => {
		out[key] = value;
	});
	return Object.freeze(out);
}

function filterResponseHeaders(
	headers: Readonly<Record<string, string>> | undefined,
	exposed: ReadonlySet<string>,
): Readonly<Record<string, string>> | undefined {
	if (headers === undefined || exposed.size === 0) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (exposed.has(key.toLowerCase())) out[key] = value;
	}
	return Object.keys(out).length === 0 ? undefined : Object.freeze(out);
}

function requestMatchesInput(
	request: ToolProviderAdapterRunRequested,
	input: ToolProviderAdapterInput,
): boolean {
	return (
		request.adapterInputId === input.adapterInputId &&
		request.requestId === input.requestId &&
		request.operationId === input.operationId &&
		(request.routeId === undefined || request.routeId === input.routeId) &&
		(request.executorId === undefined || request.executorId === input.executorId) &&
		(request.profileId === undefined || request.profileId === input.profileId)
	);
}

function requestApproved(request: ToolProviderAdapterRunRequested): boolean {
	const metadata = request.metadata;
	return (
		isRecord(metadata) &&
		(metadata.approval === "granted" ||
			metadata.approvalGranted === true ||
			(isAdmissionApprovedMetadata(metadata) && hasAdmissionSourceRef(request.sourceRefs)))
	);
}

function isAdmissionApprovedMetadata(metadata: Record<string, unknown>): boolean {
	return (
		typeof metadata.admissionId === "string" &&
		metadata.admissionId.length > 0 &&
		typeof metadata.proposalId === "string" &&
		metadata.proposalId.length > 0 &&
		typeof metadata.approvedFromRunId === "string" &&
		metadata.approvedFromRunId.length > 0
	);
}

function hasAdmissionSourceRef(sourceRefs: readonly SourceRef[] | undefined): boolean {
	return (sourceRefs ?? []).some(
		(sourceRef) =>
			sourceRef.kind === "tool-provider-run-admission" ||
			sourceRef.kind === "tool-provider-run-admission-decision",
	);
}

function defaultEvidenceRefs(input: ToolProviderAdapterInput): readonly SourceRef[] {
	return Object.freeze([
		{ kind: "tool-provider-adapter-input", id: input.adapterInputId },
		...(input.sourceRefs ?? []),
	]);
}

function outcomeIssues(outcome: ExecutorOutcome): readonly DataIssue[] {
	if (outcome.kind === "failure") return Object.freeze([outcome.error, ...(outcome.issues ?? [])]);
	return outcome.issues ?? [];
}

function agentStatusForOutcome(outcome: ExecutorOutcome): AgentRequestStatusChanged["status"] {
	switch (outcome.kind) {
		case "result":
			return "completed";
		case "failure":
			return "failed";
		case "blocked":
			return "blocked";
		case "canceled":
			return "canceled";
		case "timeout":
			return "timeout";
	}
}

function normalizeMethods(methods: readonly string[]): readonly string[] {
	return Object.freeze(
		methods
			.map((method) => normalizeMethod(method))
			.filter((method): method is string => method !== undefined),
	);
}

function normalizeMethod(method: unknown): string | undefined {
	return typeof method === "string" && method.length > 0 ? method.toUpperCase() : undefined;
}

function normalizeHeaderNames(headers: readonly string[]): readonly string[] {
	return Object.freeze(
		headers
			.filter((header) => typeof header === "string" && header.length > 0)
			.map((header) => header.toLowerCase()),
	);
}

function textBytes(text: string): number {
	return new TextEncoder().encode(text).byteLength;
}

function previewText(text: string, maxChars: number): string | undefined {
	if (text.length === 0) return undefined;
	return text.length <= maxChars ? text : text.slice(0, maxChars);
}

function blocked<T>(
	input: ToolProviderAdapterInput,
	code: string,
	message: string,
): ToolProviderAdapterRunResult<T> {
	return Object.freeze({
		kind: "blocked",
		needs: Object.freeze([
			Object.freeze({
				kind: code,
				message,
				refs:
					input.providerId === undefined
						? undefined
						: Object.freeze([{ kind: "tool-provider", id: input.providerId }]),
			}),
		]),
		issues: Object.freeze([issue(code, message, "error")]),
		evidenceRefs: input.sourceRefs,
	} satisfies ToolProviderAdapterRunResult<T>);
}

function failure<T>(
	input: ToolProviderAdapterInput,
	code: string,
	message: string,
): ToolProviderAdapterRunResult<T> {
	return Object.freeze({
		kind: "failure",
		error: issue(code, message, "error"),
		retryable: false,
		evidenceRefs: input.sourceRefs,
	} satisfies ToolProviderAdapterRunResult<T>);
}

function issue(
	code: string,
	message: string,
	severity: DataIssue["severity"] = "error",
	details?: unknown,
): DataIssue {
	return Object.freeze({
		kind: "issue",
		code,
		message,
		severity,
		...(details === undefined ? {} : { details }),
	} satisfies DataIssue);
}

function sizeEvidence(
	quantity: number,
	measurementSource: string,
	sourceRefs: readonly SourceRef[] | undefined,
): SizeCapacityEvidence {
	return Object.freeze({
		kind: "size-capacity-evidence",
		unit: "bytes",
		quantity,
		measurementSource,
		...(sourceRefs === undefined ? {} : { sourceRefs }),
	} satisfies SizeCapacityEvidence);
}

function nonNegativeFinite(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveFinite(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const entries = Array.from(value);
	if (!entries.every((entry) => typeof entry === "string")) return undefined;
	return Object.freeze(entries);
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeAllowedCommands(commands: readonly ProcessToolAllowedCommand[]): {
	readonly commands: ReadonlyMap<string, ProcessToolAllowedCommand>;
	readonly duplicates: ReadonlySet<string>;
	readonly invalids: ReadonlySet<string>;
} {
	const out = new Map<string, ProcessToolAllowedCommand>();
	const duplicates = new Set<string>();
	const invalids = new Set<string>();
	for (const command of commands) {
		if (typeof command.command !== "string" || command.command.length === 0) {
			invalids.add("<invalid-command>");
			continue;
		}
		const frozen = freezeAllowedCommand(command);
		if (frozen === undefined) {
			out.delete(command.command);
			invalids.add(command.command);
			continue;
		}
		if (out.has(command.command)) {
			out.delete(command.command);
			duplicates.add(command.command);
			continue;
		}
		if (duplicates.has(command.command) || invalids.has(command.command)) continue;
		out.set(command.command, frozen);
	}
	return { commands: out, duplicates, invalids };
}

function freezeAllowedCommand(
	command: ProcessToolAllowedCommand,
): ProcessToolAllowedCommand | undefined {
	const fixedArgs = command.fixedArgs === undefined ? undefined : stringArray(command.fixedArgs);
	if (command.fixedArgs !== undefined && fixedArgs === undefined) return undefined;
	const allowArgs = Array.isArray(command.allowArgs)
		? stringArray(command.allowArgs)
		: command.allowArgs;
	if (Array.isArray(command.allowArgs) && allowArgs === undefined) return undefined;
	return Object.freeze({
		command: command.command,
		...(command.executable === undefined ? {} : { executable: command.executable }),
		...(fixedArgs === undefined ? {} : { fixedArgs }),
		...(allowArgs === undefined ? {} : { allowArgs }),
		...(command.cwd === undefined ? {} : { cwd: command.cwd }),
	});
}

function realpath(path: string): string | undefined {
	try {
		return realpathSync.native(path);
	} catch {
		return undefined;
	}
}

function isPathInside(path: string, root: string): boolean {
	const normalizedPath = resolve(path);
	const normalizedRoot = resolve(root);
	const rel = relative(normalizedRoot, normalizedPath);
	return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel));
}

function isTimeoutError(error: Error): boolean {
	return (error as Error & { readonly code?: unknown }).code === "ETIMEDOUT";
}

function isOutputLimitError(error: Error | undefined): boolean {
	return (error as (Error & { readonly code?: unknown }) | undefined)?.code === "ENOBUFS";
}

function preview(buffer: Buffer, maxChars: number): string | undefined {
	if (buffer.length === 0) return undefined;
	const text = buffer.toString("utf8");
	return text.length <= maxChars ? text : text.slice(0, maxChars);
}
