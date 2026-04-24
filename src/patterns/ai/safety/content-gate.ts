/**
 * Content gate — classifies accumulated stream text as allow / review / block.
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";

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
 * **Wave A Unit 3 rewrite:** signature now takes `accumulatedText: Node<string>`
 * instead of a `TopicGraph<StreamChunk>` (the `StreamChunk` shape was retired
 * when the delta topic replaced the per-chunk accumulated-text shape).
 *
 * Emits a three-way decision on every text change:
 * - `"allow"` — score below `threshold`
 * - `"review"` — score in `[threshold, threshold × hardMultiplier)`
 * - `"block"` — score at or above `threshold × hardMultiplier`
 *
 * @param accumulatedText - Reactive accumulated-text source
 *                          (`streamingPromptNode(...).accumulatedText`).
 * @param classifier - `(accumulated: string) => number` scoring function, or
 *                     a `Node<number>` for live scores.
 * @param threshold - Score at which output becomes `"review"` or `"block"`.
 */
export function contentGate(
	accumulatedText: Node<string>,
	classifier: ((accumulated: string) => number) | Node<number>,
	threshold: number,
	opts?: ContentGateOptions,
): Node<ContentDecision> {
	const hardThreshold = threshold * (opts?.hardMultiplier ?? 1.5);
	const isNodeClassifier = typeof classifier !== "function";

	const deps: Node<unknown>[] = [accumulatedText];
	if (isNodeClassifier) deps.push(classifier as Node<unknown>);

	return derived<ContentDecision>(
		deps,
		(values) => {
			const text = (values[0] as string | undefined) ?? "";
			if (text.length === 0) return "allow";

			const score = isNodeClassifier
				? ((values[1] as number | undefined) ?? 0)
				: (classifier as (t: string) => number)(text);

			if (score >= hardThreshold) return "block";
			if (score >= threshold) return "review";
			return "allow";
		},
		{ name: opts?.name ?? "content-gate", initial: "allow" },
	);
}
