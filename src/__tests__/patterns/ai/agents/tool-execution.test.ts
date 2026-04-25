/**
 * Standalone unit tests for `toolExecution`. Exercises the primitive
 * directly with a hand-rolled `toolCalls` state node + a real
 * `ToolRegistryGraph`, without routing through the full `agentLoop`
 * pipeline. Catches contract regressions cheaply.
 *
 * Covers:
 *   - happy-path multi-call batch returns one ToolResult per call in order
 *   - empty batch throws the documented invariant violation
 *   - rescue mode: failed call emits `{error}` JSON, siblings continue
 *   - propagate mode: failed call ERRORs out the batch
 *   - retry: first attempt fails, second succeeds within retryCount
 *   - switchMap supersede aborts in-flight handler signal
 */

import { describe, expect, it } from "vitest";
import { DATA, ERROR } from "../../../../core/messages.js";
import { state } from "../../../../core/sugar.js";
import { awaitSettled } from "../../../../extra/sources.js";
import type { ToolCall } from "../../../../patterns/ai/adapters/core/types.js";
import { type ToolResult, toolExecution } from "../../../../patterns/ai/agents/tool-execution.js";
import { toolRegistry } from "../../../../patterns/ai/agents/tool-registry.js";

function call(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
	return { id, name, arguments: args };
}

describe("toolExecution — happy path", () => {
	it("emits one ToolResult per ToolCall in batch order", async () => {
		const tr = toolRegistry("hp-tools");
		tr.register({
			name: "echo",
			description: "Echo back the message",
			parameters: {},
			handler: (args) => `echoed-${args.msg as string}`,
		});
		tr.register({
			name: "add",
			description: "Add two numbers",
			parameters: {},
			handler: (args) => (args.a as number) + (args.b as number),
		});
		const toolCalls = state<readonly ToolCall[]>([
			call("c1", "echo", { msg: "hi" }),
			call("c2", "add", { a: 3, b: 4 }),
		]);
		const out = toolExecution({ toolCalls, tools: tr });
		const result = await awaitSettled(out);
		expect(result).toEqual([
			{ id: "c1", content: "echoed-hi" },
			{ id: "c2", content: "7" },
		]);
	});
});

describe("toolExecution — empty batch", () => {
	it("throws on empty batch (caller contract violation)", async () => {
		const tr = toolRegistry("empty-tools");
		const toolCalls = state<readonly ToolCall[]>([]);
		const out = toolExecution({ toolCalls, tools: tr });
		// switchMap dispatches the project fn synchronously on subscribe;
		// the throw surfaces as ERROR on the node.
		const errors: unknown[] = [];
		out.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === ERROR) errors.push(m[1]);
			}
		});
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toMatch(/empty tool-call batch/);
	});
});

describe("toolExecution — error handling", () => {
	it("rescue mode: failed call emits {error} JSON, sibling continues", async () => {
		const tr = toolRegistry("err-tools");
		tr.register({
			name: "boom",
			description: "Always fails",
			parameters: {},
			handler: () => {
				throw new Error("kaboom");
			},
		});
		tr.register({
			name: "ok",
			description: "Always works",
			parameters: {},
			handler: () => "fine",
		});
		const toolCalls = state<readonly ToolCall[]>([call("c1", "boom"), call("c2", "ok")]);
		// Default onError is "rescue". retryCount=0 to stop retrying the doomed call.
		const out = toolExecution({ toolCalls, tools: tr, retryCount: 0 });
		const result = await awaitSettled(out);
		expect(result).toHaveLength(2);
		const c1 = (result as readonly ToolResult[])[0];
		const c2 = (result as readonly ToolResult[])[1];
		expect(c1.id).toBe("c1");
		expect(JSON.parse(c1.content)).toEqual({ error: expect.stringContaining("kaboom") });
		expect(c2).toEqual({ id: "c2", content: "fine" });
	});

	it("propagate mode: failed call ERRORs the batch", async () => {
		const tr = toolRegistry("prop-tools");
		tr.register({
			name: "boom",
			description: "Always fails",
			parameters: {},
			handler: () => {
				throw new Error("propagated");
			},
		});
		tr.register({
			name: "ok",
			description: "Always works",
			parameters: {},
			handler: () => "fine",
		});
		const toolCalls = state<readonly ToolCall[]>([call("c1", "boom"), call("c2", "ok")]);
		const out = toolExecution({
			toolCalls,
			tools: tr,
			retryCount: 0,
			onError: "propagate",
		});
		const errors: unknown[] = [];
		const datas: unknown[] = [];
		out.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === ERROR) errors.push(m[1]);
				if (m[0] === DATA) datas.push(m[1]);
			}
		});
		// Microtasks for retrySource attempts to drain.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(datas).toEqual([]);
	});
});

describe("toolExecution — retry", () => {
	it("retries on transient failure and succeeds on attempt 2", async () => {
		const tr = toolRegistry("retry-tools");
		let attempts = 0;
		tr.register({
			name: "flaky",
			description: "Fails first attempt",
			parameters: {},
			handler: () => {
				attempts++;
				if (attempts === 1) throw new Error("transient");
				return "second-time-lucky";
			},
		});
		const toolCalls = state<readonly ToolCall[]>([call("c1", "flaky")]);
		const out = toolExecution({ toolCalls, tools: tr, retryCount: 1 });
		const result = await awaitSettled(out);
		expect(result).toEqual([{ id: "c1", content: "second-time-lucky" }]);
		expect(attempts).toBe(2);
	});
});

describe("toolExecution — supersede cancellation", () => {
	it("aborts in-flight handler signal on superseding batch", async () => {
		const tr = toolRegistry("supersede-tools");
		const seenSignals: AbortSignal[] = [];
		tr.register({
			name: "longRunning",
			description: "Never resolves until aborted",
			parameters: {},
			handler: (_args, opts) => {
				if (opts?.signal) seenSignals.push(opts.signal);
				return new Promise<string>((_resolve, reject) => {
					if (opts?.signal?.aborted) {
						reject(new DOMException("aborted", "AbortError"));
						return;
					}
					opts?.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				});
			},
		});
		tr.register({
			name: "fast",
			description: "Resolves immediately",
			parameters: {},
			handler: () => "done",
		});
		const toolCalls = state<readonly ToolCall[]>([call("c1", "longRunning")]);
		const out = toolExecution({ toolCalls, tools: tr, retryCount: 0 });
		out.subscribe(() => {});
		await Promise.resolve();
		await Promise.resolve();
		expect(seenSignals).toHaveLength(1);
		expect(seenSignals[0].aborted).toBe(false);
		// Supersede with a new batch — switchMap unmounts the prior fan,
		// which cascades through retrySource → executeReactive →
		// AbortController.abort().
		toolCalls.emit([call("c2", "fast")]);
		await Promise.resolve();
		await Promise.resolve();
		expect(seenSignals[0].aborted).toBe(true);
	});
});
