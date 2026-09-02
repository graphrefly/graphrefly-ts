import {
	type HttpToolArguments,
	type HttpToolProviderDriverResponse,
	httpToolProviderRuntime,
} from "../../src/executors/tool-provider-adapters.js";
import type { Graph } from "../../src/graph/graph.js";
import type {
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
} from "../../src/orchestration/agent-runtime-types-tool.js";

/** The transport owns only active I/O. Admission, retries and accounting stay upstream. */
export function createRootEvalHttpTransportLeaf<T>(
	graph: Graph,
	options: {
		readonly endpoint: string;
		readonly maxExecutions: number;
		readonly timeoutMs: number;
		readonly maxResponseBytes: number;
	},
) {
	if (!Number.isSafeInteger(options.maxExecutions) || options.maxExecutions < 1)
		throw new TypeError("HTTP transport execution bound invalid");
	const name = "eval/executor/provider-http";
	const providerId = "root-eval-provider-http";
	const inputs = graph.node<ToolProviderAdapterInput<HttpToolArguments>>([], null, {
		name: `${name}/input`,
		factory: "rootEvalHttpTransportInput",
	});
	const requests = graph.node<ToolProviderAdapterRunRequested>([], null, {
		name: `${name}/requested`,
		factory: "rootEvalHttpTransportRequest",
	});
	type Operation = {
		invoke(signal: AbortSignal): Promise<{ material: T; summary: HttpToolProviderDriverResponse }>;
		signal: AbortSignal;
		resolve(value: T): void;
		reject(error: unknown): void;
		material?: { value: T };
		error?: { value: unknown };
	};
	const active = new Map<string, Operation>();
	const used = new Set<string>();
	const pending = new Set<Promise<T>>();
	let closed = false;
	const runtime = httpToolProviderRuntime(graph, {
		name,
		providerId,
		inputs,
		runRequests: [requests],
		autoRunReadyInputs: false,
		allowedOrigins: [new URL(options.endpoint).origin],
		allowedMethods: ["POST"],
		allowedRequestHeaders: ["x-eval-transport-id"],
		exposedResponseHeaders: [],
		timeoutMs: options.timeoutMs,
		maxResponseBytes: options.maxResponseBytes,
		maxInlineBodyChars: 0,
		approvalMode: "auto",
		driver: {
			async fetch(request) {
				const operation = active.get(request.headers["x-eval-transport-id"] ?? "");
				if (
					operation === undefined ||
					request.url !== options.endpoint ||
					request.method !== "POST"
				)
					throw new TypeError("HTTP transport lost exact private binding");
				const signal =
					request.signal === undefined
						? operation.signal
						: AbortSignal.any([operation.signal, request.signal]);
				try {
					signal.throwIfAborted();
					const result = await operation.invoke(signal);
					// An error status already received remains factual (including a 429
					// with an aborted optional body). A late 2xx cannot admit new work.
					if (result.summary.status >= 200 && result.summary.status < 300) signal.throwIfAborted();
					operation.material = { value: result.material };
					return result.summary;
				} catch (error) {
					operation.error = { value: error };
					// The original transport error stays private; runtime issue/audit DATA
					// must never copy a URL, credential, body or arbitrary exception text.
					throw new Error("root eval HTTP transport failed");
				}
			},
		},
	});
	const stopOutcome = runtime.outcomes.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const outcome = message[1] as { requestId: string; kind: string };
		const operation = active.get(outcome.requestId);
		if (operation === undefined) return;
		if (operation.error !== undefined) operation.reject(operation.error.value);
		else if (operation.material !== undefined && outcome.kind === "result")
			operation.resolve(operation.material.value);
		else operation.reject(new TypeError("HTTP runtime rejected the admitted transport"));
	});
	const stopStatus = runtime.runStatus.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const status = message[1] as { requestId?: string; status: string };
		if (
			["missing-request", "missing-input", "stale-request", "mismatched-request"].includes(
				status.status,
			)
		)
			active
				.get(status.requestId ?? "")
				?.reject(new TypeError("HTTP runtime rejected transport correlation"));
	});
	return Object.freeze({
		run(executionId: string, invoke: Operation["invoke"], signal: AbortSignal): Promise<T> {
			if (closed || !executionId || used.has(executionId) || used.size >= options.maxExecutions)
				return Promise.reject(
					new TypeError("HTTP transport rejected replay, capacity or disposal"),
				);
			signal.throwIfAborted();
			used.add(executionId);
			let resolve!: (value: T) => void;
			let reject!: (error: unknown) => void;
			const completion = new Promise<T>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			active.set(executionId, { invoke, signal, resolve, reject });
			pending.add(completion);
			void completion.then(
				() => {
					active.delete(executionId);
					pending.delete(completion);
				},
				() => {
					active.delete(executionId);
					pending.delete(completion);
				},
			);
			try {
				// Only opaque admission coordinates enter Graph DATA. The marker is
				// consumed by this private driver and is never sent over the network.
				inputs.down([
					[
						"DATA",
						{
							kind: "tool-provider-adapter-input",
							adapterInputId: executionId,
							status: "ready",
							requestId: executionId,
							operationId: executionId,
							providerId,
							toolName: "http.fetch",
							routeId: providerId,
							executorId: name,
							profileId: `${name}/profile`,
							sourceRefs: [{ kind: "eval-admission", id: executionId }],
							toolCall: {
								kind: "tool-call",
								toolName: "http.fetch",
								arguments: {
									url: options.endpoint,
									method: "POST",
									headers: { "x-eval-transport-id": executionId },
								},
							},
						},
					],
				]);
				requests.down([
					[
						"DATA",
						{
							kind: "tool-provider-adapter-run-requested",
							runId: executionId,
							adapterInputId: executionId,
							requestId: executionId,
							operationId: executionId,
							providerId,
							attempt: 1,
							reason: "initial",
							sourceRefs: [{ kind: "eval-admission", id: executionId }],
						},
					],
				]);
			} catch (error) {
				reject(error);
			}
			return completion;
		},
		async dispose(): Promise<void> {
			closed = true;
			// Caller cancels its effect leases first. Do not suppress the runtime's
			// terminal publication before every active request has settled.
			await Promise.allSettled([...pending]);
			stopOutcome();
			stopStatus();
			runtime.dispose();
		},
	});
}
