/**
 * Cost meter extractor — counts chunks, characters, and estimates token usage.
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import type { TopicGraph } from "../../messaging/index.js";
import { aiMeta } from "../_internal.js";
import type { StreamChunk } from "../prompts/streaming.js";

/** A cost meter reading from the stream. */
export type CostMeterReading = {
	readonly chunkCount: number;
	readonly charCount: number;
	readonly estimatedTokens: number;
};

export type CostMeterOptions = {
	/** Characters per token approximation. Default: 4 (GPT-family). */
	charsPerToken?: number;
	name?: string;
};

const costMeterEqual = (a: CostMeterReading, b: CostMeterReading): boolean => {
	if (a === b) return true;
	return (
		a.chunkCount === b.chunkCount &&
		a.charCount === b.charCount &&
		a.estimatedTokens === b.estimatedTokens
	);
};

/**
 * Mounts a cost meter on a streaming topic. Counts chunks, characters, and
 * estimates token count. Compose with `budgetGate` for hard-stop when LLM
 * output exceeds budget mid-generation.
 *
 * Default structural equals suppresses DATA emission when two consecutive
 * readings are identical (same chunk count + char count + token estimate).
 */
export function costMeterExtractor(
	streamTopic: TopicGraph<StreamChunk>,
	opts?: CostMeterOptions,
): Node<CostMeterReading> {
	const charsPerToken = opts?.charsPerToken ?? 4;
	return derived<CostMeterReading>(
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk]) => {
			if (chunk == null) return { chunkCount: 0, charCount: 0, estimatedTokens: 0 };
			const c = chunk as StreamChunk;
			const charCount = c.accumulated.length;
			return {
				chunkCount: c.index + 1,
				charCount,
				estimatedTokens: Math.ceil(charCount / charsPerToken),
			};
		},
		{
			name: opts?.name ?? "cost-meter",
			describeKind: "derived",
			initial: { chunkCount: 0, charCount: 0, estimatedTokens: 0 },
			meta: aiMeta("cost_meter_extractor"),
			equals: costMeterEqual,
		},
	);
}
