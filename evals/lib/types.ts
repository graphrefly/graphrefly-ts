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
};
