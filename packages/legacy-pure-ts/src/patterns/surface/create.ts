/**
 * Surface: create a graph from a {@link GraphSpec} (§9.3-core).
 *
 * Thin wrapper over {@link compileSpec} that converts the two failure modes
 * ({@link validateSpec} structural errors, and catalog-aware validation
 * errors) into typed {@link SurfaceError} throws. Consumers are MCP/CLI
 * wrappers, not end-user graph code — those should import `compileSpec`
 * directly.
 *
 * @module
 */

import type { Graph } from "../../graph/graph.js";
import type { CompileSpecOptions, GraphSpec } from "../graphspec/index.js";
import { compileSpec, validateSpec, validateSpecAgainstCatalog } from "../graphspec/index.js";
import { SurfaceError } from "./errors.js";

/** Options for {@link createGraph}. Same shape as {@link CompileSpecOptions}. */
export type CreateGraphOptions = CompileSpecOptions;

/**
 * Build a {@link Graph} from a parsed {@link GraphSpec} with surface-layer
 * error typing.
 *
 * @throws {SurfaceError} `invalid-spec` for structural errors;
 *   `catalog-error` when fn/source names or config don't match the catalog.
 */
export function createGraph(spec: GraphSpec, opts?: CreateGraphOptions): Graph {
	const structural = validateSpec(spec);
	if (!structural.valid) {
		throw new SurfaceError(
			"invalid-spec",
			`GraphSpec validation failed:\n${structural.errors.join("\n")}`,
			{ errors: structural.errors },
		);
	}
	const catalog = opts?.catalog ?? {};
	const catalogValidation = validateSpecAgainstCatalog(spec, catalog);
	if (!catalogValidation.valid) {
		throw new SurfaceError(
			"catalog-error",
			`Catalog validation failed:\n${catalogValidation.errors.join("\n")}`,
			{ errors: catalogValidation.errors },
		);
	}
	try {
		return compileSpec(spec, opts);
	} catch (err) {
		// compileSpec re-throws validation errors plus may throw on missing
		// catalog entries for template-inner deferred nodes. Surface as
		// catalog-error; callers can inspect the wrapped message.
		const message = err instanceof Error ? err.message : String(err);
		throw new SurfaceError("catalog-error", message);
	}
}
