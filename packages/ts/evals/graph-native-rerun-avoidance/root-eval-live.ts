import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	chmod,
	link,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import type {
	EvalAdmittedEffect,
	EvalAdmittedToolEffect,
	EvalBillingObservationEffect,
	EvalBillingObservationOutcome,
	EvalCurrentKeySnapshot,
	EvalEffectOutcome,
	EvalExecutableEffect,
	EvalExecutorOutcome,
	EvalProviderOutcome,
	EvalProviderOutcomeReason,
	EvalRetryDelayEffect,
	EvalRetryDelayOutcome,
} from "./eval-topology.js";
import { ROOT_EVAL_CALLER_SAFETY_LEASE_MS } from "./eval-topology.js";
import type { RootEvalLiveClaimCommit } from "./root-eval-live-authority.js";
import {
	ROOT_EVAL_D145_TASK_SET_BINDING_DIGEST,
	ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST,
	ROOT_EVAL_DEVELOPMENT_TASKS,
	ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
	type RootEvalTaskDefinition,
	type RootEvalTaskKind,
	type RootEvalTaskManifest,
	type RootEvalTaskManifestSlot,
	readRootEvalTaskManifest,
	rootEvalTask,
} from "./root-eval-task.js";

export const ROOT_EVAL_LIVE_DECISION_REF = "graphrefly-ts:D145" as const;
export const ROOT_EVAL_LIVE_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions" as const;
export const ROOT_EVAL_FROZEN_BASELINE_COMMIT = ROOT_EVAL_DEVELOPMENT_TASKS[0]!.baselineCommit;
export const ROOT_EVAL_LIVE_WRITABLE_PATH = ROOT_EVAL_DEVELOPMENT_TASKS[0]!.writablePath;
const ROOT_EVAL_LIVE_PROVIDER_FETCH = globalThis.fetch;

export const ROOT_EVAL_LIVE_CORRECT_REPLACEMENT =
	ROOT_EVAL_DEVELOPMENT_TASKS[0]!.fixtureCorrectText;
export const ROOT_EVAL_LIVE_BUGGY_REPLACEMENT = ROOT_EVAL_DEVELOPMENT_TASKS[0]!.fixtureBuggyText;
const NO_ADMITTED_MEMORY_CONTEXT = "No admitted memory insight content.";
const MAX_PROCESS_BYTES = 4 * 1_048_576;
const MAX_RESPONSE_BYTES = 2 * 1_048_576;

function executionTask(
	task: RootEvalTaskDefinition,
	workItemRole: "source" | "target",
): RootEvalTaskDefinition {
	if (workItemRole === "target") return task;
	return Object.freeze({
		...task,
		writablePath: task.sourceWritablePath,
		taskStatement: task.sourceTaskStatement,
		fixtureCorrectText: task.sourceFixtureCorrectText,
		fixtureBuggyText: task.sourceFixtureBuggyText,
		readonlyFixtureFiles: task.sourceReadonlyFixtureFiles,
		actorContext: task.sourceActorContext,
		publicVerifierPath: task.sourcePublicVerifierPath,
		hiddenVerifierPath: task.sourceHiddenVerifierPath,
		publicVerifierName: task.sourcePublicVerifierName,
		hiddenVerifierName: task.sourceHiddenVerifierName,
		publicVerifierSource: task.sourcePublicVerifierSource,
		hiddenVerifierSource: task.sourceHiddenVerifierSource,
	});
}
class RootEvalEffectLeaseExpired extends Error {
	constructor(readonly timeoutMs: number) {
		super(`root eval admitted provider effect exceeded ${timeoutMs}ms`);
		this.name = "RootEvalEffectLeaseExpired";
	}
}

class RootEvalSettlementLeaseExpired extends Error {
	constructor(
		readonly effectClass:
			| "provider"
			| "exact-tool"
			| "retry-delay"
			| "billing-observation"
			| "cleanup-finalizer",
		readonly timeoutMs: number,
	) {
		super(`root eval admitted ${effectClass} settlement exceeded ${timeoutMs}ms`);
		this.name = "RootEvalSettlementLeaseExpired";
	}
}

export const ROOT_EVAL_CALLER_SETTLEMENT_DEADLINE_MS = ROOT_EVAL_CALLER_SAFETY_LEASE_MS;
export const ROOT_EVAL_PROVIDER_SETTLEMENT_LEASE_MS = 600_000 as const;
export const ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS = 600_000 as const;
export const ROOT_EVAL_BILLING_SETTLEMENT_LEASE_MS = 32_000 as const;
export const ROOT_EVAL_MAX_RETRY_DELAY_MS = 120_000 as const;
export const ROOT_EVAL_RETRY_SETTLEMENT_LEASE_MS = 121_000 as const;
export const ROOT_EVAL_MAX_BILLING_OBSERVATIONS = 8 as const;
export const ROOT_EVAL_MAX_POST_CUTOFF_CAUSAL_TAIL_MS =
	ROOT_EVAL_PROVIDER_SETTLEMENT_LEASE_MS +
	ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS +
	ROOT_EVAL_RETRY_SETTLEMENT_LEASE_MS +
	ROOT_EVAL_BILLING_SETTLEMENT_LEASE_MS * ROOT_EVAL_MAX_BILLING_OBSERVATIONS;

export class RootEvalCallerSettlementDeadlineExpired extends Error {
	readonly code = "caller-settlement-deadline-expired" as const;

	constructor(readonly deadlineMs: number) {
		super(`root eval caller settlement exceeded ${deadlineMs}ms`);
		this.name = "RootEvalCallerSettlementDeadlineExpired";
	}
}

function createRootEvalEffectLease(
	timeoutMs: number,
	parentSignal?: AbortSignal,
): Readonly<{
	readonly signal: AbortSignal;
	dispose(): void;
}> {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
		throw new TypeError("root eval admitted effect timeout was invalid");
	return createRootEvalAbortLease(
		timeoutMs,
		parentSignal,
		() => new RootEvalEffectLeaseExpired(timeoutMs),
	);
}

function createRootEvalSettlementLease(
	effectClass: RootEvalSettlementLeaseExpired["effectClass"],
	timeoutMs: number,
	parentSignal?: AbortSignal,
): Readonly<{
	readonly signal: AbortSignal;
	dispose(): void;
}> {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
		throw new TypeError("root eval admitted settlement timeout was invalid");
	return createRootEvalAbortLease(
		timeoutMs,
		parentSignal,
		() => new RootEvalSettlementLeaseExpired(effectClass, timeoutMs),
	);
}

async function awaitRootEvalAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	return await new Promise<T>((resolvePromise, rejectPromise) => {
		let settled = false;
		const finish = (outcome: { readonly value: T } | { readonly error: unknown }) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			if ("error" in outcome) rejectPromise(outcome.error);
			else resolvePromise(outcome.value);
		};
		const onAbort = () => finish({ error: signal.reason ?? new Error("root eval lease expired") });
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
		void operation.then(
			(value) => finish({ value }),
			(error: unknown) => finish({ error }),
		);
	});
}

function createRootEvalAbortLease(
	timeoutMs: number,
	parentSignal: AbortSignal | undefined,
	expired: () => Error,
): Readonly<{
	readonly signal: AbortSignal;
	dispose(): void;
}> {
	const controller = new AbortController();
	// AbortSignal.timeout() uses an unref'ed timer and cannot keep an admitted
	// async effect alive long enough to return its correlated outcome to Graph.
	const timer = setTimeout(() => controller.abort(expired()), timeoutMs);
	const abortFromParent = () => controller.abort(parentSignal?.reason);
	parentSignal?.addEventListener("abort", abortFromParent, { once: true });
	if (parentSignal?.aborted) abortFromParent();
	return Object.freeze({
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
			parentSignal?.removeEventListener("abort", abortFromParent);
		},
	});
}

