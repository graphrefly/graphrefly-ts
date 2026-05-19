import { DATA, type Node, node } from "@graphrefly/pure-ts/core";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../../../presets/ai/agent-loop.js";
import type { LLMAdapter, LLMResponse, ToolCall, ToolDefinition } from "../../../utils/ai/index.js";
import { toolInterceptor } from "../../../utils/ai/index.js";

// Dedicated file (NOT folded into ai.test.ts): activation of a SENTINEL dep
// through the core first-run gate is sensitive to cross-test module state
// (ai.test.ts's 100+ tests share one module instance). A clean per-file scope
// keeps these assertions deterministic. The never-emitted-predicate outcome
// itself is deliberately NOT asserted — see the NOTE below + optimizations.md.

/** Minimal sequential mock adapter (mirrors ai.test.ts `mockAdapter`). */
function mockAdapter(responses: LLMResponse[]): LLMAdapter {
	let idx = 0;
	return {
		invoke() {
			const resp = responses[idx] ?? responses[responses.length - 1]!;
			idx++;
			return resp;
		},
		async *stream() {
			yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
			yield { type: "finish" as const, reason: "stop" };
		},
	};
}

describe("toolInterceptor (Phase 14.5.2)", () => {
	const tc = (name: string): ToolCall => ({ id: `id-${name}`, name, arguments: {} });

	/** Subscribe and capture every DATA batch as tool-name arrays. */
	function capture(n: Node<readonly ToolCall[]>): { seen: string[][]; stop: () => void } {
		const seen: string[][] = [];
		const sub = n.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push((m[1] as readonly ToolCall[]).map((c) => c.name));
			}
		});
		return { seen, stop: sub };
	}

	it("allow predicate filters denied calls; reactive policy re-opens", () => {
		const calls = node<readonly ToolCall[]>([], {
			name: "calls",
			initial: [tc("read"), tc("delete")],
		});
		const policy = node<boolean>([], { name: "destructive-allowed", initial: false });
		const gated = toolInterceptor({
			allow: [
				node(
					[policy],
					(b, a, c) => {
						const d = b.map((x, i) => (x != null && x.length > 0 ? x.at(-1) : c.prevData[i]));
						a.emit((call: ToolCall) => call.name !== "delete" || d[0] === true);
					},
					{ describeKind: "derived" },
				),
			],
		})(calls);
		const { seen, stop } = capture(gated);
		// Initial: destructive "delete" filtered out.
		expect(seen).toEqual([["read"]]);
		// Opening the policy ALONE must NOT re-emit the in-flight batch
		// (no buffer-and-replay) — `seen` is unchanged until a fresh
		// `calls` wave arrives.
		policy.emit(true);
		expect(seen).toEqual([["read"]]);
		// Fresh `calls` wave now re-filters under the opened policy.
		calls.emit([tc("read"), tc("delete")]);
		expect(seen).toEqual([["read"], ["read", "delete"]]);
		stop();
	});

	it("null predicate value = pass-through (emitted null is not deny)", () => {
		const calls = node<readonly ToolCall[]>([], {
			name: "calls",
			initial: [tc("a"), tc("b")],
		});
		// Predicate emits an explicit `null` DATA value (`null` is valid DATA;
		// `undefined` would be the SENTINEL) — the author's "not-ready, allow".
		const pending = node<(c: ToolCall) => boolean>([], {
			name: "pending-pred",
			initial: null as unknown as (c: ToolCall) => boolean,
		});
		const gated = toolInterceptor({ allow: [pending] })(calls);
		const { seen, stop } = capture(gated);
		expect(seen).toEqual([["a", "b"]]);
		stop();
	});

	// NOTE: a predicate node that has NEVER emitted DATA (pure SENTINEL, no
	// `initial`) has *unspecified* gating — the core first-run-gate outcome
	// for a SENTINEL dep depends on activation ordering (it holds the turn in
	// a clean scope but can pass through after prior subscriptions in the same
	// module). The primitive's contract is therefore "always seed
	// enabled/predicate with an `initial`" (see JSDoc), and we deliberately do
	// NOT assert the never-emitted activation outcome here — that would be a
	// brittle test of core activation, not of `toolInterceptor`. The seeded
	// pass-through path is covered by "null predicate value = pass-through"
	// above; the core observation is logged in docs/optimizations.md.

	it("full-deny → RESOLVED (no DATA), and the gate is not stuck afterward", () => {
		const calls = node<readonly ToolCall[]>([], { name: "calls", initial: [tc("forbid")] });
		const allow = node<(c: ToolCall) => boolean>([], {
			name: "deny-forbid",
			initial: (c: ToolCall) => c.name !== "forbid",
		});
		const gated = toolInterceptor({ allow: [allow] })(calls);
		const { seen, stop } = capture(gated);
		// Every call denied → RESOLVED, zero DATA emissions.
		expect(seen).toEqual([]);
		// RESOLVED is a clean no-op, not a terminal lock: a later allowed
		// batch still flows.
		calls.emit([tc("read")]);
		expect(seen).toEqual([["read"]]);
		stop();
	});

	it("throwing predicate fails CLOSED — denies that call, no terminal ERROR", () => {
		const calls = node<readonly ToolCall[]>([], {
			name: "calls",
			initial: [tc("safe"), tc("boom")],
		});
		const allow = node<(c: ToolCall) => boolean>([], {
			name: "throwing-pred",
			initial: (c: ToolCall) => {
				if (c.name === "boom") throw new Error("policy bug");
				return true;
			},
		});
		const gated = toolInterceptor({ allow: [allow] })(calls);
		const { seen, stop } = capture(gated);
		// "boom" denied (predicate threw → fail-closed); "safe" still flows;
		// the stream did NOT go terminal.
		expect(seen).toEqual([["safe"]]);
		calls.emit([tc("safe")]);
		expect(seen).toEqual([["safe"], ["safe"]]);
		stop();
	});

	it("kill-switch enabled:false denies all → RESOLVED; re-enable resumes (no replay)", () => {
		const calls = node<readonly ToolCall[]>([], { name: "calls", initial: [tc("a")] });
		const killSwitch = node<boolean>([], { name: "tools-enabled", initial: false });
		const gated = toolInterceptor({ enabled: killSwitch })(calls);
		const { seen, stop } = capture(gated);
		expect(seen).toEqual([]); // switch off → all denied
		// Flipping the switch ON with NO new `calls` must NOT replay the
		// stale denied batch (the confused-deputy hole D1 closed).
		killSwitch.emit(true);
		expect(seen).toEqual([]);
		// Only a fresh `calls` wave resumes flow.
		calls.emit([tc("a")]);
		expect(seen).toEqual([["a"]]);
		stop();
	});

	it("agentLoop integration: partial deny keeps allowed, synthesizes denial result for forbidden", async () => {
		const toolCallResp: LLMResponse = {
			content: "",
			toolCalls: [
				{ id: "tc1", name: "allow", arguments: {} },
				{ id: "tc2", name: "forbid", arguments: {} },
			],
		};
		const finalResp: LLMResponse = { content: "done", finishReason: "end_turn" };
		const adapter = mockAdapter([toolCallResp, finalResp]);
		const allowTool: ToolDefinition = {
			name: "allow",
			description: "",
			parameters: {},
			handler: () => "ok",
		};
		const forbidTool: ToolDefinition = {
			name: "forbid",
			description: "",
			parameters: {},
			handler: () => {
				throw new Error("should not execute");
			},
		};
		const loop = agentLoop("ti-partial", {
			adapter,
			tools: [allowTool, forbidTool],
			interceptToolCalls: toolInterceptor({
				allow: [
					node<(c: ToolCall) => boolean>([], {
						name: "deny-forbid",
						initial: (c: ToolCall) => c.name !== "forbid",
					}),
				],
			}),
		});
		await loop.run("go");
		const toolMsgs = loop.chat.allMessages().filter((m) => m.role === "tool");
		// Post-ND-3 (DS-2.7.A /qa, 2026-05-19): every `tool_use` in the
		// assistant message has a matching `tool_result` — allowed's real
		// handler result + forbidden's synthetic denial.
		expect(toolMsgs).toHaveLength(2);
		// Public `toolCalls` surfaces the POST-intercept stream (auditable).
		expect((loop.toolCalls.cache as readonly ToolCall[]).map((c) => c.name)).toEqual(["allow"]);
	});
});
