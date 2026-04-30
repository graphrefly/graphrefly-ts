// ---------------------------------------------------------------------------
// promptCall — public single-shot LLM JSON helper (Tier 4.6 Wave AM Unit 4
// promotion from the previously-internal `llmJsonCall` in
// `patterns/ai/memory/llm-memory.ts`).
//
// Wraps {@link promptNode} for the common "one-shot LLM JSON call per input"
// shape: a per-call `node([], { initial: input })` is wrapped, the prompt builder runs against
// it, and the returned `NodeInput<TOut>` slots into reactive callbacks like
// `distill`'s `extractFn` / `consolidateFn`. Inherits markdown-fence stripping
// and content-preview parse errors from `promptNode({format: "json"})`.
//
// `llmExtractor` / `llmConsolidator` are now thin wrappers over `promptCall`.
// ---------------------------------------------------------------------------

import { node } from "../../../core/node.js";
import type { Extraction } from "../../../extra/composite.js";
import type { NodeInput } from "../../../extra/sources.js";
import type { LLMAdapter } from "../adapters/core/types.js";
import { promptNode } from "./prompt-node.js";

/** Options accepted by {@link promptCall}, {@link llmExtractor}, and {@link llmConsolidator}. */
export type PromptCallOptions = {
	adapter: LLMAdapter;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/**
	 * Optional name forwarded to the underlying `promptNode` (used as the
	 * `<name>::messages` / `<name>::call` / `<name>::output` path prefix).
	 * Defaults differ per call site so multiple `promptCall`s wired into the
	 * same graph don't collide on `prompt_node::output`.
	 */
	name?: string;
};

/**
 * Build a one-shot LLM JSON-call factory: each invocation wraps `input` in a
 * fresh `node([], { initial: input })`, delegates to `promptNode({format: "json"})`, and
 * returns a `NodeInput<TOut>` that the caller plugs into `distill` /
 * `agentLoop` / any reactive composition that accepts `NodeInput`.
 *
 * **Per-call lifecycle.** The returned `NodeInput<TOut>` is a producer that
 * emits exactly one `DATA` per upstream input (per Tier 1.2 Session C lock —
 * `promptNode` guarantees one DATA per wave). When the consumer's switchMap
 * supersedes it, the per-call `node([], { initial: input })` and the inner `prompt_node::call`
 * tear down together.
 *
 * @param systemPrompt - System message sent on every call.
 * @param buildUserContent - Per-input user-content builder (must be JSON-stringifiable).
 * @param opts - Adapter + model/temperature/maxTokens + optional name prefix.
 * @param defaultName - Path-prefix fallback when `opts.name` is omitted.
 * @returns Factory `(input: TIn) => NodeInput<TOut>`.
 *
 * @category patterns
 */
export function promptCall<TIn, TOut>(
	systemPrompt: string,
	buildUserContent: (input: TIn) => string,
	opts: PromptCallOptions,
	defaultName: string,
): (input: TIn) => NodeInput<TOut> {
	const name = opts.name ?? defaultName;
	return (input: TIn) => {
		// One-shot node([], { initial: input }) per call — switchMap teardown inside the
		// consumer (e.g. distill) reclaims the node when the next upstream
		// arrives or the bundle disposes.
		const inputState = node<TIn>([], { initial: input });
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

/** Options accepted by {@link llmExtractor} and {@link llmConsolidator}. */
export type LLMExtractorOptions = PromptCallOptions & {
	/**
	 * Cap the dedup-hint slice of `existingKeys` passed to the LLM. Larger
	 * stores ship more keys (better dedup recall) at the cost of prompt size.
	 * Default 100. Set to `Infinity` to forward every key.
	 */
	maxExistingKeys?: number;
};

/** Alias for backward compatibility. */
export type LLMConsolidatorOptions = LLMExtractorOptions;

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
	const call = promptCall<{ raw: TRaw; existingKeys: string[] }, Extraction<TMem>>(
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

/**
 * Returns a `consolidateFn` callback for `distill()` that invokes an LLM to
 * cluster and merge related memories.
 */
export function llmConsolidator<TMem>(
	systemPrompt: string,
	opts: LLMConsolidatorOptions,
): (entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>> {
	const call = promptCall<readonly { key: string; value: TMem }[], Extraction<TMem>>(
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