async function waitForRootEvalDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	await new Promise<void>((resolvePromise, rejectPromise) => {
		let settled = false;
		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			if (error === undefined) resolvePromise();
			else rejectPromise(error);
		};
		const timer = setTimeout(() => finish(), delayMs);
		const onAbort = () => {
			finish(signal?.reason ?? new Error("root eval delay cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}

export async function awaitRootEvalCallerSettlement<T>(
	settle: () => Promise<T>,
	options: Readonly<{
		readonly deadlineMs?: number;
		readonly onDeadline?: (error: RootEvalCallerSettlementDeadlineExpired) => void;
	}> = {},
): Promise<T> {
	if (typeof settle !== "function")
		throw new TypeError("root eval caller settlement requires one async operation");
	const deadlineMs = options.deadlineMs ?? ROOT_EVAL_CALLER_SETTLEMENT_DEADLINE_MS;
	if (
		!Number.isSafeInteger(deadlineMs) ||
		deadlineMs < 1 ||
		deadlineMs > ROOT_EVAL_CALLER_SETTLEMENT_DEADLINE_MS
	)
		throw new TypeError("root eval caller settlement deadline was invalid");
	// Both handles are caller-runtime safety boundaries only. They inject no Graph
	// DATA and cannot choose retries, stopping, findings, or evidence admission.
	const lease = setInterval(() => undefined, 1_000);
	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			settle(),
			new Promise<never>((_resolve, reject) => {
				deadline = setTimeout(() => {
					const error = new RootEvalCallerSettlementDeadlineExpired(deadlineMs);
					options.onDeadline?.(error);
					reject(error);
				}, deadlineMs);
			}),
		]);
	} finally {
		clearInterval(lease);
		if (deadline !== undefined) clearTimeout(deadline);
	}
}

export interface RootEvalLivePricing {
	readonly inputMicrousdPerMillionTokens: number;
	readonly outputMicrousdPerMillionTokens: number;
	readonly cacheReadMicrousdPerMillionTokens: number;
}

export interface RootEvalLiveExecutor {
	execute(effect: EvalExecutableEffect): Promise<EvalExecutorOutcome>;
	dispose(reason?: unknown): Promise<void>;
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

class RootEvalProviderDispatchAuthorityConsumed extends TypeError {
	constructor(readonly failure: unknown) {
		super("root eval D145 provider dispatch authority was consumed before durable settlement");
	}
}

async function consumeCurrentProviderDispatch(input: {
	readonly privateRoot: string;
	readonly claimCommit: RootEvalLiveClaimCommit;
	readonly bearerToken: string;
	readonly executionMode: "live" | "no-network-qualification";
	readonly effect: EvalAdmittedEffect;
	readonly signal?: AbortSignal;
	readonly removeStage?: (stage: string) => Promise<void>;
}): Promise<void> {
	input.signal?.throwIfAborted();
	const privateRoot = resolve(input.privateRoot);
	const { assertRootEvalLiveClaimCommit } = await import("./root-eval-live-authority.js");
	const claim = assertRootEvalLiveClaimCommit({
		commit: input.claimCommit,
		privateRoot,
		executionMode: input.executionMode,
		credentialFingerprintDigest: empiricalSha256(new TextEncoder().encode(input.bearerToken)),
	});
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("root eval D145 dispatch private root drifted");
	input.signal?.throwIfAborted();
	const claimPath = join(privateRoot, `.${claim.generationRef}.disposition.v20.json`);
	const claimHandle = await open(claimPath, constants.O_RDONLY | constants.O_NOFOLLOW);
	let claimBytes: Uint8Array;
	try {
		const stat = await claimHandle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 65_536)
			throw new TypeError("root eval D145 committed claim identity invalid");
		claimBytes = new Uint8Array(await claimHandle.readFile());
	} finally {
		await claimHandle.close();
	}
	input.signal?.throwIfAborted();
	const decoded = strictJsonCodec.decode(claimBytes);
	if (!sameBytes(strictJsonCodec.encode(decoded), claimBytes))
		throw new TypeError("root eval D145 committed claim bytes were not canonical");
	if (!sameBytes(strictJsonCodec.encode(claim), claimBytes))
		throw new TypeError("root eval D145 executor requires the committed claim");
	const dispatchRoot = join(privateRoot, ".d145-provider-dispatches");
	await mkdir(dispatchRoot, { recursive: true, mode: 0o700 });
	await chmod(dispatchRoot, 0o700);
	await syncDirectory(privateRoot);
	await syncDirectory(dispatchRoot);
	input.signal?.throwIfAborted();
	const receipt = strictSnapshot({
		claimDigest: claim.claimDigest,
		executionId: input.effect.executionId,
		admissionId: input.effect.admissionId,
		operationId: input.effect.operationId,
		attempt: input.effect.attempt,
	});
	const bytes = strictJsonCodec.encode({
		...receipt,
		receiptDigest: empiricalStrictJsonDigest(receipt),
	});
	const target = join(
		dispatchRoot,
		`${empiricalStrictJsonDigest({ executionId: input.effect.executionId }).slice(7)}.json`,
	);
	const stage = join(dispatchRoot, `.stage-${randomUUID()}`);
	const handle = await open(
		stage,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	let linked = false;
	let dispatchFailure: unknown;
	try {
		input.signal?.throwIfAborted();
		await link(stage, target);
		linked = true;
		await syncDirectory(dispatchRoot);
	} catch (error) {
		dispatchFailure = linked ? new RootEvalProviderDispatchAuthorityConsumed(error) : error;
	}
	try {
		if (input.removeStage === undefined) await rm(stage, { force: true });
		else await input.removeStage(stage);
	} catch (error) {
		if (linked) dispatchFailure = new RootEvalProviderDispatchAuthorityConsumed(error);
		else dispatchFailure ??= error;
	}
	if (dispatchFailure !== undefined) throw dispatchFailure;
}

export interface RootEvalNoNetworkQualificationExecutor extends RootEvalLiveExecutor {
	providerRequestSummaries(): readonly Readonly<Record<string, unknown>>[];
}

interface ProcessResult {
	readonly code: number;
	readonly stdout: Uint8Array;
	readonly stderr: Uint8Array;
}

type RootEvalPrivateDiagnosticKind = "provider-response" | "public-verifier" | "hidden-verifier";

async function persistRootEvalPrivateDiagnostic(input: {
	readonly enabled: boolean;
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly effect: EvalAdmittedEffect;
	readonly kind: RootEvalPrivateDiagnosticKind;
	readonly material: Readonly<Record<string, unknown>>;
}): Promise<void> {
	if (!input.enabled) return;
	const directory = join(resolve(input.privateRoot), ".d145-development-diagnostics");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.root-eval-development-private-diagnostic.v1",
		decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
		generationRef: input.generationRef,
		kind: input.kind,
		executionId: input.effect.executionId,
		admissionId: input.effect.admissionId,
		workItemId: input.effect.workItemId,
		replicate: input.effect.replicate,
		arm: input.effect.arm,
		attempt: input.effect.attempt,
		material: input.material,
	});
	const bytes = strictJsonCodec.encode({
		...material,
		diagnosticDigest: empiricalStrictJsonDigest(material),
	});
	if (bytes.byteLength > 9 * 1_048_576)
		throw new TypeError("root eval private diagnostic exceeded its exact byte bound");
	const coordinate = empiricalStrictJsonDigest({
		executionId: input.effect.executionId,
		kind: input.kind,
	}).slice(7);
	const target = join(directory, `${coordinate}.json`);
	const stage = join(directory, `.stage-${randomUUID()}`);
	const handle = await open(
		stage,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(stage, target);
		await syncDirectory(directory);
	} catch (error) {
		try {
			const existing = await readFile(target);
			if (!sameBytes(existing, bytes)) throw error;
		} catch {
			throw error;
		}
	} finally {
		await rm(stage, { force: true });
	}
}

interface ProviderResult {
	readonly disposition: "tool" | "retryable" | "failed";
	readonly reason: EvalProviderOutcomeReason;
	readonly costMicrousd: number;
	readonly costEvidence: EvalProviderOutcome["costEvidence"];
	readonly pricingRoundingAllowanceMicrousd: number;
	readonly resultDigest: string;
	readonly retryAfterMs: number;
	readonly tool: Readonly<{
		readonly path: string;
		readonly oldText: string;
		readonly newText: string;
	}> | null;
}

class RootEvalProviderResponseError extends TypeError {
	constructor(
		readonly reason: EvalProviderOutcomeReason,
		message: string,
		readonly costMicrousd: number | null = null,
		readonly costEvidence: EvalProviderOutcome["costEvidence"] = "reservation-upper-bound",
		readonly pricingRoundingAllowanceMicrousd = 0,
	) {
		super(message);
	}
}

function responseError(
	reason: EvalProviderOutcomeReason,
	message: string,
	costMicrousd: number | null = null,
	costEvidence: EvalProviderOutcome["costEvidence"] = costMicrousd === null
		? "reservation-upper-bound"
		: "provider-reported",
	pricingRoundingAllowanceMicrousd = 0,
): never {
	throw new RootEvalProviderResponseError(
		reason,
		message,
		costMicrousd,
		costEvidence,
		pricingRoundingAllowanceMicrousd,
	);
}

function assertUniqueJsonObjectKeys(text: string): void {
	let index = 0;
	const fail = (): never => {
		throw new TypeError("structured proposal JSON lexeme invalid");
	};
	const skipWhitespace = (): void => {
		while (/\s/u.test(text[index] ?? "")) index += 1;
	};
	const readString = (): string => {
		const start = index;
		index += 1;
		while (index < text.length) {
			if (text[index] === '"') {
				index += 1;
				return JSON.parse(text.slice(start, index)) as string;
			}
			if (text[index] === "\\") index += 2;
			else index += 1;
		}
		return fail();
	};
	const consume = (literal: string): void => {
		if (text.slice(index, index + literal.length) !== literal) fail();
		index += literal.length;
	};
	const parseValue = (): void => {
		skipWhitespace();
		const token = text[index];
		if (token === "{") {
			parseObject();
			return;
		}
		if (token === "[") {
			parseArray();
			return;
		}
		if (token === '"') {
			readString();
			return;
		}
		if (token === "t") {
			consume("true");
			return;
		}
		if (token === "f") {
			consume("false");
			return;
		}
		if (token === "n") {
			consume("null");
			return;
		}
		const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/u.exec(text.slice(index));
		if (number === null) throw new TypeError("structured proposal JSON number invalid");
		index += number[0].length;
	};
	const parseObject = (): void => {
		const keys = new Set<string>();
		index += 1;
		skipWhitespace();
		if (text[index] === "}") {
			index += 1;
			return;
		}
		while (index < text.length) {
			skipWhitespace();
			if (text[index] !== '"') fail();
			const key = readString();
			if (keys.has(key)) fail();
			keys.add(key);
			skipWhitespace();
			if (text[index] !== ":") fail();
			index += 1;
			parseValue();
			skipWhitespace();
			if (text[index] === ",") {
				index += 1;
				continue;
			}
			if (text[index] === "}") {
				index += 1;
				return;
			}
			fail();
		}
		fail();
	};
	const parseArray = (): void => {
		index += 1;
		skipWhitespace();
		if (text[index] === "]") {
			index += 1;
			return;
		}
		while (index < text.length) {
			parseValue();
			skipWhitespace();
			if (text[index] === ",") {
				index += 1;
				continue;
			}
			if (text[index] === "]") {
				index += 1;
				return;
			}
			fail();
		}
		fail();
	};
	parseValue();
	skipWhitespace();
	if (index !== text.length) fail();
}

export function parseRootEvalUniqueJson(bytes: Uint8Array, path: string): unknown {
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		assertUniqueJsonObjectKeys(text);
		return JSON.parse(text);
	} catch {
		throw new TypeError(`${path} was not unique-key UTF-8 JSON`);
	}
}

export async function readRootEvalBoundedResponseBytes(
	response: Response,
	maxBytes: number,
	path: string,
): Promise<Uint8Array> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
		throw new TypeError(`${path} byte bound was invalid`);
	const contentLength = response.headers.get("content-length");
	if (
		contentLength !== null &&
		(!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
	) {
		await response.body?.cancel().catch(() => undefined);
		throw new TypeError(`${path} exceeded its content-length bound`);
	}
	if (response.body === null) throw new TypeError(`${path} body was unavailable`);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new TypeError(`${path} exceeded its streaming byte bound`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) index += 1;
			else return true;
		} else if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

function elapsed(started: number): number {
	return Math.max(0, Math.ceil(performance.now() - started));
}

async function runProcess(input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
}): Promise<ProcessResult> {
	input.signal?.throwIfAborted();
	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(input.command, [...input.args], {
			cwd: input.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			detached: process.platform !== "win32",
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let byteLength = 0;
		let settled = false;
		let terminalError: Error | undefined;
		const terminate = (error: Error) => {
			if (terminalError !== undefined) return;
			terminalError = error;
			try {
				if (process.platform !== "win32" && child.pid !== undefined)
					process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		};
		const timer = setTimeout(
			() => terminate(new TypeError("root eval live subprocess exceeded its admitted deadline")),
			input.timeoutMs,
		);
		const onAbort = () => {
			terminate(
				input.signal?.reason instanceof Error
					? input.signal.reason
					: new RootEvalEffectLeaseExpired(input.timeoutMs),
			);
		};
		input.signal?.addEventListener("abort", onAbort, { once: true });
		if (input.signal?.aborted) onAbort();
		const finish = (error?: Error, code = 1) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", onAbort);
			if (error !== undefined) rejectPromise(error);
			else
				resolvePromise(
					Object.freeze({
						code,
						stdout: new Uint8Array(Buffer.concat(stdout)),
						stderr: new Uint8Array(Buffer.concat(stderr)),
					}),
				);
		};
		const collect = (target: Buffer[], chunk: Buffer) => {
			byteLength += chunk.byteLength;
			if (byteLength > MAX_PROCESS_BYTES) {
				terminate(new TypeError("root eval live subprocess exceeded its output bound"));
				return;
			}
			target.push(chunk);
		};
		child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
		child.once("error", (error) => finish(error));
		child.once("close", (code) => finish(terminalError, code ?? 1));
	});
}

