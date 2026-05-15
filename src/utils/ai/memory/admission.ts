// ---------------------------------------------------------------------------
// Admission scoring (generic + 3D sugar)
// ---------------------------------------------------------------------------
//
// `admissionScored<Dims>` is the generic primitive: a user-supplied scoreFn
// returns one number per named dimension; the filter rejects whenever any
// scored dimension falls below its configured threshold. Dimensions absent
// from the thresholds config are ignored — they may still be useful for
// telemetry, but don't gate admission.
//
// `admissionFilter3D` is a thin wrapper for the persistence / structure /
// personalValue triple borrowed from the LLM memory literature; ship this
// when callers want the named-axes shape, otherwise compose `admissionScored`
// directly with whatever dimensions fit the domain.
//
// The earlier `defaultAdmissionScorer` (always-0.5 across all dims) was
// retired in Unit 8 — it admitted everything in disguise. Callers must
// supply a real `scoreFn`.

/** Generic per-dimension thresholds. Any dim below its threshold → reject. */
export type AdmissionThresholds<Dims extends string> = Partial<Record<Dims, number>>;

export type AdmissionScoredOptions<Dims extends string, TRaw = unknown> = {
	/** Score function — must return a finite number for every dimension named in `thresholds`. */
	scoreFn: (raw: TRaw) => Readonly<Record<Dims, number>>;
	/** Per-dim minimums. Dims absent here are scored but not gated. */
	thresholds?: AdmissionThresholds<Dims>;
};

/**
 * Generic N-dimension admission filter. Rejects any input where one of the
 * configured threshold dimensions scores below its minimum. Missing scores
 * (`undefined` / `null`) AND non-finite values (`NaN`, `±Infinity`) are
 * treated as below all thresholds — reject by default rather than admit.
 *
 * @example
 * ```ts
 * const filter = admissionScored({
 *   scoreFn: (raw: Note) => ({ relevance: scoreRelevance(raw), age: ageScore(raw) }),
 *   thresholds: { relevance: 0.4 },  // age scored but ungated
 * });
 * ```
 */
export function admissionScored<Dims extends string, TRaw = unknown>(
	opts: AdmissionScoredOptions<Dims, TRaw>,
): (raw: TRaw) => boolean {
	const thresholds = opts.thresholds ?? ({} as AdmissionThresholds<Dims>);
	return (raw: TRaw): boolean => {
		const scores = opts.scoreFn(raw);
		for (const dim of Object.keys(thresholds) as Dims[]) {
			const min = thresholds[dim];
			if (min === undefined) continue;
			const s = scores[dim];
			// `??` falls back on null/undefined but lets NaN through; we want
			// non-finite to also reject so a buggy scoreFn returning NaN doesn't
			// silently admit. `Number.isFinite(NaN) === false`.
			const safe = Number.isFinite(s) ? (s as number) : Number.NEGATIVE_INFINITY;
			if (safe < min) return false;
		}
		return true;
	};
}

// ---------------------------------------------------------------------------
// 3D sugar
// ---------------------------------------------------------------------------

/** Scores for the three admission dimensions. Each 0–1. */
export type AdmissionScores = {
	readonly persistence: number;
	readonly structure: number;
	readonly personalValue: number;
};

export type AdmissionScore3DOptions = {
	/** Custom scoring function. Required — the previous always-0.5 default was misleading. */
	scoreFn: (raw: unknown) => AdmissionScores;
	/** Minimum persistence score to admit (default 0.3). */
	persistenceThreshold?: number;
	/** Minimum personalValue score to admit (default 0.3). */
	personalValueThreshold?: number;
	/** Require structure score > 0 to admit (default false). */
	requireStructured?: boolean;
};

/**
 * 3D admission sugar — the persistence / structure / personalValue triple
 * commonly used in agent-memory literature. Composes `admissionScored`
 * with thresholds derived from the option fields. Use directly when those
 * three named dimensions match your domain, or use `admissionScored` with
 * an arbitrary dimension set instead.
 *
 * `requireStructured: true` rejects entries where `structure <= 0` (matches
 * the pre-Unit-8 `requireStructured && scores.structure <= 0` check).
 * Implemented as a final-step predicate around `admissionScored` rather
 * than a `Number.MIN_VALUE` threshold, which would have been a footgun for
 * future readers.
 */
export function admissionFilter3D(opts: AdmissionScore3DOptions): (raw: unknown) => boolean {
	const thresholds: AdmissionThresholds<keyof AdmissionScores> = {
		persistence: opts.persistenceThreshold ?? 0.3,
		personalValue: opts.personalValueThreshold ?? 0.3,
	};
	const base = admissionScored<keyof AdmissionScores, unknown>({
		scoreFn: opts.scoreFn,
		thresholds,
	});
	if (!opts.requireStructured) return base;
	return (raw: unknown): boolean => {
		if (!base(raw)) return false;
		const s = opts.scoreFn(raw).structure;
		return Number.isFinite(s) && s > 0;
	};
}
