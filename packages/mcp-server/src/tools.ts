/**
 * Tool handlers for the GraphReFly MCP server.
 *
 * Each handler is a pure function of `(session, params) → result`. The
 * server transport layer wraps these into MCP `registerTool` callbacks;
 * tests call them directly. Handlers throw {@link SurfaceError}; the
 * transport layer maps those to MCP `isError` responses.
 *
 * Tool names follow the roadmap: `graphrefly_<action>` (underscore,
 * lowercase). Matches the §9.3 deliverable list.
 *
 * @module
 */

import type { GraphDescribeOptions, GraphSpecCatalog, LLMAdapter } from "@graphrefly/graphrefly";
import {
	createGraph,
	deleteSnapshot,
	diffSnapshots,
	type Graph,
	listSnapshots,
	patterns,
	restoreSnapshot,
	runReduction,
	SurfaceError,
	saveSnapshot,
} from "@graphrefly/graphrefly";
import type { Session } from "./session.js";

/**
 * Look up a graph by id; throws `graph-not-found` when missing.
 * Handlers should use this instead of `session.graphs.get(...)` so error
 * shape is consistent across tools.
 */
function requireGraph(session: Session, graphId: string): Graph {
	const g = session.graphs.get(graphId);
	if (g == null) {
		throw new SurfaceError("graph-not-found", `graph "${graphId}" is not registered`, {
			graphId,
		});
	}
	return g;
}

// ---------------------------------------------------------------------------
// graphrefly_create
// ---------------------------------------------------------------------------

export interface CreateParams {
	graphId: string;
	spec: Record<string, unknown>;
}

export interface CreateResult {
	graphId: string;
	name: string;
	nodeCount: number;
	subgraphs: readonly string[];
}

export function graphreflyCreate(
	session: Session,
	params: CreateParams,
	catalog: GraphSpecCatalog,
): CreateResult {
	// TODO(transport-concurrency): check-then-set is safe under stdio (the
	// MCP SDK serializes requests on a single stdio connection), but racy
	// under future HTTP/SSE transports where multiple clients may share
	// one session. Swap in a per-graphId mutex when HTTP lands. Tracked
	// in docs/optimizations.md under "MCP session graph-registry race".
	if (session.graphs.has(params.graphId)) {
		throw new SurfaceError(
			"graph-exists",
			`graph "${params.graphId}" already exists; delete it first or use a different graphId`,
			{ graphId: params.graphId },
		);
	}
	// createGraph will throw SurfaceError on validation failures.
	const g = createGraph(params.spec as never, { catalog });
	session.graphs.set(params.graphId, g);
	const described = g.describe({ detail: "minimal" });
	return {
		graphId: params.graphId,
		name: described.name,
		nodeCount: Object.keys(described.nodes).length,
		subgraphs: described.subgraphs,
	};
}

// ---------------------------------------------------------------------------
// graphrefly_describe
// ---------------------------------------------------------------------------

export interface DescribeParams {
	graphId: string;
	detail?: "minimal" | "standard" | "full";
	format?: "json" | "spec" | "pretty" | "mermaid" | "d2";
}

