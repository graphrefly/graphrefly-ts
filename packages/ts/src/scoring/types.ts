import type { DataIssue, DataResult } from "../data/index.js";

/** Graph-visible reference material carried by scoring facts (D573). */
export interface ScoreRef {
	readonly kind: string;
	readonly id: string;
	readonly metadata?: Record<string, unknown>;
}

/** A graph-visible subject that can be scored by explicit ScoreSignal facts (D573). */
export interface ScoreSubject<T = unknown> {
	readonly kind: "score-subject";
	readonly subjectId: string;
	readonly subjectKind: string;
	readonly value?: T;
	readonly sourceRefs?: readonly ScoreRef[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Explicit score DATA fact.
 *
 * Dimensions are open strings. This vocabulary owns no reviewer/outcome enum,
 * provider runtime, storage hydration, permission grant, or graph handle.
 */
export interface ScoreSignal {
	readonly kind: "score-signal";
	readonly signalId?: string;
	readonly subjectId: string;
	readonly dimension: string;
	readonly value: number;
	readonly confidence?: number;
	readonly weight?: number;
	readonly validFromMs?: number;
	readonly validToMs?: number;
	readonly sourceRefs?: readonly ScoreRef[];
	readonly policyRefs?: readonly ScoreRef[];
	readonly metadata?: Record<string, unknown>;
}

/** Missing explicit score handling is policy-owned, never implementation-defined (D573). */
export type ScoreMissingBehavior = "zero" | "ignore" | "issue";

export interface ScorePolicyDimension {
	readonly dimension: string;
	readonly weight?: number;
	readonly missing?: ScoreMissingBehavior;
	readonly sourceRefs?: readonly ScoreRef[];
	readonly policyRefs?: readonly ScoreRef[];
	readonly metadata?: Record<string, unknown>;
}

export type ScoreTieBreaker =
	| "subjectOrder"
	| "subjectId"
	| {
			readonly kind: "dimension";
			readonly dimension: string;
			readonly order?: "asc" | "desc";
	  }
	| {
			readonly kind: "metadata";
			readonly key: string;
			readonly order?: "asc" | "desc";
	  };

/** Explicit scoring policy fact/options for pure scoring projectors (D571/D573). */
export interface ScorePolicy {
	readonly kind: "score-policy";
	readonly policyId: string;
	readonly dimensions: readonly ScorePolicyDimension[];
	readonly missing?: ScoreMissingBehavior;
	readonly tieBreakers?: readonly ScoreTieBreaker[];
	readonly sourceRefs?: readonly ScoreRef[];
	readonly policyRefs?: readonly ScoreRef[];
	readonly metadata?: Record<string, unknown>;
}

export type ScoringStatus = "ready" | "partial" | "empty" | "issue";

export interface ScoringCursor {
	readonly subjectCount: number;
	readonly signalCount: number;
	readonly policyId: string;
}

export type ScoringIssue = DataIssue;

export interface ScoreBreakdown {
	readonly dimension: string;
	readonly score: number;
	readonly weight: number;
	readonly weightedScore: number;
	readonly included: boolean;
	readonly missing: boolean;
	readonly missingBehavior?: ScoreMissingBehavior;
	readonly signalCount: number;
	readonly signalIds?: readonly string[];
	readonly sourceRefs?: readonly ScoreRef[];
	readonly policyRefs?: readonly ScoreRef[];
}

export interface ScoredSubject<T = unknown> {
	readonly subject: ScoreSubject<T>;
	readonly subjectId: string;
	readonly score: number;
	readonly rank: number;
	readonly status: ScoringStatus;
	readonly breakdown: readonly ScoreBreakdown[];
	readonly issues: readonly ScoringIssue[];
	readonly sourceRefs?: readonly ScoreRef[];
	readonly policyRefs?: readonly ScoreRef[];
}

export interface ScoredView<T = unknown> {
	readonly kind: "scored-view";
	readonly policyId: string;
	readonly status: ScoringStatus;
	readonly subjects: readonly ScoredSubject<T>[];
	readonly issues: readonly ScoringIssue[];
	readonly cursor: ScoringCursor;
	readonly sourceRefs?: readonly ScoreRef[];
	readonly policyRefs?: readonly ScoreRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ScoreSubjectsOptions {
	readonly atMs?: number;
}

export type NormalizedScoreSignal = DataResult<ScoreSignal, ScoringIssue>;
