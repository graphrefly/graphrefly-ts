import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import type { D17EffectResultInputV1 } from "./d17-current-efficacy-authority.js";
import {
	createD18OneEffectAdapter,
	type D18AdapterResultV1,
	type D18OneEffectPortsV1,
} from "./d18-current-injected-provider-adapter.js";
import {
	D18_INSPECTION_PATHS,
	D18_ROUTE,
	D18_WRITABLE_PATH,
	type D18AdmittedEffectV1,
	type D18AuthorityV1,
	type D18ProviderResultInputV1,
} from "./d18-current-provider-composition-authority.js";

export const D19_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions" as const;
export const D19_TASK_BASELINE_COMMIT = "80d5f01a48af679fa8aacd44f82662b703c8db0d" as const;
export const D19_MAX_PROVIDER_RESPONSE_BYTES = 2 * 1_048_576;
export const D19_MAX_PROCESS_OUTPUT_BYTES = 2 * 1_048_576;

export const D19_FIXED_ADMISSION_BLOCK = `\t\tadmissionId,\n\t\tprincipalId,\n\t\tprincipalSessionRevision,\n\t\ttenantId,\n\t\tworkspaceId,\n\t\tresourceKind,\n\t\tresourceId,\n\t\tresourceRevision,\n\t\tpolicyRevision,\n\t\tmodelRevision,\n\t])\n\t\tassertSafe(value, "admitted coordinate");\n\tassertBoundedAuthorityId(admissionProposalId, "admission proposal coordinate");`;
export const D19_BUGGY_ADMISSION_BLOCK = `\t\tadmissionId,\n\t\tadmissionProposalId,\n\t\tprincipalId,\n\t\tprincipalSessionRevision,\n\t\ttenantId,\n\t\tworkspaceId,\n\t\tresourceKind,\n\t\tresourceId,\n\t\tresourceRevision,\n\t\tpolicyRevision,\n\t\tmodelRevision,\n\t])\n\t\tassertSafe(value, "admitted coordinate");`;

type ProviderEffect = Extract<D18AdmittedEffectV1, { kind: "provider-attempt" }>;
type LocalEffect = Extract<D18AdmittedEffectV1, { kind: "workflow-local" }>;

interface ProcessResult {
	readonly code: number;
	readonly stdout: Uint8Array;
	readonly stderr: Uint8Array;
	readonly elapsedMs: number;
}

interface WorkspaceState {
	readonly arm: string;
	readonly root: string;
	digest: string;
	cleaned: boolean;
}

class D19ProviderResultRejection extends Error {}

export interface D19ProviderPortOptionsV1 {
	readonly fetchImpl: typeof fetch;
	readonly bearerToken: string;
	readonly now?: () => number;
}

export interface D19LocalPortOptionsV1 {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly now?: () => number;
	readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface D19RealProviderAdapterOptionsV1
	extends D19ProviderPortOptionsV1,
		D19LocalPortOptionsV1 {}

function boundedElapsed(started: number, now: () => number, ceiling: number): number {
	return Math.min(ceiling, Math.max(0, Math.ceil(now() - started)));
}

function boundedString(value: unknown, path: string, maxBytes: number): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		Buffer.byteLength(value, "utf8") > maxBytes
	)
		throw new TypeError(`${path} is outside its bound`);
	return value;
}

function safeCount(value: unknown, path: string, max = 10_000_000): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max)
		throw new TypeError(`${path} is outside its bound`);
	return value as number;
}

function ownData(value: Record<string, unknown>, key: string, path: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (
		descriptor === undefined ||
		descriptor.get !== undefined ||
		descriptor.set !== undefined ||
		!("value" in descriptor)
	)
		throw new TypeError(`${path}.${key} must be an own data property`);
	return descriptor.value;
}

