// Deterministic fallback when Chrome Nano isn't available. Implements the same
// LLMAdapter contract so the chapter graph topology is identical — only the
// extraction quality differs.
//
// Strategy: a tiny dictionary of "interesting tokens" + a heuristic. When a
// paragraph mentions a known concept, emit it as an entity, then link
// neighbouring concepts via a guessed relation. Good enough to drive the
// reactive demo without any model.

import type { ChatMessage, LLMAdapter, LLMResponse } from "@graphrefly/graphrefly/patterns/ai";
import { ENTITY_KINDS } from "./extraction-schema.js";
import type { Entity, EntityKind, Relation } from "./types.js";

type Lex = { label: string; kind: EntityKind; aliases?: readonly string[] };

const LEXICON: readonly Lex[] = [
	{ label: "AI Harness Engineering", kind: "concept", aliases: ["harness engineering"] },
	{ label: "AI Alignment", kind: "concept", aliases: ["alignment"] },
	{ label: "Reward Hacking", kind: "risk" },
	{ label: "Emergent Behaviors", kind: "risk", aliases: ["emergent behavior"] },
	{ label: "Value Brittleness", kind: "risk" },
	{ label: "Planning", kind: "method", aliases: ["thinking corner"] },
	{ label: "Action", kind: "method", aliases: ["tool shed"] },
	{ label: "Reflection", kind: "method", aliases: ["magic mirror"] },
	{ label: "Memory", kind: "method", aliases: ["never-forget notebook"] },
	{ label: "Reward Engineering", kind: "method" },
	{ label: "Reward Shaping", kind: "method" },
	{ label: "Penalty Design", kind: "method" },
	{ label: "Constraints", kind: "method", aliases: ["guardrails"] },
	{ label: "Human-in-the-Loop", kind: "method", aliases: ["hitl"] },
	{ label: "Mechanistic Interpretability", kind: "method", aliases: ["interpretability"] },
	{ label: "Formal Verification", kind: "method" },
	{ label: "Red Teaming", kind: "method" },
	{ label: "Adversarial Robustness", kind: "method" },
	{ label: "AI Debate", kind: "method" },
	{ label: "Weak-to-Strong Generalization", kind: "method" },
	{ label: "Constitutional AI", kind: "method" },
	{ label: "Engineer", kind: "actor" },
	{ label: "Policymaker", kind: "actor" },
	{ label: "Business Leader", kind: "actor" },
	{ label: "Codebase Retrieval", kind: "method" },
	{ label: "Code Graph", kind: "concept" },
	{ label: "Commit Graph", kind: "concept" },
	{ label: "RepoWiki", kind: "concept" },
	{ label: "Vector Retrieval", kind: "method" },
	{ label: "Agentic Search", kind: "method" },
	{ label: "Engineering Knowledge Engine", kind: "concept" },
];

