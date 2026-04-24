// ---------------------------------------------------------------------------
// llmExtractor / llmConsolidator — thin wrappers over `promptNode` (Unit 9).
//
// Both functions used to ship ~95%-duplicated `producer` bodies that
// re-implemented the message-loop / unsubscribe machinery `promptNode`
// already provides. The shared piece is now `llmJsonCall`, which builds a
// per-input `state(input)` + delegates to `promptNode({format: "json"})`
// so we inherit fence-stripping, Unit 1's content-preview JSON error, and
// the producer-shape "exactly one DATA per wave" guarantee.
// ---------------------------------------------------------------------------

import { state } from "../../../core/sugar.js";
import type { Extraction } from "../../../extra/composite.js";
import type { NodeInput } from "../../../extra/sources.js";
import type { LLMAdapter } from "../adapters/core/types.js";
import { promptNode } from "../prompts/prompt-node.js";

export type LLMExtractorOptions = {
	adapter: LLMAdapter;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/**
	 * Cap the dedup-hint slice of `existingKeys` passed to the LLM. Larger
	 * stores ship more keys (better dedup recall) at the cost of prompt size.
	 * Default 100. Set to `Infinity` to forward every key.
	 */
	maxExistingKeys?: number;
	/**
	 * Optional name forwarded to the underlying `promptNode` (used as the
	 * `<name>::messages` / `<name>::call` / `<name>::output` path prefix).
	 * Defaults differ per call site (`llmExtractor` / `llmConsolidator`) so
	 * extractor + consolidator wired into the same graph don't collide on
	 * `prompt_node::output`.
	 */
	name?: string;
};

/**
 * Internal helper: one LLM JSON call, parameterized by system prompt + a
 * per-call user-content builder. Handles: state(input) wrapping, promptNode
 * delegation, JSON-parse / fence-strip / content-preview error path.
 *
 * Not exported; the only consumers are `llmExtractor` + `llmConsolidator`.
 * If a third caller emerges, promote to the public surface.
 */
function llmJsonCall<TIn, TOut>(
	systemPrompt: string,
	buildUserContent: (input: TIn) => string,
	opts: LLMExtractorOptions,
	defaultName: string,
): (input: TIn) => NodeInput<TOut> {
	const name = opts.name ?? defaultName;
	return (input: TIn) => {
		// One-shot state(input) per call — switchMap teardown inside distill
		// reclaims the node when the next raw arrives or the bundle disposes.
		const inputState = state<TIn>(input);
		return promptNode<TOut>(
			opts.adapter,
			[inputState as never],
			(value: unknown) => buildUserContent(value as TIn),
			{
				name,
				format: "json",
				systemPrompt,
				model: opts.model,
				temperature: opts.temperature ?? 0,
				maxTokens: opts.maxTokens,
			},
		) as NodeInput<TOut>;
	};
}

/**
 * Returns an `extractFn` callback for `distill()` that invokes an LLM to
 * extract structured memories from raw input.
 *
 * The system prompt should instruct the LLM to return JSON matching
 * `Extraction<TMem>` shape: `{ upsert: [{ key, value }], remove?: [key] }`.
 *
 * Built on `promptNode({format: "json"})` — inherits markdown-fence stripping
 * and content-preview parse errors. Stack `withRetry` on the adapter for
 * transient-error tolerance (see `patterns/ai/adapters/middleware/retry.ts`).
 */
export function llmExtractor<TRaw, TMem>(
	systemPrompt: string,
	opts: LLMExtractorOptions,
): (raw: TRaw, existing: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>> {
	const cap = opts.maxExistingKeys ?? 100;
	const call = llmJsonCall<{ raw: TRaw; existingKeys: string[] }, Extraction<TMem>>(
		systemPrompt,
		(input) => JSON.stringify({ input: input.raw, existingKeys: input.existingKeys }),
		opts,
		"llmExtractor",
	);
	return (raw: TRaw, existing: ReadonlyMap<string, TMem>) => {
		const existingKeys =
			cap === Number.POSITIVE_INFINITY ? [...existing.keys()] : [...existing.keys()].slice(0, cap);
		return call({ raw, existingKeys });
	};
}

export type LLMConsolidatorOptions = LLMExtractorOptions;

/**
 * Returns a `consolidateFn` callback for `distill()` that invokes an LLM to
 * cluster and merge related memories.
 */
export function llmConsolidator<TMem>(
	systemPrompt: string,
	opts: LLMConsolidatorOptions,
): (entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>> {
	const call = llmJsonCall<readonly { key: string; value: TMem }[], Extraction<TMem>>(
		systemPrompt,
		(memories) => JSON.stringify({ memories }),
		opts,
		"llmConsolidator",
	);
	return (entries: ReadonlyMap<string, TMem>) => {
		const memories = [...entries.entries()].map(([key, value]) => ({ key, value }));
		return call(memories);
	};
}
