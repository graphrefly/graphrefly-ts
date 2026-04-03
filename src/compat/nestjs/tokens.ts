// ---------------------------------------------------------------------------
// NestJS DI tokens for GraphReFly integration.
// ---------------------------------------------------------------------------

/** Injection token for the root `Graph` singleton created by `forRoot()`. */
export const GRAPHREFLY_ROOT_GRAPH = Symbol.for("graphrefly:root-graph");

/** Injection token for `forRoot()` / `forFeature()` options. */
export const GRAPHREFLY_MODULE_OPTIONS = Symbol.for("graphrefly:module-options");

/** Injection token for the request-scoped `Graph` created by request scope config. */
export const GRAPHREFLY_REQUEST_GRAPH = Symbol.for("graphrefly:request-graph");

/**
 * Get the injection token for a named feature graph.
 *
 * Feature graphs registered via `GraphReflyModule.forFeature({ name })` are
 * injectable using this token (or via the `@InjectGraph(name)` decorator).
 */
export function getGraphToken(name: string): symbol {
	return Symbol.for(`graphrefly:graph:${name}`);
}

/**
 * Get the injection token for a node at a qualified path.
 *
 * Nodes declared in `forRoot({ nodes })` or `forFeature({ nodes })` are
 * injectable using this token (or via the `@InjectNode(path)` decorator).
 */
export function getNodeToken(path: string): symbol {
	return Symbol.for(`graphrefly:node:${path}`);
}
