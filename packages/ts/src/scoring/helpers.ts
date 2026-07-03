import { canonicalTupleKey } from "../identity.js";
import type {
	NormalizedScoreSignal,
	ScoreBreakdown,
	ScoredSubject,
	ScoredView,
	ScoreMissingBehavior,
	ScorePolicy,
	ScorePolicyDimension,
	ScoreRef,
	ScoreSignal,
	ScoreSubject,
	ScoreSubjectsOptions,
	ScoreTieBreaker,
	ScoringIssue,
	ScoringStatus,
} from "./types.js";

/** Returns true only for finite numeric score material. */
export function isFiniteScore(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normalizes a ScoreSignal for deterministic pure helpers.
 *
 * Non-finite value/confidence/weight or an empty dimension returns a DATA-style issue.
 */
export function normalizeScoreSignal(signal: ScoreSignal): NormalizedScoreSignal {
	if (!isFiniteScore(signal.value)) return invalidSignalResult(signal);
	const dimension = signal.dimension.trim();
	if (dimension.length === 0) return invalidSignalResult(signal);
	const confidence = signal.confidence ?? 1;
	const weight = signal.weight ?? 1;
	if (!isFiniteScore(confidence) || !isFiniteScore(weight)) return invalidSignalResult(signal);
	return Object.freeze({
		kind: "ok",
		value: Object.freeze({
			...signal,
			dimension,
			confidence,
			weight,
		}),
	});
}

/** Scores subjects from explicit ScoreSignal facts and ranks the resulting view (D573). */
export function scoreSubjects<T = unknown>(
	subjects: readonly ScoreSubject<T>[],
	signals: readonly ScoreSignal[],
	policy: ScorePolicy,
	opts: ScoreSubjectsOptions = {},
): ScoredView<T> {
	const issues: ScoringIssue[] = [];
	const usableSignals = normalizeSignals(signals, opts, issues);
	const signalsBySubject = groupSignalsBySubject(usableSignals);
	const scored = subjects.map((subject, index) =>
		scoreSubject(subject, index, signalsBySubject.get(subject.subjectId) ?? [], policy),
	);
	const ranked = rankScoredSubjects(scored, policy);
	const viewIssues = ranked.flatMap((subject) => subject.issues);
	const combinedIssues = Object.freeze([...issues, ...viewIssues]);
	const status = statusForView(ranked, combinedIssues);
	return Object.freeze({
		kind: "scored-view",
		policyId: policy.policyId,
		status,
		subjects: Object.freeze(ranked),
		issues: combinedIssues,
		cursor: Object.freeze({
			policyId: policy.policyId,
			subjectCount: subjects.length,
			signalCount: usableSignals.length,
		}),
		sourceRefs: mergeRefs(subjects.flatMap((subject) => subject.sourceRefs ?? [])),
		policyRefs: mergeRefs([
			...(policy.policyRefs ?? []),
			...policy.dimensions.flatMap((d) => d.policyRefs ?? []),
		]),
		...(policy.metadata === undefined ? {} : { metadata: policy.metadata }),
	} satisfies ScoredView<T>);
}

/** Ranks scored subjects by score desc, then policy tie-breakers, then stable order and subjectId. */
export function rankScoredSubjects<T = unknown>(
	scored: readonly ScoredSubject<T>[],
	policy?: Pick<ScorePolicy, "tieBreakers">,
): readonly ScoredSubject<T>[] {
	const indexed = scored.map((subject, index) => ({ subject, index }));
	indexed.sort((a, b) => {
		const scoreDelta = compareFiniteScoreDesc(a.subject.score, b.subject.score);
		if (scoreDelta !== 0) return scoreDelta;
		for (const tieBreaker of policy?.tieBreakers ?? []) {
			const delta = compareTieBreaker(a.subject, b.subject, a.index, b.index, tieBreaker);
			if (delta !== 0) return delta;
		}
		const orderDelta = originalOrder(a.subject, a.index) - originalOrder(b.subject, b.index);
		if (orderDelta !== 0) return orderDelta;
		return a.subject.subjectId.localeCompare(b.subject.subjectId);
	});
	return Object.freeze(
		indexed.map(({ subject }, index) =>
			Object.freeze({
				...subject,
				rank: index + 1,
			}),
		),
	);
}

function scoreSubject<T>(
	subject: ScoreSubject<T>,
	subjectOrder: number,
	signals: readonly ScoreSignal[],
	policy: ScorePolicy,
): ScoredSubject<T> {
	const dimensions = policy.dimensions;
	const breakdown: ScoreBreakdown[] = [];
	const issues: ScoringIssue[] = [];
	let weightedTotal = 0;
	let includedWeight = 0;

	for (const dimension of dimensions) {
		const dimensionWeight = finiteOrDefault(dimension.weight, 1);
		const dimensionSignals = signals.filter((signal) => signal.dimension === dimension.dimension);
		if (dimensionSignals.length === 0) {
			const missingBehavior = dimension.missing ?? policy.missing ?? "issue";
			const missing = missingBreakdown(dimension, dimensionWeight, missingBehavior);
			breakdown.push(missing);
			if (missing.included) {
				weightedTotal += missing.weightedScore;
				includedWeight += dimensionWeight;
			}
			if (missingBehavior === "issue") issues.push(missingScoreIssue(subject.subjectId, dimension));
			continue;
		}

		const score = dimensionSignals.reduce(
			(total, signal) =>
				total +
				signal.value * finiteOrDefault(signal.confidence, 1) * finiteOrDefault(signal.weight, 1),
			0,
		);
		const weightedScore = score * dimensionWeight;
		weightedTotal += weightedScore;
		includedWeight += dimensionWeight;
		breakdown.push(
			Object.freeze({
				dimension: dimension.dimension,
				score,
				weight: dimensionWeight,
				weightedScore,
				included: true,
				missing: false,
				signalCount: dimensionSignals.length,
				signalIds: signalIds(dimensionSignals),
				sourceRefs: mergeRefs([
					...(dimension.sourceRefs ?? []),
					...dimensionSignals.flatMap((signal) => signal.sourceRefs ?? []),
				]),
				policyRefs: mergeRefs([
					...(dimension.policyRefs ?? []),
					...dimensionSignals.flatMap((signal) => signal.policyRefs ?? []),
				]),
			} satisfies ScoreBreakdown),
		);
	}

	const score = includedWeight === 0 ? 0 : weightedTotal / includedWeight;
	const status: ScoringStatus =
		dimensions.length === 0 || includedWeight === 0
			? "empty"
			: issues.length > 0
				? "partial"
				: "ready";
	return Object.freeze({
		subject,
		subjectId: subject.subjectId,
		score,
		rank: subjectOrder + 1,
		status,
		breakdown: Object.freeze(breakdown),
		issues: Object.freeze(issues),
		sourceRefs: mergeRefs([
			...(subject.sourceRefs ?? []),
			...signals.flatMap((signal) => signal.sourceRefs ?? []),
		]),
		policyRefs: mergeRefs([
			...(policy.policyRefs ?? []),
			...policy.dimensions.flatMap((dimension) => dimension.policyRefs ?? []),
			...signals.flatMap((signal) => signal.policyRefs ?? []),
		]),
	} satisfies ScoredSubject<T>);
}

function normalizeSignals(
	signals: readonly ScoreSignal[],
	opts: ScoreSubjectsOptions,
	issues: ScoringIssue[],
): readonly ScoreSignal[] {
	const normalized: ScoreSignal[] = [];
	for (const signal of signals) {
		const clean = normalizeScoreSignal(signal);
		if (clean.kind === "error") {
			issues.push(clean.error);
			continue;
		}
		if (!isSignalValidAt(clean.value, opts.atMs)) continue;
		normalized.push(clean.value);
	}
	return normalized;
}

function groupSignalsBySubject(
	signals: readonly ScoreSignal[],
): ReadonlyMap<string, readonly ScoreSignal[]> {
	const grouped = new Map<string, ScoreSignal[]>();
	for (const signal of signals) {
		const bucket = grouped.get(signal.subjectId);
		if (bucket === undefined) grouped.set(signal.subjectId, [signal]);
		else bucket.push(signal);
	}
	return grouped;
}

function isSignalValidAt(signal: ScoreSignal, atMs: number | undefined): boolean {
	if (atMs === undefined) return true;
	if (signal.validFromMs !== undefined && signal.validFromMs > atMs) return false;
	if (signal.validToMs !== undefined && signal.validToMs <= atMs) return false;
	return true;
}

function missingBreakdown(
	dimension: ScorePolicyDimension,
	weight: number,
	missingBehavior: ScoreMissingBehavior,
): ScoreBreakdown {
	const included = missingBehavior === "zero";
	return Object.freeze({
		dimension: dimension.dimension,
		score: 0,
		weight,
		weightedScore: 0,
		included,
		missing: true,
		missingBehavior,
		signalCount: 0,
		sourceRefs: mergeRefs(dimension.sourceRefs ?? []),
		policyRefs: mergeRefs(dimension.policyRefs ?? []),
	});
}

function compareTieBreaker<T>(
	a: ScoredSubject<T>,
	b: ScoredSubject<T>,
	aIndex: number,
	bIndex: number,
	tieBreaker: ScoreTieBreaker,
): number {
	if (tieBreaker === "subjectOrder") return originalOrder(a, aIndex) - originalOrder(b, bIndex);
	if (tieBreaker === "subjectId") return a.subjectId.localeCompare(b.subjectId);
	if (tieBreaker.kind === "dimension") {
		const order = tieBreaker.order ?? "desc";
		const aScore = dimensionScore(a, tieBreaker.dimension);
		const bScore = dimensionScore(b, tieBreaker.dimension);
		const delta = aScore - bScore;
		return order === "asc" ? delta : -delta;
	}
	const order = tieBreaker.order ?? "asc";
	const aValue = comparableMetadataValue(a.subject.metadata?.[tieBreaker.key]);
	const bValue = comparableMetadataValue(b.subject.metadata?.[tieBreaker.key]);
	const delta = aValue.localeCompare(bValue);
	return order === "asc" ? delta : -delta;
}

function dimensionScore<T>(subject: ScoredSubject<T>, dimension: string): number {
	return subject.breakdown.find((entry) => entry.dimension === dimension)?.score ?? 0;
}

function comparableMetadataValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	return stableSafeStringify(value);
}