function exactObject(
	value: unknown,
	keys: readonly string[],
	path: string,
): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be an object`);
	const candidate = value as Record<string, unknown>;
	if (Object.keys(candidate).sort().join("\u0000") !== [...keys].sort().join("\u0000"))
		throw new TypeError(`${path} shape drifted`);
	return candidate;
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function safeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new TypeError(`${path} must be a non-negative safe integer`);
	return value as number;
}

function providerReportedCost(root: Record<string, unknown>): Readonly<{
	readonly exactProviderCostMicrousd: number;
	readonly costMicrousd: number;
	readonly pricingRoundingAllowanceMicrousd: number;
}> {
	const usage = object(root.usage, "provider usage");
	if (typeof usage.cost !== "number" || !Number.isFinite(usage.cost) || usage.cost < 0)
		throw new TypeError("provider usage.cost must be a non-negative finite number");
	const exactProviderCostMicrousd = usage.cost * 1_000_000;
	if (
		!Number.isFinite(exactProviderCostMicrousd) ||
		exactProviderCostMicrousd < 0 ||
		exactProviderCostMicrousd > Number.MAX_SAFE_INTEGER
	)
		throw new TypeError("provider usage.cost exceeded safe microusd bounds");
	const costMicrousd = Math.ceil(exactProviderCostMicrousd);
	return Object.freeze({
		exactProviderCostMicrousd,
		costMicrousd,
		pricingRoundingAllowanceMicrousd:
			costMicrousd === Math.floor(exactProviderCostMicrousd) ? 0 : 1,
	});
}

function auditProviderReportedCost(
	root: Record<string, unknown>,
	pricing: RootEvalLivePricing,
	cost: ReturnType<typeof providerReportedCost>,
): void {
	const usage = object(root.usage, "provider usage");
	const input = safeInteger(usage.prompt_tokens, "provider usage.prompt_tokens");
	const output = safeInteger(usage.completion_tokens, "provider usage.completion_tokens");
	if (safeInteger(usage.total_tokens, "provider usage.total_tokens") !== input + output)
		throw new TypeError("provider usage total drifted");
	const details =
		usage.prompt_tokens_details === undefined
			? undefined
			: object(usage.prompt_tokens_details, "provider usage.prompt_tokens_details");
	const cached =
		details?.cached_tokens === undefined
			? 0
			: safeInteger(details.cached_tokens, "provider usage.cached_tokens");
	if (cached > input) throw new TypeError("provider cached token usage exceeded input usage");
	const numerators = [
		(input - cached) * pricing.inputMicrousdPerMillionTokens,
		cached * pricing.cacheReadMicrousdPerMillionTokens,
		output * pricing.outputMicrousdPerMillionTokens,
	] as const;
	if (numerators.some((numerator) => !Number.isSafeInteger(numerator) || numerator < 0))
		throw new TypeError("provider usage pricing arithmetic exceeded safe integer bounds");
	const tokenPricingAuditMicrousd =
		numerators.reduce((total, numerator) => total + numerator, 0) / 1_000_000;
	if (Math.abs(tokenPricingAuditMicrousd - cost.exactProviderCostMicrousd) > 1e-6)
		throw new TypeError("provider usage.cost disagreed with the admitted route pricing audit");
}

export function parseRootEvalLiveProviderResponse(input: {
	readonly status: number;
	readonly bytes: Uint8Array;
	readonly retryAfter: string | null;
	readonly pricing: RootEvalLivePricing;
	readonly reservationMicrousd: number;
	readonly writablePath?: string;
}): ProviderResult {
	if (!Number.isSafeInteger(input.reservationMicrousd) || input.reservationMicrousd < 1)
		throw new TypeError("root eval live provider reservation was invalid");
	if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_RESPONSE_BYTES)
		responseError(
			"response-bounds-invalid",
			"root eval live provider response exceeded its byte bound",
		);
	let decoded: unknown;
	try {
		decoded = parseRootEvalUniqueJson(input.bytes, "root eval live provider response");
	} catch {
		responseError(
			"response-json-invalid",
			"root eval live provider response was not bounded UTF-8 JSON",
		);
	}
	const root = decoded as Record<string, unknown>;
	const retryAfterMs =
		input.retryAfter !== null && /^\d+$/u.test(input.retryAfter)
			? Math.min(120_000, Number(input.retryAfter) * 1_000)
			: 0;
	let errorCostMicrousd = input.reservationMicrousd;
	let errorCostEvidence: EvalProviderOutcome["costEvidence"] = "reservation-upper-bound";
	let errorPricingRoundingAllowanceMicrousd = 0;
	if (root.usage !== undefined) {
		try {
			const cost = providerReportedCost(root);
			errorCostMicrousd = cost.costMicrousd;
			errorCostEvidence = "provider-reported";
			errorPricingRoundingAllowanceMicrousd = cost.pricingRoundingAllowanceMicrousd;
		} catch {
			// A malformed error-body usage record cannot reduce the admitted reservation.
		}
	}
	if (input.status === 429)
		return Object.freeze({
			disposition: "retryable" as const,
			reason: "http-429-retryable" as const,
			costMicrousd: errorCostMicrousd,
			costEvidence: errorCostEvidence,
			pricingRoundingAllowanceMicrousd: errorPricingRoundingAllowanceMicrousd,
			resultDigest: empiricalSha256(input.bytes),
			retryAfterMs: Math.max(60_000, retryAfterMs),
			tool: null,
		});
	if (input.status < 200 || input.status >= 300)
		return Object.freeze({
			disposition: "failed" as const,
			reason: "http-failed" as const,
			costMicrousd: errorCostMicrousd,
			costEvidence: errorCostEvidence,
			pricingRoundingAllowanceMicrousd: errorPricingRoundingAllowanceMicrousd,
			resultDigest: empiricalSha256(input.bytes),
			retryAfterMs: 0,
			tool: null,
		});
	if (
		root.provider !== "Fireworks" ||
		!["deepseek/deepseek-v4-flash-0731", "deepseek/deepseek-v4-flash-20260731"].includes(
			String(root.model),
		)
	)
		responseError(
			"response-route-invalid",
			"root eval live provider response lost its exact route identity",
		);
	let cost: ReturnType<typeof providerReportedCost>;
	try {
		cost = providerReportedCost(root);
	} catch {
		responseError("response-usage-invalid", "root eval live provider response usage was invalid");
	}
	try {
		auditProviderReportedCost(root, input.pricing, cost);
	} catch {
		responseError(
			"response-usage-invalid",
			"root eval live provider response usage pricing audit was invalid",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	}
	const choices = root.choices;
	if (!Array.isArray(choices) || choices.length !== 1)
		responseError(
			"response-choice-invalid",
			"root eval live provider returned an invalid choice cardinality",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	let choice: Record<string, unknown>;
	let message: Record<string, unknown>;
	try {
		choice = object(choices[0], "choice");
		message = object(choice.message, "choice.message");
	} catch {
		responseError(
			"response-choice-invalid",
			"root eval live provider returned an invalid choice shape",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	}
	if (choice.finish_reason === "length" || choice.native_finish_reason === "length")
		responseError(
			"response-output-truncated",
			"root eval live provider exhausted the admitted output ceiling",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	if (
		["tool_calls", "function_call", "refusal"].some(
			(key) => Object.hasOwn(message, key) && message[key] !== null,
		)
	)
		responseError(
			"response-proposal-legacy-shape",
			"root eval live provider returned a conflicting proposal envelope",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	if (typeof message.content !== "string")
		responseError(
			"response-proposal-missing",
			"root eval live provider omitted the structured proposal",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	let args: Record<string, unknown>;
	try {
		assertUniqueJsonObjectKeys(message.content);
		args = exactObject(
			JSON.parse(message.content),
			["newText", "oldText", "path"],
			"structured proposal",
		);
	} catch {
		responseError(
			"response-proposal-invalid",
			"root eval live provider returned an invalid structured proposal",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	}
	const writablePath = input.writablePath ?? ROOT_EVAL_LIVE_WRITABLE_PATH;
	if (
		args.path !== writablePath ||
		typeof args.oldText !== "string" ||
		typeof args.newText !== "string" ||
		args.oldText.length < 1 ||
		args.oldText.length > 32_768 ||
		args.newText.length > 32_768 ||
		hasUnpairedSurrogate(args.path) ||
		hasUnpairedSurrogate(args.oldText) ||
		hasUnpairedSurrogate(args.newText)
	)
		responseError(
			"response-proposal-arguments-invalid",
			"root eval live exact tool arguments failed their bound",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	if (message.role !== "assistant")
		responseError(
			"response-proposal-invalid",
			"root eval live provider proposal role was invalid",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	if (
		choice.finish_reason !== "stop" ||
		(choice.native_finish_reason != null && choice.native_finish_reason !== "stop")
	)
		responseError(
			"response-proposal-invalid",
			"root eval live provider proposal did not reach its admitted terminal state",
			cost.costMicrousd,
			"provider-reported",
			cost.pricingRoundingAllowanceMicrousd,
		);
	return Object.freeze({
		disposition: "tool" as const,
		reason: "tool-proposed" as const,
		costMicrousd: cost.costMicrousd,
		costEvidence: "provider-reported" as const,
		pricingRoundingAllowanceMicrousd: cost.pricingRoundingAllowanceMicrousd,
		resultDigest: empiricalSha256(input.bytes),
		retryAfterMs: 0,
		tool: Object.freeze({
			path: args.path,
			oldText: args.oldText,
			newText: args.newText,
		}),
	});
}

function admittedPayload(
	effect: EvalAdmittedEffect,
	task: RootEvalTaskDefinition,
	tasks: readonly RootEvalTaskDefinition[],
	taskManifestDigest: string,
): Readonly<{
	readonly material: Record<string, unknown>;
	readonly memoryContent: string;
}> {
	const payload = effect.request.payload;
	if (payload === null || typeof payload !== "object" || Array.isArray(payload))
		throw new TypeError("root eval live effect lost its admitted provider payload");
	const value = payload as Record<string, unknown>;
	if (effect.workItemRole === "source") {
		if (
			effect.arm !== "source" ||
			value.bindingRef !== `${effect.workItemId}/private-input` ||
			value.digest !==
				empiricalStrictJsonDigest({
					kind: "eval-private-source-input-binding",
					replicate: effect.replicate,
					taskManifestDigest,
				}) ||
			value.memoryProvenance !== "none" ||
			value.memoryExposureCount !== 0 ||
			!Array.isArray(value.memoryBindings) ||
			value.memoryBindings.length !== 0 ||
			value.memoryContextDigest !==
				empiricalStrictJsonDigest({
					kind: "eval-source-memory-context",
					taskInstanceRef: task.instanceRef,
					taskManifestDigest,
				})
		)
			throw new TypeError("root eval live source effect lost its exact manifest binding");
		return Object.freeze({ material: value, memoryContent: NO_ADMITTED_MEMORY_CONTEXT });
	}
	const exposed = effect.arm === "relevant-applied" || effect.arm === "irrelevant-applied";
	const expectedProvenance = effect.arm === "cold" ? "none" : effect.arm;
	const replicateMarker = `/replicate-${effect.replicate}/`;
	const markerIndex = effect.workItemId.indexOf(replicateMarker);
	if (markerIndex < 1 || task.replicate !== effect.replicate)
		throw new TypeError("root eval live task instance lost its replicate binding");
	const memoryTask =
		effect.arm === "irrelevant-applied" ? tasks[effect.replicate % tasks.length]! : task;
	const sourceWorkItemId = memoryTask.sourceWorkItemRef;
	const sourceEvidenceDigest = memoryTask.sourceVerifierEvidenceDigest;
	if (
		task.instanceRef !== `${task.taskSetRef}/instance-${effect.replicate}` ||
		task.sourceWorkItemRef !== `${task.instanceRef}/source-work-item` ||
		memoryTask.sourceWorkItemRef !== `${memoryTask.instanceRef}/source-work-item`
	)
		throw new TypeError("root eval live task lost its verified source Work Item authority");
	const sourceInsightDigest = memoryTask.sourceInsightDigest;
	const expectedBindingDigest = empiricalStrictJsonDigest({
		kind: "eval-private-memory-binding",
		taskInstanceRef: memoryTask.instanceRef,
		sourceWorkItemId,
		sourceEvidenceDigest,
		sourceInsightDigest,
		arm: effect.arm,
	});
	const expectedContextDigest = empiricalStrictJsonDigest({
		kind: "eval-memory-context",
		taskInstanceRef: task.instanceRef,
		sourceWorkItemId,
		sourceEvidenceDigest,
		sourceInsightDigest,
		arm: effect.arm,
		exposedRecordIds: exposed ? [`${effect.workItemId}/memory-fragment`] : [],
		bindings: exposed
			? [
					{
						bindingRef: `${effect.workItemId}/private-memory`,
						digest: expectedBindingDigest,
					},
				]
			: [],
	});
	const memoryBindings = Array.isArray(value.memoryBindings)
		? (value.memoryBindings as readonly unknown[])
		: null;
	if (
		effect.providerRef !== "fireworks" ||
		effect.providerModelRef !== "deepseek/deepseek-v4-flash-0731" ||
		effect.endpointProtocol !== "chat-completions" ||
		effect.proposalEncoding !== "strict-json-schema" ||
		effect.responseContractRevision !== "bounded-structured-proposal.v3" ||
		!/^sha256:[0-9a-f]{64}$/u.test(effect.profileResolutionDigest) ||
		value.bindingRef !== `${effect.workItemId}/private-input` ||
		value.digest !==
			empiricalStrictJsonDigest({
				kind: "eval-private-input-binding",
				replicate: effect.replicate,
				arm: effect.arm,
			}) ||
		value.memoryProvenance !== expectedProvenance ||
		value.memoryExposureCount !== (exposed ? 1 : 0) ||
		memoryBindings === null ||
		memoryBindings.length !== (exposed ? 1 : 0) ||
		value.memoryContextDigest !== expectedContextDigest
	)
		throw new TypeError("root eval live effect lost its exact qualified profile binding");
	if (!exposed)
		return Object.freeze({ material: value, memoryContent: NO_ADMITTED_MEMORY_CONTEXT });
	const binding = object(memoryBindings[0], "admitted memory binding");
	if (
		binding.bindingRef !== `${effect.workItemId}/private-memory` ||
		binding.digest !== expectedBindingDigest
	)
		throw new TypeError("root eval live memory binding was not exactly dereferenceable");
	return Object.freeze({
		material: value,
		memoryContent: memoryTask.sourceInsightContent,
	});
}

function excerpt(source: string, start: string, end: string): string {
	const first = source.indexOf(start);
	const last = source.indexOf(end, first + start.length);
	if (first < 0 || last < 0) throw new TypeError("root eval frozen source excerpt drifted");
	return source.slice(first, last);
}

async function liveWire(
	effect: EvalAdmittedEffect,
	root: string,
	task: RootEvalTaskDefinition,
	tasks: readonly RootEvalTaskDefinition[],
	taskManifestDigest: string,
	signal?: AbortSignal,
): Promise<string> {
	signal?.throwIfAborted();
	const admitted = admittedPayload(effect, task, tasks, taskManifestDigest);
	const actorSections: string[] = [];
	for (const source of task.actorContext) {
		const material = await readFile(join(root, source.path), "utf8");
		signal?.throwIfAborted();
		actorSections.push(
			`### ${source.heading}\n${
				source.excerptStart === undefined || source.excerptEnd === undefined
					? material
					: excerpt(material, source.excerptStart, source.excerptEnd)
			}`,
		);
	}
	return JSON.stringify({
		model: effect.providerModelRef,
		messages: [
			{
				role: "system",
				content:
					"You are editing one bounded TypeScript workspace. Inspect the supplied producer and identity contracts, then return exactly one JSON object matching the required replacement schema. Put the complete smallest behaviorally correct change in that object. Do not claim validation; the Graph runs independent public and withheld behavioral verification.",
			},
			{
				role: "user",
				content: `${task.taskStatement}\n\n### Admitted memory context\n${admitted.memoryContent}\n\n${actorSections.join("\n\n")}`,
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "exact_replacement_proposal",
				strict: true,
				schema: {
					type: "object",
					additionalProperties: false,
					required: ["path", "oldText", "newText"],
					properties: {
						path: { type: "string", enum: [task.writablePath] },
						oldText: { type: "string", minLength: 1, maxLength: 32_768 },
						newText: { type: "string", maxLength: 32_768 },
					},
				},
			},
		},
		max_tokens: effect.maxOutputTokens,
		reasoning: { effort: effect.reasoningEffort },
		provider: {
			order: [effect.providerRef],
			only: [effect.providerRef],
			allow_fallbacks: false,
			require_parameters: true,
			data_collection: "deny",
			zdr: true,
		},
	});
}