async function runProcess(input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly timeoutMs: number;
}): Promise<ProcessResult> {
	const started = performance.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), input.timeoutMs);
	try {
		return await new Promise<ProcessResult>((resolvePromise, reject) => {
			const child = spawn(input.command, [...input.args], {
				cwd: input.cwd,
				env: { ...process.env, CI: "1", NO_COLOR: "1" },
				stdio: ["ignore", "pipe", "pipe"],
				signal: controller.signal,
			});
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let bytes = 0;
			const collect = (target: Buffer[], chunk: Buffer) => {
				bytes += chunk.byteLength;
				if (bytes > D19_MAX_PROCESS_OUTPUT_BYTES) {
					controller.abort();
					return;
				}
				target.push(chunk);
			};
			child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
			child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
			child.once("error", reject);
			child.once("close", (code) => {
				if (bytes > D19_MAX_PROCESS_OUTPUT_BYTES) {
					reject(new TypeError("D19 subprocess output exceeded its bound"));
					return;
				}
				resolvePromise({
					code: code ?? 1,
					stdout: Buffer.concat(stdout),
					stderr: Buffer.concat(stderr),
					elapsedMs: Math.ceil(performance.now() - started),
				});
			});
		});
	} finally {
		clearTimeout(timer);
	}
}

function encodeBody(body: unknown): Uint8Array {
	const text = JSON.stringify(body);
	if (typeof text !== "string") throw new TypeError("D19 provider body is not JSON");
	const bytes = new TextEncoder().encode(text);
	if (bytes.byteLength < 1 || bytes.byteLength > 2 * 1_048_576)
		throw new TypeError("D19 provider body exceeds its bound");
	return bytes;
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (declared !== null) {
		const length = Number(declared);
		if (!Number.isSafeInteger(length) || length < 0 || length > D19_MAX_PROVIDER_RESPONSE_BYTES)
			throw new D19ProviderResultRejection("D19 provider response exceeds its declared bound");
	}
	if (response.body === null) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			byteLength += next.value.byteLength;
			if (byteLength > D19_MAX_PROVIDER_RESPONSE_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw new D19ProviderResultRejection("D19 provider response exceeds its byte bound");
			}
			chunks.push(new Uint8Array(next.value));
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function decodeJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("D19 provider response is not bounded UTF-8 JSON", { cause: error });
	}
}

function transportCause(error: unknown): "request-phase-und-err-socket" | null {
	let current = error;
	for (let depth = 0; depth < 4; depth += 1) {
		if (current === null || typeof current !== "object" || Array.isArray(current)) return null;
		const candidate = current as Record<string, unknown>;
		const code = Object.getOwnPropertyDescriptor(candidate, "code");
		if (code !== undefined && "value" in code && code.value === "UND_ERR_SOCKET")
			return "request-phase-und-err-socket";
		const cause = Object.getOwnPropertyDescriptor(candidate, "cause");
		if (cause === undefined || !("value" in cause)) return null;
		current = cause.value;
	}
	return null;
}

function explicitErrorType(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const root = value as Record<string, unknown>;
	const candidates: unknown[] = [root];
	const error = Object.getOwnPropertyDescriptor(root, "error");
	if (error !== undefined && "value" in error) candidates.push(error.value);
	for (const candidate of candidates) {
		if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) continue;
		for (const key of ["type", "code"] as const) {
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (
				descriptor !== undefined &&
				"value" in descriptor &&
				typeof descriptor.value === "string" &&
				descriptor.value.length > 0
			)
				return true;
		}
	}
	return false;
}

function retryAfterMs(headers: Headers, nowMs: number): number | null {
	const raw = headers.get("retry-after");
	if (raw === null || raw.length > 128) return null;
	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.ceil(seconds * 1_000));
	const date = Date.parse(raw);
	if (!Number.isFinite(date)) return null;
	return Math.min(60_000, Math.max(0, Math.ceil(date - nowMs)));
}

function parseUsage(value: unknown): {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly actualCostMicrousd: number;
} {
	const root = record(value, "D19 provider response");
	const usage = record(ownData(root, "usage", "D19 provider response"), "D19 provider usage");
	const inputTokens = safeCount(ownData(usage, "prompt_tokens", "D19 provider usage"), "input");
	const outputTokens = safeCount(
		ownData(usage, "completion_tokens", "D19 provider usage"),
		"output",
	);
	let cacheReadTokens = 0;
	const detailsDescriptor = Object.getOwnPropertyDescriptor(usage, "prompt_tokens_details");
	if (detailsDescriptor !== undefined && "value" in detailsDescriptor) {
		const details = record(detailsDescriptor.value, "D19 provider usage.prompt_tokens_details");
		const cached = Object.getOwnPropertyDescriptor(details, "cached_tokens");
		if (cached !== undefined && "value" in cached)
			cacheReadTokens = safeCount(cached.value, "cacheRead");
	}
	if (cacheReadTokens > inputTokens) throw new TypeError("D19 cached tokens exceed input tokens");
	const weighted =
		(inputTokens - cacheReadTokens) * D18_ROUTE.pricing.inputMicrousdPerMillion +
		cacheReadTokens * D18_ROUTE.pricing.cacheReadMicrousdPerMillion +
		outputTokens * D18_ROUTE.pricing.outputMicrousdPerMillion;
	return Object.freeze({
		inputTokens,
		outputTokens,
		cacheReadTokens,
		actualCostMicrousd: Math.ceil(weighted / 1_000_000),
	});
}

