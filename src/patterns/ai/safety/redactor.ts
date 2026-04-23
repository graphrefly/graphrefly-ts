/**
 * Redactor — stream extractor that replaces matched patterns in accumulated text.
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import type { TopicGraph } from "../../messaging/index.js";
import type { StreamChunk } from "../prompts/streaming.js";

/** Options for {@link redactor}. */
export type RedactorOptions = {
	name?: string;
};

/**
 * Stream extractor that replaces matched patterns in the accumulated text.
 *
 * Returns a derived node emitting a sanitized `StreamChunk` on every chunk:
 * `accumulated` and `token` have matched substrings replaced by `replaceFn`.
 * The default `replaceFn` replaces with `"[REDACTED]"`.
 *
 * Compose with `contentGate` for in-flight safety pipelines.
 *
 * @param streamTopic - Streaming topic to monitor.
 * @param patterns    - Array of RegExps to match against accumulated text.
 * @param replaceFn   - Replacement producer (default: always `"[REDACTED]"`).
 */
export function redactor(
	streamTopic: TopicGraph<StreamChunk>,
	patterns: RegExp[],
	replaceFn?: (match: string, pattern: RegExp) => string,
	opts?: RedactorOptions,
): Node<StreamChunk> {
	const replace = replaceFn ?? (() => "[REDACTED]");

	function sanitize(text: string): string {
		let result = text;
		for (const pat of patterns) {
			const global = pat.global ? pat : new RegExp(pat.source, `${pat.flags}g`);
			result = result.replace(global, (m) => replace(m, pat));
		}
		return result;
	}

	return derived<StreamChunk>(
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk]) => {
			if (chunk == null) {
				return { source: "", token: "", accumulated: "", index: -1 };
			}
			const c = chunk as StreamChunk;
			const sanitizedAccumulated = sanitize(c.accumulated);
			const sanitizedToken = sanitize(c.token);
			return {
				source: c.source,
				token: sanitizedToken,
				accumulated: sanitizedAccumulated,
				index: c.index,
			};
		},
		{ name: opts?.name ?? "redactor" },
	);
}
