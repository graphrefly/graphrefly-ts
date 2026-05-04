/**
 * Cost meter extractor — derives live cost readings from the delta topic.
 *
 * **Wave A Unit 3 rewrite:** signature takes `deltaTopic: TopicGraph<StampedDelta>`
 * instead of the old `TopicGraph<StreamChunk>`. The meter prefers real
 * `usage` deltas from the adapter; when no `usage` has been seen yet it
 * falls back to a char-based estimate over token deltas and stamps
 * `estimated: true` on the reading. Chunk count is the count of
 * token-type deltas seen (was `chunk.index + 1`).
 *
 * @module
 */

import { type Node, node } from "../../../core/node.js";
import type { TopicGraph } from "../../messaging/index.js";
import { aiMeta } from "../_internal.js";
import { sumInputTokens, sumOutputTokens } from "../adapters/core/types.js";
import type { StampedDelta } from "../prompts/streaming.js";

/** A cost meter reading from the stream. */
export type CostMeterReading = {
	readonly chunkCount: number;
	readonly charCount: number;
	readonly estimatedTokens: number;
	/**
	 * `true` when no adapter `usage` delta has been observed yet —
	 * `estimatedTokens` is a char-based heuristic and should be treated as an
	 * approximation. Flips to `false` once a real `usage` delta arrives.
	 */
	readonly estimated: boolean;
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
		a.estimatedTokens === b.estimatedTokens &&
		a.estimated === b.estimated
	);
};

/**
 * Mounts a cost meter on the delta topic. Prefers real `usage` deltas from
 * the provider; falls back to char-based estimation on token deltas alone
 * (with `meta.estimated: true` on the reading).
 *
 * Default structural equals suppresses DATA emission when two consecutive
 * readings are identical.
 */
export function costMeterExtractor(
	deltaTopic: TopicGraph<StampedDelta>,
	opts?: CostMeterOptions,
): Node<CostMeterReading> {
	const charsPerToken = opts?.charsPerToken ?? 4;
	const ZERO: CostMeterReading = {
		chunkCount: 0,
		charCount: 0,
		estimatedTokens: 0,
		estimated: true,
	};
	// Lock 6.D (Phase 13.6.B): clear per-stream counters on deactivation
	// so a resubscribed cost meter starts at zero on the next cycle.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<CostMeterReading>(
		[deltaTopic.latest],
		(batchData, actions, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.chunkCount;
						delete store.charCount;
						delete store.usageTokens;
						delete store.sawUsage;
					},
				};
			}
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const d = data[0];
			if (d === undefined) {
				actions.emit(ZERO);
				return cleanup;
			}
			const delta = d as StampedDelta;

			if (!("chunkCount" in ctx.store)) {
				ctx.store.chunkCount = 0;
				ctx.store.charCount = 0;
				ctx.store.usageTokens = 0;
				ctx.store.sawUsage = false;
			}
			const store = ctx.store as {
				chunkCount: number;
				charCount: number;
				usageTokens: number;
				sawUsage: boolean;
			};

			if (delta.type === "token") {
				store.chunkCount += 1;
				store.charCount += delta.delta.length;
			} else if (delta.type === "usage") {
				store.sawUsage = true;
				store.usageTokens = sumInputTokens(delta.usage) + sumOutputTokens(delta.usage);
			}

			const estimatedTokens = store.sawUsage
				? store.usageTokens
				: Math.ceil(store.charCount / charsPerToken);
			actions.emit({
				chunkCount: store.chunkCount,
				charCount: store.charCount,
				estimatedTokens,
				estimated: !store.sawUsage,
			});
			return cleanup;
		},
		{
			name: opts?.name ?? "cost-meter",
			describeKind: "derived",
			initial: ZERO,
			meta: aiMeta("cost_meter_extractor"),
			equals: costMeterEqual,
		},
	);
}