function parseToolIntents(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	const root = record(value, "D19 provider response");
	const choices = ownData(root, "choices", "D19 provider response");
	if (!Array.isArray(choices) || choices.length !== 1)
		throw new TypeError("D19 provider choices cardinality drifted");
	const choice = record(choices[0], "D19 provider choice");
	const message = record(ownData(choice, "message", "D19 provider choice"), "D19 message");
	const calls = ownData(message, "tool_calls", "D19 message");
	if (!Array.isArray(calls) || calls.length < 1 || calls.length > 4)
		throw new TypeError("D19 provider tool call cardinality drifted");
	return Object.freeze(
		calls.map((entry, index) => {
			const call = record(entry, `D19 tool call[${index}]`);
			const fn = record(ownData(call, "function", `D19 tool call[${index}]`), `D19 fn[${index}]`);
			const name = boundedString(ownData(fn, "name", `D19 fn[${index}]`), "D19 tool name", 64);
			const encoded = boundedString(
				ownData(fn, "arguments", `D19 fn[${index}]`),
				"D19 tool arguments",
				131_072,
			);
			const args = record(decodeJson(new TextEncoder().encode(encoded)), `D19 args[${index}]`);
			if (name === "read_file") {
				exactKeys(args, ["path"], `D19 args[${index}]`);
				const path = boundedString(
					ownData(args, "path", `D19 args[${index}]`),
					`D19 args[${index}].path`,
					512,
				);
				return strictSnapshot({
					toolRef: "read-file" as const,
					path,
				});
			}
			if (name === "replace_exact") {
				exactKeys(args, ["newText", "oldText", "path"], `D19 args[${index}]`);
				const path = boundedString(
					ownData(args, "path", `D19 args[${index}]`),
					`D19 args[${index}].path`,
					512,
				);
				const oldText = boundedString(
					ownData(args, "oldText", `D19 args[${index}]`),
					`D19 args[${index}].oldText`,
					32_768,
				);
				const newTextValue = ownData(args, "newText", `D19 args[${index}]`);
				if (typeof newTextValue !== "string" || Buffer.byteLength(newTextValue, "utf8") > 32_768)
					throw new TypeError(`D19 args[${index}].newText is outside its bound`);
				return strictSnapshot({
					toolRef: "replace-exact" as const,
					path,
					oldText,
					newText: newTextValue,
				});
			}
			throw new TypeError("D19 provider returned an unknown tool");
		}),
	);
}

type D19RetryProposal = Readonly<{
	policy: "D671" | "D675" | "D710";
	cause: "typed-rate-limit-or-503" | "request-phase-und-err-socket" | "untyped-http-429";
	delayMs: number;
}>;

function failedProviderResult(input: {
	readonly effect: ProviderEffect;
	readonly started: number;
	readonly now: () => number;
	readonly failureFamily: "transport" | "http" | "executor";
	readonly retryProposal: D19RetryProposal | null;
	readonly causeCode: string;
}): D18ProviderResultInputV1 {
	return Object.freeze({
		effectKind: "provider-attempt",
		status: "failed",
		wireBodyDigest: input.effect.request.wireBodyDigest,
		failureFamily: input.failureFamily,
		retryProposal: input.retryProposal,
		costBasis: "conservative-reservation",
		actualCostMicrousd: input.effect.request.reservation.maxCostMicrousd,
		actualElapsedMs: boundedElapsed(
			input.started,
			input.now,
			input.effect.request.reservation.maxElapsedMs,
		),
		evidenceDigest: empiricalStrictJsonDigest({
			requestDigest: input.effect.request.requestDigest,
			failureFamily: input.failureFamily,
			causeCode: input.causeCode,
		}),
	});
}

