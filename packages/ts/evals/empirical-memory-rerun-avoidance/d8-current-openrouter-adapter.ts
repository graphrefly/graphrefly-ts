import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderToolRef,
} from "./d6-current-provider-authority.js";
import type { CurrentGraphLiveExecutorV1 } from "./d8-current-live.js";
import {
	CURRENT_GRAPH_LIVE_BASELINE_COMMIT,
	CURRENT_GRAPH_LIVE_ENDPOINT,
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_PRICING,
	CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import type { CurrentGraphLiveCredentialV1 } from "./d8-current-live-preflight.js";

const MAX_PROCESS_BYTES = 2 * 1_048_576;
const MAX_PROVIDER_BYTES = 2 * 1_048_576;
export const CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK = `\t\tadmissionId,\n\t\tprincipalId,\n\t\tprincipalSessionRevision,\n\t\ttenantId,\n\t\tworkspaceId,\n\t\tresourceKind,\n\t\tresourceId,\n\t\tresourceRevision,\n\t\tpolicyRevision,\n\t\tmodelRevision,\n\t])\n\t\tassertSafe(value, "admitted coordinate");\n\tassertBoundedAuthorityId(admissionProposalId, "admission proposal coordinate");`;
export const CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK = `\t\tadmissionId,\n\t\tadmissionProposalId,\n\t\tprincipalId,\n\t\tprincipalSessionRevision,\n\t\ttenantId,\n\t\tworkspaceId,\n\t\tresourceKind,\n\t\tresourceId,\n\t\tresourceRevision,\n\t\tpolicyRevision,\n\t\tmodelRevision,\n\t])\n\t\tassertSafe(value, "admitted coordinate");`;
const TOOL_NAME_BY_REF = Object.freeze({
	"read-file": "read_file",
	"replace-exact": "replace_exact",
	"workspace-diff": "workspace_diff",
	"focused-validation": "focused_validation",
} satisfies Record<CurrentGraphProviderToolRef, string>);
const TOOL_REF_BY_NAME = new Map(
	Object.entries(TOOL_NAME_BY_REF).map(([toolRef, name]) => [
		name,
		toolRef as CurrentGraphProviderToolRef,
	]),
);

type ChatMessage = Readonly<Record<string, unknown>>;

interface WorkspaceState {
	readonly root: string;
	readonly runKey: string;
	readonly messages: ChatMessage[];
	readonly pendingToolCalls: Array<{
		readonly id: string;
		readonly toolRef: CurrentGraphProviderToolRef;
	}>;
	readonly requestBodies: Map<string, Uint8Array>;
	digest: string;
	cleaned: boolean;
}

export interface CurrentGraphOpenRouterExecutorV1 extends CurrentGraphLiveExecutorV1 {
	admitGraphAuthoredToolCalls(
		effect: CurrentGraphProviderAdmittedEffectV1,
		toolRefs: readonly ["workspace-diff", "focused-validation"],
	): void;
}

interface ProcessResult {
	readonly code: number;
	readonly stdout: Uint8Array;
	readonly stderr: Uint8Array;
	readonly elapsedMs: number;
}

export interface CurrentGraphOpenRouterAdapterOptionsV1 {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly credential: CurrentGraphLiveCredentialV1;
	readonly fetchImpl: typeof fetch;
	readonly now?: () => number;
	readonly sleep?: (milliseconds: number) => Promise<void>;
}

function boundedElapsed(started: number, now: () => number, ceiling: number): number {
	return Math.min(ceiling, Math.max(0, Math.ceil(now() - started)));
}

async function runProcess(input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly timeoutMs: number;
	readonly stdin?: Uint8Array;
}): Promise<ProcessResult> {
	const started = performance.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), input.timeoutMs);
	try {
		return await new Promise<ProcessResult>((resolvePromise, reject) => {
			const child = spawn(input.command, [...input.args], {
				cwd: input.cwd,
				env: { ...process.env, CI: "1", NO_COLOR: "1" },
				stdio: ["pipe", "pipe", "pipe"],
				signal: controller.signal,
			});
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let bytes = 0;
			const collect = (target: Buffer[], chunk: Buffer) => {
				bytes += chunk.byteLength;
				if (bytes > MAX_PROCESS_BYTES) {
					controller.abort();
					return;
				}
				target.push(chunk);
			};
			child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
			child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
			child.once("error", reject);
			child.once("close", (code) => {
				if (bytes > MAX_PROCESS_BYTES) {
					reject(new TypeError("current live subprocess exceeded its output bound"));
					return;
				}
				resolvePromise({
					code: code ?? 1,
					stdout: Buffer.concat(stdout),
					stderr: Buffer.concat(stderr),
					elapsedMs: Math.ceil(performance.now() - started),
				});
			});
			if (input.stdin === undefined) child.stdin.end();
			else child.stdin.end(input.stdin);
		});
	} finally {
		clearTimeout(timer);
	}
}

