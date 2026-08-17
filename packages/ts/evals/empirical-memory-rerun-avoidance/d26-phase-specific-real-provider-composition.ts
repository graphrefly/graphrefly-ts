import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, record, strictSnapshot } from "./canonical.js";
import type {
	CurrentGraphProviderEffectResultInputV1,
	CurrentGraphRuntimeToolArgumentsV1,
} from "./d6-current-provider-authority.js";
import {
	type CurrentGraphOpenRouterAdapterOptionsV1,
	createCurrentGraphOpenRouterExecutor,
} from "./d8-current-openrouter-adapter.js";
import type {
	D25AdmittedEffectV1,
	D25PhaseDirectiveV1,
} from "./d25-phase-specific-tool-admission.js";
import {
	type D25PhaseAuthorityV1,
	takeD25AdmittedEffect,
} from "./d25-phase-specific-tool-admission.js";

export const D26_DECISION_REF = "graphrefly-ts:D26" as const;
export const D26_ADAPTER_REVISION =
	"graphrefly-ts.d26.phase-specific-real-provider-adapter.v1" as const;
export const D26_WIRE_SCHEMA = "graphrefly-ts.d26.phase-specific-wire.v1" as const;
export const D26_MAX_PROVIDER_BYTES = 2 * 1_048_576;

const TOOL_NAME = Object.freeze({
	"read-file": "read_file",
	"replace-exact": "replace_exact",
} as const);
const PUBLIC_SEMANTIC_TEST_NAME =
	"admits only a fresh D419 managed remote run, then atomically claims with a fresh fenced session" as const;
const PROCESS_OUTPUT_BOUND = 2 * 1_048_576;

interface ActiveProviderExecution {
	readonly admitted: D25AdmittedEffectV1;
	readonly directive: D25PhaseDirectiveV1;
	mutationProjectionApplied: boolean;
	loweredBodyDigest: string | null;
}

export interface D26PhaseSpecificExecutorV1 {
	readonly executeNext: () => Promise<Readonly<{
		admitted: D25AdmittedEffectV1;
		result: CurrentGraphProviderEffectResultInputV1;
	}> | null>;
	readonly dispose: () => Promise<void>;
}

export interface D26PhaseSpecificAdapterOptionsV1
	extends Omit<CurrentGraphOpenRouterAdapterOptionsV1, "fetchImpl"> {
	readonly authority: D25PhaseAuthorityV1;
	readonly fetchImpl: typeof fetch;
}

function bodyBytes(value: unknown): Uint8Array {
	if (typeof value === "string") return Buffer.from(value, "utf8");
	if (value instanceof Uint8Array) return new Uint8Array(value);
	throw new TypeError("D26 final provider body is not bounded bytes");
}

function exactFunctionName(value: unknown, path: string): string {
	const candidate = record(value, path);
	const fn = record(candidate.function, `${path}.function`);
	if (typeof fn.name !== "string" || fn.name.length === 0)
		throw new TypeError(`${path}.function.name is invalid`);
	return fn.name;
}

function lowerFinalBody(
	bytes: Uint8Array,
	directive: D25PhaseDirectiveV1,
): Readonly<{ bytes: Uint8Array; digest: string }> {
	if (bytes.byteLength > D26_MAX_PROVIDER_BYTES)
		throw new TypeError("D26 final provider body exceeded its bound");
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("D26 final provider body is not canonical JSON", { cause: error });
	}
	const body = record(decoded, "D26 final provider body");
	if (!Array.isArray(body.tools) || body.tools.length < 1 || body.tools.length > 16)
		throw new TypeError("D26 final provider tools are invalid");
	const expectedName = TOOL_NAME[directive.namedToolRef];
	const matching = body.tools.filter(
		(tool, index) => exactFunctionName(tool, `D26 final provider tools[${index}]`) === expectedName,
	);
	if (matching.length !== 1) throw new TypeError("D26 named provider tool definition is not exact");
	const lowered = strictSnapshot({
		...body,
		tools: matching,
		tool_choice: { type: "function" as const, function: { name: expectedName } },
	});
	const loweredBytes = Buffer.from(JSON.stringify(lowered), "utf8");
	if (loweredBytes.byteLength > D26_MAX_PROVIDER_BYTES)
		throw new TypeError("D26 lowered provider body exceeded its bound");
	return Object.freeze({ bytes: loweredBytes, digest: empiricalSha256(loweredBytes) });
}