function slugify(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function findMatches(text: string): Entity[] {
	const lower = text.toLowerCase();
	const found: Entity[] = [];
	const seen = new Set<string>();
	for (const lex of LEXICON) {
		const candidates = [lex.label, ...(lex.aliases ?? [])];
		const hit = candidates.find((c) => lower.includes(c.toLowerCase()));
		if (!hit) continue;
		const id = slugify(lex.label);
		if (seen.has(id)) continue;
		seen.add(id);
		found.push({ id, label: lex.label, kind: lex.kind });
		if (found.length >= 6) break;
	}
	return found;
}

// Heuristic kind classifier for entities discovered by the generic extractor
// (i.e., not in LEXICON). Order matters — first match wins.
const KIND_PATTERNS: ReadonlyArray<{ kind: EntityKind; re: RegExp }> = [
	{ kind: "risk", re: /(risk|threat|hazard|danger|hacking|brittleness|failure|attack|bias)/i },
	{
		kind: "actor",
		re: /(engineer|leader|user|client|customer|admin|operator|researcher|policymaker|teacher|student|worker)/i,
	},
	{ kind: "metric", re: /(rate|score|percent|count|number|metric|kpi)/i },
	{
		kind: "method",
		re: /(method|technique|approach|framework|system|engine|tool|algorithm|protocol|process|model)/i,
	},
];

function classifyKind(label: string): EntityKind {
	for (const p of KIND_PATTERNS) if (p.re.test(label)) return p.kind;
	return "concept";
}

// Stop-words that show up in TitleCase headings/sentence-leads but aren't
// entities. Mostly: pronouns, discourse markers, articles, prepositions,
// short verbs, and Wikipedia-style page chrome ("Image", "See also").
const STOP_PHRASES = new Set([
	"The",
	"This",
	"These",
	"That",
	"Those",
	"Some",
	"Many",
	"Most",
	"Other",
	"Another",
	"However",
	"Therefore",
	"Although",
	"While",
	"When",
	"Where",
	"Why",
	"How",
	"What",
	"Who",
	"Which",
	"Such",
	"An",
	"A",
	"Its",
	"Their",
	"His",
	"Her",
	"Our",
	"My",
	"Your",
	"It",
	"They",
	"We",
	"You",
	"I",
	"For",
	"From",
	"With",
	"Without",
	"Into",
	"Onto",
	"Upon",
	"About",
	"Above",
	"Below",
	"After",
	"Before",
	"During",
	"Through",
	"Under",
	"Over",
	"Between",
	// Wikipedia / web-page chrome
	"Edit",
	"References",
	"See",
	"Also",
	"Notes",
	"Bibliography",
	"External",
	"Image",
	"Photo",
	"Figure",
	"Table",
	"Caption",
	"View",
	"Print",
	"Download",
	"Help",
	"Cite",
	"Source",
	"Note",
	"Search",
	"Toggle",
	"Skip",
	"Save",
	"Visit",
	"Learn",
	"Read",
	"Watch",
	"Listen",
	"Subscribe",
	"Follow",
	// Discourse markers / common short words that happen to start sentences
	"Yes",
	"No",
	"Ok",
	"Okay",
	"Sure",
	"True",
	"False",
	"Maybe",
	"Hello",
	"Welcome",
	"Goodbye",
	"Thanks",
	"Please",
	// Calendar / time
	"Today",
	"Tomorrow",
	"Yesterday",
	"Now",
	"Then",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
]);

// Comprehensive English stopword set — pronouns, articles, prepositions,
// conjunctions, modal verbs, common short verbs, discourse markers. Used to
// reject candidates BEFORE the noun-suffix / frequency tests run, so common
// non-nouns don't make it through. All entries are lowercased; Set dedupes.
const STOPWORDS = new Set<string>([
	// articles, determiners, pronouns
	"the",
	"this",
	"that",
	"these",
	"those",
	"some",
	"many",
	"most",
	"other",
	"another",
	"such",
	"any",
	"all",
	"each",
	"every",
	"either",
	"neither",
	"both",
	"few",
	"much",
	"more",
	"less",
	"least",
	"several",
	"own",
	"same",
	"its",
	"their",
	"his",
	"her",
	"our",
	"your",
	"they",
	"them",
	"you",
	"we",
	"us",
	"him",
	"she",
	"what",
	"which",
	"who",
	"whom",
	"whose",
	"there",
	"here",
	"where",
	"when",
	"why",
	"how",
	"ourselves",
	"themselves",
	// auxiliaries / modals
	"have",
	"has",
	"had",
	"having",
	"been",
	"being",
	"are",
	"were",
	"was",
	"will",
	"would",
	"could",
	"should",
	"shall",
	"may",
	"might",
	"must",
	"can",
	// prepositions / conjunctions
	"with",
	"without",
	"into",
	"onto",
	"upon",
	"about",
	"above",
	"below",
	"after",
	"before",
	"during",
	"through",
	"under",
	"over",
	"between",
	"among",
	"across",
	"against",
	"along",
	"around",
	"behind",
	"beside",
	"beyond",
	"from",
	"for",
	"and",
	"but",
	"nor",
	"yet",
	"or",
	"though",
	"although",
	"while",
	"because",
	"since",
	"until",
	"unless",
	"than",
	"then",
	"now",
	"ever",
	"never",
	"still",
	"only",
	"also",
	"even",
	"just",
	"too",
	"very",
	"quite",
	"rather",
	"perhaps",
	"maybe",
	"indeed",
	"however",
	"therefore",
	"moreover",
	"furthermore",
	"additionally",
	"instead",
	"likely",
	"unlikely",
	"almost",
	"nearly",
	"mostly",
	"often",
	"again",
	// common short verbs (low signal as nouns)
	"get",
	"gets",
	"got",
	"getting",
	"make",
	"makes",
	"made",
	"making",
	"take",
	"takes",
	"took",
	"taken",
	"taking",
	"give",
	"gives",
	"gave",
	"given",
	"giving",
	"see",
	"sees",
	"saw",
	"seen",
	"seeing",
	"find",
	"finds",
	"found",
	"finding",
	"know",
	"knows",
	"knew",
	"known",
	"knowing",
	"think",
	"thinks",
	"thought",
	"thinking",
	"come",
	"comes",
	"came",
	"coming",
	"want",
	"wants",
	"wanted",
	"wanting",
	"look",
	"looks",
	"looked",
	"looking",
	"use",
	"uses",
	"used",
	"using",
	"work",
	"works",
	"worked",
	"working",
	"call",
	"calls",
	"called",
	"calling",
	"try",
	"tries",
	"tried",
	"trying",
	"ask",
	"asks",
	"asked",
	"asking",
	"need",
	"needs",
	"needed",
	"feel",
	"feels",
	"felt",
	"feeling",
	"become",
	"becomes",
	"became",
	"becoming",
	"leave",
	"leaves",
	"left",
	"leaving",
	"mean",
	"means",
	"meant",
	"meaning",
	"keep",
	"keeps",
	"kept",
	"keeping",
	"begin",
	"begins",
	"began",
	"begun",
	"seem",
	"seems",
	"seemed",
	"help",
	"helps",
	"helped",
	"show",
	"shows",
	"showed",
	"shown",
	"showing",
	"hold",
	"holds",
	"held",
	"holding",
	"include",
	"includes",
	"included",
	"including",
	"continue",
	"continues",
	"continued",
	"continuing",
	"consider",
	"considers",
	"considered",
	"considering",
	"describe",
	"describes",
	"described",
	"describing",
	"appear",
	"appears",
	"appeared",
	"appearing",
	"based",
	"bases",
	"basing",
	// discourse / labels (also in STOP_PHRASES but mirrored here lowercased)
	"yes",
	"no",
	"okay",
	"sure",
	"true",
	"false",
	"maybe",
	"hello",
	"thanks",
	"please",
	"today",
	"tomorrow",
	"yesterday",
	"image",
	"edit",
	"view",
	"print",
	"note",
	"notes",
	"cite",
	"source",
	"sources",
	"figure",
	"table",
	"caption",
	"search",
	"toggle",
	"skip",
	"save",
	"learn",
	"watch",
	"listen",
	"follow",
	// common adjectives (not nouns)
	"new",
	"old",
	"first",
	"last",
	"next",
	"previous",
	"good",
	"bad",
	"big",
	"small",
	"large",
	"great",
	"little",
	"high",
	"low",
	"long",
	"short",
	"early",
	"late",
	"young",
	"real",
	"well",
	"open",
	"free",
	"full",
	"available",
	"different",
	"important",
	"common",
	"general",
	"specific",
	"natural",
	"social",
	"human",
	"modern",
	"current",
	"particular",
	"main",
	"recent",
	"various",
	"similar",
	"able",
]);

// Suffixes that strongly indicate a noun (not a verb / adjective / adverb).
// Avoid weak suffixes like -er / -or / -ar that match many non-nouns
// (under, over, never, after, danger, paper, water, etc.).
const NOUN_SUFFIXES: readonly string[] = [
	"tion",
	"tions",
	"sion",
	"sions",
	"ment",
	"ments",
	"ness",
	"nesses",
	"ity",
	"ities",
	"ism",
	"isms",
	"ance",
	"ances",
	"ence",
	"ences",
	"ship",
	"ships",
	"hood",
	"hoods",
	"ology",
	"ologies",
	"ologist",
	"ologists",
	"graphy",
	"graphies",
	"genesis",
	"icide",
	"cides",
	"ician",
	"icians",
	"ery",
	"eries",
	"acy",
	"acies",
];

function looksLikeNoun(lower: string): boolean {
	if (lower.length < 5) return false;
	for (const suf of NOUN_SUFFIXES) {
		if (lower.length > suf.length + 2 && lower.endsWith(suf)) return true;
	}
	return false;
}

/**
 * Generic fallback for content not covered by LEXICON. Three signals merged:
 *   1. Multi-word Title-Case phrases (high-precision proper-noun signal)
 *   2. Single Title-Case words ≥3 mentions (high-precision, e.g., "Wikipedia")
 *   3. Lowercase common nouns identified by noun-suffix heuristic OR
 *      ≥3-mention frequency outside the stopword set
 *
 * Tries to be honest about the kind classification and the label casing
 * (preserves the most-common original casing). Will produce false positives —
 * users should switch to Chrome Nano for real LLM-grade extraction.
 */
function findGenericMatches(text: string, maxEntities: number, exclude: Set<string>): Entity[] {
	// Strip markdown link syntax `[label](url)` → `label` so we don't extract
	// from URLs and we keep readable labels.
	const cleaned = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

	type Bucket = { count: number; samples: Map<string, number> };
	const phraseCount = new Map<string, number>(); // multi-word phrases (Title Case)
	const wordBuckets = new Map<string, Bucket>(); // lowercased word → bucket

	// Multi-word Title-Case phrases (2–4 words). Direct merge into output.
	const multiWordRe =
		/\b([A-Z][a-z]+(?:\s+(?:of|and|the|in|for|on|with)\s+[A-Z][a-z]+|\s+[A-Z][a-z]+){1,3})\b/g;
	for (const m of cleaned.matchAll(multiWordRe)) {
		const phrase = m[1]!.trim();
		const words = phrase.split(/\s+/);
		const realWords = words.filter((w) => !STOP_PHRASES.has(w));
		if (realWords.length < 2) continue;
		phraseCount.set(phrase, (phraseCount.get(phrase) ?? 0) + 1);
	}

	// Per-word counts (any case). Preserves observed casings so we can pick a
	// representative label later (e.g., always emit "Habitat" if the source
	// uses both "habitat" and "Habitat").
	for (const wordMatch of cleaned.matchAll(/\b[a-zA-Z][a-zA-Z'-]+\b/g)) {
		const w = wordMatch[0];
		if (w.length < 4) continue;
		const key = w.toLowerCase();
		if (STOPWORDS.has(key)) continue;
		if (STOP_PHRASES.has(w)) continue;
		const bucket = wordBuckets.get(key) ?? { count: 0, samples: new Map() };
		bucket.count += 1;
		bucket.samples.set(w, (bucket.samples.get(w) ?? 0) + 1);
		wordBuckets.set(key, bucket);
	}

	// Decide which singleton words to keep. A word qualifies if EITHER:
	//   (a) it has a strong noun suffix AND appears ≥2 times; OR
	//   (b) it appears ≥3 times AND is not in stopwords (already filtered).
	// In addition, it must not already be part of a multi-word phrase, and
	// must not be an obvious pronoun-like fragment.
	const phraseTokens = new Set<string>();
	for (const p of phraseCount.keys()) {
		for (const tok of p.split(/\s+/)) phraseTokens.add(tok.toLowerCase());
	}

	const singletons: Array<{ label: string; count: number; isProper: boolean }> = [];
	for (const [key, bucket] of wordBuckets) {
		if (phraseTokens.has(key)) continue;
		const isNounLike = looksLikeNoun(key);
		const sufficientFrequency = bucket.count >= 3;
		if (!isNounLike && !sufficientFrequency) continue;
		// Pick the most-frequent observed casing as label.
		const label = [...bucket.samples.entries()].sort((a, b) => b[1] - a[1])[0]![0];
		const isProper = /^[A-Z]/.test(label);
		// Reject lowercase singletons that don't look like nouns (defensive).
		if (!isProper && !isNounLike) continue;
		singletons.push({ label, count: bucket.count, isProper });
	}

	// Score: multi-word phrases first (highest precision), then proper-noun
	// singletons by count, then suffix-noun singletons by count. Within each
	// group, longer labels rank higher (more specific).
	const multiEntries: Array<{ label: string; count: number; rank: number }> = [];
	for (const [label, count] of phraseCount) {
		multiEntries.push({ label, count, rank: 1000 + count });
	}
	const singleEntries = singletons.map((s) => ({
		label: s.label,
		count: s.count,
		rank: (s.isProper ? 500 : 0) + s.count,
	}));

	const ranked = [...multiEntries, ...singleEntries]
		.filter(({ label }) => !exclude.has(slugify(label)))
		.sort((a, b) => b.rank - a.rank || b.label.length - a.label.length)
		.slice(0, maxEntities);

	return ranked.map(({ label }) => ({
		id: slugify(label),
		label: label.length > 50 ? `${label.slice(0, 49)}…` : label,
		kind: classifyKind(label),
	}));
}

// Hand-coded relations for known pairs in the bundled paper. Lookup happens
// before the generic inferRelation fallback so the demo shows semantically
// meaningful labels rather than monotone "is_a" chains. Direction matters:
// from → to. When the two entities both appear in a paragraph, we emit the
// edge in this exact direction.
const KNOWN_RELATIONS: ReadonlyArray<{ from: string; to: string; relation: Relation }> = [
	{ from: "hitl", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "constraints", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "reward-engineering", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "mechanistic-interpretability", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "red-teaming", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "adversarial-robustness", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "formal-verification", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "ai-debate", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "weak-to-strong-generalization", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "constitutional-ai", to: "ai-harness-engineering", relation: "part_of" },
	{ from: "ai-harness-engineering", to: "ai-alignment", relation: "addresses" },
	{ from: "hitl", to: "value-brittleness", relation: "addresses" },
	{ from: "constraints", to: "reward-hacking", relation: "addresses" },
	{ from: "reward-shaping", to: "reward-engineering", relation: "part_of" },
	{ from: "penalty-design", to: "reward-engineering", relation: "part_of" },
	{ from: "planning", to: "action", relation: "causes" },
	{ from: "action", to: "reflection", relation: "causes" },
	{ from: "reflection", to: "memory", relation: "causes" },
	{ from: "memory", to: "planning", relation: "uses" },
	{ from: "reward-hacking", to: "ai-alignment", relation: "contrasts_with" },
	{ from: "value-brittleness", to: "ai-alignment", relation: "contrasts_with" },
	{ from: "emergent-behaviors", to: "ai-alignment", relation: "contrasts_with" },
	{ from: "engineer", to: "ai-harness-engineering", relation: "uses" },
	{ from: "policymaker", to: "constraints", relation: "uses" },
	{ from: "business-leader", to: "ai-harness-engineering", relation: "uses" },
];

function inferRelation(a: Entity, b: Entity): Relation {
	const k = `${a.kind}->${b.kind}`;
	switch (k) {
		case "risk->method":
		case "method->risk":
			return "addresses";
		case "method->concept":
			return "part_of";
		case "concept->method":
			return "uses";
		case "concept->concept":
			return "is_a";
		case "risk->risk":
			return "causes";
		case "method->method":
			return "uses";
		case "actor->method":
		case "actor->concept":
		case "actor->risk":
			return "uses";
		case "concept->risk":
		case "method->actor":
			return "addresses";
		default:
			return "part_of";
	}
}

function extractFromParagraph(paragraph: string) {
	const lex = findMatches(paragraph);
	const exclude = new Set(lex.map((e) => e.id));
	// Top up with generic capitalized-phrase matches when the lexicon misses
	// (e.g., user pasted a Wikipedia article on something outside the
	// harness-engineering domain). Aim for ~6 entities total.
	const remaining = Math.max(0, 6 - lex.length);
	const generic = remaining > 0 ? findGenericMatches(paragraph, remaining, exclude) : [];
	const entities = [...lex, ...generic];
	const ids = new Set(entities.map((e) => e.id));
	const relations: Array<{ from: string; to: string; relation: Relation }> = [];
	const seen = new Set<string>();

	// 1. First, emit any KNOWN_RELATIONS whose both endpoints are present in
	//    this paragraph. These carry hand-vetted direction and label.
	for (const k of KNOWN_RELATIONS) {
		if (!ids.has(k.from) || !ids.has(k.to)) continue;
		const key = `${k.from}\u0000${k.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		relations.push(k);
	}

	// 2. Then chain any consecutive matches that didn't get a known edge.
	//    Direction follows the kind matrix: risks point at the methods that
	//    address them, actors point at what they use, etc.
	for (let i = 0; i < entities.length - 1; i += 1) {
		const a = entities[i]!;
		const b = entities[i + 1]!;
		const [from, to] =
			a.kind === "risk" && b.kind !== "risk"
				? [b, a]
				: a.kind === "actor"
					? [a, b]
					: b.kind === "actor"
						? [b, a]
						: [a, b];
		const key = `${from.id}\u0000${to.id}`;
		const reverseKey = `${to.id}\u0000${from.id}`;
		if (seen.has(key) || seen.has(reverseKey)) continue;
		seen.add(key);
		relations.push({ from: from.id, to: to.id, relation: inferRelation(from, to) });
	}
	return { entities, relations };
}

export function mockExtractAdapter(): LLMAdapter {
	return {
		invoke(messages: readonly ChatMessage[]) {
			return (async (): Promise<LLMResponse> => {
				const userMsg = messages.findLast((m) => m.role === "user");
				const paragraph = userMsg?.content ?? "";
				const result = extractFromParagraph(paragraph);
				// Validate that each kind is in ENTITY_KINDS — if not, drop. (No-op
				// today, but keeps the adapter honest if LEXICON gains a typo.)
				const entities = result.entities.filter((e) => ENTITY_KINDS.includes(e.kind));
				return {
					content: JSON.stringify({ entities, relations: result.relations }),
					finishReason: "stop",
				};
			})() as unknown as ReturnType<LLMAdapter["invoke"]>;
		},
		stream(): AsyncIterable<string> {
			return {
				[Symbol.asyncIterator]() {
					return {
						next() {
							return Promise.reject(
								new Error("mockExtractAdapter.stream is not implemented for this demo"),
							);
						},
					};
				},
			};
		},
	};
}
