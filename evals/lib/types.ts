/**
 * Eval types — mirrors the JSON Schemas in the spec repo.
 * These are the TypeScript runtime representations.
 */

export type ProviderName = "anthropic" | "openai" | "google" | "ollama" | "openrouter" | "groq";

export function normalizeProviderName(raw?: string): ProviderName {
	switch ((raw ?? "").trim()) {
		case "anthropic":
		case "openai":
		case "google":
		case "ollama":
		case "openrouter":
		case "groq":
			return raw as ProviderName;
		case "local":
			return "ollama";
		default:
			return "anthropic";
	}
}

// --- Task types ---

export type TaskCategory =
	| "linear"
	| "fan-out"
	| "fan-in"
	| "diamond"
	| "feedback-loop"
	| "multi-source"
	| "ambiguous"
	| "stateful"
	| "error-handling"
	| "multi-step-effects";

export type Complexity = "low" | "medium" | "high";

export interface EvalTask {
	id: string;
	category: TaskCategory;
	nl_description: string;
	expected_node_count?: number;
	expected_node_names?: string[];
	complexity: Complexity;
	tags?: string[];
	contrastive?: {
		expected_function_count?: number;
		key_behaviors: string[];
	};
}

export interface ModificationTask {
	id: string;
	base_spec: Record<string, unknown>;
	nl_modification: string;
	expected_changes: {
		nodes_added: string[];
		nodes_removed: string[];
		nodes_modified: string[];
		description: string;
	};
}

export interface BugTask {
	id: string;
	category: string;
	description: string;
	graphspec_bug: {
		spec: Record<string, unknown>;
		bug_location: string;
		fix: string;
	};
	functions_bug: {
		code: string;
		bug_location: string;
		fix: string;
	};
	complexity: Complexity;
}

// --- Treatment types ---

export type Treatment = "graphspec" | "functions" | "single";

/**
 * Catalog-automation treatment progression (roadmap §9.1.2).
 *
 * - `A`: manual catalog string from `graphspec-treatment.md` (Run 4 baseline).
 * - `B`: auto-generated catalog prompt via `generateCatalogPrompt(portableCatalog)`.
 * - `C`: B + auto-refine on catalog validation errors (`maxAutoRefine: 2`).
 * - `D`: C + pre-built templates (`resilientFetch`, `adaptivePoller`) injected.
 */
export type CatalogTreatment = "A" | "B" | "C" | "D";

// --- Result types ---

export interface JudgeScore {
	claim: string;
	pass: boolean;
	reasoning: string;
}

export interface TaskResult {
	task_id: string;
	treatment: Treatment;
	raw_output: string;
	valid: boolean;
	runnable: boolean;
	judge_scores: JudgeScore[];
	latency_ms: number;
	token_count?: {
		input: number;
		output: number;
	};
	cost_usd?: number;
}

export type EvalLayer = "L0" | "L1" | "L2" | "L3";

export interface EvalRun {
	run_id: string;
	timestamp: string;
	layer: EvalLayer;
	model: string;
	provider: ProviderName;
	schema_version: string;
	scores: Record<string, number>;
	tasks: TaskResult[];
	total_cost_usd?: number;
	rate_limit_stats?: {
		total_retries: number;
		total_wait_ms: number;
		effective_rpm: number;
		effective_tpm: number;
	};
}

// --- Rubric types ---

export interface RubricAssertion {
	id: string;
	claim: string;
	weight: number;
	layer: EvalLayer;
	metric: string;
}

// --- Runner config ---

export interface EvalConfig {
	provider: ProviderName;
	model: string;
	judgeProvider: ProviderName;
	judgeModel: string;
	specEvalsPath: string;
	temperature: number;
	maxRetries: number;
	/**
	 * L0 contrastive only: run from this task id (inclusive). Mutually exclusive with `l0ResumeAfterTaskId`.
	 */
	l0FromTaskId?: string;
	/**
	 * L0 contrastive only: run tasks after this task id (exclusive). Mutually exclusive with `l0FromTaskId`.
	 */
	l0ResumeAfterTaskId?: string;
	/**
	 * Whether to enable adaptive rate limiting. Default: true.
	 * Disable with EVAL_RATE_LIMIT=false for local providers like Ollama.
	 */
	rateLimitEnabled: boolean;
	/**
	 * Catalog-automation treatment for L0 contrastive (roadmap §9.1.2).
	 * Default: `"A"` (manual catalog — Run 4 baseline).
	 * Set via `EVAL_TREATMENT=A|B|C|D`.
	 */
	catalogTreatment: CatalogTreatment;
	/**
	 * Stable run id for incremental / resume runs.
	 * When set via `EVAL_RUN_ID`, the runner reuses this id (instead of a fresh
	 * `l0-<Date.now()>`), and the writer **merges** the new tasks into the
	 * existing result file — dedupe by `task_id+treatment`, last write wins,
	 * scores recomputed over the merged set. Lets you split a single logical
	 * run across multiple invocations gated by `EVAL_MAX_CALLS` / `EVAL_L0_FROM`
	 * without losing earlier task results.
	 */
	runId?: string;
	/**
	 * Merged into OpenAI-compatible `chat.completions.create` requests (OpenRouter,
	 * Groq, Ollama OpenAI shim, OpenAI, etc.). Use for vendor extensions such as
	 * OpenRouter `provider` routing. Set via `EVAL_COMPAT_CHAT_EXTRA_JSON`.
	 * Ignored by Anthropic and Google providers.
	 */
	compatChatExtra?: Record<string, unknown>;
}

function normalizeCatalogTreatment(raw?: string): CatalogTreatment {
	const v = (raw ?? "").trim().toUpperCase();
	return v === "B" || v === "C" || v === "D" ? (v as CatalogTreatment) : "A";
}

/** Parse `EVAL_COMPAT_CHAT_EXTRA_JSON` — must be a JSON object when set. */
export function parseCompatChatExtraFromEnv(raw?: string): Record<string, unknown> | undefined {
	const s = raw?.trim();
	if (!s) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(s) as unknown;
	} catch (e) {
		throw new Error(
			`EVAL_COMPAT_CHAT_EXTRA_JSON must be valid JSON: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(
			"EVAL_COMPAT_CHAT_EXTRA_JSON must be a JSON object (not an array or primitive)",
		);
	}
	return parsed as Record<string, unknown>;
}

import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CONFIG: EvalConfig = {
	provider: normalizeProviderName(process.env.EVAL_PROVIDER),
	model: process.env.EVAL_MODEL ?? "claude-sonnet-4-6",
	judgeProvider: normalizeProviderName(process.env.EVAL_JUDGE_PROVIDER),
	judgeModel: process.env.EVAL_JUDGE_MODEL ?? "claude-sonnet-4-6",
	specEvalsPath: process.env.SPEC_EVALS_PATH ?? join(homedir(), "src", "graphrefly", "evals"),
	temperature: 0,
	maxRetries: 1,
	l0FromTaskId: process.env.EVAL_L0_FROM?.trim() || undefined,
	l0ResumeAfterTaskId: process.env.EVAL_L0_AFTER?.trim() || undefined,
	rateLimitEnabled: process.env.EVAL_RATE_LIMIT !== "false",
	catalogTreatment: normalizeCatalogTreatment(process.env.EVAL_TREATMENT),
	runId: process.env.EVAL_RUN_ID?.trim() || undefined,
	compatChatExtra: parseCompatChatExtraFromEnv(process.env.EVAL_COMPAT_CHAT_EXTRA_JSON),
};