export function createD19ProviderPort(
	options: D19ProviderPortOptionsV1,
): D18OneEffectPortsV1["provider"] {
	if (typeof options.fetchImpl !== "function") throw new TypeError("D19 fetch port is invalid");
	if (typeof options.bearerToken !== "string" || options.bearerToken.length < 1)
		throw new TypeError("D19 bearer token is unavailable");
	const now = options.now ?? (() => performance.now());
	return async (effect: ProviderEffect, material): Promise<D18ProviderResultInputV1> => {
		if (empiricalStrictJsonDigest(material.body) !== effect.request.wireBodyDigest)
			throw new TypeError("D19 Graph-authored body digest drifted");
		const body = encodeBody(material.body);
		const started = now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), effect.request.reservation.maxElapsedMs);
		try {
			let response: Response;
			try {
				response = await options.fetchImpl(D19_OPENROUTER_ENDPOINT, {
					method: "POST",
					redirect: "error",
					cache: "no-store",
					credentials: "omit",
					referrerPolicy: "no-referrer",
					headers: {
						accept: "application/json",
						"content-type": "application/json",
						authorization: `Bearer ${options.bearerToken}`,
						"cache-control": "no-cache, no-store, max-age=0",
						pragma: "no-cache",
					},
					body,
					signal: controller.signal,
				});
			} catch (error) {
				const cause = transportCause(error);
				return failedProviderResult({
					effect,
					started,
					now,
					failureFamily: "transport",
					retryProposal:
						cause === null ? null : Object.freeze({ policy: "D675", cause, delayMs: 7_000 }),
					causeCode: cause ?? "unrecognized",
				});
			}
			let bytes: Uint8Array;
			try {
				bytes = await readBoundedResponse(response);
			} catch (error) {
				const locallyRejected = error instanceof D19ProviderResultRejection;
				return failedProviderResult({
					effect,
					started,
					now,
					failureFamily: locallyRejected ? "executor" : "transport",
					retryProposal: null,
					causeCode: locallyRejected
						? "provider-response-bound-rejected"
						: controller.signal.aborted
							? "owned-provider-deadline"
							: "provider-response-body-transport-failed",
				});
			}
			const elapsed = boundedElapsed(started, now, effect.request.reservation.maxElapsedMs);
			if (response.redirected)
				return failedProviderResult({
					effect,
					started,
					now,
					failureFamily: "executor",
					retryProposal: null,
					causeCode: "provider-redirect-rejected",
				});
			if (!response.ok) {
				let decoded: unknown = null;
				try {
					decoded = decodeJson(bytes);
				} catch {
					// A bounded untyped HTTP error remains classifiable without retaining raw material.
				}
				const typed = explicitErrorType(decoded);
				const policy =
					response.status === 429 && !typed
						? ("D710" as const)
						: response.status === 429 || response.status === 503
							? ("D671" as const)
							: null;
				const cause = policy === "D710" ? "untyped-http-429" : "typed-rate-limit-or-503";
				return failedProviderResult({
					effect,
					started,
					now,
					failureFamily: "http",
					retryProposal:
						policy === null
							? null
							: Object.freeze({
									policy,
									cause,
									delayMs:
										retryAfterMs(response.headers, Date.now()) ??
										(policy === "D710" ? 60_000 : 7_000),
								}),
					causeCode: `http-${response.status}-${typed ? "typed" : "untyped"}`,
				});
			}
			try {
				const contentType = response.headers.get("content-type");
				if (contentType === null || !/^application\/json(?:\s*;|$)/iu.test(contentType))
					throw new TypeError("D19 provider content type drifted");
				const decoded = decodeJson(bytes);
				const usage = parseUsage(decoded);
				if (usage.actualCostMicrousd > effect.request.reservation.maxCostMicrousd)
					throw new TypeError("D19 provider usage exceeded its reservation");
				const toolIntents = parseToolIntents(decoded);
				return Object.freeze({
					effectKind: "provider-attempt",
					status: "completed",
					wireBodyDigest: effect.request.wireBodyDigest,
					toolIntents: toolIntents as never,
					...usage,
					actualElapsedMs: elapsed,
					evidenceDigest: empiricalStrictJsonDigest({
						requestDigest: effect.request.requestDigest,
						responseDigest: empiricalSha256(bytes),
						usage,
					}),
				});
			} catch {
				return failedProviderResult({
					effect,
					started,
					now,
					failureFamily: "executor",
					retryProposal: null,
					causeCode: "provider-result-rejected",
				});
			}
		} finally {
			clearTimeout(timer);
		}
	};
}

