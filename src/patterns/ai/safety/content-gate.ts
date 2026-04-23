/**
 * Content gate — classifies accumulated stream text as allow / review / block.
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import type { TopicGraph } from "../../messaging/index.js";
import type { StreamChunk } from "../prompts/streaming.js";

/** Content safety decision. */
export type ContentDecision = "allow" | "block" | "review";

/** Options for {@link contentGate}. */
export type ContentGateOptions = {
	/**
	 * Hard-block threshold multiplier (default 1.5).
	 * Scores above `threshold * hardMultiplier` emit `"block"`.
	 * Scores between `threshold` and that emit `"review"`.
	 */
	hardMultiplier?: number;
	name?: string;
};

/**
 * Derived node that classifies accumulated stream text as `"allow"`,
 * `"review"`, or `"block"` based on a classifier score.
 *
 * Emits a three-way decision on every new chunk:
 * - `"allow"` — score below `threshold`
 * - `"review"` — score in `[threshold, threshold × hardMultiplier)`
 * - `"block"` — score at or above `threshold × hardMultiplier`
 *
 * Wire the output into a `valve` (automatic) or `gate` (human approval).
 * This node does not itself control flow — it just classifies.
 *
 * @param streamTopic - Streaming topic to classify.
 * @param classifier  - `(accumulated: string) => number` scoring function, or
 *                      a `Node<number>` for live scores.
 * @param threshold   - Score at which output becomes "review" or "block".
 */
export function contentGate(
	streamTopic: TopicGraph<StreamChunk>,
	classifier: ((accumulated: string) => number) | Node<number>,
	threshold: number,
	opts?: ContentGateOptions,
): Node<ContentDecision> {
	const hardThreshold = threshold * (opts?.hardMultiplier ?? 1.5);
	const isNodeClassifier = typeof classifier !== "function";

	const deps: Node<unknown>[] = [streamTopic.latest as Node<StreamChunk | null>];
	if (isNodeClassifier) deps.push(classifier as Node<unknown>);

	return derived<ContentDecision>(
		deps,
		(values) => {
			const chunk = values[0] as StreamChunk | undefined;
			if (chunk == null) return "allow";

			const score = isNodeClassifier
				? ((values[1] as number | undefined) ?? 0)
				: (classifier as (text: string) => number)(chunk.accumulated);

			if (score >= hardThreshold) return "block";
			if (score >= threshold) return "review";
			return "allow";
		},
		{ name: opts?.name ?? "content-gate", initial: "allow" },
	);
}
