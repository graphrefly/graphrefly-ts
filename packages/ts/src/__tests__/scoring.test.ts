import { describe, expect, it } from "vitest";
import {
	normalizeScoreSignal,
	rankScoredSubjects,
	type ScorePolicy,
	type ScoreSignal,
	type ScoreSubject,
	scoreSubjects,
} from "../scoring/index.js";

const subjects: readonly ScoreSubject[] = [
	{ kind: "score-subject", subjectKind: "memory-fragment", subjectId: "b" },
	{ kind: "score-subject", subjectKind: "memory-fragment", subjectId: "a" },
	{ kind: "score-subject", subjectKind: "memory-fragment", subjectId: "c" },
];

const policy = {
	kind: "score-policy",
	policyId: "rank-context",
	dimensions: [
		{ dimension: "relevance", weight: 2, policyRefs: [{ kind: "policy", id: "p:relevance" }] },
		{ dimension: "recency", weight: 1 },
	],
	missing: "issue",
	policyRefs: [{ kind: "policy", id: "p:root" }],
} satisfies ScorePolicy;

describe("D573 scoring primitives", () => {
	it("scores and ranks explicit score DATA facts deterministically", () => {
		const view = scoreSubjects(
			subjects,
			[
				signal("a", "relevance", 2),
				signal("a", "recency", 1),
				signal("b", "relevance", 2),
				signal("b", "recency", 1),
				signal("c", "relevance", 1),
				signal("c", "recency", 4),
			],
			{
				...policy,
				tieBreakers: [{ kind: "dimension", dimension: "recency", order: "desc" }],
			},
		);

		expect(view.kind).toBe("scored-view");
		expect(view.status).toBe("ready");
		expect(
			view.subjects.map((subject) => [subject.subjectId, subject.rank, subject.score]),
		).toEqual([
			["c", 1, 2],
			["b", 2, 5 / 3],
			["a", 3, 5 / 3],
		]);
	});

	it("falls back to stable subject order and subjectId when policy tie-breakers are absent", () => {
		const ranked = rankScoredSubjects([scored("b", 1), scored("a", 1), scored("c", 1)]);

		expect(ranked.map((subject) => [subject.subjectId, subject.rank])).toEqual([
			["b", 1],
			["a", 2],
			["c", 3],
		]);

		const equalAfterReverse = rankScoredSubjects([scored("c", 1), scored("a", 1), scored("b", 1)]);
		expect(equalAfterReverse.map((subject) => subject.subjectId)).toEqual(["c", "a", "b"]);
	});

	it("makes missing score behavior explicit: zero, ignore, or issue", () => {
		const zero = scoreSubjects([subjects[0]], [signal("b", "relevance", 3)], {
			...policy,
			missing: "zero",
		});
		expect(zero.status).toBe("ready");
		expect(zero.subjects[0]?.score).toBe(2);
		expect(
			zero.subjects[0]?.breakdown.find((entry) => entry.dimension === "recency"),
		).toMatchObject({
			included: true,
			missing: true,
			missingBehavior: "zero",
		});

		const ignore = scoreSubjects([subjects[0]], [signal("b", "relevance", 3)], {
			...policy,
			missing: "ignore",
		});
		expect(ignore.status).toBe("ready");
		expect(ignore.subjects[0]?.score).toBe(3);
		expect(
			ignore.subjects[0]?.breakdown.find((entry) => entry.dimension === "recency"),
		).toMatchObject({
			included: false,
			missing: true,
			missingBehavior: "ignore",
		});

		const issue = scoreSubjects([subjects[0]], [signal("b", "relevance", 3)], policy);
		expect(issue.status).toBe("partial");
		expect(issue.subjects[0]?.status).toBe("partial");
		expect(issue.issues).toMatchObject([
			{
				kind: "issue",
				code: "score.missing",
				subjectId: "b",
			},
		]);
	});

	it("applies signal confidence and weight while preserving sourceRefs and policyRefs", () => {
		const view = scoreSubjects(
			[
				{
					kind: "score-subject",
					subjectKind: "work-item",
					subjectId: "wi:1",
					sourceRefs: [{ kind: "work-item", id: "wi:1" }],
				},
			],
			[
				{
					kind: "score-signal",
					signalId: "sig:1",
					subjectId: "wi:1",
					dimension: "review-confidence",
					value: 10,
					confidence: 0.5,
					weight: 0.25,
					sourceRefs: [{ kind: "review", id: "rev:1" }],
					policyRefs: [{ kind: "policy", id: "review-map" }],
				},
			],
			{
				kind: "score-policy",
				policyId: "review-score",
				dimensions: [{ dimension: "review-confidence", weight: 2 }],
				policyRefs: [{ kind: "policy", id: "review-score" }],
			},
		);

		const scoredSubject = view.subjects[0];
		expect(scoredSubject?.score).toBe(1.25);
		expect(scoredSubject?.breakdown[0]).toMatchObject({
			dimension: "review-confidence",
			score: 1.25,
			weightedScore: 2.5,
			signalIds: ["sig:1"],
			sourceRefs: [{ kind: "review", id: "rev:1" }],
			policyRefs: [{ kind: "policy", id: "review-map" }],
		});
		expect(scoredSubject?.sourceRefs).toEqual([
			{ kind: "work-item", id: "wi:1" },
			{ kind: "review", id: "rev:1" },
		]);
	});

	it("normalizes explicit score signals into DataResult issues instead of hidden drops", () => {
		expect(normalizeScoreSignal(signal("a", " outcome ", 1))).toMatchObject({
			kind: "ok",
			value: {
				dimension: "outcome",
				confidence: 1,
				weight: 1,
			},
		});

		expect(
			normalizeScoreSignal({
				kind: "score-signal",
				subjectId: "a",
				dimension: "outcome",
				value: Number.NaN,
			}),
		).toMatchObject({
			kind: "error",
			error: {
				code: "score.signal.invalid",
				subjectId: "a",
			},
		});
	});

	it("surfaces invalid signal issues in the scored view status", () => {
		const view = scoreSubjects(
			[subjects[0]],
			[
				{
					kind: "score-signal",
					subjectId: "b",
					dimension: "relevance",
					value: Number.NaN,
				},
			],
			{ ...policy, missing: "ignore" },
		);

		expect(view.status).toBe("partial");
		expect(view.issues).toMatchObject([
			{
				code: "score.signal.invalid",
				subjectId: "b",
			},
		]);
	});

	it("keeps public ranking deterministic for non-finite scores", () => {
		const ranked = rankScoredSubjects([scored("b", Number.NaN), scored("a", 2), scored("c", 2)]);
		expect(ranked.map((subject) => [subject.subjectId, subject.rank])).toEqual([
			["a", 1],
			["c", 2],
			["b", 3],
		]);
	});

	it("ignores signals outside their explicit validity window", () => {
		const view = scoreSubjects(
			[subjects[0]],
			[
				{
					...signal("b", "relevance", 3),
					validFromMs: 100,
					validToMs: 200,
				},
			],
			{ ...policy, missing: "zero" },
			{ atMs: 250 },
		);

		expect(view.cursor.signalCount).toBe(0);
		expect(view.subjects[0]?.score).toBe(0);
	});
});

function signal(subjectId: string, dimension: string, value: number): ScoreSignal {
	return {
		kind: "score-signal",
		subjectId,
		dimension,
		value,
	};
}

function scored(subjectId: string, score: number) {
	return {
		subject: { kind: "score-subject", subjectKind: "test", subjectId },
		subjectId,
		score,
		rank: 0,
		status: "ready",
		breakdown: [],
		issues: [],
	} as const;
}