export function graphreflyDescribe(
	session: Session,
	params: DescribeParams,
): Record<string, unknown> | string {
	const g = requireGraph(session, params.graphId);
	const opts: GraphDescribeOptions = {
		detail: params.detail ?? "standard",
	};
	if (params.format != null && params.format !== "json") {
		(opts as Record<string, unknown>).format = params.format;
		// Graph.describe returns a string for non-json formats.
		return g.describe(opts as GraphDescribeOptions) as unknown as string;
	}
	return g.describe(opts) as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// graphrefly_observe
// ---------------------------------------------------------------------------

export interface ObserveParams {
	graphId: string;
	path?: string;
	detail?: "minimal" | "standard" | "full";
}

/**
 * One-shot observation — a snapshot of node/graph state with progressive
 * detail levels. Live event streaming stays out of the MCP surface: stdio
 * tool calls are request/response, not a subscription channel.
 */
export function graphreflyObserve(
	session: Session,
	params: ObserveParams,
): Record<string, unknown> {
	const g = requireGraph(session, params.graphId);
	const detail = params.detail ?? "standard";
	const described = g.describe({ detail });
	if (params.path == null) return described as unknown as Record<string, unknown>;
	const slice = described.nodes[params.path];
	if (slice == null) {
		throw new SurfaceError(
			"node-not-found",
			`node "${params.path}" is not registered in graph "${params.graphId}"`,
			{ graphId: params.graphId, path: params.path },
		);
	}
	return { path: params.path, ...(slice as unknown as Record<string, unknown>) };
}

// ---------------------------------------------------------------------------
// graphrefly_explain
// ---------------------------------------------------------------------------

export interface ExplainParams {
	graphId: string;
	from: string;
	to: string;
	maxDepth?: number;
}

export function graphreflyExplain(session: Session, params: ExplainParams): unknown {
	const g = requireGraph(session, params.graphId);
	const opts: { maxDepth?: number } = {};
	if (params.maxDepth != null) opts.maxDepth = params.maxDepth;
	const chain = g.explain(params.from, params.to, opts);
	return chain.toJSON();
}

// ---------------------------------------------------------------------------
// graphrefly_reduce
// ---------------------------------------------------------------------------

export interface ReduceParams {
	spec: Record<string, unknown>;
	input: unknown;
	inputPath?: string;
	outputPath?: string;
	timeoutMs?: number;
}

export async function graphreflyReduce(
	params: ReduceParams,
	catalog: GraphSpecCatalog,
): Promise<unknown> {
	return runReduction(params.spec as never, params.input, {
		catalog,
		...(params.inputPath != null ? { inputPath: params.inputPath } : {}),
		...(params.outputPath != null ? { outputPath: params.outputPath } : {}),
		...(params.timeoutMs != null ? { timeoutMs: params.timeoutMs } : {}),
	});
}

// ---------------------------------------------------------------------------
// graphrefly_snapshot_save
// ---------------------------------------------------------------------------

export interface SnapshotSaveParams {
	graphId: string;
	snapshotId: string;
}

export async function graphreflySnapshotSave(
	session: Session,
	params: SnapshotSaveParams,
): Promise<{ snapshotId: string; timestamp_ns: number }> {
	const g = requireGraph(session, params.graphId);
	return saveSnapshot(g, params.snapshotId, session.tier);
}

// ---------------------------------------------------------------------------
// graphrefly_snapshot_restore
// ---------------------------------------------------------------------------

export interface SnapshotRestoreParams {
	snapshotId: string;
	graphId: string;
}

export async function graphreflySnapshotRestore(
	session: Session,
	params: SnapshotRestoreParams,
): Promise<{ graphId: string; name: string; nodeCount: number }> {
	if (session.graphs.has(params.graphId)) {
		throw new SurfaceError(
			"graph-exists",
			`graph "${params.graphId}" already exists; delete it first or use a different graphId`,
			{ graphId: params.graphId },
		);
	}
	const g = await restoreSnapshot(params.snapshotId, session.tier);
	session.graphs.set(params.graphId, g);
	const described = g.describe({ detail: "minimal" });
	return {
		graphId: params.graphId,
		name: described.name,
		nodeCount: Object.keys(described.nodes).length,
	};
}

// ---------------------------------------------------------------------------
// graphrefly_snapshot_diff
// ---------------------------------------------------------------------------

export interface SnapshotDiffParams {
	a: string;
	b: string;
}

export async function graphreflySnapshotDiff(
	session: Session,
	params: SnapshotDiffParams,
): Promise<unknown> {
	return diffSnapshots(params.a, params.b, session.tier);
}

// ---------------------------------------------------------------------------
// graphrefly_snapshot_list
// ---------------------------------------------------------------------------

export async function graphreflySnapshotList(session: Session): Promise<readonly string[]> {
	return listSnapshots(session.tier);
}

// ---------------------------------------------------------------------------
// graphrefly_snapshot_delete
// ---------------------------------------------------------------------------

export interface SnapshotDeleteParams {
	snapshotId: string;
}

export async function graphreflySnapshotDelete(
	session: Session,
	params: SnapshotDeleteParams,
): Promise<{ snapshotId: string; deleted: true }> {
	await deleteSnapshot(params.snapshotId, session.tier);
	return { snapshotId: params.snapshotId, deleted: true };
}

// ---------------------------------------------------------------------------
// graphrefly_delete
// ---------------------------------------------------------------------------

export interface DeleteParams {
	graphId: string;
}

export function graphreflyDelete(
	session: Session,
	params: DeleteParams,
): { graphId: string; deleted: true } {
	const g = requireGraph(session, params.graphId);
	session.graphs.delete(params.graphId);
	g.destroy();
	return { graphId: params.graphId, deleted: true };
}

// ---------------------------------------------------------------------------
// graphrefly_list
// ---------------------------------------------------------------------------

export function graphreflyList(session: Session): { graphs: readonly string[] } {
	return { graphs: [...session.graphs.keys()].sort() };
}

// ---------------------------------------------------------------------------
// graphrefly_compose
// ---------------------------------------------------------------------------

export interface ComposeParams {
	problem: string;
	model?: string;
	temperature?: number;
	maxAutoRefine?: number;
}

export interface ComposeResult {
	spec: Record<string, unknown>;
	validated: true;
}

export interface ComposeSettings {
	/** Pre-configured adapter. Required; when `undefined` the handler rejects. */
	readonly adapter: LLMAdapter | undefined;
	/**
	 * Operator-curated list of model IDs the client may pass via `params.model`.
	 * When set, any value outside the list is rejected with `compose-failed`
	 * before the LLM is called. `undefined` disables model gating (the adapter's
	 * default model always wins).
	 */
	readonly modelAllowlist?: readonly string[];
}

/**
 * NL→GraphSpec composition via `llmCompose`. The server operator wires a
 * pre-configured `LLMAdapter` (BYOK + credentials stay out of tool params);
 * this handler only receives the problem description and per-call knobs.
 *
 * Compose-only by design — returns the validated GraphSpec. Callers that
 * want to persist a compiled graph should follow with `graphrefly_create`.
 * Keeps tools atomic and error-shape consistent.
 */
export async function graphreflyCompose(
	params: ComposeParams,
	catalog: GraphSpecCatalog,
	settings: ComposeSettings,
): Promise<ComposeResult> {
	const { adapter, modelAllowlist } = settings;
	if (adapter == null) {
		throw new SurfaceError(
			"compose-not-configured",
			"graphrefly_compose: no composeAdapter wired at server startup; pass `composeAdapter` to buildMcpServer.",
		);
	}
	if (params.model != null && modelAllowlist != null && !modelAllowlist.includes(params.model)) {
		throw new SurfaceError(
			"compose-failed",
			`graphrefly_compose: model "${params.model}" is not in the server's composeModelAllowlist.`,
			{ model: params.model, allowlist: [...modelAllowlist] },
		);
	}
	try {
		const spec = await patterns.graphspec.llmCompose(params.problem, adapter, {
			...(params.model != null ? { model: params.model } : {}),
			...(params.temperature != null ? { temperature: params.temperature } : {}),
			...(params.maxAutoRefine != null ? { maxAutoRefine: params.maxAutoRefine } : {}),
			catalog,
		});
		return { spec: spec as unknown as Record<string, unknown>, validated: true };
	} catch (err) {
		// Preserve typed SurfaceError shape if llmCompose (or its internals)
		// ever grows to throw one — don't flatten the code to `compose-failed`.
		if (err instanceof SurfaceError) throw err;
		// Raw LLM content can appear in `llmCompose`'s parse-failure message
		// ("LLM response is not valid JSON: <200 chars>"). Surface a generic
		// user-facing message and stash the truncated excerpt in `details` so
		// operators debugging server-side still have it, but MCP clients don't
		// get a free echo of system-prompt / catalog fragments.
		const raw = err instanceof Error ? err.message : String(err);
		const excerpt = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
		throw new SurfaceError(
			"compose-failed",
			"llmCompose failed — see `details.excerpt` for diagnostic text.",
			{ excerpt },
		);
	}
}