async function assertRegularWorkspaceFile(root: string, relativePath: string): Promise<string> {
	if (!D18_INSPECTION_PATHS.includes(relativePath as (typeof D18_INSPECTION_PATHS)[number]))
		throw new TypeError("D19 workspace path is outside the admitted set");
	const resolvedRoot = resolve(root);
	const path = resolve(root, relativePath);
	if (!path.startsWith(`${resolvedRoot}/`)) throw new TypeError("D19 workspace path escaped root");
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
		throw new TypeError("D19 workspace file identity is invalid");
	return path;
}

async function workspaceDigest(state: WorkspaceState): Promise<string> {
	const fileDigests = Object.fromEntries(
		await Promise.all(
			D18_INSPECTION_PATHS.map(async (relativePath) => {
				const path = await assertRegularWorkspaceFile(state.root, relativePath);
				return [relativePath, empiricalSha256(await readFile(path))] as const;
			}),
		),
	);
	const diff = await runProcess({
		command: "/usr/bin/git",
		args: ["diff", "--binary", "--", D18_WRITABLE_PATH],
		cwd: state.root,
		timeoutMs: 30_000,
	});
	if (diff.code !== 0) throw new TypeError("D19 workspace diff inspection failed");
	return empiricalStrictJsonDigest({
		arm: state.arm,
		fileDigests,
		diffDigest: empiricalSha256(diff.stdout),
	});
}