function toolCalls(value: unknown): readonly unknown[] | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const root = value as Record<string, unknown>;
	if (!Array.isArray(root.choices) || root.choices.length !== 1) return null;
	const choice = root.choices[0];
	if (choice === null || typeof choice !== "object" || Array.isArray(choice)) return null;
	const message = (choice as Record<string, unknown>).message;
	if (message === null || typeof message !== "object" || Array.isArray(message)) return null;
	const calls = (message as Record<string, unknown>).tool_calls;
	return Array.isArray(calls) ? calls : null;
}

function mutationCanProject(value: unknown): boolean {
	const calls = toolCalls(value);
	if (calls?.length !== 1) return false;
	try {
		return exactFunctionName(calls[0], "D26 mutation tool call") === "replace_exact";
	} catch {
		return false;
	}
}

async function projectMutationResponse(
	response: Response,
	active: ActiveProviderExecution,
): Promise<Response> {
	if (!response.ok || active.directive.namedToolRef !== "replace-exact") return response;
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > D26_MAX_PROVIDER_BYTES))
		throw new TypeError("D26 provider response exceeded its declared bound");
	const reader = response.body?.getReader();
	if (reader === undefined) throw new TypeError("D26 provider response body is missing");
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			total += next.value.byteLength;
			if (total > D26_MAX_PROVIDER_BYTES) {
				await reader.cancel();
				throw new TypeError("D26 provider response exceeded its byte bound");
			}
			chunks.push(next.value);
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
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
	} catch {
		return new Response(bytes, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}
	if (!mutationCanProject(value))
		return new Response(bytes, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	active.mutationProjectionApplied = true;
	return new Response(bytes, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

function oneMutationProposal(
	result: CurrentGraphProviderEffectResultInputV1,
	active: ActiveProviderExecution,
): CurrentGraphProviderEffectResultInputV1 {
	if (!active.mutationProjectionApplied) return result;
	if (
		result.effectKind !== "provider-request" ||
		result.status !== "completed" ||
		result.toolCalls.length !== 1 ||
		result.toolCalls[0]?.toolRef !== "replace-exact"
	)
		throw new TypeError("D26 Graph-authored deterministic tool projection drifted");
	return Object.freeze({
		...result,
		toolCalls: Object.freeze([
			strictSnapshot(result.toolCalls[0]) as CurrentGraphRuntimeToolArgumentsV1,
		]),
		evidenceDigest: empiricalStrictJsonDigest({
			schemaVersion: D26_WIRE_SCHEMA,
			requestDigest: active.admitted.effect.request.requestDigest,
			directiveDigest: active.directive.directiveDigest,
			loweredBodyDigest: active.loweredBodyDigest,
			providerEvidenceDigest: result.evidenceDigest,
			providerProposal: result.toolCalls[0],
			graphAuthoredSuccessors: active.directive.deterministicSuccessors,
		}),
	});
}

async function runPublicSemanticScenario(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly admitted: D25AdmittedEffectV1;
}): Promise<CurrentGraphProviderEffectResultInputV1> {
	const request = input.admitted.effect.request;
	if (request.effectKind !== "public-semantic-validation" || request.workspaceStateDigest === null)
		throw new TypeError("D26 public semantic request is invalid");
	const started = performance.now();
	const cwd = join(input.materializationRoot, `${request.arm}-${request.runSequence}`);
	const outcome = await new Promise<Readonly<{ code: number; output: Uint8Array }>>(
		(resolvePromise, rejectPromise) => {
			const child = spawn(
				join(input.repositoryRoot, "node_modules/.bin/vitest"),
				[
					"run",
					"packages/ts/src/__tests__/managed-cloud-postgresql.test.ts",
					"-t",
					PUBLIC_SEMANTIC_TEST_NAME,
				],
				{ cwd, stdio: ["ignore", "pipe", "pipe"] },
			);
			const chunks: Buffer[] = [];
			let outputBytes = 0;
			let settled = false;
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				finish(new TypeError("D26 public semantic validation timed out"));
			}, request.reservation.maxElapsedMs);
			timer.unref();
			const finish = (error?: Error, code = 1) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (error === undefined)
					resolvePromise(Object.freeze({ code, output: new Uint8Array(Buffer.concat(chunks)) }));
				else rejectPromise(error);
			};
			const collect = (chunk: Buffer) => {
				outputBytes += chunk.byteLength;
				if (outputBytes > PROCESS_OUTPUT_BOUND) {
					child.kill("SIGKILL");
					finish(new TypeError("D26 public semantic output exceeded its bound"));
					return;
				}
				chunks.push(chunk);
			};
			child.stdout.on("data", collect);
			child.stderr.on("data", collect);
			child.once("error", (error) => finish(error));
			child.once("close", (code) => finish(undefined, code ?? 1));
		},
	);
	const passed = outcome.code === 0;
	return Object.freeze({
		effectKind: "public-semantic-validation" as const,
		status: passed ? ("passed" as const) : ("failed" as const),
		criterionFailures: passed ? [] : (["canonical-proposal-not-admitted"] as const),
		workspaceStateDigest: request.workspaceStateDigest,
		evidenceDigest: empiricalStrictJsonDigest({
			requestDigest: request.requestDigest,
			scenario: PUBLIC_SEMANTIC_TEST_NAME,
			outputDigest: empiricalSha256(outcome.output),
			passed,
		}),
		actualCostMicrousd: 0,
		actualElapsedMs: Math.min(
			request.reservation.maxElapsedMs,
			Math.max(1, Math.ceil(performance.now() - started)),
		),
	});
}