async function materialize(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly effect: EvalAdmittedEffect;
	readonly task?: RootEvalTaskDefinition;
	readonly signal?: AbortSignal;
}): Promise<string> {
	input.signal?.throwIfAborted();
	const task = input.task ?? rootEvalTask("development-transfer", input.effect.replicate);
	const root = rootEvalWorkspaceForAdmission(input.materializationRoot, input.effect);
	await mkdir(dirname(root), { recursive: true, mode: 0o700 });
	input.signal?.throwIfAborted();
	const clone = await runProcess({
		command: "/usr/bin/git",
		args: ["clone", "--shared", "--no-checkout", input.repositoryRoot, root],
		cwd: input.materializationRoot,
		timeoutMs: 120_000,
		signal: input.signal,
	});
	if (clone.code !== 0) throw new TypeError("root eval frozen workspace clone failed");
	const checkout = await runProcess({
		command: "/usr/bin/git",
		args: ["checkout", "--detach", task.baselineCommit],
		cwd: root,
		timeoutMs: 120_000,
		signal: input.signal,
	});
	if (checkout.code !== 0) throw new TypeError("root eval frozen baseline checkout failed");
	for (const relative of ["node_modules", "packages/ts/node_modules"] as const) {
		input.signal?.throwIfAborted();
		const link = join(root, relative);
		await mkdir(dirname(link), { recursive: true });
		await symlink(join(input.repositoryRoot, relative), link, "dir");
	}
	const target = join(root, task.writablePath);
	input.signal?.throwIfAborted();
	for (const fixture of task.readonlyFixtureFiles) {
		const fixturePath = join(root, fixture.path);
		await mkdir(dirname(fixturePath), { recursive: true, mode: 0o700 });
		await writeFile(fixturePath, fixture.text, { encoding: "utf8", mode: 0o600 });
	}
	await mkdir(dirname(target), { recursive: true, mode: 0o700 });
	await writeFile(target, task.fixtureBuggyText, { encoding: "utf8", mode: 0o600 });
	input.signal?.throwIfAborted();
	const stage = await runProcess({
		command: "/usr/bin/git",
		args: [
			"add",
			"--",
			...task.readonlyFixtureFiles.map((fixture) => fixture.path),
			task.writablePath,
		],
		cwd: root,
		timeoutMs: 30_000,
		signal: input.signal,
	});
	if (stage.code !== 0) throw new TypeError("root eval frozen fixture staging failed");
	const commit = await runProcess({
		command: "/usr/bin/git",
		args: [
			"-c",
			"user.name=GraphReFly Eval",
			"-c",
			"user.email=eval@invalid.local",
			"-c",
			"core.hooksPath=/dev/null",
			"commit",
			"--no-gpg-sign",
			"--no-verify",
			"-m",
			"root eval frozen task fixture",
		],
		cwd: root,
		timeoutMs: 30_000,
		signal: input.signal,
	});
	if (commit.code !== 0) throw new TypeError("root eval frozen fixture commit failed");
	return root;
}

export function rootEvalWorkspaceForAdmission(
	root: string,
	effect: Pick<EvalAdmittedEffect, "replicate" | "workItemRole" | "arm" | "attempt">,
): string {
	return join(
		root,
		`replicate-${effect.replicate}-${effect.workItemRole}-${effect.arm}-attempt-${effect.attempt}`,
	);
}

async function applyExactTool(
	root: string,
	tool: NonNullable<ProviderResult["tool"]>,
	task: RootEvalTaskDefinition,
): Promise<"scoped-change" | "no-change" | "wrong-scope"> {
	const path = resolve(root, tool.path);
	if (!path.startsWith(`${resolve(root)}/`) || tool.path !== task.writablePath)
		throw new TypeError("root eval exact tool escaped its admitted path");
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
		throw new TypeError("root eval exact tool target identity drifted");
	const source = await readFile(path, "utf8");
	const first = source.indexOf(tool.oldText);
	if (
		tool.oldText === tool.newText ||
		first < 0 ||
		source.indexOf(tool.oldText, first + tool.oldText.length) >= 0
	)
		return "no-change";
	await writeFile(
		path,
		`${source.slice(0, first)}${tool.newText}${source.slice(first + tool.oldText.length)}`,
		"utf8",
	);
	const diff = await runProcess({
		command: "/usr/bin/git",
		args: ["diff", "--name-only"],
		cwd: root,
		timeoutMs: 30_000,
	});
	const changed = new TextDecoder().decode(diff.stdout).trim().split(/\r?\n/u).filter(Boolean);
	return diff.code === 0 && changed.length === 1 && changed[0] === task.writablePath
		? "scoped-change"
		: "wrong-scope";
}

async function verify(
	root: string,
	diff: "scoped-change" | "no-change" | "wrong-scope",
	task: RootEvalTaskDefinition,
	signal?: AbortSignal,
	onDiagnostic?: (
		kind: "public-verifier" | "hidden-verifier",
		result: ProcessResult,
	) => Promise<void>,
) {
	if (diff !== "scoped-change")
		return Object.freeze({ publicSemantic: false, hiddenVerifier: false });
	await mkdir(dirname(join(root, task.publicVerifierPath)), { recursive: true });
	await writeFile(join(root, task.publicVerifierPath), task.publicVerifierSource, "utf8");
	const focused = await runProcess({
		command: join(root, "node_modules/.bin/vitest"),
		args: [
			"run",
			"--config",
			"vitest.config.ts",
			task.publicVerifierPath.slice("packages/ts/".length),
			"-t",
			task.publicVerifierName,
		],
		cwd: join(root, "packages/ts"),
		timeoutMs: 120_000,
		signal,
	});
	await onDiagnostic?.("public-verifier", focused);
	if (focused.code !== 0) return Object.freeze({ publicSemantic: false, hiddenVerifier: false });
	await mkdir(dirname(join(root, task.hiddenVerifierPath)), { recursive: true });
	await writeFile(join(root, task.hiddenVerifierPath), task.hiddenVerifierSource, "utf8");
	const hidden = await runProcess({
		command: join(root, "node_modules/.bin/vitest"),
		args: [
			"run",
			"--config",
			"vitest.config.ts",
			task.hiddenVerifierPath.slice("packages/ts/".length),
			"-t",
			task.hiddenVerifierName,
		],
		cwd: join(root, "packages/ts"),
		timeoutMs: 300_000,
		signal,
	});
	await onDiagnostic?.("hidden-verifier", hidden);
	return Object.freeze({ publicSemantic: true, hiddenVerifier: hidden.code === 0 });
}