async function createWorkspace(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly arm: string;
}): Promise<WorkspaceState> {
	await mkdir(input.materializationRoot, { recursive: true, mode: 0o700 });
	const root = join(input.materializationRoot, input.arm);
	const added = await runProcess({
		command: "/usr/bin/git",
		args: ["worktree", "add", "--detach", root, D19_TASK_BASELINE_COMMIT],
		cwd: input.repositoryRoot,
		timeoutMs: 60_000,
	});
	if (added.code !== 0) throw new TypeError("D19 worktree materialization failed");
	try {
		const target = await assertRegularWorkspaceFile(root, D18_WRITABLE_PATH);
		const source = await readFile(target, "utf8");
		const first = source.indexOf(D19_FIXED_ADMISSION_BLOCK);
		if (first < 0 || source.indexOf(D19_FIXED_ADMISSION_BLOCK, first + 1) >= 0)
			throw new TypeError("D19 task fixture source drifted");
		await writeFile(
			target,
			`${source.slice(0, first)}${D19_BUGGY_ADMISSION_BLOCK}${source.slice(first + D19_FIXED_ADMISSION_BLOCK.length)}`,
			{ encoding: "utf8", mode: 0o644 },
		);
		const staged = await runProcess({
			command: "/usr/bin/git",
			args: ["add", "--", D18_WRITABLE_PATH],
			cwd: root,
			timeoutMs: 30_000,
		});
		if (staged.code !== 0) throw new TypeError("D19 task baseline staging failed");
		const committed = await runProcess({
			command: "/usr/bin/git",
			args: [
				"-c",
				"user.name=GraphReFly Eval",
				"-c",
				"user.email=eval@invalid.local",
				"commit",
				"--no-gpg-sign",
				"-m",
				`D19 frozen task baseline ${input.arm}`,
			],
			cwd: root,
			timeoutMs: 30_000,
		});
		if (committed.code !== 0) throw new TypeError("D19 task baseline commit failed");
		for (const relative of ["node_modules", "packages/ts/node_modules"] as const) {
			const link = join(root, relative);
			await mkdir(dirname(link), { recursive: true });
			await symlink(join(input.repositoryRoot, relative), link, "dir");
		}
		const state: WorkspaceState = { arm: input.arm, root, digest: "", cleaned: false };
		state.digest = await workspaceDigest(state);
		return state;
	} catch (error) {
		await runProcess({
			command: "/usr/bin/git",
			args: ["worktree", "remove", "--force", root],
			cwd: input.repositoryRoot,
			timeoutMs: 60_000,
		}).catch(() => undefined);
		await rm(root, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}

export function createD19LocalPorts(options: D19LocalPortOptionsV1): Pick<
	D18OneEffectPortsV1,
	"local" | "retryWait"
> & {
	readonly dispose: () => Promise<void>;
	readonly workspaceResidueCount: () => number;
} {
	const repositoryRoot = resolve(options.repositoryRoot);
	const materializationRoot = resolve(options.materializationRoot);
	const now = options.now ?? (() => performance.now());
	const sleep =
		options.sleep ??
		((milliseconds: number) =>
			new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
	const states = new Map<string, WorkspaceState>();
	const stateFor = (effect: LocalEffect): WorkspaceState => {
		const state = states.get(effect.workflowEffect.request.arm);
		if (state === undefined || state.cleaned) throw new TypeError("D19 workspace is unavailable");
		if (effect.workflowEffect.request.workspaceStateDigest !== state.digest)
			throw new TypeError("D19 workspace state drifted before effect");
		return state;
	};
	const local: D18OneEffectPortsV1["local"] = async (effect, material) => {
		const request = effect.workflowEffect.request;
		const started = now();
		if (request.effectKind === "materialization") {
			if (states.has(request.arm)) throw new TypeError("D19 materialization replayed");
			const state = await createWorkspace({
				repositoryRoot,
				materializationRoot,
				arm: request.arm,
			});
			states.set(request.arm, state);
			return Object.freeze({
				result: Object.freeze({
					effectKind: "materialization" as const,
					status: "completed" as const,
					workspaceStateDigest: state.digest,
					evidenceDigest: empiricalStrictJsonDigest({
						request: request.requestDigest,
						state: state.digest,
					}),
					actualCostMicrousd: 0 as const,
					actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
				}),
			});
		}
		const state = stateFor(effect);
		if (request.effectKind === "tool-action") {
			const args = material.toolArguments;
			if (args === null || args.toolRef !== request.toolRef)
				throw new TypeError("D19 admitted tool arguments drifted");
			const before = state.digest;
			let status: "succeeded" | "failed" = "succeeded";
			let causeCode: "exact-replacement-not-applicable" | "focused-validation-failed" | null = null;
			let nonEmptyDiff = false;
			let runtimeMaterial: string | undefined;
			if (args.toolRef === "read-file") {
				const path = await assertRegularWorkspaceFile(state.root, args.path);
				const bytes = await readFile(path);
				if (bytes.byteLength > 240_000) throw new TypeError("D19 read result exceeds D17 bound");
				runtimeMaterial = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} else if (args.toolRef === "replace-exact") {
				const path = await assertRegularWorkspaceFile(state.root, args.path);
				const source = await readFile(path, "utf8");
				const first = source.indexOf(args.oldText);
				const second = first < 0 ? -1 : source.indexOf(args.oldText, first + args.oldText.length);
				if (first < 0 || second >= 0) {
					status = "failed";
					causeCode = "exact-replacement-not-applicable";
				} else {
					const handle = await open(
						path,
						constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
					);
					try {
						await handle.writeFile(
							`${source.slice(0, first)}${args.newText}${source.slice(first + args.oldText.length)}`,
							"utf8",
						);
						await handle.sync();
					} finally {
						await handle.close();
					}
				}
			} else if (args.toolRef === "workspace-diff") {
				const checked = await runProcess({
					command: "/usr/bin/git",
					args: ["diff", "--check"],
					cwd: state.root,
					timeoutMs: request.reservation.maxElapsedMs,
				});
				const patch = await runProcess({
					command: "/usr/bin/git",
					args: ["diff", "--", D18_WRITABLE_PATH],
					cwd: state.root,
					timeoutMs: request.reservation.maxElapsedMs,
				});
				status = checked.code === 0 ? "succeeded" : "failed";
				causeCode = status === "succeeded" ? null : "focused-validation-failed";
				nonEmptyDiff = patch.stdout.byteLength > 0;
			} else {
				const validation = await runProcess({
					command: join(repositoryRoot, "node_modules/.bin/biome"),
					args: ["check", D18_WRITABLE_PATH],
					cwd: state.root,
					timeoutMs: request.reservation.maxElapsedMs,
				});
				status = validation.code === 0 ? "succeeded" : "failed";
				causeCode = status === "succeeded" ? null : "focused-validation-failed";
			}
			state.digest = await workspaceDigest(state);
			const result = Object.freeze({
				effectKind: "tool-action" as const,
				toolRef: args.toolRef,
				status,
				workspaceStateBeforeDigest: before,
				workspaceStateAfterDigest: state.digest,
				nonEmptyDiff,
				evidenceDigest: empiricalStrictJsonDigest({
					request: request.requestDigest,
					before,
					after: state.digest,
					status,
					causeCode,
				}),
				actualCostMicrousd: 0 as const,
				actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
			}) satisfies D17EffectResultInputV1;
			return Object.freeze({
				result,
				...(runtimeMaterial === undefined ? {} : { runtimeMaterial }),
			});
		}
		if (request.effectKind === "public-semantic-validation") {
			const validation = await runProcess({
				command: join(repositoryRoot, "node_modules/.bin/vitest"),
				args: [
					"run",
					"packages/ts/src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.current-graph-native.test.ts",
					"-t",
					"uses independent actor-visible behavioral scenarios instead of source substrings",
				],
				cwd: state.root,
				timeoutMs: request.reservation.maxElapsedMs,
			});
			const passed = validation.code === 0;
			return Object.freeze({
				result: Object.freeze({
					effectKind: "public-semantic-validation" as const,
					status: passed ? ("passed" as const) : ("failed" as const),
					criterionFailureCodes: passed
						? Object.freeze([])
						: Object.freeze(["canonical-proposal-not-admitted" as const]),
					workspaceStateDigest: state.digest,
					evidenceDigest: empiricalStrictJsonDigest({
						request: request.requestDigest,
						passed,
						outputDigest: empiricalSha256(validation.stdout),
					}),
					actualCostMicrousd: 0 as const,
					actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
				}),
			});
		}
		if (request.effectKind === "hidden-verifier") {
			const validation = await runProcess({
				command: join(repositoryRoot, "node_modules/.bin/vitest"),
				args: ["run", "packages/ts/src/__tests__/managed-cloud-postgresql.test.ts"],
				cwd: state.root,
				timeoutMs: request.reservation.maxElapsedMs,
			});
			return Object.freeze({
				result: Object.freeze({
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
				}),
			});
		}
		if (request.effectKind !== "cleanup")
			throw new TypeError("D19 local effect kind is unsupported");
		const removed = await runProcess({
			command: "/usr/bin/git",
			args: ["worktree", "remove", "--force", state.root],
			cwd: repositoryRoot,
			timeoutMs: request.reservation.maxElapsedMs,
		});
		await rm(state.root, { recursive: true, force: true });
		state.cleaned = removed.code === 0;
		states.delete(request.arm);
		return Object.freeze({
			result: Object.freeze({
				effectKind: "cleanup" as const,
				status: removed.code === 0 ? ("completed" as const) : ("failed" as const),
				workspaceStateDigest: null,
				evidenceDigest: empiricalStrictJsonDigest({
					request: request.requestDigest,
					removed: removed.code === 0,
				}),
				actualCostMicrousd: 0 as const,
				actualElapsedMs: boundedElapsed(started, now, request.reservation.maxElapsedMs),
			}),
		});
	};
	const retryWait: D18OneEffectPortsV1["retryWait"] = async (effect) => {
		const started = now();
		await sleep(effect.request.delayMs);
		return Object.freeze({
			actualElapsedMs: effect.request.delayMs,
			evidenceDigest: empiricalStrictJsonDigest({
				request: effect.request.requestDigest,
				delayMs: effect.request.delayMs,
				measuredElapsedMs: boundedElapsed(started, now, effect.request.delayMs),
			}),
		});
	};
	const dispose = async () => {
		const failures: unknown[] = [];
		for (const state of [...states.values()]) {
			try {
				await runProcess({
					command: "/usr/bin/git",
					args: ["worktree", "remove", "--force", state.root],
					cwd: repositoryRoot,
					timeoutMs: 60_000,
				});
				await rm(state.root, { recursive: true, force: true });
				states.delete(state.arm);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0) throw new AggregateError(failures, "D19 workspace cleanup failed");
	};
	return Object.freeze({ local, retryWait, dispose, workspaceResidueCount: () => states.size });
}

export function createD19RealProviderAdapter(options: D19RealProviderAdapterOptionsV1): {
	readonly execute: (
		authority: D18AuthorityV1,
		effect: D18AdmittedEffectV1,
	) => Promise<D18AdapterResultV1>;
	readonly dispose: () => Promise<void>;
	readonly maxActiveEffects: () => number;
	readonly workspaceResidueCount: () => number;
} {
	const local = createD19LocalPorts(options);
	const oneEffect = createD18OneEffectAdapter({
		provider: createD19ProviderPort(options),
		local: local.local,
		retryWait: local.retryWait,
	});
	return Object.freeze({
		execute: oneEffect.execute,
		dispose: local.dispose,
		maxActiveEffects: oneEffect.maxActiveEffects,
		workspaceResidueCount: local.workspaceResidueCount,
	});
}
