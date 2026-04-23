/**
 * Generic stream extractor — mounts an extract function on a streaming topic.
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import type { TopicGraph } from "../../messaging/index.js";
import { aiMeta } from "../_internal.js";
import type { StreamChunk } from "../prompts/streaming.js";

/**
 * Mounts an extractor function on a streaming topic. Returns a derived node
 * that emits extracted values as chunks arrive.
 *
 * `extractFn` receives the accumulated text from the latest chunk and returns
 * the extracted value, or `null` if nothing detected yet. This is the building
 * block for keyword flags, tool call detection, cost metering, etc.
 *
 * @param streamTopic - The stream topic to extract from.
 * @param extractFn - `(accumulated: string) => T | null`.
 * @param opts - Optional name.
 * @returns Derived node emitting extracted values.
 */
export function streamExtractor<T>(
	streamTopic: TopicGraph<StreamChunk>,
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
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk]) => {
			if (chunk == null) return null;
			return extractFn((chunk as StreamChunk).accumulated);
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