async function assertRegularFile(root: string, relativePath: string): Promise<string> {
	if (!CURRENT_GRAPH_LIVE_READABLE_FILES.includes(relativePath as never))
		throw new TypeError("current live read path is outside the admitted set");
	const path = resolve(root, relativePath);
	if (!path.startsWith(`${resolve(root)}/`))
		throw new TypeError("current live path escaped workspace");
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
		throw new TypeError("current live workspace file identity is invalid");
	return path;
}

async function workspaceDigest(state: WorkspaceState): Promise<string> {
	const file = await assertRegularFile(state.root, CURRENT_GRAPH_LIVE_WRITABLE_FILE);
	const bytes = await readFile(file);
	const diff = await runProcess({
		command: "git",
		args: ["diff", "--binary", "--", CURRENT_GRAPH_LIVE_WRITABLE_FILE],
		cwd: state.root,
		timeoutMs: 30_000,
	});
	if (diff.code !== 0) throw new TypeError("current live workspace diff inspection failed");
	return empiricalStrictJsonDigest({
		runKey: state.runKey,
		fileDigest: empiricalSha256(bytes),
		diffDigest: empiricalSha256(diff.stdout),
	});
}

async function createWorkspace(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly runKey: string;
}): Promise<WorkspaceState> {
	await mkdir(input.materializationRoot, { recursive: true, mode: 0o700 });
	const root = join(input.materializationRoot, input.runKey);
	const add = await runProcess({
		command: "git",
		args: ["worktree", "add", "--detach", root, CURRENT_GRAPH_LIVE_BASELINE_COMMIT],
		cwd: input.repositoryRoot,
		timeoutMs: 60_000,
	});
	if (add.code !== 0) throw new TypeError("current live worktree materialization failed");
	try {
		const targetPath = await assertRegularFile(root, CURRENT_GRAPH_LIVE_WRITABLE_FILE);
		const fixedSource = await readFile(targetPath, "utf8");
		const first = fixedSource.indexOf(CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK);
		if (first < 0 || fixedSource.indexOf(CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK, first + 1) >= 0)
			throw new TypeError("current live task fixture source drifted");
		await writeFile(
			targetPath,
			`${fixedSource.slice(0, first)}${CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK}${fixedSource.slice(first + CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK.length)}`,
			{ encoding: "utf8", mode: 0o644 },
		);
		const stage = await runProcess({
			command: "git",
			args: ["add", "--", CURRENT_GRAPH_LIVE_WRITABLE_FILE],
			cwd: root,
			timeoutMs: 30_000,
		});
		if (stage.code !== 0) throw new TypeError("current live task baseline staging failed");
		const commit = await runProcess({
			command: "git",
			args: [
				"-c",
				"user.name=GraphReFly Eval",
				"-c",
				"user.email=eval@invalid.local",
				"commit",
				"--no-gpg-sign",
				"-m",
				"current Graph-native D8 task baseline",
			],
			cwd: root,
			timeoutMs: 30_000,
		});
		if (commit.code !== 0) throw new TypeError("current live task baseline commit failed");
		for (const relative of ["node_modules", "packages/ts/node_modules"] as const) {
			const target = join(input.repositoryRoot, relative);
			const link = join(root, relative);
			await mkdir(dirname(link), { recursive: true });
			try {
				await symlink(target, link, "dir");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
		const state: WorkspaceState = {
			root,
			runKey: input.runKey,
			messages: [],
			pendingToolCalls: [],
			requestBodies: new Map(),
			digest: "",
			cleaned: false,
		};
		state.digest = await workspaceDigest(state);
		return state;
	} catch (error) {
		await runProcess({
			command: "git",
			args: ["worktree", "remove", "--force", root],
			cwd: input.repositoryRoot,
			timeoutMs: 30_000,
		}).catch(() => undefined);
		throw error;
	}
}

function toolDefinitions(allowed: readonly CurrentGraphProviderToolRef[]) {
	return allowed.map((toolRef) => {
		if (toolRef === "read-file")
			return {
				type: "function",
				function: {
					name: TOOL_NAME_BY_REF[toolRef],
					description: "Read one admitted workspace file.",
					parameters: {
						type: "object",
						additionalProperties: false,
						required: ["path"],
						properties: { path: { type: "string", enum: CURRENT_GRAPH_LIVE_READABLE_FILES } },
					},
				},
			};
		if (toolRef === "replace-exact")
			return {
				type: "function",
				function: {
					name: TOOL_NAME_BY_REF[toolRef],
					description:
						"Replace one exact occurrence in the admitted file. oldText must match the latest admitted read evidence exactly once, and newText must be byte-different from oldText.",
					parameters: {
						type: "object",
						additionalProperties: false,
						required: ["path", "oldText", "newText"],
						properties: {
							path: { type: "string", enum: [CURRENT_GRAPH_LIVE_WRITABLE_FILE] },
							oldText: { type: "string", minLength: 1, maxLength: 131_072 },
							newText: { type: "string", maxLength: 131_072 },
						},
					},
				},
			};
		return {
			type: "function",
			function: {
				name: TOOL_NAME_BY_REF[toolRef],
				description:
					toolRef === "workspace-diff"
						? "Inspect the current bounded workspace diff."
						: "Run the admitted focused validation.",
				parameters: { type: "object", additionalProperties: false, properties: {} },
			},
		};
	});
}

function bodyFor(effect: CurrentGraphProviderAdmittedEffectV1, state: WorkspaceState): Uint8Array {
	const envelope = effect.runtime.modelEnvelope;
	if (envelope === null) throw new TypeError("current live provider envelope is missing");
	if (state.messages.length === 0) {
		state.messages.push(
			{ role: "system", content: envelope.systemInstruction },
			{
				role: "user",
				content: `${envelope.taskStatement}\n\n${envelope.armContext}`,
			},
		);
	}
	const correction = {
		role: "system",
		content: `Graph admission: phase=${envelope.phaseBefore}; correction=${envelope.correctionStage ?? "none"}; correctionReason=${envelope.correctionReason ?? "none"}; correctionStage=${envelope.correctionStage ?? "none"}; requiredDisposition=${envelope.requiredDisposition ?? "none"}; requiredFirstTool=${envelope.requiredFirstToolRef ?? "none"}.`,
	};
	const messages = [...state.messages, correction];
	const requiredName = envelope.requiredFirstToolRef
		? TOOL_NAME_BY_REF[envelope.requiredFirstToolRef]
		: null;
	const material = {
		model: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
		messages,
		tools: toolDefinitions(envelope.allowedTools),
		tool_choice:
			requiredName === null ? "required" : { type: "function", function: { name: requiredName } },
		max_tokens: CURRENT_GRAPH_LIVE_ROUTE.maxOutputTokens,
		reasoning: { effort: "high" },
		provider: {
			order: [CURRENT_GRAPH_LIVE_PROVIDER_TAG],
			only: [CURRENT_GRAPH_LIVE_PROVIDER_TAG],
			allow_fallbacks: false,
			require_parameters: true,
		},
	};
	return Buffer.from(JSON.stringify(material), "utf8");
}

function number(value: unknown): number {
	return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

function retryAfterMs(headers: Headers): number | null {
	const raw = headers.get("retry-after");
	if (raw === null || !/^\d{1,5}$/.test(raw.trim())) return null;
	const milliseconds = Number(raw.trim()) * 1_000;
	return milliseconds >= 0 && milliseconds <= 60_000 ? milliseconds : null;
}

function transportCause(error: unknown): "d675" | null {
	const value = error as { cause?: { code?: unknown }; code?: unknown };
	const code = typeof value?.cause?.code === "string" ? value.cause.code : value?.code;
	return code === "UND_ERR_SOCKET" || code === "ECONNRESET" ? "d675" : null;
}

function retryProposal(input: {
	readonly delayMs: number;
	readonly requestDigest: string;
	readonly logicalRequestDigest: string;
}) {
	const material = strictSnapshot({
		retryClass: "retryable-transient" as const,
		retryAfterMs: input.delayMs,
		requestDigest: input.requestDigest,
		logicalRequestDigest: input.logicalRequestDigest,
	});
	return Object.freeze({
		retryClass: "retryable-transient" as const,
		retryAfterMs: input.delayMs,
		proposalDigest: empiricalStrictJsonDigest(material),
	});
}

async function parseBoundedJson(
	response: Response,
): Promise<{ readonly bytes: Uint8Array; readonly value: unknown }> {
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_PROVIDER_BYTES))
		throw new TypeError("current live provider response exceeded its declared bound");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > MAX_PROVIDER_BYTES)
		throw new TypeError("current live provider response exceeded its byte bound");
	return { bytes, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
}

function explicitErrorType(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const root = value as Record<string, unknown>;
	const nested = root.error;
	for (const candidate of [root, nested]) {
		if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) continue;
		const record = candidate as Record<string, unknown>;
		if (
			(typeof record.type === "string" && record.type.length > 0) ||
			(typeof record.code === "string" && record.code.length > 0)
		)
			return true;
	}
	return false;
}

