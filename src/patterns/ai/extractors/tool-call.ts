/**
 * Tool-call extractor — scans accumulated stream text for complete JSON tool call objects.
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import { aiMeta } from "../_internal.js";

/** A tool call detected in the stream. */
export type ExtractedToolCall = {
	readonly name: string;
	readonly arguments: Record<string, unknown>;
	readonly raw: string;
	readonly startIndex: number;
};

const toolCallsEqual = (
	a: readonly ExtractedToolCall[] | null,
	b: readonly ExtractedToolCall[] | null,
): boolean => {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (x.startIndex !== y.startIndex || x.name !== y.name || x.raw !== y.raw) {
			return false;
		}
	}
	return true;
};

/**
 * Mounts a tool-call extractor on a streaming topic. Scans accumulated text
 * for complete JSON objects containing `"name"` and `"arguments"` keys (the
 * standard tool_call shape). Partial JSON is ignored until the closing brace.
 *
 * Feeds into the tool interception chain for reactive tool gating mid-stream.
 *
 * **Streaming optimization.** Maintains a cursor (`scanFrom`) in `ctx.store`
 * so each chunk resumes brace-scanning from the position after the last
 * complete parse (or the last incomplete open brace). Already-parsed objects
 * are not re-parsed. Default structural equals suppresses DATA emission when
 * no new tool call completed this chunk.
 */
export function toolCallExtractor(
	accumulatedText: Node<string>,
	opts?: { name?: string },
): Node<readonly ExtractedToolCall[]> {
	return derived<readonly ExtractedToolCall[]>(
		[accumulatedText],
		([text], ctx) => {
			if (text == null) return [];
			const accumulated = text as string;

			if (!("calls" in ctx.store)) {
				ctx.store.calls = [] as ExtractedToolCall[];
				ctx.store.scanFrom = 0;
			}
			const calls = ctx.store.calls as ExtractedToolCall[];
			let i = ctx.store.scanFrom as number;
			let added = false;

			while (i < accumulated.length) {
				const start = accumulated.indexOf("{", i);
				if (start === -1) {
					ctx.store.scanFrom = accumulated.length;
					break;
				}
				let depth = 0;
				let end = -1;
				let inString = false;
				for (let j = start; j < accumulated.length; j++) {
					const ch = accumulated[j];
					if (inString) {
						if (ch === "\\" && j + 1 < accumulated.length) {
							j++; // skip escaped character
						} else if (ch === '"') {
							inString = false;
						}
					} else if (ch === '"') {
						inString = true;
					} else if (ch === "{") {
						depth++;
					} else if (ch === "}") {
						depth--;
						if (depth === 0) {
							end = j;
							break;
						}
					}
				}
				if (end === -1) {
					// Incomplete — resume brace-scanning from this open brace
					// next chunk. Do NOT advance past it.
					ctx.store.scanFrom = start;
					break;
				}
				const raw = accumulated.slice(start, end + 1);
				try {
					const parsed = JSON.parse(raw) as Record<string, unknown>;
					if (
						typeof parsed.name === "string" &&
						parsed.arguments != null &&
						typeof parsed.arguments === "object"
					) {
						calls.push({
							name: parsed.name,
							arguments: parsed.arguments as Record<string, unknown>,
							raw,
							startIndex: start,
						});
						added = true;
					}
				} catch {
					// Not valid JSON — skip
				}
				i = end + 1;
				ctx.store.scanFrom = i;
			}

			// Always return a fresh copy so downstream never holds a live
			// reference to ctx.store.calls.
			return added ? [...calls] : calls.slice();
		},
		{
			name: opts?.name ?? "tool-call-extractor",
			describeKind: "derived",
			initial: [],
			meta: aiMeta("tool_call_extractor"),
			equals: toolCallsEqual,
		},
	);
}
