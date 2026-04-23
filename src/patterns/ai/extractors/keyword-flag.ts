/**
 * Keyword-flag extractor — scans accumulated stream text for configured patterns.
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import type { TopicGraph } from "../../messaging/index.js";
import { aiMeta } from "../_internal.js";
import type { StreamChunk } from "../prompts/streaming.js";

/** A keyword match detected in the stream. */
export type KeywordFlag = {
	readonly label: string;
	readonly pattern: RegExp;
	readonly match: string;
	readonly position: number;
};

export type KeywordFlagExtractorOptions = {
	patterns: readonly { pattern: RegExp; label: string }[];
	name?: string;
	/**
	 * Maximum length of any pattern's literal text. Used as an overlap window
	 * when cursoring through the accumulated stream so matches that span
	 * chunk boundaries aren't missed. Default: 128.
	 */
	maxPatternLength?: number;
};

const keywordFlagsEqual = (
	a: readonly KeywordFlag[] | null,
	b: readonly KeywordFlag[] | null,
): boolean => {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (
			x.label !== y.label ||
			x.pattern !== y.pattern ||
			x.match !== y.match ||
			x.position !== y.position
		) {
			return false;
		}
	}
	return true;
};

/**
 * Mounts a keyword-flag extractor on a streaming topic. Scans accumulated text
 * for all configured patterns and emits an array of matches.
 *
 * Use cases: design invariant violations (`setTimeout`, `EventEmitter`), PII
 * detection (SSN, email, phone), toxicity keywords, off-track reasoning.
 *
 * **Streaming optimization.** Maintains a cursor across chunks in `ctx.store`
 * so each chunk scans only the delta region `accumulated.slice(scannedTo -
 * maxPatternLength)` — not the full string. Default structural equals
 * suppresses DATA emission when no new flags were found this chunk.
 */
export function keywordFlagExtractor(
	streamTopic: TopicGraph<StreamChunk>,
	opts: KeywordFlagExtractorOptions,
): Node<readonly KeywordFlag[]> {
	const maxPatternLength = opts.maxPatternLength ?? 128;
	return derived<readonly KeywordFlag[]>(
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk], ctx) => {
			if (chunk == null) return [];
			const accumulated = (chunk as StreamChunk).accumulated;

			if (!("flags" in ctx.store)) {
				ctx.store.flags = [] as KeywordFlag[];
				ctx.store.scannedTo = 0;
			}
			const flags = ctx.store.flags as KeywordFlag[];
			const scannedTo = ctx.store.scannedTo as number;

			// Scan the delta plus an overlap window so matches that span
			// chunk boundaries (e.g. "EventE" + "mitter") are still found.
			const startOffset = Math.max(0, scannedTo - maxPatternLength);
			const region = accumulated.slice(startOffset);
			let added = false;
			for (const { pattern, label } of opts.patterns) {
				const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
				for (const m of region.matchAll(re)) {
					const pos = startOffset + m.index!;
					// Skip matches that end inside the already-scanned prefix.
					if (pos + m[0].length <= scannedTo) continue;
					flags.push({ label, pattern, match: m[0], position: pos });
					added = true;
				}
			}
			ctx.store.scannedTo = accumulated.length;

			// Always return a fresh copy so downstream never holds a live
			// reference to ctx.store.flags. Structural equals suppresses the
			// emission when no new flag was added this chunk.
			return added ? [...flags] : flags.slice();
		},
		{
			name: opts.name ?? "keyword-flag-extractor",
			describeKind: "derived",
			initial: [],
			meta: aiMeta("keyword_flag_extractor"),
			equals: keywordFlagsEqual,
		},
	);
}