export async function qualifyRootEvalTransferTaskFamily(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
}): Promise<
	readonly Readonly<{
		readonly replicate: 1 | 2 | 3 | 4 | 5;
		readonly publicAllowsAmbiguousBug: true;
		readonly hiddenRejectsAmbiguousBug: true;
		readonly exactScopedChange: true;
		readonly correctPassesPublicAndHidden: true;
	}>[]
> {
	const materializationRoot = resolve(input.materializationRoot);
	const results = [];
	for (const task of ROOT_EVAL_DEVELOPMENT_TASKS) {
		const effect = {
			replicate: task.replicate,
			arm: "relevant-applied",
			attempt: 1,
		} as EvalAdmittedEffect;
		const root = await materialize({
			repositoryRoot: resolve(input.repositoryRoot),
			materializationRoot,
			effect,
			task,
		});
		try {
			const ambiguousBug = await verify(root, "scoped-change", task);
			const diff = await applyExactTool(
				root,
				{
					path: task.writablePath,
					oldText: task.fixtureBuggyText,
					newText: task.fixtureCorrectText,
				},
				task,
			);
			const correct = await verify(root, diff, task);
			if (
				!ambiguousBug.publicSemantic ||
				ambiguousBug.hiddenVerifier ||
				diff !== "scoped-change" ||
				!correct.publicSemantic ||
				!correct.hiddenVerifier
			)
				throw new TypeError(
					`root eval transfer task ${task.replicate} failed closed: ${JSON.stringify({ ambiguousBug, diff, correct })}`,
				);
			results.push(
				Object.freeze({
					replicate: task.replicate,
					publicAllowsAmbiguousBug: true as const,
					hiddenRejectsAmbiguousBug: true as const,
					exactScopedChange: true as const,
					correctPassesPublicAndHidden: true as const,
				}),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
	return Object.freeze(results);
}

function providerOutcome(
	effect: EvalAdmittedEffect,
	input: {
		readonly status: EvalProviderOutcome["status"];
		readonly reason: EvalProviderOutcomeReason;
		readonly dispatchAttempted: boolean;
		readonly costMicrousd: number;
		readonly costEvidence: EvalProviderOutcome["costEvidence"];
		readonly pricingRoundingAllowanceMicrousd: number;
		readonly elapsedMs: number;
		readonly resultDigest: string;
		readonly retryAfterMs: number;
		readonly cleanupCompleted: boolean;
		readonly tool: ProviderResult["tool"];
	},
): EvalProviderOutcome {
	const toolProposal =
		input.tool === null
			? null
			: Object.freeze({
					toolRef: "graphrefly.eval.exact-tool.v1" as const,
					...input.tool,
					argumentsDigest: empiricalStrictJsonDigest({
						toolRef: "graphrefly.eval.exact-tool.v1",
						...input.tool,
					}),
				});
	return Object.freeze({
		kind: "eval-provider-outcome" as const,
		admission: effect,
		admissionId: effect.admissionId,
		executionId: effect.executionId,
		operationId: effect.operationId,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		replicate: effect.replicate,
		arm: effect.arm,
		workItemRole: effect.workItemRole,
		attempt: effect.attempt,
		status: input.status,
		reason: input.reason,
		dispatchAttempted: input.dispatchAttempted,
		costMicrousd: input.costMicrousd,
		costEvidence: input.costEvidence,
		pricingRoundingAllowanceMicrousd: input.pricingRoundingAllowanceMicrousd,
		elapsedMs: input.elapsedMs,
		resultDigest: input.resultDigest,
		retryAfterMs: input.retryAfterMs,
		cleanupCompleted: input.cleanupCompleted,
		toolProposal,
	});
}

function toolOutcome(
	effect: EvalAdmittedToolEffect,
	input: {
		readonly status: EvalEffectOutcome["status"];
		readonly elapsedMs: number;
		readonly resultDigest: string;
		readonly expectedDigest: string;
		readonly actualDigest: string;
		readonly diff: EvalEffectOutcome["evidence"]["diff"];
		readonly cleanupCompleted: boolean;
		readonly publicSemantic: boolean;
		readonly hiddenVerifier: boolean;
	},
): EvalEffectOutcome {
	return Object.freeze({
		kind: "eval-effect-outcome" as const,
		admission: effect,
		executionId: effect.executionId,
		admissionId: effect.providerAdmission.admissionId,
		toolAdmissionId: effect.toolAdmissionId,
		operationId: effect.providerAdmission.operationId,
		argumentsDigest: effect.argumentsDigest,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		replicate: effect.replicate,
		arm: effect.arm,
		workItemRole: effect.workItemRole,
		attempt: effect.attempt,
		status: input.status,
		costMicrousd: 0 as const,
		elapsedMs: input.elapsedMs,
		resultDigest: input.resultDigest,
		evidence: Object.freeze({
			expectedDigest: input.expectedDigest,
			actualDigest: input.actualDigest,
			diff: input.diff,
			cleanupCompleted: input.cleanupCompleted,
			publicSemantic: input.publicSemantic ? "equivalent" : "different",
			hiddenVerifier: input.hiddenVerifier ? "pass" : "fail",
		}),
	});
}

export interface RootEvalLiveExecutorInput {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly privateRoot: string;
	readonly claimCommit: RootEvalLiveClaimCommit;
	readonly bearerToken: string;
	readonly pricing: RootEvalLivePricing;
	readonly taskKind?: RootEvalTaskKind;
	readonly taskManifestSlot?: RootEvalTaskManifestSlot;
	readonly taskManifest?: RootEvalTaskManifest;
	readonly diagnosticMode?: "none" | "development-private";
	readonly beforeProviderDispatch?: (
		effect: EvalAdmittedEffect,
		signal: AbortSignal,
	) => Promise<void>;
	readonly onProviderCall?: (effect: EvalAdmittedEffect) => void;
	readonly wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
	readonly observeCurrentKey?: (
		effect: EvalBillingObservationEffect,
		signal?: AbortSignal,
	) => Promise<EvalCurrentKeySnapshot>;
	readonly removeWorkspace?: (root: string, signal: AbortSignal) => Promise<void>;
	readonly removeDispatchStage?: (stage: string) => Promise<void>;
}

const ROOT_EVAL_REMOVE_WORKSPACE_SCRIPT =
	'import { rm } from "node:fs/promises"; await rm(process.argv[1], { recursive: true, force: true });';

function createRootEvalLiveExecutorInternal(
	input: RootEvalLiveExecutorInput,
	executionMode: "live" | "no-network-qualification",
	providerFetch: typeof fetch,
): RootEvalLiveExecutor {
	const repositoryRoot = resolve(input.repositoryRoot);
	const materializationRoot = resolve(input.materializationRoot);
	const taskKind = input.taskKind ?? "development-transfer";
	const taskManifest =
		input.taskManifest ??
		(input.taskManifestSlot === undefined
			? undefined
			: readRootEvalTaskManifest(input.taskManifestSlot));
	if (
		taskManifest !== undefined &&
		(taskManifest.slot !== input.taskManifestSlot ||
			taskManifest.taskSetRef !== input.claimCommit.claim.taskSetRef ||
			taskManifest.manifestDigest !== input.claimCommit.claim.taskManifestDigest)
	)
		throw new TypeError("root eval claim-bound task manifest drifted before executor creation");
	const tasks = taskManifest?.tasks ?? ROOT_EVAL_DEVELOPMENT_TASKS;
	const taskManifestDigest = taskManifest?.manifestDigest ?? ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST;
	const taskForEffect = (effect: Pick<EvalAdmittedEffect, "replicate" | "workItemRole">) => {
		const task = tasks[effect.replicate - 1];
		if (task === undefined || task.kind !== taskKind)
			throw new TypeError("root eval claim-bound task was unavailable");
		return executionTask(task, effect.workItemRole);
	};
	const privateDiagnostics = input.diagnosticMode === "development-private";
	if (privateDiagnostics && taskKind !== "development-transfer")
		throw new TypeError("root eval private proposal diagnostics are development-only");
	if (input.bearerToken.length < 16 || input.bearerToken.length > 4_096)
		throw new TypeError("root eval D145 credential was invalid");
	let disposed = false;
	const cancellation = new AbortController();
	const active = new Map<string, Promise<EvalExecutorOutcome>>();
	const cleanup = async (root: string, signal: AbortSignal): Promise<boolean> => {
		try {
			const operation: Promise<unknown> =
				input.removeWorkspace === undefined
					? runProcess({
							command: process.execPath,
							args: ["--input-type=module", "--eval", ROOT_EVAL_REMOVE_WORKSPACE_SCRIPT, root],
							cwd: repositoryRoot,
							timeoutMs: ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS,
							signal,
						})
					: input.removeWorkspace(root, signal);
			await awaitRootEvalAbortable(operation, signal);
			signal.throwIfAborted();
			return true;
		} catch {
			return false;
		}
	};
	const executeProvider = async (effect: EvalAdmittedEffect): Promise<EvalProviderOutcome> => {
		const task = taskForEffect(effect);
		const started = performance.now();
		const settlementLease = createRootEvalSettlementLease(
			"provider",
			ROOT_EVAL_PROVIDER_SETTLEMENT_LEASE_MS,
			cancellation.signal,
		);
		const lease = createRootEvalEffectLease(effect.timeoutMs, settlementLease.signal);
		const root = rootEvalWorkspaceForAdmission(materializationRoot, effect);
		let postDispatch = false;
		let confirmedCostMicrousd = 0;
		let confirmedPricingRoundingAllowanceMicrousd = 0;
		try {
			const materializedRoot = await materialize({
				repositoryRoot,
				materializationRoot,
				effect,
				task,
				signal: lease.signal,
			});
			if (materializedRoot !== root)
				throw new TypeError("root eval materialized workspace identity drifted");
			const body = await liveWire(effect, root, task, tasks, taskManifestDigest, lease.signal);
			if (input.beforeProviderDispatch !== undefined)
				await awaitRootEvalAbortable(
					input.beforeProviderDispatch(effect, lease.signal),
					lease.signal,
				);
			lease.signal.throwIfAborted();
			await consumeCurrentProviderDispatch({
				privateRoot: input.privateRoot,
				claimCommit: input.claimCommit,
				bearerToken: input.bearerToken,
				executionMode,
				effect,
				signal: lease.signal,
				removeStage: input.removeDispatchStage,
			});
			postDispatch = true;
			input.onProviderCall?.(effect);
			lease.signal.throwIfAborted();
			const response = await providerFetch(ROOT_EVAL_LIVE_ENDPOINT, {
				method: "POST",
				redirect: "error",
				cache: "no-store",
				credentials: "omit",
				referrerPolicy: "no-referrer",
				headers: {
					authorization: `Bearer ${input.bearerToken}`,
					"content-type": "application/json",
					accept: "application/json",
				},
				body,
				signal: lease.signal,
			});
			if (response.redirected || response.url !== ROOT_EVAL_LIVE_ENDPOINT)
				throw new TypeError("root eval D145 provider response route drifted");
			const bytes = await readRootEvalBoundedResponseBytes(
				response,
				MAX_RESPONSE_BYTES,
				"root eval live provider response",
			);
			await persistRootEvalPrivateDiagnostic({
				enabled: privateDiagnostics,
				privateRoot: input.privateRoot,
				generationRef: input.claimCommit.claim.generationRef,
				effect,
				kind: "provider-response",
				material: Object.freeze({
					status: response.status,
					retryAfter: response.headers.get("retry-after"),
					responseByteLength: bytes.byteLength,
					responseDigest: empiricalSha256(bytes),
					responseBase64: Buffer.from(bytes).toString("base64"),
				}),
			});
			const provider = parseRootEvalLiveProviderResponse({
				status: response.status,
				bytes,
				retryAfter: response.headers.get("retry-after"),
				pricing: input.pricing,
				reservationMicrousd: effect.reservationMicrousd,
				writablePath: task.writablePath,
			});
			confirmedCostMicrousd = provider.costMicrousd;
			confirmedPricingRoundingAllowanceMicrousd = provider.pricingRoundingAllowanceMicrousd;
			if (provider.disposition === "tool")
				return providerOutcome(effect, {
					status: "tool-proposed",
					reason: provider.reason,
					dispatchAttempted: true,
					costMicrousd: provider.costMicrousd,
					costEvidence: provider.costEvidence,
					pricingRoundingAllowanceMicrousd: provider.pricingRoundingAllowanceMicrousd,
					elapsedMs: elapsed(started),
					resultDigest: provider.resultDigest,
					retryAfterMs: 0,
					cleanupCompleted: false,
					tool: provider.tool,
				});
			const cleanupCompleted = await cleanup(root, settlementLease.signal);
			return providerOutcome(effect, {
				status:
					provider.disposition === "retryable" && effect.attempt === 1 ? "retryable" : "failed",
				reason:
					provider.disposition === "retryable" && effect.attempt !== 1
						? "http-failed"
						: provider.reason,
				dispatchAttempted: true,
				costMicrousd: provider.costMicrousd,
				costEvidence: provider.costEvidence,
				pricingRoundingAllowanceMicrousd: provider.pricingRoundingAllowanceMicrousd,
				elapsedMs: elapsed(started),
				resultDigest: provider.resultDigest,
				retryAfterMs:
					provider.disposition === "retryable" && effect.attempt === 1 ? provider.retryAfterMs : 0,
				cleanupCompleted,
				tool: null,
			});
		} catch (error) {
			if (error instanceof RootEvalProviderDispatchAuthorityConsumed && !postDispatch) {
				postDispatch = true;
				input.onProviderCall?.(effect);
			}
			const leaseExpired =
				error instanceof RootEvalEffectLeaseExpired ||
				error instanceof RootEvalSettlementLeaseExpired ||
				(lease.signal.aborted &&
					(lease.signal.reason instanceof RootEvalEffectLeaseExpired ||
						lease.signal.reason instanceof RootEvalSettlementLeaseExpired));
			const digest = empiricalStrictJsonDigest({
				kind: "root-eval-d145-provider-failure",
				admissionId: effect.admissionId,
				message: error instanceof Error ? error.message : String(error),
			});
			const cleanupCompleted = await cleanup(root, settlementLease.signal);
			return providerOutcome(effect, {
				status: "failed",
				reason:
					error instanceof RootEvalProviderResponseError
						? error.reason
						: leaseExpired
							? "transport-failed"
							: "executor-failed",
				dispatchAttempted: postDispatch,
				costMicrousd: postDispatch
					? error instanceof RootEvalProviderResponseError && error.costMicrousd !== null
						? error.costMicrousd
						: confirmedCostMicrousd > 0
							? confirmedCostMicrousd
							: effect.reservationMicrousd
					: 0,
				costEvidence: postDispatch
					? error instanceof RootEvalProviderResponseError
						? error.costEvidence
						: confirmedCostMicrousd > 0
							? "provider-reported"
							: "reservation-upper-bound"
					: "provider-reported",
				pricingRoundingAllowanceMicrousd: postDispatch
					? error instanceof RootEvalProviderResponseError
						? error.pricingRoundingAllowanceMicrousd
						: confirmedCostMicrousd > 0
							? confirmedPricingRoundingAllowanceMicrousd
							: 0
					: 0,
				elapsedMs: elapsed(started),
				resultDigest: digest,
				retryAfterMs: 0,
				cleanupCompleted,
				tool: null,
			});
		} finally {
			lease.dispose();
			settlementLease.dispose();
		}
	};
	const executeTool = async (effect: EvalAdmittedToolEffect): Promise<EvalEffectOutcome> => {
		const task = taskForEffect(effect);
		const expectedDigest =
			effect.workItemRole === "source"
				? task.sourceVerifierEvidenceDigest
				: empiricalStrictJsonDigest({
						kind: "root-eval-actor-visible-acceptance",
						task: "d145-prior-work-item-transfer-acceptance",
					});
		const started = performance.now();
		const root = rootEvalWorkspaceForAdmission(materializationRoot, effect.providerAdmission);
		const lease = createRootEvalSettlementLease(
			"exact-tool",
			ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS,
			cancellation.signal,
		);
		try {
			let result: EvalEffectOutcome;
			try {
				lease.signal.throwIfAborted();
				const diff = await applyExactTool(
					root,
					{
						path: effect.path,
						oldText: effect.oldText,
						newText: effect.newText,
					},
					task,
				);
				const verification = await verify(
					root,
					diff,
					task,
					lease.signal,
					async (kind, processResult) =>
						persistRootEvalPrivateDiagnostic({
							enabled: privateDiagnostics,
							privateRoot: input.privateRoot,
							generationRef: input.claimCommit.claim.generationRef,
							effect: effect.providerAdmission,
							kind,
							material: Object.freeze({
								code: processResult.code,
								stdoutByteLength: processResult.stdout.byteLength,
								stderrByteLength: processResult.stderr.byteLength,
								stdout: new TextDecoder().decode(processResult.stdout.slice(0, 65_536)),
								stderr: new TextDecoder().decode(processResult.stderr.slice(0, 65_536)),
							}),
						}),
				);
				lease.signal.throwIfAborted();
				const actualDigest = empiricalSha256(await readFile(join(root, task.writablePath)));
				result = toolOutcome(effect, {
					status: "completed",
					elapsedMs: elapsed(started),
					resultDigest: empiricalStrictJsonDigest({
						providerResultDigest: effect.providerOutcome.resultDigest,
						actualDigest,
						diff,
						verification,
					}),
					expectedDigest,
					actualDigest,
					diff,
					cleanupCompleted: true,
					publicSemantic: verification.publicSemantic,
					hiddenVerifier: verification.hiddenVerifier,
				});
			} catch (error) {
				const digest = empiricalStrictJsonDigest({
					kind: "root-eval-d145-tool-failure",
					toolAdmissionId: effect.toolAdmissionId,
					message: error instanceof Error ? error.message : String(error),
				});
				result = toolOutcome(effect, {
					status: "failed",
					elapsedMs: elapsed(started),
					resultDigest: digest,
					expectedDigest,
					actualDigest: digest,
					diff: "no-change",
					cleanupCompleted: true,
					publicSemantic: false,
					hiddenVerifier: false,
				});
			}
			if (!(await cleanup(root, lease.signal)))
				return toolOutcome(effect, {
					status: "failed",
					elapsedMs: elapsed(started),
					resultDigest: empiricalStrictJsonDigest({
						kind: "root-eval-d145-cleanup-failure",
						toolAdmissionId: effect.toolAdmissionId,
					}),
					expectedDigest,
					actualDigest: result.evidence.actualDigest,
					diff: result.evidence.diff,
					cleanupCompleted: false,
					publicSemantic: false,
					hiddenVerifier: false,
				});
			return result;
		} finally {
			lease.dispose();
		}
	};
	const executeDelay = async (effect: EvalRetryDelayEffect): Promise<EvalRetryDelayOutcome> => {
		if (effect.delayMs > ROOT_EVAL_MAX_RETRY_DELAY_MS)
			throw new TypeError("root eval admitted retry delay exceeded its settlement bound");
		const lease = createRootEvalSettlementLease(
			"retry-delay",
			ROOT_EVAL_RETRY_SETTLEMENT_LEASE_MS,
			cancellation.signal,
		);
		try {
			const wait = input.wait ?? waitForRootEvalDelay;
			await awaitRootEvalAbortable(wait(effect.delayMs, lease.signal), lease.signal);
			lease.signal.throwIfAborted();
			return Object.freeze({
				kind: "eval-retry-delay-outcome" as const,
				admission: effect,
				executionId: effect.executionId,
				elapsedMs: effect.delayMs,
				status: "completed" as const,
				resultDigest: empiricalStrictJsonDigest({
					kind: "root-eval-d145-retry-delay-complete",
					executionId: effect.executionId,
					delayMs: effect.delayMs,
				}),
			});
		} finally {
			lease.dispose();
		}
	};
	const executeBillingObservation = async (
		effect: EvalBillingObservationEffect,
	): Promise<EvalBillingObservationOutcome> => {
		const lease = createRootEvalSettlementLease(
			"billing-observation",
			ROOT_EVAL_BILLING_SETTLEMENT_LEASE_MS,
			cancellation.signal,
		);
		try {
			const wait = input.wait ?? waitForRootEvalDelay;
			if (effect.delayMs > 0)
				await awaitRootEvalAbortable(wait(effect.delayMs, lease.signal), lease.signal);
			lease.signal.throwIfAborted();
			let currentKeyAfter: EvalCurrentKeySnapshot;
			if (input.observeCurrentKey !== undefined)
				currentKeyAfter = await awaitRootEvalAbortable(
					input.observeCurrentKey(effect, lease.signal),
					lease.signal,
				);
			else if (executionMode === "no-network-qualification") {
				const delta = effect.accountedUpperBoundMicrousd;
				const material = {
					kind: "eval-current-key-snapshot" as const,
					keyBindingDigest: effect.currentKeyBefore.keyBindingDigest,
					limitMicrousd: effect.currentKeyBefore.limitMicrousd,
					remainingMicrousd: effect.currentKeyBefore.remainingMicrousd - delta,
					usageMicrousd: effect.currentKeyBefore.usageMicrousd + delta,
					limitReset: "none" as const,
					isManagementKey: false as const,
				};
				currentKeyAfter = Object.freeze({
					...material,
					admissionDigest: empiricalStrictJsonDigest(material),
				});
			} else throw new TypeError("live billing observation executor was not configured");
			return Object.freeze({
				kind: "eval-billing-observation-outcome" as const,
				admission: effect,
				executionId: effect.executionId,
				observation: effect.observation,
				status: "completed" as const,
				currentKeyAfter,
				resultDigest: empiricalStrictJsonDigest({
					kind: "root-eval-billing-observation-complete",
					executionId: effect.executionId,
					admissionDigest: currentKeyAfter.admissionDigest,
				}),
			});
		} catch (error) {
			return Object.freeze({
				kind: "eval-billing-observation-outcome" as const,
				admission: effect,
				executionId: effect.executionId,
				observation: effect.observation,
				status: "failed" as const,
				currentKeyAfter: null,
				resultDigest: empiricalStrictJsonDigest({
					kind: "root-eval-billing-observation-failed",
					executionId: effect.executionId,
					message: error instanceof Error ? error.message : String(error),
				}),
			});
		} finally {
			lease.dispose();
		}
	};
	return Object.freeze({
		async execute(effect: EvalExecutableEffect): Promise<EvalExecutorOutcome> {
			if (disposed || active.has(effect.executionId))
				throw new TypeError("root eval D145 executor rejected replay or disposal");
			cancellation.signal.throwIfAborted();
			const execution = (async (): Promise<EvalExecutorOutcome> => {
				if (effect.kind === "eval-admitted-effect") return await executeProvider(effect);
				if (effect.kind === "eval-admitted-tool-effect") return await executeTool(effect);
				if (effect.kind === "eval-admitted-retry-delay") return await executeDelay(effect);
				return await executeBillingObservation(effect);
			})();
			active.set(effect.executionId, execution);
			try {
				return await execution;
			} finally {
				active.delete(effect.executionId);
			}
		},
		async dispose(reason?: unknown): Promise<void> {
			disposed = true;
			if (!cancellation.signal.aborted)
				cancellation.abort(reason ?? new Error("root eval executor disposed"));
			await Promise.allSettled([...active.values()]);
			const finalizer = createRootEvalSettlementLease(
				"cleanup-finalizer",
				ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS,
			);
			try {
				await cleanup(materializationRoot, finalizer.signal);
			} finally {
				finalizer.dispose();
			}
		},
	});
}

export function createRootEvalLiveExecutor(input: RootEvalLiveExecutorInput): RootEvalLiveExecutor {
	return createRootEvalLiveExecutorInternal(input, "live", ROOT_EVAL_LIVE_PROVIDER_FETCH);
}

export interface RootEvalLiveTransportQualificationExecutor extends RootEvalLiveExecutor {
	providerRequestSummaries(): readonly Readonly<Record<string, unknown>>[];
}

export function createRootEvalLiveTransportQualificationExecutor(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly privateRoot: string;
	readonly claimCommit: RootEvalLiveClaimCommit;
	readonly bearerToken: string;
	readonly pricing: RootEvalLivePricing;
	readonly taskKind?: RootEvalTaskKind;
	readonly taskManifestSlot?: RootEvalTaskManifestSlot;
	readonly diagnosticMode?: "none" | "development-private";
	readonly providerResponses: readonly Readonly<{
		readonly status: number;
		readonly bytes: Uint8Array;
		readonly retryAfter?: string | null;
		readonly stallUntilAbort?: boolean;
		readonly stallBodyUntilAbort?: boolean;
	}>[];
	readonly providerResponseForRequest?: (
		request: Readonly<Record<string, unknown>>,
		ordinal: number,
	) => Readonly<{
		readonly status: number;
		readonly bytes: Uint8Array;
		readonly retryAfter?: string | null;
		readonly stallUntilAbort?: boolean;
		readonly stallBodyUntilAbort?: boolean;
	}>;
	readonly beforeProviderDispatch?: (
		effect: EvalAdmittedEffect,
		signal: AbortSignal,
	) => Promise<void>;
	readonly onProviderCall?: (effect: EvalAdmittedEffect) => void;
	readonly removeDispatchStage?: (stage: string) => Promise<void>;
}): RootEvalLiveTransportQualificationExecutor {
	const responses = input.providerResponses.map((response) =>
		Object.freeze({
			status: response.status,
			bytes: response.bytes.slice(),
			retryAfter: response.retryAfter ?? null,
			stallUntilAbort: response.stallUntilAbort === true,
			stallBodyUntilAbort: response.stallBodyUntilAbort === true,
		}),
	);
	const summaries: Readonly<Record<string, unknown>>[] = [];
	let responseIndex = 0;
	const frozenResponseFetch = async (
		url: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		if (String(url) !== ROOT_EVAL_LIVE_ENDPOINT || typeof init?.body !== "string")
			throw new TypeError("root eval frozen transport request drifted");
		const request = object(
			parseRootEvalUniqueJson(
				new TextEncoder().encode(init.body),
				"root eval frozen transport request",
			),
			"root eval frozen transport request",
		);
		const { messages: _messages, ...materialFreeSummary } = request;
		summaries.push(strictSnapshot(materialFreeSummary));
		const selected = input.providerResponseForRequest?.(request, responseIndex);
		const frozen =
			selected === undefined
				? responses[responseIndex]
				: Object.freeze({
						status: selected.status,
						bytes: selected.bytes.slice(),
						retryAfter: selected.retryAfter ?? null,
						stallUntilAbort: selected.stallUntilAbort === true,
						stallBodyUntilAbort: selected.stallBodyUntilAbort === true,
					});
		responseIndex += 1;
		if (frozen === undefined)
			throw new TypeError("root eval frozen transport response was unavailable");
		if (frozen.stallUntilAbort)
			return await new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				if (signal == null)
					return reject(new TypeError("root eval frozen stalled transport omitted signal"));
				if (signal.aborted) return reject(signal.reason);
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
		if (frozen.stallBodyUntilAbort) {
			const signal = init?.signal;
			if (signal == null) throw new TypeError("root eval frozen stalled body omitted signal");
			const response = new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(frozen.bytes.slice(0, 1));
						const abort = () => controller.error(new DOMException("aborted", "AbortError"));
						if (signal.aborted) abort();
						else signal.addEventListener("abort", abort, { once: true });
					},
				}),
				{ status: frozen.status },
			);
			Object.defineProperty(response, "url", { value: ROOT_EVAL_LIVE_ENDPOINT });
			return response;
		}
		const response = new Response(frozen.bytes.slice(), {
			status: frozen.status,
			headers: frozen.retryAfter === null ? undefined : { "retry-after": frozen.retryAfter },
		});
		Object.defineProperty(response, "url", { value: ROOT_EVAL_LIVE_ENDPOINT });
		return response;
	};
	const executor = createRootEvalLiveExecutorInternal(
		{
			repositoryRoot: input.repositoryRoot,
			materializationRoot: input.materializationRoot,
			privateRoot: input.privateRoot,
			claimCommit: input.claimCommit,
			bearerToken: input.bearerToken,
			pricing: input.pricing,
			taskKind: input.taskKind,
			taskManifestSlot: input.taskManifestSlot,
			diagnosticMode: input.diagnosticMode,
			beforeProviderDispatch: input.beforeProviderDispatch,
			onProviderCall: input.onProviderCall,
			removeDispatchStage: input.removeDispatchStage,
		},
		"no-network-qualification",
		frozenResponseFetch as typeof fetch,
	);
	return Object.freeze({
		execute: executor.execute,
		dispose: executor.dispose,
		providerRequestSummaries: () => strictSnapshot(summaries),
	});
}