function usageFrom(value: unknown, elapsed: number) {
	const root = value as Record<string, unknown>;
	const usage = root?.usage as Record<string, unknown> | undefined;
	const inputTokens = number(usage?.prompt_tokens);
	const outputTokens = number(usage?.completion_tokens);
	const details = usage?.prompt_tokens_details as Record<string, unknown> | undefined;
	const cacheReadTokens = Math.min(inputTokens, number(details?.cached_tokens));
	const noncache = Math.max(0, inputTokens - cacheReadTokens);
	const numerator =
		noncache * CURRENT_GRAPH_LIVE_PRICING.inputMicrousdPerMillionTokens +
		outputTokens * CURRENT_GRAPH_LIVE_PRICING.outputMicrousdPerMillionTokens +
		cacheReadTokens * CURRENT_GRAPH_LIVE_PRICING.cacheReadMicrousdPerMillionTokens;
	return Object.freeze({
		requests: 1 as const,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		actualCostMicrousd: Math.min(
			CURRENT_GRAPH_LIVE_LIMITS.providerMaxCostMicrousd,
			Math.ceil(numerator / 1_000_000),
		),
		actualElapsedMs: elapsed,
		costBasis: "reported" as const,
	});
}

function parseToolCalls(value: unknown) {
	const root = value as Record<string, unknown>;
	const choices = root?.choices;
	if (!Array.isArray(choices) || choices.length !== 1)
		throw new TypeError("current live provider choices drifted");
	const message = (choices[0] as Record<string, unknown>)?.message as Record<string, unknown>;
	const calls = message?.tool_calls;
	if (!Array.isArray(calls) || calls.length < 1 || calls.length > 16)
		throw new TypeError("current live provider did not return bounded tool calls");
	return calls.map((raw, index) => {
		if (raw === null || typeof raw !== "object" || Array.isArray(raw))
			throw new TypeError("current live provider tool call is invalid");
		const call = raw as Record<string, unknown>;
		const fn = call.function as Record<string, unknown>;
		const id = typeof call.id === "string" && call.id.length <= 256 ? call.id : `call-${index}`;
		const toolRef = TOOL_REF_BY_NAME.get(String(fn?.name));
		if (toolRef === undefined)
			throw new TypeError("current live provider returned an unknown tool");
		if (typeof fn?.arguments !== "string" || Buffer.byteLength(fn.arguments, "utf8") > 262_144)
			throw new TypeError("current live provider tool arguments exceeded their bound");
		const args = JSON.parse(fn.arguments) as Record<string, unknown>;
		const stringArgument = (key: string, allowEmpty = false) => {
			const value = args[key];
			if (
				typeof value !== "string" ||
				(!allowEmpty && value.length === 0) ||
				Buffer.byteLength(value, "utf8") > 131_072
			)
				throw new TypeError(`current live provider ${key} argument is invalid`);
			return value;
		};
		const toolCall =
			toolRef === "read-file"
				? ({ toolRef, path: stringArgument("path") } as const)
				: toolRef === "replace-exact"
					? ({
							toolRef,
							path: stringArgument("path"),
							oldText: stringArgument("oldText"),
							newText: stringArgument("newText", true),
						} as const)
					: ({ toolRef } as const);
		return { id, toolRef, toolCall, raw };
	});
}

