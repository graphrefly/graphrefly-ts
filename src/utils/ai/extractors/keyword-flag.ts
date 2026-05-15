/**
 * Keyword-flag extractor — scans accumulated stream text for configured patterns.
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core";
import { aiMeta } from "../_internal.js";

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
 * Mounts a keyword-flag extractor on accumulated text. Scans for all
 * configured patterns and emits an array of matches.
 *
 * **Wave A Unit 3 rewrite:** signature takes `accumulatedText: Node<string>`
 * instead of the old `TopicGraph<StreamChunk>`. Patterns are compiled once
 * at factory time (was per-chunk). `maxPatternLength` is validated at
 * factory time — any pattern whose source exceeds the window throws
 * immediately.
 *
 * Use cases: design invariant violations (`setTimeout`, `EventEmitter`), PII
 * detection (SSN, email, phone), toxicity keywords, off-track reasoning.
 *
 * **Streaming optimization.** Maintains a cursor across waves in `ctx.store`
 * so each emission scans only the delta region `accumulated.slice(scannedTo -
 * maxPatternLength)` — not the full string. Reactivation clears `ctx.store`
 * and resumes from offset 0 (COMPOSITION-GUIDE §20 RAM semantics).
 *
 * Default structural equals suppresses DATA emission when no new flags were
 * found this wave.
 */
export function keywordFlagExtractor(
	accumulatedText: Node<string>,
	opts: KeywordFlagExtractorOptions,
): Node<readonly KeywordFlag[]> {
	const maxPatternLength = opts.maxPatternLength ?? 128;
	// Factory-time: validate pattern literal lengths + compile once.
	for (const p of opts.patterns) {
		if (p.pattern.source.length > maxPatternLength) {
			throw new Error(
				`keywordFlagExtractor: pattern "${p.label}" literal exceeds maxPatternLength (${p.pattern.source.length} > ${maxPatternLength}); raise the option or shorten the pattern.`,
			);
		}
	}
	const compiled = opts.patterns.map((p) => ({
		label: p.label,
		pattern: p.pattern,
		compiled: new RegExp(p.pattern.source, `${p.pattern.flags.replace("g", "")}g`),
	}));
	// Lock 6.D (Phase 13.6.B): clear scan state on deactivation so a
	// resubscribed extractor doesn't carry over per-stream cursors.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<readonly KeywordFlag[]>(
		[accumulatedText],
		(batchData, actions, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.flags;
						delete store.scannedTo;
					},
				};
			}
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const text = data[0];
			if (text == null) {
				actions.emit([]);
				return cleanup;
			}
			const accumulated = text as string;

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
			for (const { pattern, label, compiled: re } of compiled) {
				re.lastIndex = 0;
				for (const m of region.matchAll(re)) {
					const pos = startOffset + (m.index ?? 0);
					if (pos + m[0].length <= scannedTo) continue;
					flags.push({ label, pattern, match: m[0], position: pos });
					added = true;
				}
			}
			ctx.store.scannedTo = accumulated.length;
			actions.emit(added ? [...flags] : flags.slice());
			return cleanup;
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
