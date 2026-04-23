/**
 * Runtime validator — uses graphrefly-ts APIs for real validation and execution.
 *
 * Structure validation delegates to the real `validateSpec()` from graphspec.ts.
 * Execution validation uses `compileSpec()` to actually instantiate the graph.
 */

import {
	compileSpec,
	type GraphSpec,
	type GraphSpecValidation,
	validateSpec as realValidateSpec,
} from "../../src/patterns/graphspec/index.js";

export type { GraphSpecValidation as ValidationResult };

export interface ExecutionResult {
	runnable: boolean;
	error?: string;
}

/**
 * Validate a GraphSpec JSON object against the real schema.
 *
 * Delegates to `src/patterns/graphspec.ts → validateSpec()`.
 */
export function validateSpec(spec: unknown): GraphSpecValidation {
	return realValidateSpec(spec);
}

/**
 * Attempt to compile a GraphSpec into a live Graph.
 *
 * Uses `compileSpec()` — catches instantiation errors (missing catalog entries,
 * unresolvable deps, etc.) and reports them.
 */
export function executeSpec(spec: unknown): ExecutionResult {
	const validation = validateSpec(spec);
	if (!validation.valid) {
		return { runnable: false, error: validation.errors.join("; ") };
	}

	try {
		// compileSpec will throw on catalog misses, dep resolution failures, etc.
		// We pass no catalog — this tests structural compilability, not runtime behavior.
		const graph = compileSpec(spec as GraphSpec);
		graph.destroy();
		return { runnable: true };
	} catch (err) {
		return {
			runnable: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