export function createRootEvalNoNetworkQualificationExecutor(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly pricing: RootEvalLivePricing;
	readonly taskKind?: RootEvalTaskKind;
	readonly taskManifestSlot?: RootEvalTaskManifestSlot;
	readonly providerResponses: readonly Readonly<{
		readonly status: number;
		readonly bytes: Uint8Array;
		readonly retryAfter?: string | null;
	}>[];
	readonly providerResponseForEffect?: (
		effect: EvalAdmittedEffect,
		ordinal: number,
	) => Readonly<{
		readonly status: number;
		readonly bytes: Uint8Array;
		readonly retryAfter?: string | null;
	}>;
}): RootEvalNoNetworkQualificationExecutor {
	const repositoryRoot = resolve(input.repositoryRoot);
	const materializationRoot = resolve(input.materializationRoot);
	const taskKind = input.taskKind ?? "development-transfer";
	const taskManifest =
		input.taskManifestSlot === undefined
			? undefined
			: readRootEvalTaskManifest(input.taskManifestSlot);
	const tasks = taskManifest?.tasks ?? ROOT_EVAL_DEVELOPMENT_TASKS;
	const taskManifestDigest = taskManifest?.manifestDigest ?? ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST;
	const taskForEffect = (effect: Pick<EvalAdmittedEffect, "replicate" | "workItemRole">) => {
		const task = tasks[effect.replicate - 1];
		if (task === undefined || task.kind !== taskKind)
			throw new TypeError("root eval no-network task snapshot was unavailable");
		return executionTask(task, effect.workItemRole);
	};
	const providerResponses = input.providerResponses.map((response) =>
		Object.freeze({
			status: response.status,
			bytes: response.bytes.slice(),
			retryAfter: response.retryAfter ?? null,
		}),
	);
	let responseIndex = 0;
	const providerRequestSummaries: Readonly<Record<string, unknown>>[] = [];
	let disposed = false;
	const cancellation = new AbortController();
	const active = new Map<string, Promise<EvalExecutorOutcome>>();
	const cleanup = async (root: string, signal: AbortSignal): Promise<boolean> => {
		try {
			await awaitRootEvalAbortable(
				runProcess({
					command: process.execPath,
					args: ["--input-type=module", "--eval", ROOT_EVAL_REMOVE_WORKSPACE_SCRIPT, root],
					cwd: repositoryRoot,
					timeoutMs: ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS,
					signal,
				}),
				signal,
			);
			signal.throwIfAborted();
			return true;
		} catch {
			return false;
		}
	};
	const executeProvider = async (effect: EvalAdmittedEffect): Promise<EvalProviderOutcome> => {
		const task = taskForEffect(effect);
		const started = performance.now();
		const settlementLease = createRootEvalSettlementLease(
			"provider",
			ROOT_EVAL_PROVIDER_SETTLEMENT_LEASE_MS,
			cancellation.signal,
		);
		const lease = createRootEvalEffectLease(effect.timeoutMs, settlementLease.signal);
		let root: string | undefined;
		let postDispatch = false;
		let confirmedCostMicrousd = 0;
		let confirmedPricingRoundingAllowanceMicrousd = 0;
		try {
			root = await materialize({
				repositoryRoot,
				materializationRoot,
				effect,
				task,
				signal: lease.signal,
			});
			const body = await liveWire(effect, root, task, tasks, taskManifestDigest, lease.signal);
			lease.signal.throwIfAborted();
			const request = object(JSON.parse(body), "root eval no-network provider request");
			providerRequestSummaries.push(
				strictSnapshot({
					model: request.model,
					responseFormat: request.response_format,
					provider: request.provider,
					forbiddenFieldPresence: {
						parallelToolCalls: Object.hasOwn(request, "parallel_tool_calls"),
						tools: Object.hasOwn(request, "tools"),
						toolChoice: Object.hasOwn(request, "tool_choice"),
						plugins: Object.hasOwn(request, "plugins"),
					},
				}),
			);
			const selected = input.providerResponseForEffect?.(effect, responseIndex);
			const response =
				selected === undefined
					? providerResponses[responseIndex]
					: Object.freeze({
							status: selected.status,
							bytes: selected.bytes.slice(),
							retryAfter: selected.retryAfter ?? null,
						});
			if (response === undefined)
				throw new TypeError("root eval no-network qualification response sequence exhausted");
			responseIndex += 1;
			postDispatch = true;
			const provider = parseRootEvalLiveProviderResponse({
				status: response.status,
				bytes: response.bytes,
				retryAfter: response.retryAfter,
				pricing: input.pricing,
				reservationMicrousd: effect.reservationMicrousd,
				writablePath: task.writablePath,
			});
			confirmedCostMicrousd = provider.costMicrousd;
			confirmedPricingRoundingAllowanceMicrousd = provider.pricingRoundingAllowanceMicrousd;
			if (provider.disposition === "tool")
				return providerOutcome(effect, {
					status: "tool-proposed",
					reason: provider.reason,
					dispatchAttempted: true,
					costMicrousd: provider.costMicrousd,
					costEvidence: provider.costEvidence,
					pricingRoundingAllowanceMicrousd: provider.pricingRoundingAllowanceMicrousd,
					elapsedMs: elapsed(started),
					resultDigest: provider.resultDigest,
					retryAfterMs: 0,
					cleanupCompleted: false,
					tool: provider.tool,
				});
			const cleanupCompleted = await cleanup(root, settlementLease.signal);
			return providerOutcome(effect, {
				status:
					provider.disposition === "retryable" && effect.attempt === 1 ? "retryable" : "failed",
				reason:
					provider.disposition === "retryable" && effect.attempt !== 1
						? "http-failed"
						: provider.reason,
				dispatchAttempted: true,
				costMicrousd: provider.costMicrousd,
				costEvidence: provider.costEvidence,
				pricingRoundingAllowanceMicrousd: provider.pricingRoundingAllowanceMicrousd,
				elapsedMs: elapsed(started),
				resultDigest: provider.resultDigest,
				retryAfterMs:
					provider.disposition === "retryable" && effect.attempt === 1 ? provider.retryAfterMs : 0,
				cleanupCompleted,
				tool: null,
			});
		} catch (error) {
			const digest = empiricalStrictJsonDigest({
				kind: "root-eval-live-provider-failure",
				admissionId: effect.admissionId,
				message: error instanceof Error ? error.message : String(error),
			});
			const cleanupCompleted =
				root === undefined ? true : await cleanup(root, settlementLease.signal);
			return providerOutcome(effect, {
				status: "failed",
				reason: error instanceof RootEvalProviderResponseError ? error.reason : "executor-failed",
				dispatchAttempted: postDispatch,
				costMicrousd: postDispatch
					? error instanceof RootEvalProviderResponseError && error.costMicrousd !== null
						? error.costMicrousd
						: confirmedCostMicrousd > 0
							? confirmedCostMicrousd
							: effect.reservationMicrousd
					: 0,
				costEvidence: postDispatch
					? error instanceof RootEvalProviderResponseError
						? error.costEvidence
						: confirmedCostMicrousd > 0
							? "provider-reported"
							: "reservation-upper-bound"
					: "provider-reported",
				pricingRoundingAllowanceMicrousd: postDispatch
					? error instanceof RootEvalProviderResponseError
						? error.pricingRoundingAllowanceMicrousd
						: confirmedCostMicrousd > 0
							? confirmedPricingRoundingAllowanceMicrousd
							: 0
					: 0,
				elapsedMs: elapsed(started),
				resultDigest: digest,
				retryAfterMs: 0,
				cleanupCompleted,
				tool: null,
			});
		} finally {
			lease.dispose();
			settlementLease.dispose();
		}
	};
	const executeTool = async (effect: EvalAdmittedToolEffect): Promise<EvalEffectOutcome> => {
		const task = taskForEffect(effect);
		const expectedDigest =
			effect.workItemRole === "source"
				? task.sourceVerifierEvidenceDigest
				: empiricalStrictJsonDigest({
						kind: "root-eval-actor-visible-acceptance",
						task: "d145-prior-work-item-transfer-acceptance",
					});
		const started = performance.now();
		const root = rootEvalWorkspaceForAdmission(materializationRoot, effect.providerAdmission);
		const lease = createRootEvalSettlementLease(
			"exact-tool",
			ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS,
			cancellation.signal,
		);
		let result: EvalEffectOutcome;
		try {
			lease.signal.throwIfAborted();
			const diff = await applyExactTool(
				root,
				{
					path: effect.path,
					oldText: effect.oldText,
					newText: effect.newText,
				},
				task,
			);
			const verification = await verify(root, diff, task, lease.signal);
			lease.signal.throwIfAborted();
			const actualDigest = empiricalSha256(await readFile(join(root, task.writablePath)));
			result = toolOutcome(effect, {
				status: "completed",
				elapsedMs: elapsed(started),
				resultDigest: empiricalStrictJsonDigest({
					providerResultDigest: effect.providerOutcome.resultDigest,
					actualDigest,
					diff,
					verification,
				}),
				expectedDigest,
				actualDigest,
				diff,
				cleanupCompleted: true,
				publicSemantic: verification.publicSemantic,
				hiddenVerifier: verification.hiddenVerifier,
			});
		} catch (error) {
			const digest = empiricalStrictJsonDigest({
				kind: "root-eval-live-tool-failure",
				toolAdmissionId: effect.toolAdmissionId,
				message: error instanceof Error ? error.message : String(error),
			});
			result = toolOutcome(effect, {
				status: "failed",
				elapsedMs: elapsed(started),
				resultDigest: digest,
				expectedDigest,
				actualDigest: digest,
				diff: "no-change",
				cleanupCompleted: true,
				publicSemantic: false,
				hiddenVerifier: false,
			});
		}
		try {
			if (!(await cleanup(root, lease.signal)))
				return toolOutcome(effect, {
					status: "failed",
					elapsedMs: elapsed(started),
					resultDigest: empiricalStrictJsonDigest({
						kind: "root-eval-live-cleanup-failure",
						toolAdmissionId: effect.toolAdmissionId,
					}),
					expectedDigest,
					actualDigest: result.evidence.actualDigest,
					diff: result.evidence.diff,
					cleanupCompleted: false,
					publicSemantic: false,
					hiddenVerifier: false,
				});
			return result;
		} finally {
			lease.dispose();
		}
	};
	const executeDelay = async (effect: EvalRetryDelayEffect): Promise<EvalRetryDelayOutcome> => {
		const lease = createRootEvalSettlementLease(
			"retry-delay",
			ROOT_EVAL_RETRY_SETTLEMENT_LEASE_MS,
			cancellation.signal,
		);
		try {
			lease.signal.throwIfAborted();
			return Object.freeze({
				kind: "eval-retry-delay-outcome" as const,
				admission: effect,
				executionId: effect.executionId,
				elapsedMs: effect.delayMs,
				status: "completed" as const,
				resultDigest: empiricalStrictJsonDigest({
					kind: "root-eval-retry-delay-complete",
					executionId: effect.executionId,
					delayMs: effect.delayMs,
				}),
			});
		} finally {
			lease.dispose();
		}
	};
	const executeBillingObservation = async (
		effect: EvalBillingObservationEffect,
	): Promise<EvalBillingObservationOutcome> => {
		const lease = createRootEvalSettlementLease(
			"billing-observation",
			ROOT_EVAL_BILLING_SETTLEMENT_LEASE_MS,
			cancellation.signal,
		);
		lease.signal.throwIfAborted();
		const delta = effect.accountedUpperBoundMicrousd;
		const material = {
			kind: "eval-current-key-snapshot" as const,
			keyBindingDigest: effect.currentKeyBefore.keyBindingDigest,
			limitMicrousd: effect.currentKeyBefore.limitMicrousd,
			remainingMicrousd: effect.currentKeyBefore.remainingMicrousd - delta,
			usageMicrousd: effect.currentKeyBefore.usageMicrousd + delta,
			limitReset: "none" as const,
			isManagementKey: false as const,
		};
		const currentKeyAfter = Object.freeze({
			...material,
			admissionDigest: empiricalStrictJsonDigest(material),
		});
		try {
			return Object.freeze({
				kind: "eval-billing-observation-outcome" as const,
				admission: effect,
				executionId: effect.executionId,
				observation: effect.observation,
				status: "completed" as const,
				currentKeyAfter,
				resultDigest: empiricalStrictJsonDigest({
					kind: "root-eval-no-network-billing-observation",
					executionId: effect.executionId,
					admissionDigest: currentKeyAfter.admissionDigest,
				}),
			});
		} finally {
			lease.dispose();
		}
	};
	return Object.freeze({
		providerRequestSummaries(): readonly Readonly<Record<string, unknown>>[] {
			return Object.freeze([...providerRequestSummaries]);
		},
		async execute(effect: EvalExecutableEffect): Promise<EvalExecutorOutcome> {
			if (disposed || active.has(effect.executionId))
				throw new TypeError("root eval live executor rejected replay or disposal");
			cancellation.signal.throwIfAborted();
			const execution = (async (): Promise<EvalExecutorOutcome> => {
				if (effect.kind === "eval-admitted-effect") return await executeProvider(effect);
				if (effect.kind === "eval-admitted-tool-effect") return await executeTool(effect);
				if (effect.kind === "eval-admitted-retry-delay") return await executeDelay(effect);
				return await executeBillingObservation(effect);
			})();
			active.set(effect.executionId, execution);
			try {
				return await execution;
			} finally {
				active.delete(effect.executionId);
			}
		},
		async dispose(reason?: unknown): Promise<void> {
			disposed = true;
			if (!cancellation.signal.aborted)
				cancellation.abort(reason ?? new Error("root eval executor disposed"));
			await Promise.allSettled([...active.values()]);
			const finalizer = createRootEvalSettlementLease(
				"cleanup-finalizer",
				ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS,
			);
			try {
				await cleanup(materializationRoot, finalizer.signal);
			} finally {
				finalizer.dispose();
			}
		},
	});
}

export const ROOT_EVAL_LIVE_TASK_BINDING_DIGEST = empiricalStrictJsonDigest(
	strictSnapshot({
		decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
		taskSetBindingDigest: ROOT_EVAL_D145_TASK_SET_BINDING_DIGEST,
		heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
		developmentTasks: ROOT_EVAL_DEVELOPMENT_TASKS,
		noAdmittedMemoryContext: NO_ADMITTED_MEMORY_CONTEXT,
	}),
);

export { ROOT_EVAL_HELD_OUT_SEAL_DIGEST } from "./root-eval-task.js";
