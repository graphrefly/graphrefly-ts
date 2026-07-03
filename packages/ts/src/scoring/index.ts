/**
 * Reusable scoring and ranking helpers (D571).
 *
 * This top-level family is deliberately independent from graph policies,
 * memory records, WorkItems, executors, providers, and storage.
 */

export {
	type AdmissionFilter,
	type AdmissionScore3DOptions,
	type AdmissionScoredOptions,
	type AdmissionScores,
	type AdmissionThresholds,
	admissionFilter3D,
	admissionScored,
	type CollectionEntry,
	type CollectionScoreFn,
	cosineSimilarity,
	type DecayPolicy,
	type OutcomeSignal,
	type RankedCollectionEntry,
	type RetrievalEntry,
	type RetrievalQuery,
	type RetrievalTrace,
	type ScoringPolicy,
	type VectorSearchResult,
} from "../patterns/semantic-memory.js";
export {
	isFiniteScore,
	normalizeScoreSignal,
	rankScoredSubjects,
	scoreSubjects,
} from "./helpers.js";
export type {
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
	ScoringCursor,
	ScoringIssue,
	ScoringStatus,
} from "./types.js";
