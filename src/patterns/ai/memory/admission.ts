// ---------------------------------------------------------------------------
// 3D Admission Scoring
// ---------------------------------------------------------------------------

/** Scores for the three admission dimensions. Each 0–1. */
export type AdmissionScores = {
	readonly persistence: number;
	readonly structure: number;
	readonly personalValue: number;
};

export type AdmissionScore3DOptions = {
	/** Custom scoring function. Default: rule-based (all dimensions 0.5). */
	scoreFn?: (raw: unknown) => AdmissionScores;
	/** Minimum persistence score to admit (default 0.3). */
	persistenceThreshold?: number;
	/** Minimum personalValue score to admit (default 0.3). */
	personalValueThreshold?: number;
	/** Require structure score > 0 to admit (default false). */
	requireStructured?: boolean;
};

/**
 * Default 3D admission scorer. Returns middle scores for all dimensions.
 * Override with `scoreFn` for LLM-backed or domain-specific scoring.
 */
function defaultAdmissionScorer(_raw: unknown): AdmissionScores {
	return { persistence: 0.5, structure: 0.5, personalValue: 0.5 };
}

/**
 * Creates a 3D admission filter function compatible with `agentMemory`'s
 * `admissionFilter` option. Scores each candidate on persistence, structure,
 * and personalValue, then applies thresholds.
 */
export function admissionFilter3D(opts: AdmissionScore3DOptions = {}): (raw: unknown) => boolean {
	const scoreFn = opts.scoreFn ?? defaultAdmissionScorer;
	const pThresh = opts.persistenceThreshold ?? 0.3;
	const pvThresh = opts.personalValueThreshold ?? 0.3;
	const reqStructured = opts.requireStructured ?? false;
	return (raw: unknown): boolean => {
		const scores = scoreFn(raw);
		if (scores.persistence < pThresh) return false;
		if (scores.personalValue < pvThresh) return false;
		if (reqStructured && scores.structure <= 0) return false;
		return true;
	};
}