function originalOrder<T>(subject: ScoredSubject<T>, fallback: number): number {
	void subject;
	return fallback;
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
	return isFiniteScore(value) ? value : fallback;
}

function signalIds(signals: readonly ScoreSignal[]): readonly string[] | undefined {
	const ids = signals
		.map((signal) => signal.signalId)
		.filter((id): id is string => id !== undefined);
	return ids.length === 0 ? undefined : Object.freeze(ids);
}

function mergeRefs(refs: readonly ScoreRef[]): readonly ScoreRef[] | undefined {
	if (refs.length === 0) return undefined;
	const seen = new Set<string>();
	const out: ScoreRef[] = [];
	for (const ref of refs) {
		const key = canonicalTupleKey([ref.kind, ref.id, stableSafeStringify(ref.metadata ?? {})]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(ref);
	}
	return Object.freeze(out);
}

function compareFiniteScoreDesc(a: number, b: number): number {
	const aFinite = isFiniteScore(a);
	const bFinite = isFiniteScore(b);
	if (aFinite && bFinite) return b - a;
	if (aFinite) return -1;
	if (bFinite) return 1;
	return 0;
}

function stableSafeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(toStableJsonValue(value, seen)) ?? String(value);
}

function toStableJsonValue(value: unknown, seen: WeakSet<object>): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "undefined") return "[undefined]";
	if (typeof value === "function") return "[function]";
	if (typeof value === "symbol") return `[symbol:${value.description ?? ""}]`;
	if (typeof value !== "object") return String(value);
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	if (Array.isArray(value)) return value.map((entry) => toStableJsonValue(entry, seen));
	return Object.keys(value)
		.sort()
		.reduce<Record<string, unknown>>((record, key) => {
			record[key] = toStableJsonValue((value as Record<string, unknown>)[key], seen);
			return record;
		}, {});
}