export function createD26PhaseSpecificRealProviderExecutor(
	options: D26PhaseSpecificAdapterOptionsV1,
): D26PhaseSpecificExecutorV1 {
	const { authority, fetchImpl, ...baseOptions } = options;
	const repositoryRoot = resolve(options.repositoryRoot);
	const materializationRoot = resolve(options.materializationRoot);
	const consumed = new WeakSet<object>();
	const retryBodies = new Map<string, Uint8Array>();
	let active: ActiveProviderExecution | null = null;
	let executing = false;
	const base = createCurrentGraphOpenRouterExecutor({
		...baseOptions,
		repositoryRoot,
		materializationRoot,
		fetchImpl: async (url, init) => {
			const current = active;
			if (current === null)
				throw new TypeError("D26 provider transport has no active Graph admission");
			const request = current.admitted.effect.request;
			if (request.effectKind !== "provider-request" || request.logicalRequestDigest === null)
				throw new TypeError("D26 provider transport request is invalid");
			const lowered = lowerFinalBody(bodyBytes(init?.body), current.directive);
			const prior = retryBodies.get(request.logicalRequestDigest);
			if (prior !== undefined && !Buffer.from(prior).equals(Buffer.from(lowered.bytes)))
				throw new TypeError("D26 final retry wire bytes drifted");
			retryBodies.set(request.logicalRequestDigest, lowered.bytes);
			current.loweredBodyDigest = lowered.digest;
			const deadline = new AbortController();
			const upstream = init?.signal;
			const forwardAbort = () => deadline.abort(upstream?.reason);
			if (upstream?.aborted === true) forwardAbort();
			else upstream?.addEventListener("abort", forwardAbort, { once: true });
			const timer = setTimeout(
				() =>
					deadline.abort(
						new DOMException("Graph provider effect deadline elapsed", "TimeoutError"),
					),
				request.reservation.maxElapsedMs,
			);
			timer.unref();
			try {
				const response = await fetchImpl(url, {
					...init,
					body: lowered.bytes,
					signal: deadline.signal,
				});
				return await projectMutationResponse(response, current);
			} finally {
				clearTimeout(timer);
				upstream?.removeEventListener("abort", forwardAbort);
			}
		},
	});
	return Object.freeze({
		async executeNext() {
			const admitted = takeD25AdmittedEffect(authority);
			if (admitted === null) return null;
			if (consumed.has(admitted as object)) throw new TypeError("D26 admitted effect was replayed");
			consumed.add(admitted as object);
			if (executing) throw new TypeError("D26 observed parallel admitted effects");
			executing = true;
			const directive = admitted.phaseDirective;
			const provider = admitted.effect.request.effectKind === "provider-request";
			try {
				if (provider !== (directive !== null))
					throw new TypeError("D26 phase directive presence drifted");
				if (admitted.effect.request.effectKind === "public-semantic-validation")
					return Object.freeze({
						admitted,
						result: await runPublicSemanticScenario({
							repositoryRoot,
							materializationRoot,
							admitted,
						}),
					});
				active =
					directive === null
						? null
						: { admitted, directive, mutationProjectionApplied: false, loweredBodyDigest: null };
				if (
					admitted.effect.request.effectKind === "tool-action" &&
					admitted.effect.request.toolRef === "workspace-diff"
				)
					base.admitGraphAuthoredToolCalls(admitted.effect, [
						"workspace-diff",
						"focused-validation",
					]);
				const result = await base.execute(admitted.effect);
				return Object.freeze({
					admitted,
					result: active === null ? result : oneMutationProposal(result, active),
				});
			} finally {
				active = null;
				executing = false;
			}
		},
		async dispose() {
			if (executing) throw new TypeError("D26 cannot dispose an active effect");
			active = null;
			retryBodies.clear();
			await base.dispose();
		},
	});
}
