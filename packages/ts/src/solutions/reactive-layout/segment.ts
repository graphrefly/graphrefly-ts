import type { SegmentAdapter, SegmentBreakKind, SegmentInfo } from "./types.js";

export const kinsokuStart = /* @__PURE__ */ new Set([
	"\u3001",
	"\u3002",
	"\u30FB",
	"\uFF09",
	"\u3015",
	"\u3009",
	"\u300B",
	"\u300D",
	"\u300F",
	"\u3011",
]);

export const leftStickyPunctuation = /* @__PURE__ */ new Set([
	".",
	",",
	"!",
	"?",
	":",
	";",
	")",
	"]",
	"}",
	"%",
	'"',
	"\u201D",
	"\u2019",
	"\xBB",
	"\u203A",
	"\u2026",
]);

export function isCJK(text: string): boolean {
	for (const ch of text) {
		const c = ch.codePointAt(0);
		if (
			(c !== undefined && c >= 19968 && c <= 40959) ||
			(c !== undefined && c >= 13312 && c <= 19903) ||
			(c !== undefined && c >= 12288 && c <= 12351) ||
			(c !== undefined && c >= 12352 && c <= 12447) ||
			(c !== undefined && c >= 44032 && c <= 55215) ||
			(c !== undefined && c >= 65280 && c <= 65519)
		) {
			return true;
		}
	}
	return false;
}

export function normalizeWhitespace(text: string): string {
	return text.replace(/[\t\f ]+/g, " ").replace(/^ | $/g, "");
}

export function segmentText(
	text: string,
	segmentAdapter: SegmentAdapter,
): {
	readonly texts: string[];
	readonly isWordLike: boolean[];
	readonly kinds: SegmentBreakKind[];
}[] {
	const pieces: {
		texts: string[];
		isWordLike: boolean[];
		kinds: SegmentBreakKind[];
	}[] = [];
	for (const s of segmentAdapter.segmentWords(text)) {
		const wordSegment = s.segment;
		const rawWordLike = s.isWordLike ?? false;
		const pieceTexts: string[] = [];
		const pieceWordLikes: boolean[] = [];
		const pieceKinds: SegmentBreakKind[] = [];
		let currentText = "";
		let currentKind: SegmentBreakKind | null = null;
		for (const ch of wordSegment) {
			let kind: SegmentBreakKind;
			if (ch === " ") {
				kind = "space";
			} else if (ch === "\u200B") {
				kind = "zero-width-break";
			} else if (ch === "\xAD") {
				kind = "soft-hyphen";
			} else if (ch === "\n") {
				kind = "hard-break";
			} else {
				kind = "text";
			}
			if (currentKind !== null && kind === currentKind) {
				currentText += ch;
			} else {
				if (currentKind !== null) {
					pieceTexts.push(currentText);
					pieceWordLikes.push(currentKind === "text" && rawWordLike);
					pieceKinds.push(currentKind);
				}
				currentText = ch;
				currentKind = kind;
			}
		}
		if (currentKind !== null) {
			pieceTexts.push(currentText);
			pieceWordLikes.push(currentKind === "text" && rawWordLike);
			pieceKinds.push(currentKind);
		}
		pieces.push({ texts: pieceTexts, isWordLike: pieceWordLikes, kinds: pieceKinds });
	}
	return pieces;
}

function* fallbackSegmentWords(text: string): Iterable<SegmentInfo> {
	let index = 0;
	let current = "";
	let currentIndex = 0;
	let currentWordLike: boolean | null = null;
	const flush = () => {
		if (current.length === 0 || currentWordLike === null) return undefined;
		const out = { segment: current, index: currentIndex, isWordLike: currentWordLike };
		current = "";
		currentWordLike = null;
		return out;
	};
	for (const ch of text) {
		const isWordLike = !/[\s\u200B\u00AD]/u.test(ch);
		if (currentWordLike !== null && currentWordLike !== isWordLike) {
			const out = flush();
			if (out) yield out;
		}
		if (currentWordLike === null) {
			currentWordLike = isWordLike;
			currentIndex = index;
		}
		current += ch;
		index += ch.length;
	}
	const out = flush();
	if (out) yield out;
}

function* fallbackSegmentGraphemes(text: string): Iterable<SegmentInfo> {
	let index = 0;
	for (const ch of text) {
		yield { segment: ch, index };
		index += ch.length;
	}
}

export function createDefaultSegmentAdapter(): SegmentAdapter {
	return {
		segmentWords(text: string): Iterable<SegmentInfo> {
			return fallbackSegmentWords(text);
		},
		segmentGraphemes(text: string): Iterable<SegmentInfo> {
			return fallbackSegmentGraphemes(text);
		},
	};
}

let defaultSegmentAdapter: SegmentAdapter | null = null;

export function getDefaultSegmentAdapter(): SegmentAdapter {
	if (defaultSegmentAdapter === null) {
		defaultSegmentAdapter = createDefaultSegmentAdapter();
	}
	return defaultSegmentAdapter;
}

export function measuredWidth(value: number | { readonly width: number }): number {
	const width = typeof value === "number" ? value : value.width;
	return Number.isFinite(width) && width >= 0 ? width : 0;
}

export function metricKey(text: string, font: string): string {
	return `${font}\0${text}`;
}