export function createCurrentGraphOpenRouterExecutor(
	options: CurrentGraphOpenRouterAdapterOptionsV1,
): CurrentGraphOpenRouterExecutorV1 {
	const repositoryRoot = resolve(options.repositoryRoot);
	const materializationRoot = resolve(options.materializationRoot);
	const now = options.now ?? (() => performance.now());
	const sleep =
		options.sleep ??
		((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
	const states = new Map<string, WorkspaceState>();
	let active = 0;
	let disposed = false;
	const stateFor = (effect: CurrentGraphProviderAdmittedEffectV1) => {
		const state = states.get(`${effect.request.arm}-${effect.request.runSequence}`);
		if (state === undefined || state.cleaned)
			throw new TypeError("current live workspace is unavailable");
		if (effect.request.workspaceStateDigest !== state.digest)
			throw new TypeError("current live workspace state drifted before effect");
		return state;
	};
	return Object.freeze({
		admitGraphAuthoredToolCalls(
			effect: CurrentGraphProviderAdmittedEffectV1,
			toolRefs: readonly ["workspace-diff", "focused-validation"],
		) {
			if (disposed || active !== 0)
				throw new TypeError("current live Graph-authored transcript admission is unavailable");
			const state = stateFor(effect);
			if (
				effect.request.effectKind !== "tool-action" ||
				effect.request.toolRef !== "workspace-diff" ||
				toolRefs.join(",") !== "workspace-diff,focused-validation" ||
				state.pendingToolCalls.length !== 0
			)
				throw new TypeError("current live Graph-authored transcript admission drifted");
			const coordinate = effect.request.requestDigest.slice("sha256:".length, 30);
			const calls = toolRefs.map((toolRef, index) => {
				const id = `graph-${coordinate}-${index}`;
				return Object.freeze({
					id,
					type: "function" as const,
					function: Object.freeze({ name: TOOL_NAME_BY_REF[toolRef], arguments: "{}" }),
				});
			});
			state.messages.push({ role: "assistant", content: null, tool_calls: calls });
			state.pendingToolCalls.push(
				...toolRefs.map((toolRef, index) => ({ id: calls[index]!.id, toolRef })),
			);
		},
		async execute(effect: CurrentGraphProviderAdmittedEffectV1) {
			if (disposed) throw new TypeError("current live executor is disposed");
			active += 1;
			if (active !== 1) throw new TypeError("current live executor observed parallel effects");
			const started = now();
			try {
				const request = effect.request;
				const runKey = `${request.arm}-${request.runSequence}`;
				if (request.effectKind === "materialization") {
					if (states.has(runKey)) throw new TypeError("current live materialization replayed");
					const state = await createWorkspace({ repositoryRoot, materializationRoot, runKey });
					states.set(runKey, state);
					return {
						effectKind: "materialization" as const,
						status: "completed" as const,
						workspaceStateDigest: state.digest,
						evidenceDigest: empiricalStrictJsonDigest({
							request: request.requestDigest,
							state: state.digest,
						}),
						actualCostMicrousd: 0 as const,
						actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
					};
				}
				if (request.effectKind === "retry-wait") {
					await sleep(request.retryDelayMs);
					return {
						effectKind: "retry-wait" as const,
						status: "completed" as const,
						actualElapsedMs: request.retryDelayMs,
						evidenceDigest: empiricalStrictJsonDigest({
							request: request.requestDigest,
							waited: request.retryDelayMs,
						}),
					};
				}
				const state = stateFor(effect);
				if (request.effectKind === "provider-request") {
					if (effect.runtime.route?.routeDigest !== CURRENT_GRAPH_LIVE_ROUTE.routeDigest)
						throw new TypeError("current live provider route drifted");
					const logical = request.logicalRequestDigest;
					if (logical === null) throw new TypeError("current live logical request is missing");
					const proposedBody = bodyFor(effect, state);
					const prior = state.requestBodies.get(logical);
					if (prior !== undefined && !Buffer.from(prior).equals(Buffer.from(proposedBody)))
						throw new TypeError("current live retry request bytes drifted");
					state.requestBodies.set(logical, proposedBody);
					const controller = new AbortController();
					const timer = setTimeout(() => controller.abort(), request.reservation.maxElapsedMs);
					try {
						let response: Response;
						try {
							response = await options.fetchImpl(CURRENT_GRAPH_LIVE_ENDPOINT, {
								method: "POST",
								redirect: "error",
								cache: "no-store",
								credentials: "omit",
								referrerPolicy: "no-referrer",
								headers: {
									accept: "application/json",
									"content-type": "application/json",
									authorization: `Bearer ${options.credential.bearerToken}`,
									"cache-control": "no-cache, no-store, max-age=0",
									pragma: "no-cache",
								},
								body: proposedBody,
								signal: controller.signal,
							});
						} catch (error) {
							const elapsed = boundedElapsed(started, now, request.reservation.maxElapsedMs);
							const policy = transportCause(error);
							return {
								effectKind: "provider-request" as const,
								status: "failed" as const,
								toolCalls: [],
								failureCode:
									policy === null ? ("provider-failed" as const) : ("retryable-transient" as const),
								retryProposal:
									policy === null
										? null
										: retryProposal({
												delayMs: 1_000,
												requestDigest: request.requestDigest,
												logicalRequestDigest: logical,
											}),
								usage: {
									requests: 1 as const,
									inputTokens: 0,
									outputTokens: 0,
									cacheReadTokens: 0,
									actualCostMicrousd: request.reservation.maxCostMicrousd,
									actualElapsedMs: elapsed,
									costBasis: "conservative-reservation" as const,
								},
								evidenceDigest: empiricalStrictJsonDigest({
									request: request.requestDigest,
									transport: policy ?? "unrecognized",
								}),
							};
						}
						const parsed = await parseBoundedJson(response);
						const elapsed = boundedElapsed(started, now, request.reservation.maxElapsedMs);
						if (!response.ok) {
							const typed = explicitErrorType(parsed.value);
							const policy =
								response.status === 429 && !typed
									? "D710"
									: response.status === 429 || response.status === 503
										? "D671"
										: null;
							const delay = retryAfterMs(response.headers) ?? (policy === "D710" ? 60_000 : 7_000);
							return {
								effectKind: "provider-request" as const,
								status: "failed" as const,
								toolCalls: [],
								failureCode:
									policy === null ? ("provider-failed" as const) : ("retryable-transient" as const),
								retryProposal:
									policy === null
										? null
										: retryProposal({
												delayMs: delay,
												requestDigest: request.requestDigest,
												logicalRequestDigest: logical,
											}),
								usage: {
									requests: 1 as const,
									inputTokens: 0,
									outputTokens: 0,
									cacheReadTokens: 0,
									actualCostMicrousd: request.reservation.maxCostMicrousd,
									actualElapsedMs: elapsed,
									costBasis: "conservative-reservation" as const,
								},
								evidenceDigest: empiricalStrictJsonDigest({
									request: request.requestDigest,
									status: response.status,
									responseDigest: empiricalSha256(parsed.bytes),
									typed,
								}),
							};
						}
						const calls = parseToolCalls(parsed.value);
						const assistantCalls = calls.map((call) => call.raw);
						state.messages.push({ role: "assistant", content: null, tool_calls: assistantCalls });
						state.pendingToolCalls.push(...calls.map(({ id, toolRef }) => ({ id, toolRef })));
						return {
							effectKind: "provider-request" as const,
							status: "completed" as const,
							toolCalls: calls.map((call) => call.toolCall),
							failureCode: null,
							retryProposal: null,
							usage: usageFrom(parsed.value, elapsed),
							evidenceDigest: empiricalStrictJsonDigest({
								request: request.requestDigest,
								responseDigest: empiricalSha256(parsed.bytes),
								toolCalls: calls.map((call) => call.toolCall),
							}),
						};
					} finally {
						clearTimeout(timer);
					}
				}
				if (request.effectKind === "tool-action") {
					const args = effect.runtime.toolArguments;
					if (args === null || args.toolRef !== request.toolRef)
						throw new TypeError("current live admitted tool arguments drifted");
					const before = state.digest;
					let succeeded = true;
					let causeCode:
						| "exact-replacement-unchanged"
						| "exact-replacement-old-text-not-found"
						| "exact-replacement-old-text-not-unique"
						| "focused-validation-failed"
						| null = null;
					let nonEmptyDiff = false;
					let output = "completed";
					if (args.toolRef === "read-file") {
						const path = await assertRegularFile(state.root, args.path);
						const bytes = await readFile(path);
						if (bytes.byteLength > 262_144)
							throw new TypeError("current live read result exceeded its bound");
						output = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
					} else if (args.toolRef === "replace-exact") {
						const path = await assertRegularFile(state.root, args.path);
						const text = await readFile(path, "utf8");
						const first = text.indexOf(args.oldText);
						const second = first < 0 ? -1 : text.indexOf(args.oldText, first + args.oldText.length);
						if (first < 0 || second >= 0 || args.oldText === args.newText) {
							succeeded = false;
							causeCode =
								first < 0
									? "exact-replacement-old-text-not-found"
									: second >= 0
										? "exact-replacement-old-text-not-unique"
										: "exact-replacement-unchanged";
							output = `Exact replacement rejected: ${causeCode}.`;
						} else {
							const next = `${text.slice(0, first)}${args.newText}${text.slice(first + args.oldText.length)}`;
							const handle = await open(
								path,
								constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
							);
							try {
								await handle.writeFile(next, "utf8");
								await handle.sync();
							} finally {
								await handle.close();
							}
							output = "Exact replacement applied.";
						}
					} else if (args.toolRef === "workspace-diff") {
						const diff = await runProcess({
							command: "git",
							args: ["diff", "--check"],
							cwd: state.root,
							timeoutMs: 30_000,
						});
						const patch = await runProcess({
							command: "git",
							args: ["diff", "--", CURRENT_GRAPH_LIVE_WRITABLE_FILE],
							cwd: state.root,
							timeoutMs: 30_000,
						});
						succeeded = diff.code === 0;
						causeCode = succeeded ? null : "focused-validation-failed";
						nonEmptyDiff = patch.stdout.byteLength > 0;
						output = new TextDecoder().decode(patch.stdout).slice(0, 131_072);
					} else {
						const validation = await runProcess({
							command: join(options.repositoryRoot, "node_modules/.bin/biome"),
							args: ["check", CURRENT_GRAPH_LIVE_WRITABLE_FILE],
							cwd: state.root,
							timeoutMs: 120_000,
						});
						succeeded = validation.code === 0;
						causeCode = succeeded ? null : "focused-validation-failed";
						output = succeeded ? "Focused validation passed." : "Focused validation failed.";
					}
					state.digest = await workspaceDigest(state);
					const pending = state.pendingToolCalls.shift();
					if (pending === undefined || pending.toolRef !== args.toolRef)
						throw new TypeError("current live tool transcript order drifted");
					state.messages.push({ role: "tool", tool_call_id: pending.id, content: output });
					return {
						effectKind: "tool-action" as const,
						toolRef: args.toolRef,
						status: succeeded ? ("succeeded" as const) : ("failed" as const),
						causeCode,
						workspaceStateBeforeDigest: before,
						workspaceStateAfterDigest: state.digest,
						nonEmptyDiff,
						evidenceDigest: empiricalStrictJsonDigest({
							request: request.requestDigest,
							before,
							after: state.digest,
							succeeded,
							causeCode,
						}),
						actualCostMicrousd: 0 as const,
						actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
					};
				}
				if (request.effectKind === "public-semantic-validation") {
					const validation = await runProcess({
						command: join(options.repositoryRoot, "node_modules/.bin/vitest"),
						args: [
							"run",
							"packages/ts/src/__tests__/managed-cloud-postgresql.test.ts",
							"-t",
							"admits only a fresh D619 managed remote run",
						],
						cwd: state.root,
						timeoutMs: 120_000,
					});
					const passed = validation.code === 0;
					const failures = passed ? [] : (["canonical-proposal-not-admitted"] as const);
					state.messages.push({
						role: "user",
						content: passed
							? "Graph public semantic validation passed."
							: "Graph public semantic validation failed: canonical proposal behavior was not admitted.",
					});
					return {
						effectKind: "public-semantic-validation" as const,
						status: passed ? ("passed" as const) : ("failed" as const),
						criterionFailures: failures,
						workspaceStateDigest: state.digest,
						evidenceDigest: empiricalStrictJsonDigest({
							request: request.requestDigest,
							passed,
							outputDigest: empiricalSha256(validation.stdout),
						}),
						actualCostMicrousd: 0 as const,
						actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
					};
				}
				if (request.effectKind === "hidden-verifier") {
					const validation = await runProcess({
						command: join(options.repositoryRoot, "node_modules/.bin/vitest"),
						args: ["run", "packages/ts/src/__tests__/managed-cloud-postgresql.test.ts"],
						cwd: state.root,
						timeoutMs: 120_000,
					});
					return {
						effectKind: "hidden-verifier" as const,
						status: validation.code === 0 ? ("passed" as const) : ("failed" as const),
						workspaceStateDigest: state.digest,
						evidenceDigest: empiricalStrictJsonDigest({
							request: request.requestDigest,
							passed: validation.code === 0,
							outputDigest: empiricalSha256(validation.stdout),
						}),
						actualCostMicrousd: 0 as const,
						actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
					};
				}
				if (request.effectKind !== "cleanup")
					throw new TypeError("current live effect kind is unsupported");
				const remove = await runProcess({
					command: "git",
					args: ["worktree", "remove", "--force", state.root],
					cwd: repositoryRoot,
					timeoutMs: 60_000,
				});
				state.cleaned = remove.code === 0;
				return {
					effectKind: "cleanup" as const,
					status: state.cleaned ? ("completed" as const) : ("failed" as const),
					workspaceStateDigest: state.cleaned ? null : state.digest,
					evidenceDigest: empiricalStrictJsonDigest({
						request: request.requestDigest,
						cleaned: state.cleaned,
					}),
					actualCostMicrousd: 0 as const,
					actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
				};
			} finally {
				active -= 1;
			}
		},
		async dispose() {
			disposed = true;
			for (const state of states.values()) {
				if (state.cleaned) continue;
				await runProcess({
					command: "git",
					args: ["worktree", "remove", "--force", state.root],
					cwd: repositoryRoot,
					timeoutMs: 60_000,
				}).catch(() => undefined);
				state.cleaned = true;
			}
			await rm(materializationRoot, { recursive: true, force: true });
		},
	});
}
