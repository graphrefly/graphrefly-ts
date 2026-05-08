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
 * Tier 1.5.3 Phase 3: nodes use the unified shape — `meta.factory` /
 * `meta.factoryArgs` instead of legacy `fn` / `source` / `config`.
 *
 * See `evals/results/session-2026-04-06-catalog-automation.md` §1 for the
 * full motivation and `docs/roadmap.md` §9.1.2 (Treatment D prerequisites).
 */

import { factoryTag } from "../../packages/pure-ts/src/core/meta.js";
import type {
	GraphSpecFeedbackEdge,
	GraphSpecTemplate,
} from "../../packages/pure-ts/src/patterns/graphspec/index.js";

export const resilientFetchTemplate: GraphSpecTemplate = {
	params: ["$source"],
	nodes: {
		rateLimited: {
			type: "derived",
			deps: ["$source"],
			meta: { ...factoryTag("rateLimiter", { maxEvents: 5, windowMs: 1000 }) },
		},
		breaker: {
			type: "derived",
			deps: ["rateLimited"],
			meta: { ...factoryTag("circuitBreaker", { failureThreshold: 3, cooldownMs: 30000 }) },
		},
		retried: {
			type: "derived",
			deps: ["breaker"],
			meta: { ...factoryTag("retry", { maxAttempts: 3, backoff: "exponential" }) },
		},
		timed: {
			type: "derived",
			deps: ["retried"],
			meta: { ...factoryTag("timeout", { timeoutMs: 2000 }) },
		},
		cache: { type: "state", deps: [], value: null },
		withFallback: {
			type: "derived",
			deps: ["timed"],
			meta: { ...factoryTag("fallback", { fallbackSource: "cache" }) },
		},
		cacheUpdate: {
			type: "derived",
			deps: ["withFallback"],
			meta: { ...factoryTag("scan", { fn: "latest", initial: null }) },
		},
		status: {
			type: "derived",
			deps: ["withFallback"],
			meta: { ...factoryTag("withStatus", { initialStatus: "pending" }) },
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
		interval: { type: "state", deps: [], value: 10000 },
		timer: {
			type: "producer",
			deps: [],
			meta: { ...factoryTag("timer", { intervalMs: 10000 }) },
		},
		fetch: {
			type: "derived",
			deps: ["timer"],
			meta: { ...factoryTag("conditionalMap", { rules: [], default: null }) },
		},
		rateComputed: {
			type: "derived",
			deps: ["$rateComputer"],
			meta: { ...factoryTag("mapFields", {}) },
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
