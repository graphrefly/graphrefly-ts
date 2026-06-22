/**
 * Hello-world wiring of `harnessLoop` + `refineExecutor` + `evalVerifier`.
 *
 * Scenario: the "artifact" under refinement is a plain catalog description
 * string. The evaluator checks whether a set of REQUIRED_KEYWORDS appears
 * in the description; each keyword is one dataset row. The strategy
 * iteratively appends the next missing keyword until every row scores 1.0.
 *
 * The harness:
 *  - Receives synthetic intake items (one per demo run).
 *  - Triages via `dryRunAdapter` with a canned classifier response.
 *  - EXECUTE: `refineExecutor` mounts a per-item refineLoop that runs the
 *    keyword-appender strategy until convergence (min-score 1.0) or budget.
 *  - VERIFY: `evalVerifier` re-runs the SAME evaluator against the
 *    executor's emitted artifact. Consistent scoring between stages.
 */

import type { Node } from "@graphrefly/graphrefly";
import { derived } from "@graphrefly/graphrefly";
import { dryRunAdapter } from "@graphrefly/graphrefly/patterns/ai";
import {
	evalVerifier,
	type HarnessGraph,
	harnessLoop,
	refineExecutor,
} from "@graphrefly/graphrefly/patterns/harness";
import type {
	DatasetItem,
	EvalResult,
	Evaluator,
	RefineStrategy,
} from "@graphrefly/graphrefly/patterns/refine-loop";

export const REQUIRED_KEYWORDS = ["reactive", "composable", "inspectable"] as const;

export const DATASET: readonly DatasetItem[] = REQUIRED_KEYWORDS.map((kw) => ({ id: kw }));

/**
 * Evaluator: score each required-keyword row as 1 iff the candidate
 * description contains that keyword (case-insensitive), 0 otherwise.
 * Shape matches `refineLoop`'s `Evaluator<T>` — both `candidates` and
 * `dataset` are reactive.
 */
export const keywordEvaluator: Evaluator<string> = (candidates, dataset) =>
	derived<readonly EvalResult[]>(
		[candidates as Node<unknown>, dataset as Node<unknown>],
		([cands, rows]) => {
			const cs = cands as readonly string[];
			const ds = rows as readonly DatasetItem[];
			const best = (cs[0] ?? "").toLowerCase();
			return ds.map((row) => ({
				taskId: row.id,
				score: best.includes(row.id.toLowerCase()) ? 1 : 0,
			}));
		},
		{ name: "keyword-evaluator" },
	);

/**
 * Strategy: append the first missing keyword each iteration. Async so
 * `pause()` / `setStrategy()` have a microtask window (see refineLoop
 * JSDoc — sync strategies drain the entire loop during activation).
 */
export const keywordAppender: RefineStrategy<string> = {
	name: "keyword-appender",
	seed: (s) => [s],
	analyze: (_scores, candidates) => {
		const best = (candidates[0] ?? "").toLowerCase();
		const missing = REQUIRED_KEYWORDS.filter((kw) => !best.includes(kw));
		const score = (REQUIRED_KEYWORDS.length - missing.length) / REQUIRED_KEYWORDS.length;
		return {
			summary:
				missing.length === 0
					? "all keywords present"
					: `${missing.length} missing: ${missing.join(", ")}`,
			score,
			weakTasks: [...missing],
		};
	},
	generate: async (feedback, prior) => {
		const missing = (feedback.weakTasks ?? []) as readonly string[];
		const base = prior[0] ?? "";
		if (missing.length === 0) {
			// Should not reach here — min-score convergence would have fired.
			return [`${base}`.trim()];
		}
		return [`${base} ${missing[0]}`.trim()];
	},
};

const TRIAGE_CANNED_RESPONSE = JSON.stringify({
	rootCause: "missing-fn",
	intervention: "template",
	route: "auto-fix",
	priority: 80,
	triageReasoning: "seed description missing required keywords",
});

export function helloHarness(): HarnessGraph {
	const adapter = dryRunAdapter({
		respond: () => TRIAGE_CANNED_RESPONSE,
	});

	return harnessLoop("hello-refine-harness", {
		adapter,
		executor: refineExecutor<string>({
			name: "refine-executor",
			seedFrom: () => "The GraphReFly protocol is a framework",
			datasetFor: () => DATASET,
			evaluator: keywordEvaluator,
			strategy: keywordAppender,
			refine: {
				minScore: 1.0,
				maxIterations: 8,
			},
		}),
		verifier: evalVerifier<string>({
			name: "eval-verifier",
			datasetFor: () => DATASET,
			evaluator: keywordEvaluator,
			threshold: 1.0,
		}),
	});
}
