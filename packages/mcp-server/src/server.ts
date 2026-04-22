/**
 * MCP server wiring: registers every GraphReFly tool on a high-level
 * `McpServer`. Keeps transport-agnostic so the same `McpServer` can be
 * connected to stdio, HTTP, or a test transport.
 *
 * @module
 */

import type { GraphSpecCatalog, LLMAdapter } from "@graphrefly/graphrefly";
import { SurfaceError } from "@graphrefly/graphrefly";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "./session.js";
import {
	graphreflyCompose,
	graphreflyCreate,
	graphreflyDelete,
	graphreflyDescribe,
	graphreflyExplain,
	graphreflyList,
	graphreflyObserve,
	graphreflyReduce,
	graphreflySnapshotDelete,
	graphreflySnapshotDiff,
	graphreflySnapshotList,
	graphreflySnapshotRestore,
	graphreflySnapshotSave,
} from "./tools.js";

/** Options for {@link buildMcpServer}. */
export interface BuildMcpServerOptions {
	/**
	 * Fn/source catalog available to `graphrefly_create` and
	 * `graphrefly_reduce`. Catalog delivery over the wire is a separate
	 * design pass — server operators register the catalog at startup.
	 */
	catalog?: GraphSpecCatalog;
	/**
	 * Pre-configured LLM adapter for `graphrefly_compose` (NL→GraphSpec).
	 * Server operators wire this at startup from env/config — credentials
	 * stay off the MCP wire. Typically: `resilientAdapter(createAdapter({
	 * provider, apiKey, model }))`. Omit to disable the compose tool.
	 */
	composeAdapter?: LLMAdapter;
	/**
	 * Optional allowlist of model IDs clients may request via `graphrefly_compose`
	 * `params.model`. Any value outside this list is rejected with a typed
	 * `compose-failed` error BEFORE the adapter is invoked — so a malicious
	 * caller can't coerce an expensive frontier model onto operator-funded
	 * credentials. Omit to allow any model the caller passes (adapter default
	 * still wins when `params.model` is unset).
	 */
	composeModelAllowlist?: readonly string[];
	/** Server metadata; defaults match the npm package. */
	name?: string;
	version?: string;
	/** Extra instructions exposed to MCP clients. */
	instructions?: string;
}

function toContent(payload: unknown): { content: { type: "text"; text: string }[] } {
	return {
		content: [
			{
				type: "text",
				text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
			},
		],
	};
}

function wrap<P, R>(
	fn: (params: P) => R | Promise<R>,
): (params: P) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
	return async (params) => {
		try {
			const result = await fn(params);
			return toContent(result);
		} catch (err) {
			if (err instanceof SurfaceError) {
				return {
					content: [{ type: "text" as const, text: JSON.stringify(err.toJSON(), null, 2) }],
					isError: true,
				};
			}
			// Convert non-SurfaceError (raw strings, numbers, unknown Errors)
			// into an internal-error response instead of rethrowing — a
			// single buggy handler should not crash the transport loop
			// and kill the session.
			const message =
				err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
			const payload = {
				code: "internal-error" as const,
				message: message || "tool handler threw an unknown value",
			};
			return {
				content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
				isError: true,
			};
		}
	};
}

/**
 * Build a configured {@link McpServer} with every GraphReFly tool registered.
 *
 * The returned server is not connected to a transport — call
 * `server.connect(transport)` yourself, or use {@link startStdioServer}
 * for the common case.
 */
