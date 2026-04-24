/**
 * Generic stream extractor — mounts an extract function on accumulated text.
 *
 * **Wave A Unit 3 rewrite:** signature changed from
 * `streamExtractor(topic: TopicGraph<StreamChunk>, fn)` to
 * `streamExtractor(accumulatedText: Node<string>, fn)`. The Unit 2 delta-
 * topic redesign removed the per-chunk `accumulated` field; callers pass
 * `streamingPromptNode(...).accumulatedText` (or any other `Node<string>`
 * source of accumulated text). Source-agnostic — the extractor doesn't care
 * whether the text came from an LLM, WebSocket, SSE tail, or file reader.
 *
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import { aiMeta } from "../_internal.js";

/**
 * Mounts an extractor function on a reactive accumulated-text source. Returns
 * a derived node that emits extracted values as the text grows.
 *
 * @param accumulatedText - Reactive `Node<string>` of accumulated text.
 * @param extractFn - `(accumulated: string) => T | null`.
 * @param opts - Optional name + structural equals.
 * @returns Derived node emitting extracted values.
 */
export function streamExtractor<T>(
	accumulatedText: Node<string>,
	extractFn: (accumulated: string) => T | null,
	opts?: {
		name?: string;
		/**
		 * Optional structural equals for the extractor output. When two
		 * consecutive chunks produce structurally-equal outputs, the framework
		 * emits `RESOLVED` instead of `DATA`, saving downstream work. Default:
		 * reference equality (`Object.is`). The library cannot know your
		 * output shape — supply this when your `extractFn` returns structured
		 * objects or arrays.
		 */
		equals?: (a: T | null, b: T | null) => boolean;
	},
): Node<T | null> {
	return derived<T | null>(
		[accumulatedText],
		([text]) => {
			if (text == null) return null;
			return extractFn(text as string);
		},
		{
			name: opts?.name ?? "extractor",
			describeKind: "derived",
			initial: null,
			meta: aiMeta("stream_extractor"),
			...(opts?.equals ? { equals: opts.equals } : {}),
		},
	);
}
