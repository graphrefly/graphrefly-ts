/**
 * Scenario-scripted mock LLM adapter for harness and AI pattern testing.
 *
 * Detects the calling stage from prompt content and returns scripted responses.
 * Records all calls for assertions.
 *
 * @module
 */

import type { ChatMessage, LLMAdapter, LLMResponse } from "../../patterns/ai/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single recorded call to the mock adapter. */
export interface MockCall {
	stage: string;
	messages: readonly ChatMessage[];
	response: LLMResponse;
}

/** Per-stage response script. Cycles through responses on each call. */
export interface StageScript {
	/** Ordered responses — each call consumes the next; last one repeats. */
	responses: unknown[];
}

/** Configuration for {@link mockLLM}. */
export interface MockScript {
	/** Stage-aware response scripts. Stage is detected from prompt keywords. */
	stages?: Record<string, StageScript>;
	/** Fallback response for unmatched prompts. */
	fallback?: unknown;
}

/** Extended LLM adapter with call recording and inspection. */
export interface MockLLMAdapter extends LLMAdapter {
	/** All calls recorded in order. */
	readonly calls: MockCall[];
	/** Per-stage call counts. */
	readonly stageCounts: ReadonlyMap<string, number>;
	/** Calls filtered by stage name. */
	callsFor(stage: string): MockCall[];
	/** Reset all counters and call history. */
	reset(): void;
}

// ---------------------------------------------------------------------------
// Stage detection
// ---------------------------------------------------------------------------

/**
 * Default stage detection keywords (matched against lowercased prompt text).
 * Order matters: more specific phrases checked first to avoid substring
 * collisions (e.g. "triaged issue" in execute prompt matching "triage").
 */
const STAGE_KEYWORDS: [string, string[]][] = [
	["execute", ["implementation agent", "produce a fix"]],
	["verify", ["qa reviewer", "verify whether"]],
	["triage", ["triage classifier", "intake item"]],
];

function detectStage(text: string, customStages?: Record<string, StageScript>): string {
	const lower = text.toLowerCase();

	// Check built-in multi-word keywords first (more specific, avoids substring collisions
	// like "triaged" matching "triage")
	for (const [stage, keywords] of STAGE_KEYWORDS) {
		if (keywords.some((kw) => lower.includes(kw))) return stage;
	}

	// Fall back to custom stage names as keywords
	if (customStages) {
		for (const stage of Object.keys(customStages)) {
			if (lower.includes(stage.toLowerCase())) return stage;
		}
	}

	return "unknown";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a scenario-scripted mock LLM adapter.
 *
 * ```ts
 * const mock = mockLLM({
 *   stages: {
 *     triage:  { responses: [{ rootCause: "missing-fn", intervention: "catalog-fn", route: "auto-fix", priority: 80 }] },
 *     execute: { responses: [{ outcome: "success", detail: "Fixed" }] },
 *     verify:  { responses: [{ verified: false, findings: ["err"], errorClass: "self-correctable" },
 *                            { verified: true, findings: ["ok"] }] },
 *   },
 * });
 * ```
 */
export function mockLLM(script: MockScript = {}): MockLLMAdapter {
	const calls: MockCall[] = [];
	const stageCounts = new Map<string, number>();
	const stageIndices = new Map<string, number>();

	function getResponse(stage: string): unknown {
		const stageScript = script.stages?.[stage];
		if (!stageScript) return script.fallback ?? {};

		const idx = stageIndices.get(stage) ?? 0;
		const responses = stageScript.responses;
		const response = responses[Math.min(idx, responses.length - 1)];
		stageIndices.set(stage, idx + 1);
		return response;
	}

	function invoke(messages: readonly ChatMessage[]): Promise<LLMResponse> {
		const text = messages.map((m) => m.content).join(" ");
		const stage = detectStage(text, script.stages);

		const count = stageCounts.get(stage) ?? 0;
		stageCounts.set(stage, count + 1);

		const responseData = getResponse(stage);
		const response: LLMResponse = {
			content: typeof responseData === "string" ? responseData : JSON.stringify(responseData),
			usage: { input: { regular: 0 }, output: { regular: 0 } },
		};

		calls.push({ stage, messages, response });
		return Promise.resolve(response);
	}

	async function* stream(): AsyncIterable<
		import("../../patterns/ai/adapters/core/types.js").StreamDelta
	> {
		yield { type: "token", delta: "mock stream" };
		yield { type: "usage", usage: { input: { regular: 0 }, output: { regular: 0 } } };
		yield { type: "finish", reason: "stop" };
	}

	return {
		provider: "mock",
		calls,
		get stageCounts() {
			return stageCounts as ReadonlyMap<string, number>;
		},
		callsFor(stage: string) {
			return calls.filter((c) => c.stage === stage);
		},
		reset() {
			calls.length = 0;
			stageCounts.clear();
			stageIndices.clear();
		},
		invoke,
		stream,
	};
}