export function buildMcpServer(session: Session, opts?: BuildMcpServerOptions): McpServer {
	const catalog: GraphSpecCatalog = opts?.catalog ?? {};
	const server = new McpServer(
		{
			name: opts?.name ?? "@graphrefly/mcp-server",
			version: opts?.version ?? "0.0.1",
		},
		{
			instructions:
				opts?.instructions ??
				"GraphReFly harness server. Call graphrefly_create with a GraphSpec, then graphrefly_describe/observe/explain to inspect, graphrefly_reduce for one-shot runs, or graphrefly_snapshot_save/restore/diff/list for state management.",
		},
	);

	server.registerTool(
		"graphrefly_create",
		{
			title: "Create a graph",
			description: "Compile a GraphSpec into a running graph registered under graphId.",
			inputSchema: {
				graphId: z.string().min(1).describe("Client-chosen id for subsequent references."),
				spec: z
					.object({})
					.passthrough()
					.describe("GraphSpec JSON object — see @graphrefly/graphrefly graphspec."),
			},
		},
		wrap((p: { graphId: string; spec: Record<string, unknown> }) =>
			graphreflyCreate(session, p, catalog),
		),
	);

	server.registerTool(
		"graphrefly_describe",
		{
			title: "Describe a graph",
			description:
				"Topology + values snapshot of a registered graph. Progressive detail levels; optional diagram export.",
			inputSchema: {
				graphId: z.string().min(1),
				detail: z.enum(["minimal", "standard", "full"]).optional(),
				format: z.enum(["json", "spec", "pretty", "mermaid", "d2"]).optional(),
			},
		},
		wrap(
			(p: {
				graphId: string;
				detail?: "minimal" | "standard" | "full";
				format?: "json" | "spec" | "pretty" | "mermaid" | "d2";
			}) => graphreflyDescribe(session, p),
		),
	);

	server.registerTool(
		"graphrefly_observe",
		{
			title: "Observe node or graph state",
			description:
				"One-shot observation of a registered graph — optionally narrowed to a single node path. Progressive detail levels.",
			inputSchema: {
				graphId: z.string().min(1),
				path: z.string().optional(),
				detail: z.enum(["minimal", "standard", "full"]).optional(),
			},
		},
		wrap((p: { graphId: string; path?: string; detail?: "minimal" | "standard" | "full" }) =>
			graphreflyObserve(session, p),
		),
	);

	server.registerTool(
		"graphrefly_explain",
		{
			title: "Explain a causal chain",
			description: "Walk backward from `to` through `deps` to `from` and return a CausalChain.",
			inputSchema: {
				graphId: z.string().min(1),
				from: z.string().min(1),
				to: z.string().min(1),
				maxDepth: z.number().int().positive().optional(),
			},
		},
		wrap((p: { graphId: string; from: string; to: string; maxDepth?: number }) =>
			graphreflyExplain(session, p),
		),
	);

	server.registerTool(
		"graphrefly_reduce",
		{
			title: "Run a one-shot reduction",
			description:
				"Compile a GraphSpec, push `input` to `inputPath` (default 'input'), await the first DATA on `outputPath` (default 'output'), dispose. Stateless.",
			inputSchema: {
				spec: z.object({}).passthrough(),
				input: z.unknown(),
				inputPath: z.string().optional(),
				outputPath: z.string().optional(),
				timeoutMs: z.number().int().positive().optional(),
			},
		},
		wrap(
			(p: {
				spec: Record<string, unknown>;
				input: unknown;
				inputPath?: string;
				outputPath?: string;
				timeoutMs?: number;
			}) => graphreflyReduce(p, catalog),
		),
	);

	server.registerTool(
		"graphrefly_snapshot_save",
		{
			title: "Save a snapshot",
			description: "Serialize a registered graph's current state as a full checkpoint record.",
			inputSchema: {
				graphId: z.string().min(1),
				snapshotId: z.string().min(1),
			},
		},
		wrap((p: { graphId: string; snapshotId: string }) => graphreflySnapshotSave(session, p)),
	);

	server.registerTool(
		"graphrefly_snapshot_restore",
		{
			title: "Restore a snapshot",
			description:
				"Load a snapshot from the session's storage tier and register it as a new live graph under graphId.",
			inputSchema: {
				snapshotId: z.string().min(1),
				graphId: z.string().min(1),
			},
		},
		wrap((p: { snapshotId: string; graphId: string }) => graphreflySnapshotRestore(session, p)),
	);

	server.registerTool(
		"graphrefly_snapshot_diff",
		{
			title: "Diff two snapshots",
			description: "Compute a structural + value diff between two saved snapshots.",
			inputSchema: {
				a: z.string().min(1),
				b: z.string().min(1),
			},
		},
		wrap((p: { a: string; b: string }) => graphreflySnapshotDiff(session, p)),
	);

	server.registerTool(
		"graphrefly_snapshot_list",
		{
			title: "List saved snapshots",
			description: "Enumerate snapshot ids known to the session's storage tier.",
			inputSchema: {},
		},
		wrap(async () => graphreflySnapshotList(session)),
	);

	server.registerTool(
		"graphrefly_snapshot_delete",
		{
			title: "Delete a snapshot",
			description: "Remove a snapshot from the session's storage tier.",
			inputSchema: {
				snapshotId: z.string().min(1),
			},
		},
		wrap((p: { snapshotId: string }) => graphreflySnapshotDelete(session, p)),
	);

	server.registerTool(
		"graphrefly_delete",
		{
			title: "Unregister a graph",
			description: "Destroy a live graph and remove it from the session registry.",
			inputSchema: {
				graphId: z.string().min(1),
			},
		},
		wrap((p: { graphId: string }) => graphreflyDelete(session, p)),
	);

	server.registerTool(
		"graphrefly_list",
		{
			title: "List registered graphs",
			description: "Enumerate graphIds currently registered in the session.",
			inputSchema: {},
		},
		wrap(async () => graphreflyList(session)),
	);

	server.registerTool(
		"graphrefly_compose",
		{
			title: "Compose a GraphSpec from natural language",
			description:
				"NL→GraphSpec via llmCompose. Returns a validated spec only — follow with graphrefly_create to register and run it. Requires composeAdapter wired at server startup.",
			inputSchema: {
				problem: z.string().min(1).describe("Natural-language description of the graph to build."),
				model: z
					.string()
					.optional()
					.describe("Override the adapter's default model for this call."),
				temperature: z.number().min(0).max(2).optional(),
				maxAutoRefine: z
					.number()
					.int()
					.nonnegative()
					.optional()
					.describe(
						"Max catalog-validation refine attempts. Default 0. Each retry costs one LLM call.",
					),
			},
		},
		wrap((p: { problem: string; model?: string; temperature?: number; maxAutoRefine?: number }) =>
			graphreflyCompose(p, catalog, {
				adapter: opts?.composeAdapter,
				...(opts?.composeModelAllowlist != null
					? { modelAllowlist: opts.composeModelAllowlist }
					: {}),
			}),
		),
	);

	return server;
}
