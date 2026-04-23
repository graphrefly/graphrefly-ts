// ---------------------------------------------------------------------------
// llmExtractor / llmConsolidator
// ---------------------------------------------------------------------------

import { COMPLETE, DATA, ERROR } from "../../../core/messages.js";
import { producer } from "../../../core/sugar.js";
import type { Extraction } from "../../../extra/composite.js";
import { fromAny, type NodeInput } from "../../../extra/sources.js";
import type { ChatMessage, LLMAdapter, LLMResponse } from "../adapters/core/types.js";

export type LLMExtractorOptions = {
	adapter: LLMAdapter;
	model?: string;
	temperature?: number;
	maxTokens?: number;
};

/**
 * Returns an `extractFn` callback for `distill()` that invokes an LLM to
 * extract structured memories from raw input.
 *
 * The system prompt should instruct the LLM to return JSON matching
 * `Extraction<TMem>` shape: `{ upsert: [{ key, value }], remove?: [key] }`.
 */
export function llmExtractor<TRaw, TMem>(
	systemPrompt: string,
	opts: LLMExtractorOptions,
): (raw: TRaw, existing: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>> {
	return (raw: TRaw, existing: ReadonlyMap<string, TMem>) => {
		const existingKeys = [...existing.keys()].slice(0, 100); // sample for dedup
		const messages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: JSON.stringify({
					input: raw,
					existingKeys,
				}),
			},
		];
		// Wrap the adapter call in a producer that parses the JSON response
		return producer<Extraction<TMem>>((actions) => {
			let active = true;
			const result = opts.adapter.invoke(messages, {
				model: opts.model,
				temperature: opts.temperature ?? 0,
				maxTokens: opts.maxTokens,
			});
			// result is NodeInput — could be a Promise, Node, etc.
			const resolved = fromAny(result);
			const unsub = resolved.subscribe((msgs) => {
				if (!active) return;
				let done = false;
				for (const msg of msgs) {
					if (done) break;
					if (msg[0] === DATA) {
						const response = msg[1] as LLMResponse;
						try {
							const parsed = JSON.parse(response.content) as Extraction<TMem>;
							actions.emit(parsed);
							actions.down([[COMPLETE]]);
						} catch {
							actions.down([
								[ERROR, new Error("llmExtractor: failed to parse LLM response as JSON")],
							]);
						}
						done = true;
					} else if (msg[0] === ERROR) {
						actions.down([[ERROR, msg[1]]]);
						done = true;
					} else if (msg[0] === COMPLETE) {
						actions.down([[COMPLETE]]);
						done = true;
					} else {
						// Forward unknown message types (spec §1.3.6)
						actions.down([[msg[0], msg[1]]]);
					}
				}
			});
			return () => {
				unsub();
				active = false;
			};
		});
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
	return (entries: ReadonlyMap<string, TMem>) => {
		const entriesArray = [...entries.entries()].map(([key, value]) => ({ key, value }));
		const messages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: JSON.stringify({ memories: entriesArray }) },
		];
		return producer<Extraction<TMem>>((actions) => {
			let active = true;
			const result = opts.adapter.invoke(messages, {
				model: opts.model,
				temperature: opts.temperature ?? 0,
				maxTokens: opts.maxTokens,
			});
			const resolved = fromAny(result);
			const unsub = resolved.subscribe((msgs) => {
				if (!active) return;
				let done = false;
				for (const msg of msgs) {
					if (done) break;
					if (msg[0] === DATA) {
						const response = msg[1] as LLMResponse;
						try {
							const parsed = JSON.parse(response.content) as Extraction<TMem>;
							actions.emit(parsed);
							actions.down([[COMPLETE]]);
						} catch {
							actions.down([
								[ERROR, new Error("llmConsolidator: failed to parse LLM response as JSON")],
							]);
						}
						done = true;
					} else if (msg[0] === ERROR) {
						actions.down([[ERROR, msg[1]]]);
						done = true;
					} else if (msg[0] === COMPLETE) {
						actions.down([[COMPLETE]]);
						done = true;
					} else {
						// Forward unknown message types (spec §1.3.6)
						actions.down([[msg[0], msg[1]]]);
					}
				}
			});
			return () => {
				unsub();
				active = false;
			};
		});
	};
}