function missingScoreIssue(subjectId: string, dimension: ScorePolicyDimension): ScoringIssue {
	return Object.freeze({
		kind: "issue",
		code: "score.missing",
		message: `Missing score for dimension '${dimension.dimension}'.`,
		severity: "warning",
		subjectId,
		refs: [dimension.dimension],
		source: "scoring",
	} satisfies ScoringIssue);
}

function invalidSignalIssue(signal: ScoreSignal): ScoringIssue {
	return Object.freeze({
		kind: "issue",
		code: "score.signal.invalid",
		message:
			"ScoreSignal must carry a finite value, finite weight/confidence, and non-empty dimension.",
		severity: "warning",
		subjectId: signal.subjectId,
		refs: [signal.dimension],
		source: "scoring",
	} satisfies ScoringIssue);
}

function invalidSignalResult(signal: ScoreSignal): NormalizedScoreSignal {
	const error = invalidSignalIssue(signal);
	return Object.freeze({
		kind: "error",
		error,
		issues: Object.freeze([error]),
	});
}

function statusForView<T>(
	subjects: readonly ScoredSubject<T>[],
	issues: readonly ScoringIssue[],
): ScoringStatus {
	if (subjects.length === 0) return "empty";
	if (issues.length > 0) return "partial";
	if (subjects.every((subject) => subject.status === "empty")) return "empty";
	return "ready";
}
