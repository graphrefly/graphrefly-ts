/**
 * Treatment-D templates — pre-built GraphSpec template fragments shipped to
 * close architectural gaps the LLM gets wrong unaided (Run 4 analysis).
 *
 * - `resilientFetch`: correct resilience nesting (rateLimiter → breaker →
 *   retry → timeout → fallback → cache feedback → status). Closes T5/T8a/T8b.
 * - `adaptivePoller`: switchMap-based dynamic interval + feedback edge to
 *   interval state. Closes T6 producer-can't-read-state gap.
 *
 * These are GraphSpec template definitions — they go into `spec.templates`
 * for the LLM to reference via `{ type: "template", template: "...", bind }`.
 *
 * See `evals/results/session-2026-04-06-catalog-automation.md` §1 for the
 * full motivation and `docs/roadmap.md` §9.1.2 (Treatment D prerequisites).
 */

import type {
	GraphSpecFeedbackEdge,
	GraphSpecTemplate,
} from "../../src/patterns/graphspec/index.js";

export const resilientFetchTemplate: GraphSpecTemplate = {
	params: ["$source"],
	nodes: {
		rateLimited: {
			type: "derived",
			deps: ["$source"],
			fn: "rateLimiter",
			config: { maxEvents: 5, windowMs: 1000 },
		},
		breaker: {
			type: "derived",
			deps: ["rateLimited"],
			fn: "circuitBreaker",
			config: { failureThreshold: 3, cooldownMs: 30000 },
		},
		retried: {
			type: "derived",
			deps: ["breaker"],
			fn: "retry",
			config: { maxAttempts: 3, backoff: "exponential" },
		},
		timed: {
			type: "derived",
			deps: ["retried"],
			fn: "timeout",
			config: { timeoutMs: 2000 },
		},
		cache: { type: "state", initial: null },
		withFallback: {
			type: "derived",
			deps: ["timed"],
			fn: "fallback",
			config: { fallbackSource: "cache" },
		},
		cacheUpdate: {
			type: "derived",
			deps: ["withFallback"],
			fn: "scan",
			config: { fn: "latest", initial: null },
		},
		status: {
			type: "derived",
			deps: ["withFallback"],
			fn: "withStatus",
			config: { initialStatus: "pending" },
		},
	},
	output: "status",
};

/** Feedback edge required when instantiating `resilientFetch`. */
export const resilientFetchFeedback = (instanceName: string): GraphSpecFeedbackEdge => ({
	from: `${instanceName}::cacheUpdate`,
	to: `${instanceName}::cache`,
	maxIterations: 1,
});

export const adaptivePollerTemplate: GraphSpecTemplate = {
	params: ["$rateComputer"],
	nodes: {
		interval: { type: "state", initial: 10000 },
		timer: {
			type: "producer",
			source: "timer",
			config: { intervalMs: 10000 },
		},
		fetch: {
			type: "derived",
			deps: ["timer"],
			fn: "conditionalMap",
			config: { rules: [], default: null },
		},
		rateComputed: {
			type: "derived",
			deps: ["$rateComputer"],
			fn: "mapFields",
			config: {},
		},
	},
	output: "fetch",
};

/** Feedback edge required when instantiating `adaptivePoller`. */
export const adaptivePollerFeedback = (instanceName: string): GraphSpecFeedbackEdge => ({
	from: `${instanceName}::rateComputed`,
	to: `${instanceName}::interval`,
	maxIterations: 1,
});

/**
 * The full set of Treatment-D templates, keyed by template name.
 * Spread into `spec.templates` to make them available to the LLM.
 */
export const portableTemplates: Record<string, GraphSpecTemplate> = {
	resilientFetch: resilientFetchTemplate,
	adaptivePoller: adaptivePollerTemplate,
};

/**
 * Human-readable summaries shown in the Treatment-D prompt so the LLM knows
 * when to reach for each template. Keep these short — they're inlined.
 */
export const portableTemplateDescriptions: Record<string, string> = {
	resilientFetch:
		"Wraps a single source with the canonical resilience stack (rateLimiter → circuitBreaker → retry → timeout → fallback → cache feedback → status). Use for any 'call API with retry/cache/breaker' task. Bind: $source. Output: status node. Requires a feedback edge from `<instance>::cacheUpdate` to `<instance>::cache` with maxIterations 1.",
	adaptivePoller:
		"Polls on a timer whose interval is a state node updated by a rate computer. Use for any 'poll faster when busy, slower when idle' task. Bind: $rateComputer. Output: fetch node. Requires a feedback edge from `<instance>::rateComputed` to `<instance>::interval` with maxIterations 1.",
};
